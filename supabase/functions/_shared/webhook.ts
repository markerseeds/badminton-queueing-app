// paddle-webhook's request handling, with the database call and the reporter
// passed in so vitest can drive it (the Deno entry file wires the real ones).
//
// The contract with Paddle is the status code: 200 means "done, stop", anything
// else means "send it again" — up to 60 times over about two days on a live
// account, 3 times over about two minutes in the sandbox. Every redelivery is
// harmless (apply_paddle_event dedupes on the event id), so the rule is simple:
// answer 200 only for outcomes a retry could not improve on.

import { json } from "./http.ts";
import { parsePaddleEvent } from "./paddleEvents.ts";
import { verifyPaddleSignature } from "./paddleSignature.ts";
import type { Reporter } from "./report.ts";

// What apply_paddle_event() returns. See its migration for the outcomes.
export type ApplyResult = {
  outcome: "applied" | "duplicate" | "ignored" | "stale" | "failed";
  event_id?: string;
  event_type?: string;
  transaction_id?: string | null;
  user_id?: string | null;
  plan?: "free" | "pro" | null;
  plan_changed?: boolean;
  sqlstate?: string;
  error?: string;
};

export type WebhookDeps = {
  secret: string | undefined;
  priceId: string | undefined;
  applyEvent: (event: unknown, priceId: string) => Promise<ApplyResult>;
  reporter: Reporter;
  now?: () => number;
  log?: (line: string) => void;
};

export async function handlePaddleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.log(line));

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405, { allow: "POST" });
  }

  // Refuse to run half-configured. With no secret, verification would have to
  // accept an HMAC anyone can compute; with no price, every purchase would be
  // "not ours" and ignored while the customer waits. 500, so Paddle keeps the
  // events coming until the secret is set.
  if (!deps.secret || !deps.priceId) {
    const missing = !deps.secret ? "PADDLE_WEBHOOK_SECRET" : "PADDLE_PRICE_ID";
    await deps.reporter.message("error", `paddle-webhook is missing ${missing}`, {
      function: "paddle-webhook",
    });
    return json({ error: "misconfigured" }, 500);
  }

  // The raw text, exactly as sent: the HMAC covers these bytes, and parsed and
  // re-serialized JSON would not reproduce them.
  const rawBody = await req.text();
  const check = await verifyPaddleSignature({
    header: req.headers.get("paddle-signature"),
    rawBody,
    secret: deps.secret,
    now: deps.now?.(),
  });

  if (!check.ok) {
    // A well-formed Paddle header with the wrong HMAC almost always means this
    // destination's secret is wrong — and then every real purchase is being
    // refused — so that one is an error. No header, or an old timestamp, is
    // what a scanner sends: worth seeing, not worth waking anyone for.
    await deps.reporter.message(
      check.reason === "mismatch" ? "error" : "warning",
      `Paddle webhook signature rejected (${check.reason})`,
      { function: "paddle-webhook", reason: check.reason },
    );
    return json({ error: "invalid signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = undefined;
  }
  const event = parsePaddleEvent(payload, deps.priceId);
  if (!event) {
    // Signed, so it came from Paddle, but it isn't an event. A retry would
    // only send the same bytes again.
    await deps.reporter.message("error", "Signed Paddle webhook body is not an event", {
      function: "paddle-webhook",
    });
    return json({ error: "not a Paddle event" }, 400);
  }

  const tags = {
    function: "paddle-webhook",
    event_id: event.eventId,
    event_type: event.eventType,
    transaction_id: event.transactionId,
  };

  let result: ApplyResult;
  try {
    result = await deps.applyEvent(payload, deps.priceId);
  } catch (e) {
    // The database call itself failed (unreachable, timed out). Nothing was
    // recorded, so the retry is what saves the event.
    await deps.reporter.exception(e, tags);
    return json({ error: "could not record the event" }, 500);
  }

  log(
    `paddle-webhook ${event.eventType} ${event.eventId} ${event.transactionId ?? "-"} → ${result.outcome}`,
  );

  if (result.outcome === "failed") {
    // The case monitoring exists for: someone may have paid and got nothing.
    // The payload and error are already in webhook_events; the tags are what
    // find them.
    await deps.reporter.message(
      "error",
      `apply_paddle_event failed for ${event.eventType}: ${result.sqlstate ?? "?"} ${result.error ?? ""}`.trim(),
      { ...tags, transaction_id: result.transaction_id ?? event.transactionId, sqlstate: result.sqlstate },
    );
    // Seen only in Paddle's own dashboard (the request was signed by Paddle),
    // where it saves a trip to the logs.
    return json({ outcome: "failed", error: result.error ?? null }, 500);
  }

  return json({ outcome: result.outcome }, 200);
}
