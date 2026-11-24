import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handlePaddleWebhook, type ApplyResult } from "../../supabase/functions/_shared/webhook.ts";
import type { Reporter, ReportTags } from "../../supabase/functions/_shared/report.ts";
import { loadFixture, TEST_PRICE_ID } from "../helpers/paddle";

// The paddle-webhook function's request handling, with the database call and
// the error reporter replaced by recorders. What this pins down is the contract
// with Paddle: 200 means "stop retrying", anything else means "send it again",
// so every outcome has to land on the right side of that line — and every
// failure that costs a customer money has to reach a person.

const SECRET = "pdl_ntfset_local_test_only_not_a_real_secret";
const NOW = Date.parse("2026-11-24T08:15:50Z");

function signedRequest(body: string, opts: { secret?: string; method?: string; ts?: number } = {}) {
  const ts = opts.ts ?? Math.floor(NOW / 1000);
  const h1 = createHmac("sha256", opts.secret ?? SECRET).update(`${ts}:${body}`).digest("hex");
  return new Request("http://localhost/functions/v1/paddle-webhook", {
    method: opts.method ?? "POST",
    headers: { "content-type": "application/json", "paddle-signature": `ts=${ts};h1=${h1}` },
    body: opts.method === "GET" ? undefined : body,
  });
}

function recorder() {
  const reports: { kind: "exception" | "message"; level?: string; text: string; tags: ReportTags }[] = [];
  const reporter: Reporter = {
    async exception(error, tags = {}) {
      reports.push({ kind: "exception", text: error instanceof Error ? error.message : String(error), tags });
    },
    async message(level, text, tags = {}) {
      reports.push({ kind: "message", level, text, tags });
    },
  };
  return { reporter, reports };
}

function deps(apply: (event: unknown, priceId: string) => Promise<ApplyResult>) {
  const { reporter, reports } = recorder();
  const applied: { event: unknown; priceId: string }[] = [];
  return {
    reports,
    applied,
    deps: {
      secret: SECRET,
      priceId: TEST_PRICE_ID,
      reporter,
      now: () => NOW,
      log: () => {},
      applyEvent: async (event: unknown, priceId: string) => {
        applied.push({ event, priceId });
        return apply(event, priceId);
      },
    },
  };
}

const completed = loadFixture("transaction.completed");
const body = JSON.stringify(completed);

describe("handlePaddleWebhook", () => {
  it("applies a verified delivery and answers 200", async () => {
    const t = deps(async () => ({ outcome: "applied", event_id: completed.event_id }));

    const res = await handlePaddleWebhook(signedRequest(body), t.deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "applied" });
    // The raw payload, exactly as Paddle sent it, plus the configured price.
    expect(t.applied).toEqual([{ event: completed, priceId: TEST_PRICE_ID }]);
    expect(t.reports).toEqual([]);
  });

  // Each of these means "nothing more to do", and a non-200 would have Paddle
  // retry it 60 times over two days for no reason.
  it("answers 200 for a duplicate, an ignored and a stale event", async () => {
    for (const outcome of ["duplicate", "ignored", "stale"] as const) {
      const t = deps(async () => ({ outcome, event_id: completed.event_id }));
      const res = await handlePaddleWebhook(signedRequest(body), t.deps);
      expect(res.status, outcome).toBe(200);
      expect(await res.json()).toEqual({ outcome });
      expect(t.reports).toEqual([]);
    }
  });

  // The case monitoring exists for: Paddle is told to retry (every retry is
  // harmless), and a person is told why, with enough tags to find the payload
  // in webhook_events without reading logs.
  it("answers 500 for a failed event and reports it tagged for lookup", async () => {
    const t = deps(async () => ({
      outcome: "failed",
      event_id: completed.event_id,
      transaction_id: "txn_01jh8tzx9kq2w3e4r5t6y7u8i9",
      sqlstate: "23514",
      error: "A Pro plan needs a signed-in account — this one is anonymous",
    }));

    const res = await handlePaddleWebhook(signedRequest(body), t.deps);

    expect(res.status).toBe(500);
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0]).toMatchObject({
      kind: "message",
      level: "error",
      tags: {
        event_id: completed.event_id,
        event_type: "transaction.completed",
        transaction_id: "txn_01jh8tzx9kq2w3e4r5t6y7u8i9",
        sqlstate: "23514",
      },
    });
    expect(t.reports[0].text).toMatch(/anonymous/);
  });

  it("refuses a bad signature with 401 without touching the database", async () => {
    const t = deps(async () => ({ outcome: "applied", event_id: "x" }));

    const res = await handlePaddleWebhook(signedRequest(body, { secret: "pdl_ntfset_wrong" }), t.deps);

    expect(res.status).toBe(401);
    expect(t.applied).toEqual([]);
    // A well-formed Paddle header with the wrong HMAC is almost always this
    // destination's secret being wrong — every real purchase would now be
    // refused — so it is reported as an error, not a warning.
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0]).toMatchObject({ kind: "message", level: "error", tags: { reason: "mismatch" } });
  });

  // A missing or stale header is what a scanner sends; worth seeing, not worth
  // paging anyone about.
  it("refuses an unsigned or stale request with 401, as a warning", async () => {
    const unsigned = new Request("http://localhost/functions/v1/paddle-webhook", { method: "POST", body });
    const stale = signedRequest(body, { ts: Math.floor(NOW / 1000) - 3600 });

    for (const [req, reason] of [[unsigned, "malformed"], [stale, "stale"]] as const) {
      const t = deps(async () => ({ outcome: "applied", event_id: "x" }));
      const res = await handlePaddleWebhook(req, t.deps);
      expect(res.status).toBe(401);
      expect(t.applied).toEqual([]);
      expect(t.reports[0]).toMatchObject({ level: "warning", tags: { reason } });
    }
  });

  it("answers 500 and reports when the database call itself throws", async () => {
    const t = deps(async () => {
      throw new Error("connection refused");
    });

    const res = await handlePaddleWebhook(signedRequest(body), t.deps);

    expect(res.status).toBe(500);
    expect(t.reports[0]).toMatchObject({
      kind: "exception",
      text: "connection refused",
      tags: { event_id: completed.event_id, event_type: "transaction.completed" },
    });
  });

  // Verifying against an empty secret would accept a signature anyone can
  // compute, and running without the price would ignore every purchase.
  it("answers 500 and reports when the secret or the price isn't configured", async () => {
    for (const missing of ["secret", "priceId"] as const) {
      const t = deps(async () => ({ outcome: "applied", event_id: "x" }));
      const res = await handlePaddleWebhook(signedRequest(body), { ...t.deps, [missing]: undefined });
      expect(res.status, missing).toBe(500);
      expect(t.applied).toEqual([]);
      expect(t.reports[0]).toMatchObject({ level: "error" });
    }
  });

  it("refuses anything but POST", async () => {
    const t = deps(async () => ({ outcome: "applied", event_id: "x" }));
    const res = await handlePaddleWebhook(signedRequest(body, { method: "GET" }), t.deps);
    expect(res.status).toBe(405);
    expect(t.applied).toEqual([]);
  });

  // Correctly signed but not an event: Paddle never sends this, and a retry
  // would only send it again.
  it("answers 400 to a signed body that is not a Paddle event", async () => {
    for (const notAnEvent of ["{}", "not json"]) {
      const t = deps(async () => ({ outcome: "applied", event_id: "x" }));
      const res = await handlePaddleWebhook(signedRequest(notAnEvent), t.deps);
      expect(res.status, notAnEvent).toBe(400);
      expect(t.applied).toEqual([]);
      expect(t.reports[0]).toMatchObject({ level: "error" });
    }
  });
});
