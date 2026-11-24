// Verifies the `Paddle-Signature` header on a webhook delivery.
//
// The signature is the webhook's only authentication: Paddle can't send a
// Supabase JWT, so paddle-webhook runs with verify_jwt = false and everything
// between the open internet and apply_paddle_event is this file.
//
// Deliberately free of Deno globals and `npm:` imports — Web Crypto and
// TextEncoder exist in both runtimes — so the Edge Function and vitest run the
// very same code.
//
// Format (developer.paddle.com/webhooks/signature-verification):
//   Paddle-Signature: ts=1671552777;h1=eb4d0dc8…
// where h1 is lowercase-hex HMAC-SHA256, keyed with the notification
// destination's secret, over `${ts}:${rawBody}`. During a secret rotation Paddle
// sends one h1 per live secret, and any one of them verifying is enough.

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "malformed" | "stale" | "mismatch" };

// Paddle's SDKs allow 5 s. A replay inside the window is harmless anyway — the
// event id makes a second delivery a no-op — so the window is about refusing
// requests captured long ago, and five minutes is kinder to a cold start or a
// clock a little off than five seconds.
const DEFAULT_TOLERANCE_SECONDS = 300;

const HEX_SHA256 = /^[0-9a-f]{64}$/;

export function parseSignatureHeader(
  header: string | null | undefined,
): { ts: number; h1: string[] } | null {
  if (!header) return null;

  let ts: number | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") {
      if (!/^\d+$/.test(value)) return null;
      ts = Number(value);
    } else if (key === "h1") {
      const hex = value.toLowerCase();
      if (!HEX_SHA256.test(hex)) return null;
      h1.push(hex);
    }
    // Unknown keys are skipped rather than refused, so a future scheme added
    // alongside h1 doesn't take the webhook down.
  }

  if (ts === null || h1.length === 0) return null;
  return { ts, h1 };
}

// Return type left to inference on purpose: TS 5.7+ infers
// Uint8Array<ArrayBuffer>, which is what subtle.verify accepts, where a bare
// `Uint8Array` annotation widens to ArrayBufferLike and Deno's checker refuses it.
function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyPaddleSignature(opts: {
  header: string | null | undefined;
  // Exactly the bytes Paddle sent, as text. Never re-serialized JSON: a
  // reordered key or a changed space is a different message.
  rawBody: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): Promise<SignatureCheck> {
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { ok: false, reason: "malformed" };

  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - parsed.ts) > tolerance) {
    return { ok: false, reason: "stale" };
  }

  // An empty key is a valid HMAC key, so a function deployed without its secret
  // would otherwise accept a signature anyone can compute. Fail closed.
  if (!opts.secret) return { ok: false, reason: "mismatch" };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(opts.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const message = encoder.encode(`${parsed.ts}:${opts.rawBody}`);

  // subtle.verify, not a string comparison of hex digests: it compares in
  // constant time, so response timing can't be used to guess a signature one
  // byte at a time.
  for (const candidate of parsed.h1) {
    if (await crypto.subtle.verify("HMAC", key, hexToBytes(candidate), message)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}
