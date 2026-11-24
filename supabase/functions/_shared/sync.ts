// "Verify purchase": for each of the caller's pending purchases, ask Paddle what
// became of the transaction, and feed the completed ones through the same
// apply_paddle_event a webhook would — one code path, so a sync can't grant
// anything a webhook wouldn't.
//
// It is the recovery path for a webhook that never arrived (a wrong secret, an
// outage longer than Paddle's retries), and create-checkout runs it first, so a
// buyer whose payment went through is never handed a second checkout.

import { bearerToken, corsHeaders, json, type AuthUser } from "./http.ts";
import { syncEventFor } from "./paddleEvents.ts";
import type { Reporter } from "./report.ts";
import type { ApplyResult } from "./webhook.ts";

export type SyncDeps = {
  priceId: string;
  // The caller's purchases still marked pending, newest first (and capped by
  // the caller — abandoned checkouts accumulate one per tap of Buy).
  listPending: (userId: string) => Promise<{ provider_transaction_id: string }[]>;
  getTransaction: (id: string) => Promise<Record<string, unknown>>;
  applyEvent: (event: unknown, priceId: string) => Promise<ApplyResult>;
  accountPlan: (userId: string) => Promise<"free" | "pro">;
  reporter: Reporter;
};

export type SyncResult = {
  plan: "free" | "pro";
  checked: number;
  applied: number;
  // A transaction is `paid` — the card was charged — but Paddle hasn't marked
  // it completed yet. Nothing to apply, but no new checkout should start.
  processing: boolean;
};

export async function syncPendingPurchases(userId: string, deps: SyncDeps): Promise<SyncResult> {
  const pending = await deps.listPending(userId);
  let applied = 0;
  let processing = false;

  for (const { provider_transaction_id: id } of pending) {
    let transaction: Record<string, unknown>;
    try {
      transaction = await deps.getTransaction(id);
    } catch (e) {
      // One unreachable transaction shouldn't hide another that completed.
      await deps.reporter.exception(e, { function: "sync-purchase", transaction_id: id });
      continue;
    }

    if (transaction.status === "paid") processing = true;
    if (transaction.status !== "completed") continue;

    const result = await deps.applyEvent(syncEventFor(transaction), deps.priceId);
    if (result.outcome === "failed") {
      await deps.reporter.message(
        "error",
        `apply_paddle_event failed for a synced transaction: ${result.sqlstate ?? "?"} ${result.error ?? ""}`.trim(),
        {
          function: "sync-purchase",
          event_id: result.event_id,
          transaction_id: id,
          sqlstate: result.sqlstate,
        },
      );
    } else if (result.outcome === "applied") {
      applied++;
    }
  }

  return { plan: await deps.accountPlan(userId), checked: pending.length, applied, processing };
}

export type SyncHandlerDeps = {
  getUser: (token: string) => Promise<AuthUser | null>;
  sync: (userId: string) => Promise<SyncResult>;
  reporter: Reporter;
};

export async function handleSyncPurchase(req: Request, deps: SyncHandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, corsHeaders);

  const token = bearerToken(req);
  const user = token ? await deps.getUser(token) : null;
  if (!user) {
    return json({ error: "Sign in to verify a purchase.", code: "unauthenticated" }, 401, corsHeaders);
  }

  try {
    const result = await deps.sync(user.id);
    return json({ plan: result.plan, processing: result.processing }, 200, corsHeaders);
  } catch (e) {
    await deps.reporter.exception(e, { function: "sync-purchase", user_id: user.id });
    return json(
      { error: "Couldn't check your purchase just now. Please try again.", code: "server_error" },
      500,
      corsHeaders,
    );
  }
}
