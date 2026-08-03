import { afterEach, describe, expect, it } from "vitest";
import {
  anonClient,
  authedClient,
  createTestSession,
  deleteSession,
  deleteUser,
  getSession,
  serviceClient,
} from "../helpers/db";

// Column-level privileges on `sessions`.
//
// Room *operations* (the court count) must stay writable by anyone holding the
// code, but ownership and the lock must not. Rather than encoding that as
// per-column RLS logic, the migration grants UPDATE only on (courts,
// updated_at) — so `owner_id`, `share_code` and `locked` are unreachable
// through PostgREST no matter what the row policy says.
//
// This is what keeps `set_courts` (SECURITY INVOKER) working for non-owners
// while making room hijacking impossible.

const svc = serviceClient();
const anon = anonClient();

describe("sessions column privileges", () => {
  let sessionId: string;
  let ownerId: string | null = null;

  afterEach(async () => {
    await deleteSession(svc, sessionId);
    if (ownerId) {
      await deleteUser(svc, ownerId);
      ownerId = null;
    }
  });

  it("allows a stranger to update courts on an unlocked room", async () => {
    sessionId = await createTestSession(svc, 3);

    const { error } = await anon
      .from("sessions")
      .update({ courts: 4 })
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).courts).toBe(4);
  });

  it("refuses to let anyone write owner_id", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { error } = await anon
      .from("sessions")
      .update({ owner_id: null })
      .eq("id", sessionId);
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).owner_id).toBe(owner.userId);
  });

  it("refuses to let anyone write share_code", async () => {
    sessionId = await createTestSession(svc, 3);
    const before = (await getSession(svc, sessionId)).share_code;

    const { error } = await anon
      .from("sessions")
      .update({ share_code: "HIJACKED" })
      .eq("id", sessionId);
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).share_code).toBe(before);
  });

  it("refuses to let anyone write locked directly", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    // Even the owner must go through set_room_lock — the column is ungranted.
    const { error: ownerError } = await owner.client
      .from("sessions")
      .update({ locked: true })
      .eq("id", sessionId);
    expect(ownerError).not.toBeNull();

    const { error: anonError } = await anon
      .from("sessions")
      .update({ locked: true })
      .eq("id", sessionId);
    expect(anonError).not.toBeNull();

    expect((await getSession(svc, sessionId)).locked).toBe(false);
  });

  it("lets a signed-in user create a room they own", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;

    const { data, error } = await owner.client
      .from("sessions")
      .insert({
        share_code: `OWN${Date.now().toString(36)}`.toUpperCase(),
        owner_id: owner.userId,
      })
      .select("id, owner_id")
      .single();
    expect(error).toBeNull();
    sessionId = data!.id;
    expect(data!.owner_id).toBe(owner.userId);
  });

  it("refuses to let a user create a room owned by someone else", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const stranger = await authedClient(svc);
    try {
      const { error } = await stranger.client.from("sessions").insert({
        share_code: `EVIL${Date.now().toString(36)}`.toUpperCase(),
        owner_id: owner.userId,
      });
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(svc, stranger.userId);
    }
  });

  it("lets only the owner delete a room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { data: strangerDeleted } = await anon
      .from("sessions")
      .delete()
      .eq("id", sessionId)
      .select();
    expect(strangerDeleted).toHaveLength(0);

    const { data: ownerDeleted } = await owner.client
      .from("sessions")
      .delete()
      .eq("id", sessionId)
      .select();
    expect(ownerDeleted).toHaveLength(1);
  });
});
