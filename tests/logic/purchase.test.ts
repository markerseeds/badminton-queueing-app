import { describe, expect, it } from "vitest";
import {
  pollUntil,
  proCta,
  runPurchase,
  type PurchaseDeps,
} from "../../app/lib/purchase";

// The buyer's side of Phase 3c, minus the DOM: what the Pro card's button says,
// and the sequence a tap of it runs — sign in, checkout, then wait for the plan
// to change. The waiting is the subtle part. Paddle reports `checkout.completed`
// in the browser before its webhook has necessarily reached us, so the page
// polls `my_limits()`; if that runs out, it asks the server to check with
// Paddle directly ("Verify purchase"); and if even that finds nothing yet, it
// says the payment arrived and Pro is on its way rather than implying failure.

const date = (iso: string) => `on ${iso.slice(0, 10)}`;

describe("proCta", () => {
  const base = {
    authLoading: false,
    signedIn: true,
    plan: "free" as const,
    price: "$30.00",
    proSince: null,
    configured: true,
    formatDate: date,
  };

  it("offers the purchase at the local price to a signed-in free account", () => {
    expect(proCta(base)).toEqual({ kind: "buy", label: "Buy Pro: $30.00" });
  });

  it("still offers it while the price is loading", () => {
    expect(proCta({ ...base, price: null })).toEqual({ kind: "buy", label: "Buy Pro" });
  });

  // Anonymous counts as signed out here: Pro can never be held by an anonymous
  // account (Phase 3b, enforced in Postgres), so the honest first step is the
  // sign-in that keeps their rooms.
  it("asks anyone not signed in with Google to sign in first", () => {
    expect(proCta({ ...base, signedIn: false, plan: null })).toEqual({
      kind: "sign-in",
      label: "Sign in to buy",
    });
  });

  it("tells a Pro account since when — one unlock per account", () => {
    expect(proCta({ ...base, plan: "pro", proSince: "2026-11-24T08:15:45Z" })).toEqual({
      kind: "owned",
      label: "You have Pro since on 2026-11-24",
    });
    expect(proCta({ ...base, plan: "pro", proSince: null })).toEqual({
      kind: "owned",
      label: "You have Pro",
    });
  });

  // A build without the Paddle variables (local dev, a preview) must not offer
  // a button that can only fail — but a Pro account still sees that it's Pro.
  it("offers nothing to buy when checkout isn't configured", () => {
    expect(proCta({ ...base, configured: false })).toEqual({
      kind: "unavailable",
      label: "Checkout unavailable",
    });
    expect(proCta({ ...base, configured: false, plan: "pro" }).kind).toBe("owned");
  });

  it("waits for auth to resolve before committing to a label", () => {
    expect(proCta({ ...base, authLoading: true })).toEqual({ kind: "loading" });
  });
});

describe("pollUntil", () => {
  function clock() {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  }

  it("returns as soon as the check is satisfied", async () => {
    const c = clock();
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      (n) => n === 3,
      { intervalMs: 1000, timeoutMs: 30_000, ...c },
    );
    expect(result).toEqual({ value: 3, done: true });
    expect(calls).toBe(3);
  });

  it("gives up once the time is spent", async () => {
    const c = clock();
    let calls = 0;
    const result = await pollUntil(
      async () => ++calls,
      () => false,
      { intervalMs: 1000, timeoutMs: 30_000, ...c },
    );
    expect(result.done).toBe(false);
    // Once at t=0, then once a second up to and including t=30s.
    expect(calls).toBe(31);
  });

  // Courtside wifi drops requests; one failed poll isn't the answer.
  it("keeps polling through a failed check", async () => {
    const c = clock();
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        if (calls < 3) throw new Error("offline");
        return "pro";
      },
      (plan) => plan === "pro",
      { intervalMs: 1000, timeoutMs: 30_000, ...c },
    );
    expect(result).toEqual({ value: "pro", done: true });
  });
});

describe("runPurchase", () => {
  function deps(overrides: Partial<PurchaseDeps> = {}) {
    const log: string[] = [];
    let t = 0;
    const d: PurchaseDeps = {
      signedIn: true,
      signIn: async () => void log.push("signIn"),
      createCheckout: async () => {
        log.push("createCheckout");
        return { transactionId: "txn_1" };
      },
      openCheckout: async (id) => {
        log.push(`openCheckout:${id}`);
        return "completed";
      },
      getPlan: async () => {
        log.push("getPlan");
        return "pro";
      },
      syncPurchase: async () => {
        log.push("syncPurchase");
        return { plan: "free" };
      },
      onStage: (stage) => log.push(`stage:${stage}`),
      poll: { intervalMs: 1000, timeoutMs: 30_000, now: () => t, sleep: async (ms) => void (t += ms) },
      ...overrides,
    };
    return { d, log };
  }

  it("sends someone not signed in to sign in, and nothing else", async () => {
    const { d, log } = deps({ signedIn: false });
    expect(await runPurchase(d)).toBe("signing-in");
    expect(log).toEqual(["signIn"]);
  });

  it("creates the checkout, opens it, and confirms Pro from the plan", async () => {
    const { d, log } = deps();
    expect(await runPurchase(d)).toBe("pro");
    expect(log).toEqual([
      "createCheckout",
      "stage:checkout",
      "openCheckout:txn_1",
      "stage:confirming",
      "getPlan",
    ]);
  });

  it("stops quietly when the overlay is closed without paying", async () => {
    const { d, log } = deps({
      openCheckout: async () => "closed",
    });
    expect(await runPurchase(d)).toBe("closed");
    expect(log).not.toContain("getPlan");
  });

  it("asks the server to check with Paddle when the webhook is slow", async () => {
    const { d, log } = deps({
      getPlan: async () => "free",
      syncPurchase: async () => {
        log.push("syncPurchase");
        return { plan: "pro" };
      },
    });
    expect(await runPurchase(d)).toBe("pro");
    expect(log.filter((l) => l === "syncPurchase")).toHaveLength(1);
  });

  it("says Pro is on its way when nothing has caught up yet", async () => {
    const { d } = deps({ getPlan: async () => "free" });
    expect(await runPurchase(d)).toBe("delayed");
  });

  it("treats a failed verify as 'on its way', not as an error", async () => {
    const { d } = deps({
      getPlan: async () => "free",
      syncPurchase: async () => {
        throw new Error("network");
      },
    });
    expect(await runPurchase(d)).toBe("delayed");
  });

  // create-checkout checks the account's pending purchases with Paddle first,
  // so these two refusals mean "you've already paid", not "something broke".
  it("treats an already-Pro refusal as Pro, without opening a checkout", async () => {
    const { d, log } = deps({
      createCheckout: async () => {
        throw Object.assign(new Error("already"), { code: "already_pro" });
      },
    });
    expect(await runPurchase(d)).toBe("pro");
    expect(log).not.toContain("openCheckout:txn_1");
  });

  it("treats a payment still processing as 'on its way'", async () => {
    const { d } = deps({
      createCheckout: async () => {
        throw Object.assign(new Error("processing"), { code: "payment_processing" });
      },
    });
    expect(await runPurchase(d)).toBe("delayed");
  });

  it("lets any other refusal through to be shown", async () => {
    const { d } = deps({
      createCheckout: async () => {
        throw Object.assign(new Error("Sign in with Google first"), { code: "anonymous" });
      },
    });
    await expect(runPurchase(d)).rejects.toThrow("Sign in with Google first");
  });
});
