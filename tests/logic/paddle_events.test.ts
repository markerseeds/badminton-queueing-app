import { describe, expect, it } from "vitest";
import {
  parsePaddleEvent,
  syncEventFor,
} from "../../supabase/functions/_shared/paddleEvents.ts";
import { loadFixture, TEST_PRICE_ID } from "../helpers/paddle";

// What the Edge Functions need to know about an event before (and regardless
// of) handing it to apply_paddle_event: enough to tag a Sentry report and log a
// line. The database re-derives everything that decides an outcome from the raw
// payload, so this parser never gates anything — which is why it is forgiving
// and returns nulls rather than throwing.

describe("parsePaddleEvent", () => {
  it("reads a transaction.completed", () => {
    const parsed = parsePaddleEvent(loadFixture("transaction.completed"), TEST_PRICE_ID);
    expect(parsed).toEqual({
      eventId: "evt_01jh8v3k2m4n5p6q7r8s9t0vwx",
      eventType: "transaction.completed",
      kind: "transaction_completed",
      transactionId: "txn_01jh8tzx9kq2w3e4r5t6y7u8i9",
      userId: "00000000-0000-4000-8000-000000000000",
      priceMatches: true,
      occurredAt: "2026-11-24T08:15:45.366122Z",
      adjustment: null,
    });
  });

  it("notices a transaction for another price", () => {
    const parsed = parsePaddleEvent(loadFixture("transaction.completed"), "pri_something_else");
    expect(parsed?.priceMatches).toBe(false);
  });

  it("has no user for a checkout opened without custom_data", () => {
    const event = loadFixture("transaction.completed");
    (event.data as Record<string, unknown>).custom_data = null;
    expect(parsePaddleEvent(event, TEST_PRICE_ID)?.userId).toBeNull();
  });

  it("reads an approved full refund", () => {
    const parsed = parsePaddleEvent(loadFixture("adjustment.updated.refund-approved"), TEST_PRICE_ID);
    expect(parsed).toEqual({
      eventId: "evt_01jh9am5n6b7v8c9x0z1a2s3d4",
      eventType: "adjustment.updated",
      kind: "adjustment",
      transactionId: "txn_01jh8tzx9kq2w3e4r5t6y7u8i9",
      userId: null,
      priceMatches: false,
      occurredAt: "2026-11-24T09:10:08.650443Z",
      adjustment: { action: "refund", type: "full", status: "approved" },
    });
  });

  it("reads the other adjustment shapes the webhook subscribes to", () => {
    expect(
      parsePaddleEvent(loadFixture("adjustment.created.refund-pending"), TEST_PRICE_ID)?.adjustment,
    ).toEqual({ action: "refund", type: "full", status: "pending_approval" });
    expect(
      parsePaddleEvent(loadFixture("adjustment.updated.refund-partial-approved"), TEST_PRICE_ID)
        ?.adjustment,
    ).toEqual({ action: "refund", type: "partial", status: "approved" });
    expect(
      parsePaddleEvent(loadFixture("adjustment.created.chargeback"), TEST_PRICE_ID)?.adjustment,
    ).toEqual({ action: "chargeback", type: "full", status: "approved" });
    expect(
      parsePaddleEvent(loadFixture("adjustment.created.chargeback-reverse"), TEST_PRICE_ID)
        ?.adjustment,
    ).toEqual({ action: "chargeback_reverse", type: "full", status: "approved" });
  });

  // The same fallback apply_paddle_event uses, so a tag can't disagree with
  // what the database decided.
  it("derives an adjustment's type from its items when the field is absent", () => {
    const full = loadFixture("adjustment.updated.refund-approved");
    delete (full.data as Record<string, unknown>).type;
    expect(parsePaddleEvent(full, TEST_PRICE_ID)?.adjustment?.type).toBe("full");

    const partial = loadFixture("adjustment.updated.refund-partial-approved");
    delete (partial.data as Record<string, unknown>).type;
    expect(parsePaddleEvent(partial, TEST_PRICE_ID)?.adjustment?.type).toBe("partial");
  });

  it("passes other event types through as 'other'", () => {
    const event = loadFixture("transaction.completed");
    event.event_type = "customer.updated";
    expect(parsePaddleEvent(event, TEST_PRICE_ID)).toMatchObject({
      kind: "other",
      eventType: "customer.updated",
      transactionId: null,
    });
  });

  it("returns null for something that is not an event", () => {
    for (const notAnEvent of [null, "evt", 42, [], {}, { event_id: "evt_x" }, { event_type: "x" }]) {
      expect(parsePaddleEvent(notAnEvent, TEST_PRICE_ID)).toBeNull();
    }
  });
});

// "Verify purchase" fetches a transaction from Paddle's API and feeds it through
// the very same apply_paddle_event, wrapped as if it were a webhook. Its event
// id is deterministic, so verifying twice is a duplicate rather than a second
// row, and it changes whenever the transaction does.
describe("syncEventFor", () => {
  it("wraps an API transaction as a transaction.completed", () => {
    const transaction = loadFixture("transaction.completed").data;
    const event = syncEventFor(transaction);
    expect(event).toEqual({
      event_id: "sync:txn_01jh8tzx9kq2w3e4r5t6y7u8i9:2026-11-24T08:15:45.112233Z",
      event_type: "transaction.completed",
      occurred_at: "2026-11-24T08:15:45.112233Z",
      data: transaction,
    });
  });
});
