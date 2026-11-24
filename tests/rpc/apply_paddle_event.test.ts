import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accountPlan,
  anonClient,
  anonSignedInClient,
  authedClient,
  countPurchases,
  createTestSession,
  deletePurchases,
  deleteSession,
  deleteUser,
  deleteWebhookEvents,
  getEntitlement,
  getPurchase,
  getSession,
  getWebhookEvent,
  seedPurchase,
  serviceClient,
  type ApplyResult,
} from "../helpers/db";
import {
  adjustmentEvent,
  at,
  completedEvent,
  newTransactionId,
  TEST_PRICE_ID,
  type PaddleEvent,
} from "../helpers/paddle";

// Phase 3c: every verified Paddle delivery — and every "Verify purchase" sync —
// goes through this one function, as service_role, which is the webhook's
// position. Pro is DERIVED from purchases rather than switched on and off:
// `plan = 'pro'` whenever the account holds at least one purchase that is
// completed and not refunded. So the tests below drive events and then assert
// on the plan, never on a flag the events set directly.
//
// Three rules shape almost every case:
//   * the event id is the dedupe key — Paddle redelivers with the same `evt_…`,
//     so a second copy must change nothing but the attempt counter;
//   * delivery order is not guaranteed — an event older than the last one
//     applied to its purchase is stale and changes nothing;
//   * a failure keeps the payload and the error but NOT the event's effects,
//     and leaves the event unprocessed so Paddle's retry runs it again.

const svc = serviceClient();

const users: string[] = [];
const rooms: string[] = [];
const txns: string[] = [];
const events: string[] = [];

afterEach(async () => {
  await deleteWebhookEvents(svc, events.splice(0));
  await deletePurchases(svc, txns.splice(0));
  for (const id of rooms.splice(0)) await deleteSession(svc, id);
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

async function apply(
  event: PaddleEvent,
  priceId = TEST_PRICE_ID,
  client: SupabaseClient = svc,
): Promise<ApplyResult> {
  if (!events.includes(event.event_id)) events.push(event.event_id);
  const { data, error } = await client.rpc("apply_paddle_event", {
    p_event: event,
    p_price_id: priceId,
  });
  if (error) throw error;
  return data as ApplyResult;
}

// A signed-in Google-style account: the only kind allowed to hold Pro.
async function buyer(): Promise<string> {
  const { userId } = await authedClient(svc);
  users.push(userId);
  return userId;
}

function transaction(): string {
  const txn = newTransactionId();
  txns.push(txn);
  return txn;
}

describe("apply_paddle_event — purchases", () => {
  it("grants Pro for a completed purchase of our price", async () => {
    const userId = await buyer();
    const txn = transaction();
    const event = completedEvent({ txn, userId });

    const result = await apply(event);

    expect(result).toMatchObject({
      outcome: "applied",
      event_id: event.event_id,
      transaction_id: txn,
      user_id: userId,
      plan: "pro",
      plan_changed: true,
    });
    expect(await accountPlan(svc, userId)).toBe("pro");

    const purchase = await getPurchase(svc, txn);
    expect(purchase).toMatchObject({
      user_id: userId,
      status: "completed",
      price_id: TEST_PRICE_ID,
      provider_customer_id: "ctm_01jh8v1q2w3e4r5t6y7u8i9o0p",
      currency_code: "USD",
      subtotal: 2500,
      tax: 500,
      total: 3000,
      revoked_at: null,
    });
    expect(purchase!.completed_at).not.toBeNull();

    const stored = await getWebhookEvent(svc, event.event_id);
    expect(stored).toMatchObject({
      event_type: "transaction.completed",
      attempts: 1,
      outcome: "applied",
      error: null,
    });
    expect(stored!.processed_at).not.toBeNull();
    expect(stored!.payload).toEqual(event);
  });

  it("treats a redelivered event as a duplicate and changes nothing", async () => {
    const userId = await buyer();
    const roomId = await createTestSession(svc, 2, { ownerId: userId });
    rooms.push(roomId);
    const txn = transaction();
    const event = completedEvent({ txn, userId });

    await apply(event);
    const entitlementBefore = await getEntitlement(svc, userId);
    const roomBefore = await getSession(svc, roomId);

    const replay = await apply(event);

    expect(replay.outcome).toBe("duplicate");
    expect(await countPurchases(svc, txn)).toBe(1);
    expect((await getWebhookEvent(svc, event.event_id))!.attempts).toBe(2);
    // "Pro once": the entitlement row and the room were written by the first
    // delivery and not touched again.
    expect(await getEntitlement(svc, userId)).toEqual(entitlementBefore);
    expect((await getSession(svc, roomId)).updated_at).toBe(roomBefore.updated_at);
  });

  // The race the event row exists to serialize: Paddle retrying while the first
  // delivery is still being processed. Both land on the same primary key, so
  // the second waits on the first's row lock and then sees it processed.
  it("lets only one of two simultaneous copies of an event apply", async () => {
    const userId = await buyer();
    const txn = transaction();
    const event = completedEvent({ txn, userId });

    const results = await Promise.all([
      apply(event, TEST_PRICE_ID, serviceClient()),
      apply(event, TEST_PRICE_ID, serviceClient()),
    ]);

    expect(results.map((r) => r.outcome).sort()).toEqual(["applied", "duplicate"]);
    expect(await countPurchases(svc, txn)).toBe(1);
    expect((await getWebhookEvent(svc, event.event_id))!.attempts).toBe(2);
    expect(await accountPlan(svc, userId)).toBe("pro");
  });

  it("takes the buyer from the pending row create-checkout wrote, not custom_data", async () => {
    const realBuyer = await buyer();
    const someoneElse = await buyer();
    const txn = transaction();
    await seedPurchase(svc, { userId: realBuyer, transactionId: txn });

    const result = await apply(completedEvent({ txn, userId: someoneElse }));

    expect(result).toMatchObject({ outcome: "applied", user_id: realBuyer });
    expect(await accountPlan(svc, realBuyer)).toBe("pro");
    expect(await accountPlan(svc, someoneElse)).toBe("free");
    expect((await getPurchase(svc, txn))!.user_id).toBe(realBuyer);
  });

  it("falls back to custom_data.user_id when there is no pending row", async () => {
    const userId = await buyer();
    const txn = transaction();

    const result = await apply(completedEvent({ txn, userId }));

    expect(result).toMatchObject({ outcome: "applied", user_id: userId });
    expect(await accountPlan(svc, userId)).toBe("pro");
  });

  // A paid transaction nobody can be matched to is precisely what must alert:
  // someone has paid and is about to get nothing.
  it("fails a completed purchase it cannot attribute to anyone", async () => {
    const txn = transaction();
    const event = completedEvent({ txn, userId: null });

    const result = await apply(event);

    expect(result.outcome).toBe("failed");
    expect(await getPurchase(svc, txn)).toBeNull();
    const stored = await getWebhookEvent(svc, event.event_id);
    expect(stored).toMatchObject({ outcome: "failed", processed_at: null });
    expect(stored!.error).toMatch(/user/i);
    expect(stored!.payload).toEqual(event);
  });

  it("ignores a transaction for another price", async () => {
    const userId = await buyer();
    const txn = transaction();
    const event = completedEvent({ txn, userId, priceId: "pri_some_other_product" });

    const result = await apply(event);

    expect(result.outcome).toBe("ignored");
    expect(await getPurchase(svc, txn)).toBeNull();
    expect(await accountPlan(svc, userId)).toBe("free");
    const stored = await getWebhookEvent(svc, event.event_id);
    expect(stored).toMatchObject({ outcome: "ignored" });
    expect(stored!.processed_at).not.toBeNull();
  });

  // enforce_pro_requires_account (Phase 3b) is the last line: service_role is
  // the most privileged caller there is, and the database still refuses to
  // record Pro against an anonymous account. The inner exception block is what
  // keeps the evidence while undoing the effects.
  it("fails an anonymous buyer, keeping the payload and the error", async () => {
    const anonymous = await anonSignedInClient();
    users.push(anonymous.userId);
    const txn = transaction();
    const event = completedEvent({ txn, userId: anonymous.userId });

    const result = await apply(event);

    expect(result).toMatchObject({ outcome: "failed", sqlstate: "23514" });
    expect(await accountPlan(svc, anonymous.userId)).toBe("free");
    expect(await getPurchase(svc, txn)).toBeNull();
    const stored = await getWebhookEvent(svc, event.event_id);
    expect(stored).toMatchObject({ outcome: "failed", processed_at: null });
    expect(stored!.error).toMatch(/23514/);
    expect(stored!.payload).toEqual(event);
  });
});

describe("apply_paddle_event — refunds and chargebacks", () => {
  it("turns Pro off for an approved full refund", async () => {
    const userId = await buyer();
    const txn = transaction();
    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    const result = await apply(adjustmentEvent("refund-approved", { txn, occurredAt: at(-1) }));

    expect(result).toMatchObject({ outcome: "applied", plan: "free", plan_changed: true });
    expect(await accountPlan(svc, userId)).toBe("free");
    const purchase = await getPurchase(svc, txn);
    expect(purchase!.status).toBe("refunded");
    expect(purchase!.revoked_at).not.toBeNull();
  });

  it("changes nothing for a refund still pending approval", async () => {
    const userId = await buyer();
    const txn = transaction();
    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    const result = await apply(adjustmentEvent("refund-pending", { txn, occurredAt: at(-1) }));

    expect(result.outcome).toBe("ignored");
    expect(await accountPlan(svc, userId)).toBe("pro");
    expect((await getPurchase(svc, txn))!.status).toBe("completed");
  });

  it("keeps Pro through a partial refund", async () => {
    const userId = await buyer();
    const txn = transaction();
    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    const result = await apply(adjustmentEvent("refund-partial", { txn, occurredAt: at(-1) }));

    expect(result.outcome).toBe("ignored");
    expect(await accountPlan(svc, userId)).toBe("pro");
    expect((await getPurchase(svc, txn))!.status).toBe("completed");
  });

  it("turns Pro off for a chargeback, and back on when it is reversed", async () => {
    const userId = await buyer();
    const txn = transaction();
    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    const chargeback = await apply(adjustmentEvent("chargeback", { txn, occurredAt: at(-20) }));
    expect(chargeback).toMatchObject({ outcome: "applied", plan: "free", plan_changed: true });
    expect((await getPurchase(svc, txn))!.status).toBe("chargeback");

    const reversed = await apply(
      adjustmentEvent("chargeback-reverse", { txn, occurredAt: at(-10) }),
    );
    expect(reversed).toMatchObject({ outcome: "applied", plan: "pro", plan_changed: true });
    const purchase = await getPurchase(svc, txn);
    expect(purchase!.status).toBe("completed");
    expect(purchase!.revoked_at).toBeNull();
  });

  it("keeps Pro while any purchase is still completed", async () => {
    const userId = await buyer();
    const first = transaction();
    const second = transaction();
    await apply(completedEvent({ txn: first, userId, occurredAt: at(-30) }));
    await apply(completedEvent({ txn: second, userId, occurredAt: at(-20) }));

    const result = await apply(
      adjustmentEvent("refund-approved", { txn: first, occurredAt: at(-1) }),
    );

    expect(result).toMatchObject({ outcome: "applied", plan: "pro", plan_changed: false });
    expect(await accountPlan(svc, userId)).toBe("pro");
    expect((await getPurchase(svc, first))!.status).toBe("refunded");
  });

  // Paddle does not promise delivery order. The realistic inversion: the
  // checkout's pending row exists, the refund lands, and only then does the
  // transaction.completed that preceded it arrive. Applying it would hand back
  // Pro that was refunded.
  it("ignores an event older than the last one applied to its purchase", async () => {
    const userId = await buyer();
    const txn = transaction();
    await seedPurchase(svc, { userId, transactionId: txn });

    await apply(adjustmentEvent("refund-approved", { txn, occurredAt: at(-1) }));
    const late = await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    expect(late.outcome).toBe("stale");
    expect(await accountPlan(svc, userId)).toBe("free");
    expect((await getPurchase(svc, txn))!.status).toBe("refunded");
  });

  // The same rule protecting the other direction: the seller won the dispute,
  // and the chargeback that started it is delivered after the reversal.
  it("keeps Pro when a chargeback arrives after its reversal", async () => {
    const userId = await buyer();
    const txn = transaction();
    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));

    await apply(adjustmentEvent("chargeback-reverse", { txn, occurredAt: at(-10) }));
    const late = await apply(adjustmentEvent("chargeback", { txn, occurredAt: at(-20) }));

    expect(late.outcome).toBe("stale");
    expect(await accountPlan(svc, userId)).toBe("pro");
    expect((await getPurchase(svc, txn))!.status).toBe("completed");
  });

  // Fails rather than being ignored, because the likeliest cause is ordering:
  // the transaction.completed it refunds has not been delivered yet. Failing
  // returns 500, Paddle retries, and by then the purchase exists — which only
  // works because a failure leaves the event unprocessed.
  it("fails a refund for an unknown transaction, then applies it on retry", async () => {
    const userId = await buyer();
    const txn = transaction();
    const refund = adjustmentEvent("refund-approved", { txn, occurredAt: at(-1) });

    const first = await apply(refund);
    expect(first).toMatchObject({ outcome: "failed", sqlstate: "P0002" });
    const stored = await getWebhookEvent(svc, refund.event_id);
    expect(stored).toMatchObject({ outcome: "failed", processed_at: null });
    expect(stored!.error).toMatch(/P0002/);

    await apply(completedEvent({ txn, userId, occurredAt: at(-30) }));
    expect(await accountPlan(svc, userId)).toBe("pro");

    const retry = await apply(refund);
    expect(retry).toMatchObject({ outcome: "applied", plan: "free" });
    expect((await getWebhookEvent(svc, refund.event_id))!.attempts).toBe(2);
    expect(await accountPlan(svc, userId)).toBe("free");
  });
});

describe("apply_paddle_event — open rooms", () => {
  // Open rooms learn about a plan change without `entitlements` being
  // published: the same transaction bumps updated_at on the owner's rooms, and
  // every device already subscribed to `sessions` reloads its limits — the
  // courtside tablet included, which is not the owner and could never read
  // `entitlements`. So the touch must happen exactly when the plan moves.
  it("touches the buyer's rooms only when the plan changes", async () => {
    const userId = await buyer();
    const other = await buyer();
    const mine = await createTestSession(svc, 2, { ownerId: userId });
    const theirs = await createTestSession(svc, 2, { ownerId: other });
    rooms.push(mine, theirs);
    const theirsBefore = (await getSession(svc, theirs)).updated_at;

    const before = (await getSession(svc, mine)).updated_at;
    await apply(completedEvent({ txn: transaction(), userId, occurredAt: at(-30) }));
    const afterGrant = (await getSession(svc, mine)).updated_at;
    expect(Date.parse(afterGrant)).toBeGreaterThan(Date.parse(before));

    // Already Pro: a second purchase changes no plan, so no room is touched.
    await apply(completedEvent({ txn: transaction(), userId, occurredAt: at(-20) }));
    expect((await getSession(svc, mine)).updated_at).toBe(afterGrant);

    expect((await getSession(svc, theirs)).updated_at).toBe(theirsBefore);
  });
});

describe("apply_paddle_event — who may call it", () => {
  // Postgres grants EXECUTE to PUBLIC by default and Supabase's default ACL
  // adds anon and authenticated by name, so without an explicit revoke from all
  // three anyone holding the anon key could hand themselves Pro.
  //
  // The message is asserted, not just the code, because the code alone passes
  // for the wrong reason: with EXECUTE granted back, the INVOKER function still
  // dies 42501 one layer down, on its first write to the revoked
  // webhook_events. That is real defence in depth, but it isn't this gate —
  // measured by re-granting EXECUTE to anon and watching only this test fail.
  it("refuses anon and authenticated callers at the function itself", async () => {
    const signedIn = await authedClient(svc);
    users.push(signedIn.userId);
    const txn = transaction();

    for (const client of [anonClient(), signedIn.client]) {
      const { error } = await client.rpc("apply_paddle_event", {
        p_event: completedEvent({ txn, userId: signedIn.userId }),
        p_price_id: TEST_PRICE_ID,
      });
      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/function apply_paddle_event/);
    }
    expect(await accountPlan(svc, signedIn.userId)).toBe("free");
  });

  it("refuses anon and authenticated readers of webhook_events", async () => {
    const signedIn = await authedClient(svc);
    users.push(signedIn.userId);

    for (const client of [anonClient(), signedIn.client]) {
      const { error } = await client.from("webhook_events").select("event_id").limit(1);
      expect(error?.code).toBe("42501");
    }
  });
});
