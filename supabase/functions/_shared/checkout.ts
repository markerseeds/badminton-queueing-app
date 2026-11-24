// create-checkout's request handling, with every dependency passed in (the Deno
// entry file wires the real ones).
//
// The server creates the Paddle transaction rather than the browser opening a
// checkout for the price directly, for three reasons:
//   * the refusals happen BEFORE anyone pays — an anonymous account can never
//     hold Pro (Phase 3b's invariant, enforced in Postgres), and an account that
//     already has it would be paying twice for one unlock — and both are
//     cheaper to refuse here than to refund later;
//   * the transaction id is recorded as a pending purchase first, which is what
//     lets "Verify purchase" recover a payment whose webhook never arrived;
//   * the buyer is attached to a Paddle customer for the account's own verified
//     email, so Paddle's receipts and refunds line up with one account.

import { bearerToken, corsHeaders, json, type AuthUser } from "./http.ts";
import type { Reporter } from "./report.ts";
import type { SyncResult } from "./sync.ts";

export type CheckoutUser = AuthUser;

export type CheckoutDeps = {
  priceId: string | undefined;
  appName: string;
  getUser: (token: string) => Promise<CheckoutUser | null>;
  accountPlan: (userId: string) => Promise<"free" | "pro">;
  // Checks the caller's pending purchases with Paddle first (see sync.ts).
  reconcile: (userId: string) => Promise<SyncResult>;
  findOrCreateCustomer: (email: string) => Promise<string>;
  createTransaction: (input: {
    priceId: string;
    customerId: string;
    customData: Record<string, string>;
  }) => Promise<{ id: string }>;
  insertPending: (row: {
    user_id: string;
    provider_transaction_id: string;
    provider_customer_id: string;
    price_id: string;
  }) => Promise<void>;
  reporter: Reporter;
};

function refuse(status: number, code: string, error: string): Response {
  return json({ error, code }, status, corsHeaders);
}

export async function handleCreateCheckout(req: Request, deps: CheckoutDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return refuse(405, "method_not_allowed", "Method not allowed.");

  const token = bearerToken(req);
  const user = token ? await deps.getUser(token) : null;
  if (!user) return refuse(401, "unauthenticated", "Sign in to buy Pro.");

  if (user.isAnonymous) {
    return refuse(
      403,
      "anonymous",
      "Sign in with Google first — Pro belongs to an account, not to this browser.",
    );
  }
  if (!user.email || !user.emailVerified) {
    return refuse(403, "no_verified_email", "Your account needs a verified email address to buy Pro.");
  }

  if (!deps.priceId) {
    await deps.reporter.message("error", "create-checkout is missing PADDLE_PRICE_ID", {
      function: "create-checkout",
    });
    return refuse(500, "misconfigured", "Checkout isn't set up yet. Please try again later.");
  }

  const tags = { function: "create-checkout", user_id: user.id };

  try {
    // One unlock per account. The cheap check first…
    if ((await deps.accountPlan(user.id)) === "pro") {
      return refuse(409, "already_pro", "This account already has Pro.");
    }
    // …then the one that costs a Paddle call per pending purchase: a payment
    // that went through but whose webhook is late or lost leaves the buyer
    // looking free, and tapping Buy again must find it rather than charge again.
    const reconciled = await deps.reconcile(user.id);
    if (reconciled.plan === "pro") {
      return refuse(409, "already_pro", "We found your payment — this account already has Pro.");
    }
    if (reconciled.processing) {
      return refuse(
        409,
        "payment_processing",
        "Your payment is still being processed — Pro will arrive in a moment.",
      );
    }
  } catch (e) {
    await deps.reporter.exception(e, tags);
    return refuse(500, "server_error", "Couldn't start checkout. Please try again.");
  }

  let customerId: string;
  let transactionId: string;
  try {
    customerId = await deps.findOrCreateCustomer(user.email);
    const txn = await deps.createTransaction({
      priceId: deps.priceId,
      customerId,
      // Read back by apply_paddle_event only when the pending row below is
      // missing; `app` tells this app's transactions apart in Paddle's
      // dashboard if the account ever sells anything else.
      customData: { user_id: user.id, app: deps.appName },
    });
    transactionId = txn.id;
  } catch (e) {
    await deps.reporter.exception(e, tags);
    return refuse(502, "provider_error", "Couldn't reach the payment provider. Please try again.");
  }

  try {
    await deps.insertPending({
      user_id: user.id,
      provider_transaction_id: transactionId,
      provider_customer_id: customerId,
      price_id: deps.priceId,
    });
  } catch (e) {
    // Without this row the webhook could still find the buyer through
    // custom_data, but "Verify purchase" could not — so an unrecorded
    // transaction is never handed to the browser to pay.
    await deps.reporter.exception(e, { ...tags, transaction_id: transactionId });
    return refuse(500, "server_error", "Couldn't start checkout. Please try again.");
  }

  return json({ transactionId }, 200, corsHeaders);
}
