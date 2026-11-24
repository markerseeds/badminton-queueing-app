import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountPlan,
  anonSignedInClient,
  authedClient,
  deletePurchases,
  deleteUser,
  deleteWebhookEvents,
  getWebhookEvent,
  serviceClient,
} from "../helpers/db";
import { completedEvent, newTransactionId, type PaddleEvent } from "../helpers/paddle";

// paddle-webhook end to end: the real Deno function, behind the local gateway,
// against the real database. The unit suite (tests/logic/) pins the handler's
// logic; this proves the wiring — that verify_jwt is really off for this one
// function, that the raw body survives the gateway byte for byte, and that the
// service-role client reaches apply_paddle_event.
//
// Needs `supabase functions serve --env-file tests/fixtures/functions.env`
// running, and that same file loaded into this process (CI does both; see
// CLAUDE.md). Skipped otherwise, so a plain `npm test` without the functions
// served stays green.

const FUNCTIONS_URL = process.env.FUNCTIONS_URL;
const SECRET = process.env.PADDLE_WEBHOOK_SECRET;
const PRICE = process.env.PADDLE_PRICE_ID;

const svc = serviceClient();
const users: string[] = [];
const txns: string[] = [];
const events: string[] = [];

afterEach(async () => {
  await deleteWebhookEvents(svc, events.splice(0));
  await deletePurchases(svc, txns.splice(0));
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

function deliver(event: PaddleEvent, opts: { secret?: string; signed?: boolean } = {}) {
  if (!events.includes(event.event_id)) events.push(event.event_id);
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", opts.secret ?? SECRET!).update(`${ts}:${body}`).digest("hex");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signed !== false) headers["paddle-signature"] = `ts=${ts};h1=${h1}`;
  // No Authorization header at all — exactly like Paddle.
  return fetch(`${FUNCTIONS_URL}/paddle-webhook`, { method: "POST", headers, body });
}

describe.skipIf(!FUNCTIONS_URL || !SECRET || !PRICE)("paddle-webhook over HTTP", () => {
  it("applies a signed transaction.completed and answers 200", async () => {
    const { userId } = await authedClient(svc);
    users.push(userId);
    const txn = newTransactionId();
    txns.push(txn);

    const res = await deliver(completedEvent({ txn, userId, priceId: PRICE }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "applied" });
    expect(await accountPlan(svc, userId)).toBe("pro");
  });

  it("answers 200 to a redelivery and counts the attempt", async () => {
    const { userId } = await authedClient(svc);
    users.push(userId);
    const txn = newTransactionId();
    txns.push(txn);
    const event = completedEvent({ txn, userId, priceId: PRICE });

    await deliver(event);
    const again = await deliver(event);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ outcome: "duplicate" });
    expect((await getWebhookEvent(svc, event.event_id))!.attempts).toBe(2);
  });

  it("refuses an unsigned delivery with 401 and records nothing", async () => {
    const event = completedEvent({ txn: newTransactionId(), userId: null, priceId: PRICE });

    const res = await deliver(event, { signed: false });

    expect(res.status).toBe(401);
    expect(await getWebhookEvent(svc, event.event_id)).toBeNull();
  });

  it("refuses a delivery signed with another secret with 401", async () => {
    const event = completedEvent({ txn: newTransactionId(), userId: null, priceId: PRICE });

    const res = await deliver(event, { secret: "pdl_ntfset_someone_else" });

    expect(res.status).toBe(401);
    expect(await getWebhookEvent(svc, event.event_id)).toBeNull();
  });

  // 500 is what makes Paddle retry, and the payload is already safe in
  // webhook_events with the reason it failed.
  it("answers 500 for an event the database refuses, keeping the payload", async () => {
    const anonymous = await anonSignedInClient();
    users.push(anonymous.userId);
    const txn = newTransactionId();
    txns.push(txn);
    const event = completedEvent({ txn, userId: anonymous.userId, priceId: PRICE });

    const res = await deliver(event);

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ outcome: "failed" });
    const stored = await getWebhookEvent(svc, event.event_id);
    expect(stored).toMatchObject({ outcome: "failed", processed_at: null });
    expect(stored!.payload).toEqual(event);
    expect(await accountPlan(svc, anonymous.userId)).toBe("free");
  });
});
