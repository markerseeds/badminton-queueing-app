import { afterEach, describe, expect, it } from "vitest";
import {
  anonClient,
  authedClient,
  deletePurchases,
  deleteUser,
  getPurchase,
  seedPurchase,
  serviceClient,
} from "../helpers/db";
import { newTransactionId } from "../helpers/paddle";

// Phase 3c: one `purchases` row per Paddle transaction — the receipt, and the
// thing the plan is derived from.
//
// It lives in its own table rather than on `sessions` because `sessions_select`
// is `using (true)`: anything stored on a room is readable by anyone holding
// the anon key. Here a signed-in user may read their OWN rows and nothing else,
// and no client may write at all — create-checkout and the webhook write as
// service_role. The table is revoked from anon/authenticated before SELECT is
// granted back, because Supabase's default privileges would otherwise hand anon
// full DML on a new table (CLAUDE.md, "On grants"), which also makes these
// refusals honest 42501s rather than silent empty results.

const svc = serviceClient();

const users: string[] = [];
const txns: string[] = [];

afterEach(async () => {
  await deletePurchases(svc, txns.splice(0));
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

async function account() {
  const actor = await authedClient(svc);
  users.push(actor.userId);
  return actor;
}

async function purchaseFor(userId: string, status: "pending" | "completed" = "completed") {
  const txn = newTransactionId();
  txns.push(txn);
  await seedPurchase(svc, {
    userId,
    transactionId: txn,
    status,
    completedAt: status === "completed" ? new Date().toISOString() : undefined,
  });
  return txn;
}

describe("purchases access", () => {
  it("lets a user read their own purchases and nobody else's", async () => {
    const alice = await account();
    const bob = await account();
    const alicesTxn = await purchaseFor(alice.userId);
    await purchaseFor(alice.userId, "pending");
    const bobsTxn = await purchaseFor(bob.userId);

    const { data, error } = await alice.client
      .from("purchases")
      .select("provider_transaction_id, user_id, status");

    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.every((r) => r.user_id === alice.userId)).toBe(true);
    expect(data!.map((r) => r.provider_transaction_id)).toContain(alicesTxn);
    expect(data!.map((r) => r.provider_transaction_id)).not.toContain(bobsTxn);
  });

  it("refuses signed-out visitors outright", async () => {
    const { error } = await anonClient().from("purchases").select("id").limit(1);
    expect(error?.code).toBe("42501");
  });

  // Granting a client INSERT or UPDATE here would let it mint a completed
  // purchase — and with it Pro — without paying.
  it("refuses client inserts and updates", async () => {
    const alice = await account();
    const txn = await purchaseFor(alice.userId, "pending");

    const insert = await alice.client.from("purchases").insert({
      user_id: alice.userId,
      provider_transaction_id: newTransactionId(),
      status: "completed",
    });
    expect(insert.error?.code).toBe("42501");

    const update = await alice.client
      .from("purchases")
      .update({ status: "completed" })
      .eq("provider_transaction_id", txn);
    expect(update.error?.code).toBe("42501");
    expect((await getPurchase(svc, txn))!.status).toBe("pending");
  });

  // ON DELETE SET NULL rather than CASCADE: the money moved whether or not the
  // account still exists, and the receipt is what a refund or a tax question is
  // answered from.
  it("keeps the receipt when the account is deleted", async () => {
    const alice = await account();
    const txn = await purchaseFor(alice.userId);

    await deleteUser(svc, alice.userId);
    users.splice(users.indexOf(alice.userId), 1);

    const purchase = await getPurchase(svc, txn);
    expect(purchase).not.toBeNull();
    expect(purchase!.user_id).toBeNull();
    expect(purchase!.status).toBe("completed");
  });
});
