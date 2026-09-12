import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  authedClient,
  createTestSession,
  deleteSession,
  deleteUser,
  getPlayers,
  getSession,
  seedPlayers,
  serviceClient,
  setPlan,
  uniqueCode,
  type SeedPlayer,
} from "../helpers/db";

// Phase 3a plan limits, exercised through the real RLS path.
//
//   free → 2 courts, 10 players per room, 2 saved rooms
//   pro  → 6 courts (the table CHECK ceiling), unlimited players and rooms
//
// The property that shapes the whole design: a limit follows the room's OWNER,
// not the caller. On club night the person adding an 11th player is usually a
// stranger holding the share code — `players_write` lets them in, and the cap
// still has to judge them by whose room it is. Both directions are asserted
// below ("judges the player cap by the room's owner").
//
// Note on RLS semantics (same as room_ownership.test.ts): a blocked INSERT
// raises, a `using` failure on UPDATE matches no rows silently. The court cap
// is a `with check`, not a `using`, so it *does* raise — which is what lets
// set_courts roll its player-idling back.

const svc = serviceClient();
const anon = anonClient();

const rooms: string[] = [];
const users: string[] = [];

afterEach(async () => {
  // Rooms first: deleting a user only SET NULLs owner_id, so the rows would leak.
  for (const id of rooms.splice(0)) await deleteSession(svc, id);
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

type Owner = { client: SupabaseClient; userId: string };

async function newOwner(plan: "free" | "pro" = "free"): Promise<Owner> {
  const owner = await authedClient(svc);
  users.push(owner.userId);
  if (plan === "pro") await setPlan(svc, owner.userId, plan);
  return owner;
}

// Inserts through the OWNER's own client, so the sessions_insert policy applies
// (createTestSession seeds through service_role and would bypass it).
async function createRoomAs(owner: Owner, courts = 2) {
  const res = await owner.client
    .from("sessions")
    .insert({ share_code: uniqueCode(), courts, owner_id: owner.userId })
    .select("id")
    .single();
  if (res.data) rooms.push(res.data.id);
  return res;
}

// Seeds a room straight through service_role, bypassing the insert policy —
// for cases whose subject is a later write, or that need a court count the
// owner's plan would refuse (a "grandfathered" room).
async function seedRoom(ownerId: string | null, courts = 2): Promise<string> {
  const id = await createTestSession(svc, courts, {
    ownerId: ownerId ?? undefined,
  });
  rooms.push(id);
  return id;
}

const names = (n: number, prefix = "P"): SeedPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `${prefix}${i}`,
    skill: "intermediate",
  }));

const playingOn = (court: number): SeedPlayer[] =>
  Array.from({ length: 4 }, (_, i) => ({
    name: `C${court}-${i}`,
    skill: "intermediate",
    status: "playing" as const,
    court_no: court,
    court_slot: i,
  }));

// ---------------------------------------------------------------------------
describe("player cap", () => {
  // The test the trigger exists for. A per-row `with check` cannot do this: in
  // READ COMMITTED every row of one statement sees the statement-start
  // snapshot, so all 15 would independently observe "0 players, fine" and land.
  it("caps a bulk insert that crosses the limit in one statement", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId);

    const { error } = await anon
      .from("players")
      .insert(names(15).map((p) => ({ session_id: sessionId, ...p })));

    expect(error).not.toBeNull();
    // The whole statement rolls back — not a partial fill up to the cap.
    expect(await getPlayers(svc, sessionId)).toHaveLength(0);
  });

  it("lets a stranger fill a free room to exactly 10", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId);

    const { error } = await anon
      .from("players")
      .insert(names(10).map((p) => ({ session_id: sessionId, ...p })));

    expect(error).toBeNull();
    expect(await getPlayers(svc, sessionId)).toHaveLength(10);
  });

  it("blocks the 11th player one at a time", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId);
    await seedPlayers(svc, sessionId, names(10));

    const { error } = await anon
      .from("players")
      .insert({ session_id: sessionId, name: "Eleven", skill: "beginner" });

    expect(error).not.toBeNull();
    expect(await getPlayers(svc, sessionId)).toHaveLength(10);
  });

  // Both directions of the owner-not-caller rule.
  it("judges the player cap by the room's owner, not the caller", async () => {
    const freeOwner = await newOwner("free");
    const proOwner = await newOwner("pro");
    const freeRoom = await seedRoom(freeOwner.userId);
    const proRoom = await seedRoom(proOwner.userId);
    await seedPlayers(svc, freeRoom, names(10));
    await seedPlayers(svc, proRoom, names(10));

    // A Pro account writing into someone else's free room is still capped.
    const { error: blocked } = await proOwner.client
      .from("players")
      .insert({ session_id: freeRoom, name: "Nope", skill: "new" });
    expect(blocked).not.toBeNull();

    // A signed-out stranger writing into a Pro owner's room is not.
    const { error: allowed } = await anon
      .from("players")
      .insert({ session_id: proRoom, name: "Walk-in", skill: "new" });
    expect(allowed).toBeNull();
    expect(await getPlayers(svc, proRoom)).toHaveLength(11);
  });

  it("leaves an ownerless room uncapped", async () => {
    const sessionId = await seedRoom(null);

    const { error } = await anon
      .from("players")
      .insert(names(15).map((p) => ({ session_id: sessionId, ...p })));

    expect(error).toBeNull();
    expect(await getPlayers(svc, sessionId)).toHaveLength(15);
  });

  // Policies exempt service_role automatically; a trigger does not, so the
  // exemption is written out in the function body. Without it every existing
  // suite that seeds a full board through serviceClient would break.
  it("lets service_role seed past the cap", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId);

    await seedPlayers(svc, sessionId, names(15));
    expect(await getPlayers(svc, sessionId)).toHaveLength(15);
  });

  // Closed by the column grant rather than the trigger: `session_id` is no
  // longer updatable by anon/authenticated at all, so a player can't be walked
  // into a full room around the insert-time cap. Keeping the trigger to INSERT
  // alone is what keeps it off enqueue/start_game/games_played.
  it("blocks moving a player into a room that is already full", async () => {
    const owner = await newOwner();
    const full = await seedRoom(owner.userId);
    const spare = await seedRoom(owner.userId);
    await seedPlayers(svc, full, names(10));
    const [mover] = await seedPlayers(svc, spare, [
      { name: "Mover", skill: "new" },
    ]);

    const { error } = await anon
      .from("players")
      .update({ session_id: full })
      .eq("id", mover.id);

    expect(error).not.toBeNull();
    expect(await getPlayers(svc, full)).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
describe("court cap", () => {
  it("lets a free owner create a room at the court cap", async () => {
    const owner = await newOwner();
    const { error } = await createRoomAs(owner, 2);
    expect(error).toBeNull();
  });

  it("blocks a free owner creating a room above the court cap", async () => {
    const owner = await newOwner();
    const { error } = await createRoomAs(owner, 4);
    expect(error).not.toBeNull();
  });

  it("lets a pro owner run 6 courts", async () => {
    const owner = await newOwner("pro");
    const { data, error } = await createRoomAs(owner, 6);
    expect(error).toBeNull();
    expect((await getSession(svc, data!.id)).courts).toBe(6);
  });

  // set_courts is SECURITY INVOKER, so the sessions `with check` applies to it —
  // and because a with-check violation raises rather than matching no rows, the
  // player-idling UPDATE that ran first inside the same transaction rolls back.
  it("rolls back set_courts when the new count is above the plan cap", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId, 5); // grandfathered above cap
    await seedPlayers(svc, sessionId, playingOn(5));

    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 3,
    });

    expect(error).not.toBeNull();
    const rows = await getPlayers(svc, sessionId);
    expect(rows.every((r) => r.status === "playing" && r.court_no === 5)).toBe(
      true,
    );
    expect((await getSession(svc, sessionId)).courts).toBe(5);
  });

  it("lets a grandfathered room step down to the cap but not back up", async () => {
    const owner = await newOwner();
    const sessionId = await seedRoom(owner.userId, 5);

    const { error: down } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 2,
    });
    expect(down).toBeNull();
    expect((await getSession(svc, sessionId)).courts).toBe(2);

    const { error: up } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 3,
    });
    expect(up).not.toBeNull();
    expect((await getSession(svc, sessionId)).courts).toBe(2);
  });

  // Why tests/rpc/set_courts.test.ts keeps passing untouched: its rooms are
  // ownerless, and ownerless resolves to pro.
  it("leaves an ownerless room's court count uncapped", async () => {
    const sessionId = await seedRoom(null, 3);

    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 6,
    });

    expect(error).toBeNull();
    expect((await getSession(svc, sessionId)).courts).toBe(6);
  });
});

// ---------------------------------------------------------------------------
describe("saved-room cap", () => {
  it("lets a free account keep 2 rooms and blocks the 3rd", async () => {
    const owner = await newOwner();

    expect((await createRoomAs(owner)).error).toBeNull();
    expect((await createRoomAs(owner)).error).toBeNull();
    expect((await createRoomAs(owner)).error).not.toBeNull();
  });

  it("lifts the room cap for a pro account", async () => {
    const owner = await newOwner("pro");

    expect((await createRoomAs(owner)).error).toBeNull();
    expect((await createRoomAs(owner)).error).toBeNull();
    expect((await createRoomAs(owner)).error).toBeNull();
  });

  // The `owner_id is null` arm is dropped from sessions_insert. It was unused
  // (createSession always calls ensureUser first) and, now that ownerless means
  // uncapped, it would be a free unlimited tier one curl away.
  it("refuses to create a room with no owner", async () => {
    const { error } = await anon
      .from("sessions")
      .insert({ share_code: uniqueCode(), courts: 2, owner_id: null });

    expect(error).not.toBeNull();
  });
});
