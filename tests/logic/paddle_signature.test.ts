import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSignatureHeader,
  verifyPaddleSignature,
} from "../../supabase/functions/_shared/paddleSignature.ts";

// Paddle signs every webhook as `Paddle-Signature: ts=<unix>;h1=<hex>`, where h1
// is HMAC-SHA256 over `${ts}:${rawBody}` with the destination's secret. The
// signature is the webhook's only authentication — Paddle can't send a Supabase
// JWT, so the function runs with verify_jwt = false — which makes this the gate
// between the open internet and apply_paddle_event.
//
// The expected values below are computed with node:crypto, a different
// implementation from the Web Crypto the module uses, so the two agreeing is
// evidence about the format rather than the code checking itself.

const SECRET = "pdl_ntfset_01test_local_only_not_a_real_secret";
const BODY = JSON.stringify({ event_id: "evt_test", event_type: "transaction.completed", data: { id: "txn_test" } });
const NOW = Date.parse("2026-11-24T08:15:45Z");
const TS = Math.floor(NOW / 1000);

function sign(ts: number, body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");
}

function header(ts: number, ...h1s: string[]): string {
  return [`ts=${ts}`, ...h1s.map((h) => `h1=${h}`)].join(";");
}

describe("verifyPaddleSignature", () => {
  it("accepts a valid signature", async () => {
    const result = await verifyPaddleSignature({
      header: header(TS, sign(TS, BODY)),
      rawBody: BODY,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  // The body is verified byte for byte — which is why the webhook must read the
  // RAW body and never re-serialize parsed JSON before checking.
  it("rejects a tampered body", async () => {
    const tampered = BODY.replace("txn_test", "txn_evil");
    const result = await verifyPaddleSignature({
      header: header(TS, sign(TS, BODY)),
      rawBody: tampered,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a signature made with another secret", async () => {
    const result = await verifyPaddleSignature({
      header: header(TS, sign(TS, BODY, "pdl_ntfset_someone_elses_secret")),
      rawBody: BODY,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });

  // The timestamp is inside the signed string, so moving it breaks the HMAC —
  // but a captured, correctly signed request could still be replayed later.
  // Paddle's SDKs allow 5 s; this allows five minutes, which is safe because the
  // event id already makes a replay harmless, and kind to a slow cold start.
  it("rejects a timestamp outside the window, in either direction", async () => {
    for (const ts of [TS - 301, TS + 301]) {
      const result = await verifyPaddleSignature({
        header: header(ts, sign(ts, BODY)),
        rawBody: BODY,
        secret: SECRET,
        now: NOW,
      });
      expect(result).toEqual({ ok: false, reason: "stale" });
    }
  });

  it("accepts a timestamp just inside the window", async () => {
    const ts = TS - 299;
    const result = await verifyPaddleSignature({
      header: header(ts, sign(ts, BODY)),
      rawBody: BODY,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a malformed header", async () => {
    const good = sign(TS, BODY);
    for (const bad of [
      null,
      "",
      `h1=${good}`,
      `ts=${TS}`,
      `ts=soon;h1=${good}`,
      `ts=${TS};h1=not-hex`,
      `ts=${TS};h1=${good.slice(0, 40)}`,
      "garbage",
    ]) {
      const result = await verifyPaddleSignature({
        header: bad,
        rawBody: BODY,
        secret: SECRET,
        now: NOW,
      });
      expect(result, `header ${JSON.stringify(bad)}`).toEqual({ ok: false, reason: "malformed" });
    }
  });

  // While Paddle rotates a destination's secret it sends one h1 per secret
  // still live; any one of them verifying is enough.
  it("accepts any of several h1 values during secret rotation", async () => {
    const oldSecret = "pdl_ntfset_01old_secret_being_rotated_out";
    for (const order of [
      [sign(TS, BODY, oldSecret), sign(TS, BODY)],
      [sign(TS, BODY), sign(TS, BODY, oldSecret)],
    ]) {
      const result = await verifyPaddleSignature({
        header: header(TS, ...order),
        rawBody: BODY,
        secret: SECRET,
        now: NOW,
      });
      expect(result).toEqual({ ok: true });
    }
  });

  it("refuses to verify against an empty secret", async () => {
    const result = await verifyPaddleSignature({
      header: header(TS, sign(TS, BODY, "")),
      rawBody: BODY,
      secret: "",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("parseSignatureHeader", () => {
  it("reads ts and every h1, tolerating spaces and unknown keys", () => {
    const a = "a".repeat(64);
    const b = "B".repeat(64);
    expect(parseSignatureHeader(` ts=${TS} ; h1=${a};h2=ignored;h1=${b}`)).toEqual({
      ts: TS,
      h1: [a, b.toLowerCase()],
    });
  });
});
