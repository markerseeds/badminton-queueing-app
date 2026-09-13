import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonClient,
  anonSignedInClient,
  authedClient,
  createTestSession,
  deleteSession,
  deleteUser,
  getClaim,
  getSession,
  roomsOwnedBy,
  seedClaim,
  serviceClient,
  setPlan,
} from "../helpers/db";

// Phase 3b: redeeming a claim ticket moves every room off the discarded
// anonymous identity and onto the account that just signed in.
//
// `owner_id` is ungranted at the column level, so this RPC is the only way to
// write it — the same shape as `locked` / `set_room_lock` and `name` /
// `set_room_name`. Being SECURITY DEFINER also sidesteps `sessions_update`,
// whose with-check carries the plan court cap and would otherwise refuse the
// ownership change on any room grandfathered above it ("moves a room that sits
// above its owner's court cap" below).
//
// The rule the tests keep returning to: a refusal must NOT consume the ticket.
// By the time a caller sees one she has already lost the anonymous session, and
// her rooms are reachable only by share code — so redeeming again after making
// space has to work. Raising rather than returning is what guarantees it, since
// the exception rolls the claim back with everything else.
//
// Unlike a blocked PostgREST UPDATE (0 rows, no error), a blocked RPC raises —
// so these assert on `error`, not on row counts.

const svc = serviceClient();
const anon = anonClient();

const rooms: string[] = [];
const users: string[] = [];

afterEach(async () => {
  // Rooms first: deleting a user only SET NULLs owner_id, so the rows would
  // leak. Claims need no cleanup — they cascade from auth.users.
  for (const id of rooms.splice(0)) await deleteSession(svc, id);
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

type Actor = { client: SupabaseClient; userId: string };

// The organizer as she starts out: signed in anonymously by "Create a room".
async function anonymousOrganizer(): Promise<Actor> {
  const actor = await anonSignedInClient();
  users.push(actor.userId);
  return actor;
}

// The Google account she turns out to already have.
async function account(plan: "free" | "pro" = "free"): Promise<Actor> {
  const actor = await authedClient(svc);
  users.push(actor.userId);
  if (plan === "pro") await setPlan(svc, actor.userId, plan);
  return actor;
}

async function seedRoom(ownerId: string, courts = 2): Promise<string> {
  const id = await createTestSession(svc, courts, { ownerId });
  rooms.push(id);
  return id;
}

describe("transfer_room_ownership", () => {
  it("moves every room from the anonymous owner to the caller", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const a = await seedRoom(from.userId);
    const b = await seedRoom(from.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { data, error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect(data).toBe(2);

    expect((await getSession(svc, a)).owner_id).toBe(to.userId);
    expect((await getSession(svc, b)).owner_id).toBe(to.userId);
    expect(await roomsOwnedBy(svc, from.userId)).toHaveLength(0);
    expect((await getClaim(svc, nonce))!.redeemed_at).not.toBeNull();
  });

  // THE load-bearing case of the phase. A build that claims the ticket before
  // checking the cap passes every other test here and strands the user
  // permanently the first time an account is full.
  it("leaves the ticket unredeemed when the move would exceed the room cap", async () => {
    const from = await anonymousOrganizer();
    const to = await account(); // free → 2 rooms
    const mine = await seedRoom(from.userId);
    await seedRoom(to.userId);
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");

    // Nothing moved, and — the point — the ticket is still redeemable.
    expect((await getSession(svc, mine)).owner_id).toBe(from.userId);
    expect((await getClaim(svc, nonce))!.redeemed_at).toBeNull();
  });

  // The recovery the strict refusal above is only survivable because of. Same
  // nonce, after making space.
  it("redeems the same ticket once the caller deletes a room", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const mine = await seedRoom(from.userId);
    const spare = await seedRoom(to.userId);
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, from.userId);

    const first = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(first.error).not.toBeNull();

    await deleteSession(svc, spare);
    rooms.splice(rooms.indexOf(spare), 1);

    const second = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(1);
    expect((await getSession(svc, mine)).owner_id).toBe(to.userId);
  });

  // The direct analogue of set_room_name's grandfathered case, and the reason
  // this is SECURITY DEFINER rather than a widened column grant: 6 courts on a
  // free owner fails `sessions_update`'s with-check, so a non-definer build
  // refuses the ownership change with 42501 on a room that deliberately keeps
  // its courts.
  it("moves a room that sits above its owner's court cap", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const grandfathered = await seedRoom(from.userId, 6);
    const nonce = await seedClaim(svc, from.userId);

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();

    const after = await getSession(svc, grandfathered);
    expect(after.owner_id).toBe(to.userId);
    // The courts survive the move — the ratchet only bites when someone
    // deliberately changes the count.
    expect(after.courts).toBe(6);
  });

  // React's development double-effect and a second open tab both land here. A
  // build that raises on replay shows an error after a transfer that worked.
  it("returns 0 on a replayed ticket rather than raising", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    await seedRoom(from.userId);
    const nonce = await seedClaim(svc, from.userId);

    const first = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(first.data).toBe(1);

    const second = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(0);
  });

  // Against `sessions_insert`'s `count < max`, which is right there and wrong
  // here: that policy's own row isn't in yet, this one's rooms already exist.
  it("allows a move that exactly fills the cap", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    await seedRoom(from.userId);
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { data, error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(await roomsOwnedBy(svc, to.userId)).toHaveLength(2);
  });

  it("refuses a move one room over the cap", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    await seedRoom(from.userId);
    await seedRoom(from.userId);
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error!.code).toBe("23514");
  });

  // Proves the cap is derived from plan_limits() rather than a hardcoded 2 —
  // the same reason /pricing reads its numbers out of SQL.
  it("lifts the cap for a Pro target", async () => {
    const from = await anonymousOrganizer();
    const to = await account("pro");
    for (let i = 0; i < 3; i++) await seedRoom(from.userId);
    await seedRoom(to.userId);
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { data, error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect(data).toBe(3);
  });

  // linkIdentity kept the user id after all, or she cancelled at Google. The
  // ticket survives, in case the real fallback still happens in this browser.
  it("is a no-op when the ticket names its own caller", async () => {
    const to = await account();
    await seedRoom(to.userId);
    const nonce = await seedClaim(svc, to.userId);

    const { data, error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect(data).toBe(0);
    expect((await getClaim(svc, nonce))!.redeemed_at).toBeNull();
  });

  it("returns 0 when the anonymous owner had no rooms", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const nonce = await seedClaim(svc, from.userId);

    const { data, error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it("refuses a signed-out caller", async () => {
    const from = await anonymousOrganizer();
    const room = await seedRoom(from.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { error } = await anon.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect((await getSession(svc, room)).owner_id).toBe(from.userId);
  });

  it("refuses a nonce that does not exist", async () => {
    const to = await account();

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("P0002");
  });

  it("refuses an expired ticket", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const room = await seedRoom(from.userId);
    const nonce = await seedClaim(svc, from.userId, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error!.code).toBe("P0002");
    expect((await getSession(svc, room)).owner_id).toBe(from.userId);
  });

  // A ticket entitles you to one identity's rooms, not to every room in the
  // database — the obvious catastrophe if the update's where clause slipped.
  it("does not touch a third party's rooms", async () => {
    const from = await anonymousOrganizer();
    const to = await account();
    const bystander = await account();
    await seedRoom(from.userId);
    const theirs = await seedRoom(bystander.userId);
    const nonce = await seedClaim(svc, from.userId);

    const { error } = await to.client.rpc("transfer_room_ownership", {
      p_nonce: nonce,
    });
    expect(error).toBeNull();
    expect((await getSession(svc, theirs)).owner_id).toBe(bystander.userId);
  });
});
