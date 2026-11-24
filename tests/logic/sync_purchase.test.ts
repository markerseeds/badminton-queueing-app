import { describe, expect, it } from "vitest";
import {
  handleSyncPurchase,
  syncPendingPurchases,
  type SyncDeps,
} from "../../supabase/functions/_shared/sync.ts";
import { syncEventFor } from "../../supabase/functions/_shared/paddleEvents.ts";
import type { ApplyResult } from "../../supabase/functions/_shared/webhook.ts";
import type { Reporter } from "../../supabase/functions/_shared/report.ts";
import { loadFixture } from "../helpers/paddle";

// "Verify purchase": for each of the caller's pending purchases, ask Paddle
// what became of the transaction, and feed the completed ones through the same
// apply_paddle_event a webhook would. It is the recovery path for a webhook
// that never arrived — a wrong secret, an outage longer than Paddle's retries —
// and create-checkout runs it first so a buyer whose payment went through is
// never charged a second time.

const USER = "22222222-2222-4222-8222-222222222222";

function transaction(id: string, status: string) {
  const tx = loadFixture("transaction.completed").data;
  tx.id = id;
  tx.status = status;
  return tx;
}

function setup(statuses: Record<string, string | Error>, overrides: Partial<SyncDeps> = {}) {
  const applied: unknown[] = [];
  const reports: { level: string; text: string }[] = [];
  const reporter: Reporter = {
    async exception(error) {
      reports.push({ level: "exception", text: error instanceof Error ? error.message : String(error) });
    },
    async message(level, text) {
      reports.push({ level, text });
    },
  };
  let plan: "free" | "pro" = "free";
  const deps: SyncDeps = {
    priceId: "pri_pro",
    reporter,
    listPending: async () => Object.keys(statuses).map((id) => ({ provider_transaction_id: id })),
    getTransaction: async (id) => {
      const s = statuses[id];
      if (s instanceof Error) throw s;
      return transaction(id, s);
    },
    applyEvent: async (event): Promise<ApplyResult> => {
      applied.push(event);
      plan = "pro";
      return { outcome: "applied", event_id: (event as { event_id: string }).event_id, plan: "pro" };
    },
    accountPlan: async () => plan,
    ...overrides,
  };
  return { deps, applied, reports };
}

describe("syncPendingPurchases", () => {
  it("applies a completed transaction through apply_paddle_event", async () => {
    const t = setup({ txn_paid: "completed" });

    const result = await syncPendingPurchases(USER, t.deps);

    expect(t.applied).toEqual([syncEventFor(transaction("txn_paid", "completed"))]);
    expect(result).toEqual({ plan: "pro", checked: 1, applied: 1, processing: false });
  });

  it("leaves a transaction that hasn't been paid alone", async () => {
    const t = setup({ txn_open: "ready", txn_draft: "draft", txn_gone: "canceled" });

    const result = await syncPendingPurchases(USER, t.deps);

    expect(t.applied).toEqual([]);
    expect(result).toEqual({ plan: "free", checked: 3, applied: 0, processing: false });
  });

  // `paid` is the moment between the card being charged and Paddle marking the
  // transaction completed. Nothing to apply yet, but the money has moved — so
  // create-checkout must not start another checkout.
  it("notices a payment that is still being processed", async () => {
    const t = setup({ txn_paying: "paid" });

    const result = await syncPendingPurchases(USER, t.deps);

    expect(t.applied).toEqual([]);
    expect(result.processing).toBe(true);
  });

  it("keeps going when one transaction can't be fetched, and reports it", async () => {
    const t = setup({ txn_broken: new Error("Paddle timed out"), txn_paid: "completed" });

    const result = await syncPendingPurchases(USER, t.deps);

    expect(result).toMatchObject({ plan: "pro", applied: 1 });
    expect(t.reports).toEqual([{ level: "exception", text: "Paddle timed out" }]);
  });

  it("reports a completed transaction the database refused", async () => {
    const t = setup(
      { txn_paid: "completed" },
      {
        applyEvent: async (event) => ({
          outcome: "failed",
          event_id: (event as { event_id: string }).event_id,
          sqlstate: "23514",
          error: "anonymous",
        }),
      },
    );

    const result = await syncPendingPurchases(USER, t.deps);

    expect(result).toMatchObject({ plan: "free", applied: 0 });
    expect(t.reports[0]).toMatchObject({ level: "error" });
    expect(t.reports[0].text).toMatch(/23514/);
  });
});

describe("handleSyncPurchase", () => {
  function request(token: string | null = "user-jwt", method = "POST") {
    return new Request("http://localhost/functions/v1/sync-purchase", {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  it("syncs the caller's purchases and answers with their plan", async () => {
    const synced: string[] = [];
    const res = await handleSyncPurchase(request(), {
      reporter: { exception: async () => {}, message: async () => {} },
      getUser: async () => ({ id: USER, email: "sam@example.com", emailVerified: true, isAnonymous: false }),
      sync: async (userId) => {
        synced.push(userId);
        return { plan: "pro", checked: 1, applied: 1, processing: false };
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: "pro", processing: false });
    expect(synced).toEqual([USER]);
  });

  it("refuses a caller who isn't signed in", async () => {
    for (const getUser of [async () => null]) {
      const res = await handleSyncPurchase(request(), {
        reporter: { exception: async () => {}, message: async () => {} },
        getUser,
        sync: async () => {
          throw new Error("should not sync");
        },
      });
      expect(res.status).toBe(401);
    }
    const res = await handleSyncPurchase(request(null), {
      reporter: { exception: async () => {}, message: async () => {} },
      getUser: async () => null,
      sync: async () => {
        throw new Error("should not sync");
      },
    });
    expect(res.status).toBe(401);
  });

  it("answers the CORS preflight", async () => {
    const res = await handleSyncPurchase(request(null, "OPTIONS"), {
      reporter: { exception: async () => {}, message: async () => {} },
      getUser: async () => null,
      sync: async () => {
        throw new Error("should not sync");
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
