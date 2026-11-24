// What the Edge Functions need to know about a Paddle event — enough to tag an
// error report and write a log line — before handing the raw payload to
// apply_paddle_event, which re-derives everything that decides an outcome. So
// nothing here gates anything, which is why it is forgiving: unknown shapes
// come back as nulls rather than exceptions.
//
// Free of Deno globals and `npm:` imports so vitest imports it as-is.

export type PaddleEventPayload = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  notification_id?: string;
  data: Record<string, unknown>;
};

export type ParsedPaddleEvent = {
  eventId: string;
  eventType: string;
  kind: "transaction_completed" | "adjustment" | "other";
  transactionId: string | null;
  // custom_data.user_id, as create-checkout set it. A transaction only.
  userId: string | null;
  // Whether any item sells the configured price. A transaction only.
  priceMatches: boolean;
  occurredAt: string | null;
  adjustment: {
    action: string | null;
    type: string | null;
    status: string | null;
  } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// Mirrors the fallback in apply_paddle_event, so a tag can never disagree with
// what the database decided: an adjustment is `full` only if every item is.
function adjustmentType(data: Record<string, unknown>): string | null {
  const explicit = str(data.type);
  if (explicit) return explicit;
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) return "partial";
  return items.every((i) => isRecord(i) && i.type === "full") ? "full" : "partial";
}

export function parsePaddleEvent(
  payload: unknown,
  priceId: string,
): ParsedPaddleEvent | null {
  if (!isRecord(payload)) return null;
  const eventId = str(payload.event_id);
  const eventType = str(payload.event_type);
  if (!eventId || !eventType) return null;

  const data = isRecord(payload.data) ? payload.data : {};
  const occurredAt = str(payload.occurred_at);

  if (eventType === "transaction.completed") {
    const items = Array.isArray(data.items) ? data.items : [];
    const customData = isRecord(data.custom_data) ? data.custom_data : {};
    return {
      eventId,
      eventType,
      kind: "transaction_completed",
      transactionId: str(data.id),
      userId: str(customData.user_id),
      priceMatches: items.some(
        (i) => isRecord(i) && isRecord(i.price) && i.price.id === priceId,
      ),
      occurredAt,
      adjustment: null,
    };
  }

  if (eventType === "adjustment.created" || eventType === "adjustment.updated") {
    return {
      eventId,
      eventType,
      kind: "adjustment",
      transactionId: str(data.transaction_id),
      userId: null,
      priceMatches: false,
      occurredAt,
      adjustment: {
        action: str(data.action),
        type: adjustmentType(data),
        status: str(data.status),
      },
    };
  }

  return {
    eventId,
    eventType,
    kind: "other",
    transactionId: null,
    userId: null,
    priceMatches: false,
    occurredAt,
    adjustment: null,
  };
}

// "Verify purchase" fetches a transaction from Paddle's API and feeds it through
// the same apply_paddle_event as a webhook would, so there is one code path. The
// event id is made up but deterministic — `sync:<txn>:<updated_at>` — so
// verifying twice is a duplicate rather than a second row, while a transaction
// that has changed since gets a fresh id. Paddle's own ids start `evt_`, so the
// two can never collide.
//
// occurred_at is the transaction's updated_at: a sync that runs after the real
// webhook carries an older time than it and is therefore stale, and one that
// runs before it is simply overtaken — either way, nothing is applied twice.
export function syncEventFor(transaction: Record<string, unknown>): PaddleEventPayload {
  const id = String(transaction.id);
  const updatedAt = String(transaction.updated_at);
  return {
    event_id: `sync:${id}:${updatedAt}`,
    event_type: "transaction.completed",
    occurred_at: updatedAt,
    data: transaction,
  };
}
