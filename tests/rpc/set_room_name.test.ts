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

// `name` is deliberately outside the column-level UPDATE grant on `sessions`
// (see tests/rls/session_columns.test.ts), so this SECURITY DEFINER RPC is the
// only way to write it — the same shape as `locked` / `set_room_lock`.
//
// But it is DEFINER for a second, sharper reason. `sessions_update`'s with-check
// carries the plan court cap, and a with-check is evaluated against the NEW row
// on EVERY update — including one that only touches a name. A room grandfathered
// above its owner's cap would therefore refuse a pure rename with 42501, on a
// room the product deliberately lets keep its courts. Running as definer
// sidesteps the policy and re-checks only what a rename implicates: may you edit
// here? That is the "renames a grandfathered room" case below, and it is the
// whole reason this function exists rather than a widened column grant.
//
// Unlike a blocked PostgREST UPDATE (which matches no rows and returns no
// error), a blocked RPC raises — so these assert on `error`, not on row counts.

const svc = serviceClient();
const anon = anonClient();

describe("set_room_name", () => {
  let sessionId: string;
  let ownerId: string | null = null;

  afterEach(async () => {
    await deleteSession(svc, sessionId);
    if (ownerId) {
      await deleteUser(svc, ownerId);
      ownerId = null;
    }
  });

  // The club-night guarantee, and the reason renaming isn't owner-only: the
  // courtside tablet and a co-organizer hold the code, not the account.
  it("lets a stranger rename an unlocked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 2, { ownerId: owner.userId });

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Tuesday club",
    });
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).name).toBe("Tuesday club");
  });

  it("lets the owner rename their own room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 2, { ownerId: owner.userId });

    const { error } = await owner.client.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Saturday juniors",
    });
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).name).toBe("Saturday juniors");
  });

  // The entire reason this is an RPC. 6 courts on an owner left at the free
  // plan (cap 2) is exactly the state three production rooms are in. Against a
  // widened column grant this fails with 42501; here it must succeed, because
  // a rename does not touch `courts` and must not be judged by the court cap.
  it("renames a grandfathered room that sits above its owner's court cap", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    // No entitlements row → free plan → max_courts 2, while the room has 6.
    sessionId = await createTestSession(svc, 6, { ownerId: owner.userId });

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Grandfathered hall",
    });
    expect(error).toBeNull();

    const after = await getSession(svc, sessionId);
    expect(after.name).toBe("Grandfathered hall");
    // The courts must survive the rename untouched — the ratchet only moves
    // when someone deliberately changes the court count.
    expect(after.courts).toBe(6);
  });

  it("refuses a stranger renaming a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 2, {
      ownerId: owner.userId,
      locked: true,
    });

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Hijacked",
    });
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).name).toBeNull();
  });

  it("lets the owner rename their own locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 2, {
      ownerId: owner.userId,
      locked: true,
    });

    const { error } = await owner.client.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Locked but mine",
    });
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).name).toBe("Locked but mine");
  });

  // Ownerless rooms stay open, exactly as they do for every other edit — a
  // stale lock on a room whose owner deleted their account must not strand it.
  it("lets anyone rename a locked room that has no owner", async () => {
    sessionId = await createTestSession(svc, 2, { locked: true });

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Ownerless hall",
    });
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).name).toBe("Ownerless hall");
  });

  // Clearing the name has to be reachable, since the name is optional.
  it("clears the name when given a blank one", async () => {
    sessionId = await createTestSession(svc, 2);
    await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Named for now",
    });

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "   ",
    });
    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).name).toBeNull();
  });

  it("rejects renaming a room that does not exist", async () => {
    sessionId = await createTestSession(svc, 2);

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: "00000000-0000-0000-0000-000000000000",
      p_name: "Nowhere",
    });
    expect(error).not.toBeNull();
  });

  it("refuses a name longer than the column allows", async () => {
    sessionId = await createTestSession(svc, 2);

    const { error } = await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "a".repeat(61),
    });
    expect(error).not.toBeNull();
    expect((await getSession(svc, sessionId)).name).toBeNull();
  });

  it("bumps updated_at", async () => {
    sessionId = await createTestSession(svc, 2);
    const before = (await getSession(svc, sessionId)).updated_at;

    await anon.rpc("set_room_name", {
      p_session_id: sessionId,
      p_name: "Touched",
    });

    const after = (await getSession(svc, sessionId)).updated_at;
    expect(new Date(after).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });
});
