import { afterEach, describe, expect, it } from "vitest";
import {
  anonClient,
  anonSignedInClient,
  authedClient,
  deleteUser,
  getClaim,
  seedClaim,
  serviceClient,
} from "../helpers/db";

// A claim ticket is the proof that whoever holds the nonce used to be a
// particular anonymous user. That proof only means anything because of what
// this file pins down: RLS forces `from_user_id = auth.uid()`, so a ticket can
// only ever name the person who wrote it.
//
// The table is write-only to clients. There is no SELECT policy and no SELECT
// grant, which is what keeps a nonce that was never stolen from being
// discovered — and it costs nothing, because the client generates the nonce
// itself and never needs to read the row back.
//
// The column grant is the second half: `expires_at` and `redeemed_at` are
// outside it, so a client cannot mint a ticket that never expires or one that
// arrives pre-redeemed. Same mechanism as `owner_id` on sessions
// (tests/rls/session_columns.test.ts).

const svc = serviceClient();
const anon = anonClient();

const users: string[] = [];

afterEach(async () => {
  // Claims cascade from auth.users, so deleting the user is enough here —
  // unlike sessions, whose owner_id only SET NULLs.
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

describe("room_claims privileges", () => {
  it("lets an anonymous user write a ticket naming themselves", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);
    const nonce = crypto.randomUUID();

    const { error } = await me.client
      .from("room_claims")
      .insert({ nonce, from_user_id: me.userId });
    expect(error).toBeNull();

    const row = await getClaim(svc, nonce);
    expect(row!.from_user_id).toBe(me.userId);
    expect(row!.redeemed_at).toBeNull();
  });

  // The hijack this whole design exists to prevent: claiming to have been
  // someone else, and walking off with their rooms.
  it("refuses a ticket naming another user", async () => {
    const me = await anonSignedInClient();
    const victim = await anonSignedInClient();
    users.push(me.userId, victim.userId);
    const nonce = crypto.randomUUID();

    const { error } = await me.client
      .from("room_claims")
      .insert({ nonce, from_user_id: victim.userId });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(await getClaim(svc, nonce)).toBeNull();
  });

  it("refuses a ticket from a signed-out caller", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);

    const { error } = await anon
      .from("room_claims")
      .insert({ nonce: crypto.randomUUID(), from_user_id: me.userId });
    expect(error).not.toBeNull();
  });

  // Without the column grant, a client could set its own expiry — turning a
  // 24-hour ticket into a permanent standing claim on that identity's rooms.
  it("refuses to let a client set expires_at", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);
    const nonce = crypto.randomUUID();

    const { error } = await me.client.from("room_claims").insert({
      nonce,
      from_user_id: me.userId,
      expires_at: "3000-01-01T00:00:00Z",
    });
    expect(error).not.toBeNull();
    expect(await getClaim(svc, nonce)).toBeNull();
  });

  it("refuses to let a client set redeemed_at", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);
    const nonce = crypto.randomUUID();

    const { error } = await me.client.from("room_claims").insert({
      nonce,
      from_user_id: me.userId,
      redeemed_at: null,
    });
    expect(error).not.toBeNull();
    expect(await getClaim(svc, nonce)).toBeNull();
  });

  // No SELECT grant, so a stolen nonce cannot even be confirmed to exist, and
  // a live one cannot be enumerated.
  it("refuses to let anyone read a ticket back", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);
    const nonce = await seedClaim(svc, me.userId);

    const mine = await me.client.from("room_claims").select("*").eq("nonce", nonce);
    expect(mine.error).not.toBeNull();

    const theirs = await anon.from("room_claims").select("*");
    expect(theirs.error).not.toBeNull();
  });

  // Marking your own ticket unredeemed again would make it re-usable; deleting
  // someone else's would be a denial of service on their sign-in.
  it("refuses client UPDATE and DELETE outright", async () => {
    const me = await anonSignedInClient();
    users.push(me.userId);
    const nonce = await seedClaim(svc, me.userId);

    const updated = await me.client
      .from("room_claims")
      .update({ redeemed_at: null })
      .eq("nonce", nonce);
    expect(updated.error).not.toBeNull();

    const deleted = await me.client
      .from("room_claims")
      .delete()
      .eq("nonce", nonce);
    expect(deleted.error).not.toBeNull();

    expect(await getClaim(svc, nonce)).not.toBeNull();
  });

  // ON DELETE CASCADE, unlike sessions.owner_id's SET NULL: a ticket naming a
  // user who no longer exists could never be honoured, so it should not linger.
  it("cascades when the user it names is deleted", async () => {
    const me = await authedClient(svc);
    const nonce = await seedClaim(svc, me.userId);
    expect(await getClaim(svc, nonce)).not.toBeNull();

    await deleteUser(svc, me.userId);
    expect(await getClaim(svc, nonce)).toBeNull();
  });
});
