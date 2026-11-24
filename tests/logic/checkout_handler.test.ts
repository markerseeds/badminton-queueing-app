import { describe, expect, it } from "vitest";
import {
  handleCreateCheckout,
  type CheckoutDeps,
  type CheckoutUser,
} from "../../supabase/functions/_shared/checkout.ts";
import type { SyncResult } from "../../supabase/functions/_shared/sync.ts";
import type { Reporter } from "../../supabase/functions/_shared/report.ts";
import { PaddleApiError } from "../../supabase/functions/_shared/paddleApi.ts";

// create-checkout, with every dependency a recorder. The server — not the
// browser — creates the Paddle transaction, so that the refusals happen BEFORE
// anyone pays: an anonymous account can never hold Pro (Phase 3b's invariant,
// enforced in Postgres), and an account that already has it would be paying
// twice for one unlock. Both are cheaper to refuse here than to refund.

const REAL: CheckoutUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "sam@example.com",
  emailVerified: true,
  isAnonymous: false,
};

function request(opts: { token?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? "user-jwt"}`;
  return new Request("http://localhost/functions/v1/create-checkout", {
    method: opts.method ?? "POST",
    headers,
  });
}

function setup(overrides: Partial<CheckoutDeps> = {}, user: CheckoutUser | null = REAL) {
  const calls: string[] = [];
  const pending: unknown[] = [];
  const reports: { level: string; text: string }[] = [];
  const reporter: Reporter = {
    async exception(error) {
      reports.push({ level: "exception", text: error instanceof Error ? error.message : String(error) });
    },
    async message(level, text) {
      reports.push({ level, text });
    },
  };
  const deps: CheckoutDeps = {
    priceId: "pri_pro",
    appName: "badminton-queue",
    reporter,
    getUser: async (token) => {
      calls.push(`getUser:${token}`);
      return user;
    },
    accountPlan: async () => {
      calls.push("accountPlan");
      return "free";
    },
    reconcile: async (): Promise<SyncResult> => {
      calls.push("reconcile");
      return { plan: "free", checked: 0, applied: 0, processing: false };
    },
    findOrCreateCustomer: async (email) => {
      calls.push(`customer:${email}`);
      return "ctm_1";
    },
    createTransaction: async (input) => {
      calls.push(`transaction:${input.priceId}:${input.customerId}`);
      return { id: "txn_new" };
    },
    insertPending: async (row) => {
      calls.push("insertPending");
      pending.push(row);
    },
    ...overrides,
  };
  return { deps, calls, pending, reports };
}

describe("handleCreateCheckout", () => {
  it("creates a transaction for the buyer's verified email and records it as pending", async () => {
    const t = setup();

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transactionId: "txn_new" });
    expect(t.calls).toEqual([
      "getUser:user-jwt",
      "accountPlan",
      "reconcile",
      "customer:sam@example.com",
      "transaction:pri_pro:ctm_1",
      "insertPending",
    ]);
    expect(t.pending).toEqual([
      {
        user_id: REAL.id,
        provider_transaction_id: "txn_new",
        provider_customer_id: "ctm_1",
        price_id: "pri_pro",
      },
    ]);
    // The browser calls this cross-origin.
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("puts the buyer and the app in custom_data", async () => {
    let customData: unknown;
    const t = setup({
      createTransaction: async (input) => {
        customData = input.customData;
        return { id: "txn_new" };
      },
    });

    await handleCreateCheckout(request(), t.deps);

    expect(customData).toEqual({ user_id: REAL.id, app: "badminton-queue" });
  });

  it("answers the CORS preflight", async () => {
    const t = setup();
    const res = await handleCreateCheckout(request({ method: "OPTIONS" }), t.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/);
    expect(t.calls).toEqual([]);
  });

  it("refuses a caller with no token, or one that isn't a user", async () => {
    const noToken = setup();
    expect((await handleCreateCheckout(request({ token: null }), noToken.deps)).status).toBe(401);
    expect(noToken.calls).toEqual([]);

    const unknown = setup({}, null);
    const res = await handleCreateCheckout(request(), unknown.deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("refuses an anonymous account before anything is created", async () => {
    const t = setup({}, { ...REAL, email: null, emailVerified: false, isAnonymous: true });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "anonymous" });
    expect(t.calls).toEqual(["getUser:user-jwt"]);
  });

  // The Paddle customer is keyed on the account's email, so that email has to
  // be one the account actually controls.
  it("refuses an account with no verified email", async () => {
    const t = setup({}, { ...REAL, emailVerified: false });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "no_verified_email" });
    expect(t.calls).toEqual(["getUser:user-jwt"]);
  });

  it("refuses an account that already has Pro — one unlock per account", async () => {
    const t = setup({
      accountPlan: async () => {
        t.calls.push("accountPlan");
        return "pro";
      },
    });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "already_pro" });
    expect(t.calls).toEqual(["getUser:user-jwt", "accountPlan"]);
  });

  // The double-charge this exists to prevent: the webhook for a payment that
  // went through is late or lost, the buyer sees no Pro, and taps Buy again.
  // Checking their pending transactions with Paddle first finds the payment.
  it("finds a payment whose webhook never arrived instead of charging again", async () => {
    const t = setup({
      reconcile: async () => {
        t.calls.push("reconcile");
        return { plan: "pro", checked: 1, applied: 1, processing: false };
      },
    });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "already_pro" });
    expect(t.calls).not.toContain("insertPending");
  });

  it("refuses while an earlier payment is still being processed", async () => {
    const t = setup({
      reconcile: async () => ({ plan: "free", checked: 1, applied: 0, processing: true }),
    });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "payment_processing" });
  });

  it("answers 502 and reports when Paddle refuses, recording nothing", async () => {
    const t = setup({
      createTransaction: async () => {
        throw new PaddleApiError(400, "bad_request", "price is archived");
      },
    });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "provider_error" });
    expect(t.pending).toEqual([]);
    expect(t.reports[0]).toMatchObject({ level: "exception" });
    expect(t.reports[0].text).toMatch(/price is archived/);
  });

  // Without the pending row the webhook still finds the buyer through
  // custom_data, but "Verify purchase" could not — so a checkout that can't be
  // recorded isn't handed to the browser at all.
  it("answers 500 and opens no checkout when the pending row can't be written", async () => {
    const t = setup({
      insertPending: async () => {
        throw new Error("insert failed");
      },
    });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("transactionId");
    expect(t.reports[0]).toMatchObject({ level: "exception", text: "insert failed" });
  });

  it("answers 500 and reports when no price is configured", async () => {
    const t = setup({ priceId: undefined });

    const res = await handleCreateCheckout(request(), t.deps);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "misconfigured" });
    expect(t.reports[0]).toMatchObject({ level: "error" });
  });
});
