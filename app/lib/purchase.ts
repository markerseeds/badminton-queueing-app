// The buyer's side of Phase 3c with no React and no Supabase in it, so it is
// unit-tested (tests/logic/purchase.test.ts): what the Pro card's button says,
// and the sequence one tap of it runs. usePurchase wires the real pieces in.

import type { PlanName } from "./types";

export type ProCta =
  | { kind: "loading" }
  | { kind: "unavailable"; label: string }
  | { kind: "sign-in"; label: string }
  | { kind: "buy"; label: string }
  | { kind: "owned"; label: string };

export function proCta(input: {
  authLoading: boolean;
  // A real account. Anonymous counts as signed out: Pro can never be held by an
  // anonymous account (Phase 3b, enforced in Postgres), so the first step for
  // one is the sign-in that keeps their rooms.
  signedIn: boolean;
  plan: PlanName | null;
  // Localized by Paddle, e.g. "$30.00". Null while loading or unavailable.
  price: string | null;
  proSince: string | null;
  // False on a build without the NEXT_PUBLIC_PADDLE_* variables.
  configured: boolean;
  formatDate: (iso: string) => string;
}): ProCta {
  if (input.authLoading) return { kind: "loading" };

  // Before `configured`: a Pro account on a build without checkout is still Pro.
  if (input.signedIn && input.plan === "pro") {
    return {
      kind: "owned",
      label: input.proSince ? `You have Pro since ${input.formatDate(input.proSince)}` : "You have Pro",
    };
  }
  // Never a button that can only fail.
  if (!input.configured) return { kind: "unavailable", label: "Checkout unavailable" };
  if (!input.signedIn) return { kind: "sign-in", label: "Sign in to buy" };
  return { kind: "buy", label: input.price ? `Buy Pro: ${input.price}` : "Buy Pro" };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Calls `check` now, then every `intervalMs`, until `done` says so or
// `timeoutMs` has passed. A check that throws is a missed beat, not the end:
// courtside wifi drops requests.
export async function pollUntil<T>(
  check: () => Promise<T>,
  done: (value: T) => boolean,
  opts: {
    intervalMs: number;
    timeoutMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<{ value: T | undefined; done: boolean }> {
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const start = now();
  let value: T | undefined;
  for (;;) {
    try {
      value = await check();
      if (done(value)) return { value, done: true };
    } catch {
      // Try again next beat.
    }
    if (now() - start + opts.intervalMs > opts.timeoutMs) return { value, done: false };
    await sleep(opts.intervalMs);
  }
}

export type PurchaseStage = "checkout" | "confirming";

// How one tap of Buy ended:
//   signing-in — sent to Google first; they come back to /pricing
//   closed     — the overlay was closed without paying
//   pro        — the account is Pro
//   delayed    — Paddle took the payment but the plan hasn't caught up; the
//                page says "Pro is on its way" and offers Verify purchase
export type PurchaseOutcome = "signing-in" | "closed" | "pro" | "delayed";

export type PurchaseDeps = {
  signedIn: boolean;
  signIn: () => Promise<void>;
  createCheckout: () => Promise<{ transactionId: string }>;
  openCheckout: (transactionId: string) => Promise<"completed" | "closed">;
  getPlan: () => Promise<PlanName | null>;
  syncPurchase: () => Promise<{ plan: PlanName }>;
  onStage?: (stage: PurchaseStage) => void;
  poll?: {
    intervalMs: number;
    timeoutMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  };
};

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

export async function runPurchase(deps: PurchaseDeps): Promise<PurchaseOutcome> {
  if (!deps.signedIn) {
    await deps.signIn();
    return "signing-in";
  }

  let transactionId: string;
  try {
    ({ transactionId } = await deps.createCheckout());
  } catch (e) {
    // create-checkout checks this account's pending purchases with Paddle
    // before starting another, so these two refusals mean "you've already
    // paid" — good news, not an error.
    if (codeOf(e) === "already_pro") return "pro";
    if (codeOf(e) === "payment_processing") return "delayed";
    throw e;
  }

  deps.onStage?.("checkout");
  if ((await deps.openCheckout(transactionId)) === "closed") return "closed";

  // Paddle reports completion in the browser before its webhook has
  // necessarily reached the server. Poll the plan for a while — about once a
  // second for up to 30 seconds…
  deps.onStage?.("confirming");
  const polled = await pollUntil(deps.getPlan, (plan) => plan === "pro", {
    intervalMs: 1000,
    timeoutMs: 30_000,
    ...deps.poll,
  });
  if (polled.done) return "pro";

  // …then ask the server to check with Paddle directly, once. If even that
  // finds nothing yet, the payment still went through: say so.
  try {
    if ((await deps.syncPurchase()).plan === "pro") return "pro";
  } catch {
    // Same answer as "not yet" — the Verify purchase button can retry.
  }
  return "delayed";
}

// Which Paddle.js events end an open checkout, for paddle.ts. Kept here so it
// is tested: `checkout.error` is easy to forget, and a promise that waits only
// for completed/closed hangs forever when Paddle refuses to open a transaction
// (an unapproved domain, a bad id) — which leaves the page stuck on "complete
// your purchase". After completion nothing else matters; a declined card keeps
// the overlay open for another try, so it settles nothing either.
export function checkoutEventOutcome(
  name: string | undefined,
  completed: boolean,
): "completed" | "closed" | "error" | null {
  if (name === "checkout.completed") return "completed";
  if (completed) return null;
  if (name === "checkout.closed") return "closed";
  if (name === "checkout.error") return "error";
  return null;
}

// What the page shows once a tap of Buy has run its course. A sign-in that
// returns without leaving the page (Google refused, storage blocked) lands
// back on idle, so the button never stays disabled on "Starting checkout…".
export function statusAfter(outcome: PurchaseOutcome): "idle" | "pro" | "delayed" {
  if (outcome === "pro" || outcome === "delayed") return outcome;
  return "idle";
}
