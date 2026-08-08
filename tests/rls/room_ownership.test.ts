import { afterEach, describe, expect, it } from "vitest";
import {
  anonClient,
  anonSignedInClient,
  authedClient,
  createTestSession,
  deleteSession,
  deleteUser,
  getPlayers,
  seedPlayers,
  serviceClient,
} from "../helpers/db";
import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 2 ownership rules, exercised through the real RLS path.
//
// A room is OPEN by default: anyone holding the share code edits it, exactly as
// in Phase 1 — that is the club-night guarantee (the tablet by the courts and a
// co-organizer's phone must keep working). An owner may LOCK a room, which
// restricts writes to them alone.
//
// Note on RLS semantics: a blocked INSERT raises 42501, but a blocked
// UPDATE/DELETE simply matches no rows — no error. So those assertions check
// that nothing changed, not that an error came back.

const svc = serviceClient();
const anon = anonClient();

describe("room ownership RLS", () => {
  let sessionId: string;
  let ownerId: string | null = null;

  afterEach(async () => {
    await deleteSession(svc, sessionId);
    if (ownerId) {
      await deleteUser(svc, ownerId);
      ownerId = null;
    }
  });

  // --- the club-night guarantee -------------------------------------------
  it("lets a stranger add, queue and delete players in an unlocked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { error: insertError } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Walk-in", skill: "beginner" });
    expect(insertError).toBeNull();

    const [player] = await getPlayers(svc, sessionId);
    const { error: rpcError } = await anon.rpc("enqueue_players", {
      p_session_id: sessionId,
      p_player_ids: [player.id],
    });
    expect(rpcError).toBeNull();
    expect((await getPlayers(svc, sessionId))[0].status).toBe("queued");

    const { data: deleted } = await anon
      .from("players")
      .delete()
      .eq("id", player.id)
      .select();
    expect(deleted).toHaveLength(1);
  });

  it("lets a stranger rename and re-skill a player in an unlocked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });
    const [seeded] = await seedPlayers(svc, sessionId, [
      { name: "Mrak", skill: "new", games_played: 5 },
    ]);

    const { data: updated, error } = await anon
      .from("players")
      .update({ name: "Mark", skill: "intermediate" })
      .eq("id", seeded.id)
      .select();
    expect(error).toBeNull();
    expect(updated).toHaveLength(1);

    const rows = await getPlayers(svc, sessionId);
    expect(rows[0].name).toBe("Mark");
    expect(rows[0].skill).toBe("intermediate");
    // The whole point of editing over delete-and-re-add: the count survives, so
    // the player keeps their place in the fewest-games-first auto-pick order.
    expect(rows[0].games_played).toBe(5);
  });

  it("lets a stranger change the court count in an unlocked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, { ownerId: owner.userId });

    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 5,
    });
    expect(error).toBeNull();
  });

  // --- locked rooms --------------------------------------------------------
  it("blocks a stranger's writes in a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });
    const [seeded] = await seedPlayers(svc, sessionId, [
      { name: "Ana", skill: "advanced" },
    ]);

    const { error: insertError } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Intruder", skill: "beginner" });
    expect(insertError).not.toBeNull();

    const { data: updated } = await anon
      .from("players")
      .update({ games_played: 99 })
      .eq("id", seeded.id)
      .select();
    expect(updated).toHaveLength(0);

    const { data: deleted } = await anon
      .from("players")
      .delete()
      .eq("id", seeded.id)
      .select();
    expect(deleted).toHaveLength(0);

    const rows = await getPlayers(svc, sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].games_played).toBe(0);
  });

  it("blocks a stranger renaming a player in a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });
    const [seeded] = await seedPlayers(svc, sessionId, [
      { name: "Ana", skill: "advanced" },
    ]);

    // No error — the policy simply matches no rows (see the header note).
    const { data: updated, error } = await anon
      .from("players")
      .update({ name: "Hijacked", skill: "new" })
      .eq("id", seeded.id)
      .select();
    expect(error).toBeNull();
    expect(updated).toHaveLength(0);

    const rows = await getPlayers(svc, sessionId);
    expect(rows[0].name).toBe("Ana");
    expect(rows[0].skill).toBe("advanced");
  });

  it("blocks a stranger's court change in a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });

    // set_courts is SECURITY INVOKER, so the sessions UPDATE policy applies:
    // the row simply doesn't match, leaving the count untouched.
    await anon.rpc("set_courts", { p_session_id: sessionId, p_courts: 6 });

    const { data } = await svc
      .from("sessions")
      .select("courts")
      .eq("id", sessionId)
      .single();
    expect(data!.courts).toBe(3);
  });

  it("still lets the owner write in a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });

    const { error } = await owner.client
      .from("players")
      .insert({ session_id: sessionId, name: "Ben", skill: "intermediate" });
    expect(error).toBeNull();
    expect(await getPlayers(svc, sessionId)).toHaveLength(1);
  });

  it("still lets a stranger READ a locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });
    await seedPlayers(svc, sessionId, [{ name: "Cara", skill: "beginner" }]);

    const { data, error } = await anon
      .from("players")
      .select("name")
      .eq("session_id", sessionId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("isolates one owner from another owner's locked room", async () => {
    const owner = await authedClient(svc);
    ownerId = owner.userId;
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });

    const stranger = await authedClient(svc);
    try {
      const { error } = await (stranger.client as SupabaseClient)
        .from("players")
        .insert({ session_id: sessionId, name: "Nope", skill: "beginner" });
      expect(error).not.toBeNull();
    } finally {
      await deleteUser(svc, stranger.userId);
    }
  });

  // --- the real "Create a room" path ---------------------------------------
  // The app signs the organizer in anonymously, then inserts the room owned by
  // that user. Anonymous users carry the `authenticated` role, so this must give
  // them full ownership powers — including the lock — before they ever link a
  // Google account.
  it("gives an anonymously signed-in creator full ownership of their room", async () => {
    const creator = await anonSignedInClient();
    ownerId = creator.userId;

    const { data, error } = await creator.client
      .from("sessions")
      .insert({
        share_code: `ANON${Date.now().toString(36)}`.toUpperCase(),
        owner_id: creator.userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    sessionId = data!.id;

    const { error: lockError } = await creator.client.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: true,
    });
    expect(lockError).toBeNull();

    const { error: strangerError } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Intruder", skill: "beginner" });
    expect(strangerError).not.toBeNull();

    const { error: ownerWrite } = await creator.client
      .from("players")
      .insert({ session_id: sessionId, name: "Dana", skill: "advanced" });
    expect(ownerWrite).toBeNull();
  });

  // --- ownerless rooms fall back to open -----------------------------------
  // `sessions.owner_id` is ON DELETE SET NULL, so deleting an account leaves its
  // rooms ownerless. Those must stay editable rather than becoming dead rooms
  // that nobody — not even the club still standing on the court — can touch.
  it("keeps a room editable after its owner's account is deleted", async () => {
    const owner = await authedClient(svc);
    sessionId = await createTestSession(svc, 3, {
      ownerId: owner.userId,
      locked: true,
    });

    await deleteUser(svc, owner.userId);

    const { error } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Still works", skill: "beginner" });
    expect(error).toBeNull();
  });

  it("treats a legacy room with no owner as open", async () => {
    sessionId = await createTestSession(svc, 3);

    const { error } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Legacy", skill: "beginner" });
    expect(error).toBeNull();
  });
});
