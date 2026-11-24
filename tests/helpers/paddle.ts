import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Paddle webhook payloads for the Phase 3c suites, built from the sandbox-shaped
// fixtures in tests/fixtures/paddle/ (modelled on Paddle's own SDK mocks).
//
// Every builder starts from a fresh parse of the fixture, so a test can mutate
// what it gets without leaking into the next one, and stamps a fresh event id —
// Paddle's `evt_…` is the dedupe key, so a replay has to be asked for by passing
// the same event back, never by accident.

export type PaddleEvent = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  notification_id?: string;
  data: Record<string, unknown> & { id: string };
};

const fixtureDir = fileURLToPath(new URL("../fixtures/paddle/", import.meta.url));

export function loadFixture(name: string): PaddleEvent {
  return JSON.parse(readFileSync(`${fixtureDir}${name}.json`, "utf8")) as PaddleEvent;
}

// The price the fixtures sell — what PADDLE_PRICE_ID would be set to.
export const TEST_PRICE_ID = "pri_01jh8sx0pro0un1ock0one0time";

function suffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function newTransactionId(): string {
  return `txn_test_${suffix()}`;
}

function newEventId(): string {
  return `evt_test_${suffix()}`;
}

export function completedEvent(opts: {
  txn: string;
  // Who create-checkout said was buying. Omitted leaves `app` but no user_id;
  // null drops custom_data entirely, as a checkout opened by hand would.
  userId?: string | null;
  priceId?: string;
  occurredAt?: string;
  eventId?: string;
}): PaddleEvent {
  const e = loadFixture("transaction.completed");
  const data = e.data as Record<string, unknown> & {
    id: string;
    items: { price: { id: string } }[];
    details: { line_items: { price_id: string }[] };
    custom_data: Record<string, string> | null;
    checkout: { url: string };
  };
  e.event_id = opts.eventId ?? newEventId();
  if (opts.occurredAt) e.occurred_at = opts.occurredAt;
  data.id = opts.txn;
  data.checkout.url = data.checkout.url.replace(/_ptxn=.*$/, `_ptxn=${opts.txn}`);
  if (opts.priceId) {
    data.items[0].price.id = opts.priceId;
    data.details.line_items[0].price_id = opts.priceId;
  }
  data.custom_data =
    opts.userId === null
      ? null
      : opts.userId === undefined
        ? { app: "badminton-queue" }
        : { app: "badminton-queue", user_id: opts.userId };
  return e;
}

export type AdjustmentKind =
  | "refund-pending"
  | "refund-approved"
  | "refund-partial"
  | "chargeback"
  | "chargeback-reverse";

const adjustmentFixture: Record<AdjustmentKind, string> = {
  "refund-pending": "adjustment.created.refund-pending",
  "refund-approved": "adjustment.updated.refund-approved",
  "refund-partial": "adjustment.updated.refund-partial-approved",
  chargeback: "adjustment.created.chargeback",
  "chargeback-reverse": "adjustment.created.chargeback-reverse",
};

export function adjustmentEvent(
  kind: AdjustmentKind,
  opts: { txn: string; occurredAt?: string; eventId?: string },
): PaddleEvent {
  const e = loadFixture(adjustmentFixture[kind]);
  e.event_id = opts.eventId ?? newEventId();
  if (opts.occurredAt) e.occurred_at = opts.occurredAt;
  (e.data as Record<string, unknown>).transaction_id = opts.txn;
  return e;
}

// ISO timestamps a fixed distance apart, for ordering tests. Paddle's own
// timestamps have microseconds; Postgres keeps them, so plain ISO strings
// compare the same way on both sides.
export function at(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}
