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

// `locked` is deliberately ungranted at the column level (see
// tests/rls/session_columns.test.ts), so the only way to toggle it is this
// SECURITY DEFINER RPC — which re-checks ownership itself, since running as the
// definer bypasses RLS.

const svc = serviceClient();
const anon = anonClient();

describe("set_room_lock", () => {
  let sessionId: string;
  let ownerId: string | null = null;

  afterEach(async () => {
    await deleteSession(svc, sessionId);
    if (ownerId) {
      await deleteUser(svc, ownerId);
      ownerId = null;
    }
  });

  it("lets the owner lock and unlock their room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { error: lockError } = await owner.client.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: true,
    });
    expect(lockError).toBeNull();
    expect((await getSession(svc, sessionId)).locked).toBe(true);

    const { error: unlockError } = await owner.client.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: false,
    });
    expect(unlockError).toBeNull();
    expect((await getSession(svc, sessionId)).locked).toBe(false);
  });

  it("rejects an unauthenticated caller", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { error } = await anon.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: true,
    });
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).locked).toBe(false);
  });

  it("rejects a signed-in user who does not own the room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const stranger = await authedClient(svc);
    try {
      const { error } = await stranger.client.rpc("set_room_lock", {
        p_session_id: sessionId,
        p_locked: true,
      });
      expect(error).not.toBeNull();
      expect((await getSession(svc, sessionId)).locked).toBe(false);
    } finally {
      await deleteUser(svc, stranger.userId);
    }
  });

  it("rejects locking a room that has no owner", async () => {
    sessionId = await createTestSession(svc, 3);

    const owner = await authedClient(svc);
    ownerId = owner.userId;
    const { error } = await owner.client.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: true,
    });
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).locked).toBe(false);
  });

  it("rejects locking a room that does not exist", async () => {
    sessionId = await createTestSession(svc, 3);

    const owner = await authedClient(svc);
    ownerId = owner.userId;
    const { error } = await owner.client.rpc("set_room_lock", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
      p_locked: true,
    });
    expect(error).not.toBeNull();
  });
});
