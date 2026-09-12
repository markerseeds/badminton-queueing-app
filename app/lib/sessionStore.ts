// The single data-access module. Everything that reads from or writes to the
// database goes through here, so the rest of the app never touches Supabase
// directly. Assembles the relational rows back into the in-memory SessionState
// shape the UI renders from.

import { ensureUser } from "./auth";
import { DEFAULT_COURTS } from "./constants";
import { supabase } from "./supabase";
import type {
  AccountLimits,
  CourtGame,
  LoadedSession,
  NewPlayer,
  PlanName,
  Player,
  PlayerStatus,
  RoomSummary,
  SessionLimits,
} from "./types";

// ---------- row shapes (snake_case, as stored) ----------
type SessionRow = {
  id: string;
  share_code: string;
  name: string | null;
  courts: number;
  owner_id: string | null;
  locked: boolean;
};

// `plan_limits()` / `session_limits()` / `my_limits()` all return one-row tables,
// so supabase-js hands them back as arrays. Only the latter two carry `plan`
// (plan_limits is given one), and only `my_limits` carries `max_rooms`.
type LimitsRow = {
  plan?: string;
  max_courts: number;
  max_players: number;
  max_rooms?: number;
};

type PlayerRow = {
  id: string;
  session_id: string;
  name: string;
  skill: string;
  games_played: number;
  status: PlayerStatus;
  queue_position: number | null;
  court_no: number | null;
  court_slot: number | null;
};

// Awaits a Supabase query and throws on error so callers can rely on rejection.
async function run<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
  const res = await query;
  if (res.error) throw res.error;
  return res;
}

// ---------- share codes ----------
// Unambiguous alphabet (no I, L, O, 0, 1). 8 chars ≈ 10^12 combinations — the
// room's only gate in Phase 1 (capability URL), so it must be hard to guess.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateShareCode(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

// ---------- assembly ----------
const toPlayer = (r: PlayerRow): Player => ({
  id: r.id,
  name: r.name,
  skill: r.skill,
  gamesPlayed: r.games_played,
});

// The numbers themselves live in SQL (`plan_limits()`), never here — the whole
// point of reading them back is that the UI's gates and the server's stay the
// same gate. So a missing row is an error rather than a guessed default.
function toLimits(rows: LimitsRow[] | null): SessionLimits {
  const row = rows?.[0];
  if (!row?.plan) throw new Error("Could not read this room's plan limits.");
  return {
    plan: row.plan as PlanName,
    maxCourts: row.max_courts,
    maxPlayers: row.max_players,
  };
}

function assembleSession(
  session: SessionRow,
  rows: PlayerRow[],
  limits: SessionLimits,
): LoadedSession {
  const players = rows.map(toPlayer);

  const queue = rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
    .map(toPlayer);

  const games: CourtGame[] = [];
  for (let court = 1; court <= session.courts; court++) {
    const courtPlayers = rows
      .filter((r) => r.status === "playing" && r.court_no === court)
      .sort((a, b) => (a.court_slot ?? 0) - (b.court_slot ?? 0))
      .map(toPlayer);
    games.push({ court, players: courtPlayers });
  }

  return {
    id: session.id,
    shareCode: session.share_code,
    name: session.name,
    courts: session.courts,
    ownerId: session.owner_id,
    locked: session.locked,
    limits,
    players,
    queue,
    games,
  };
}

// ---------- session lifecycle ----------
// Creating a room signs the organizer in anonymously first (see auth.ts), so the
// room always has an owner — that's what makes it appear in "My rooms" and what
// the lock is enforced against. Joining a room does NOT do this.
export async function createSession(): Promise<{ id: string; shareCode: string }> {
  const user = await ensureUser();

  // Retry on the (rare) share_code collision surfaced by the unique constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareCode = generateShareCode();
    const { data, error } = await supabase
      .from("sessions")
      .insert({
        share_code: shareCode,
        courts: DEFAULT_COURTS,
        owner_id: user.id,
      })
      .select("id, share_code")
      .single();

    if (!error && data) return { id: data.id, shareCode: data.share_code };
    if (error?.code === "23505") continue; // unique_violation — new code, retry

    // `sessions_insert` also carries the saved-room cap, and a blocked insert
    // arrives as a bare "new row violates row-level security policy". This is
    // the only path that inserts a session, so the translation is unambiguous
    // here — and unlike the room's other gates there is no count on this screen
    // to pre-check against, so the message is all the user gets.
    if (error?.code === "42501") {
      throw new Error(
        "You've reached your plan's limit on saved rooms. Delete one to make " +
          "space, or upgrade to Pro for unlimited rooms.",
      );
    }
    if (error) throw error;
  }
  throw new Error("Could not generate a unique room code. Please try again.");
}

export async function getSessionByCode(
  code: string,
): Promise<LoadedSession | null> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, share_code, name, courts, owner_id, locked")
    .eq("share_code", code)
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;

  // Both are keyed on the session id and neither depends on the other, so they
  // go together rather than in series.
  const [rows, limits] = await Promise.all([
    supabase
      .from("players")
      .select(
        "id, session_id, name, skill, games_played, status, queue_position, court_no, court_slot",
      )
      .eq("session_id", session.id),
    supabase.rpc("session_limits", { p_session_id: session.id }),
  ]);
  if (rows.error) throw rows.error;
  if (limits.error) throw limits.error;

  return assembleSession(
    session as SessionRow,
    (rows.data ?? []) as PlayerRow[],
    toLimits(limits.data as LimitsRow[] | null),
  );
}

// The published ceilings for a plan, read from the same `plan_limits()` the
// policies consult — so the pricing page can't advertise a number the server
// would refuse to honour. Callable signed out.
export async function getPlanLimits(plan: PlanName): Promise<AccountLimits> {
  const { data, error } = await supabase.rpc("plan_limits", { p_plan: plan });
  if (error) throw error;
  const row = (data as LimitsRow[] | null)?.[0];
  if (!row) throw new Error(`No limits are defined for the ${plan} plan.`);
  return {
    plan,
    maxCourts: row.max_courts,
    maxPlayers: row.max_players,
    maxRooms: row.max_rooms ?? 0,
  };
}

// The signed-in account's own ceilings, for surfaces that aren't about one
// particular room. Null when signed out — `my_limits()` returns no row without
// a caller, deliberately, rather than defaulting.
export async function getMyLimits(): Promise<AccountLimits | null> {
  const { data, error } = await supabase.rpc("my_limits");
  if (error) throw error;
  const row = (data as LimitsRow[] | null)?.[0];
  if (!row?.plan) return null;
  return {
    plan: row.plan as PlanName,
    maxCourts: row.max_courts,
    maxPlayers: row.max_players,
    maxRooms: row.max_rooms ?? 0,
  };
}

// Rooms owned by the signed-in user. RLS lets anyone SELECT any session (a
// visitor must be able to resolve a share code), so the owner filter is applied
// here rather than being implied by the policy.
export async function listMyRooms(): Promise<RoomSummary[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("sessions")
    .select("id, share_code, name, courts, locked, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    shareCode: r.share_code,
    name: r.name,
    courts: r.courts,
    locked: r.locked,
    createdAt: r.created_at,
  }));
}

// `locked` is ungranted at the column level, so this RPC is the only way to
// change it; it re-checks ownership server-side and throws otherwise.
export async function setRoomLock(
  sessionId: string,
  locked: boolean,
): Promise<void> {
  await run(
    supabase.rpc("set_room_lock", {
      p_session_id: sessionId,
      p_locked: locked,
    }),
  );
}

// `name` is ungranted at the column level too, so this RPC is likewise the only
// way to write it — but unlike the lock it is open to anyone who may edit the
// room, not just its owner: a name is content, like the court count and player
// names, not a security control.
//
// Pass null to clear the name. A bare `run()` is enough here, without
// `updatePlayer`'s `.select("id")`-and-throw idiom: that exists because a
// lock-blocked PostgREST UPDATE matches no rows *without* erroring, whereas
// this RPC raises.
export async function setRoomName(
  sessionId: string,
  name: string | null,
): Promise<void> {
  await run(
    supabase.rpc("set_room_name", { p_session_id: sessionId, p_name: name }),
  );
}

// Owner-only (enforced by the sessions DELETE policy); cascades to players.
export async function deleteRoom(sessionId: string): Promise<void> {
  const { data, error } = await supabase
    .from("sessions")
    .delete()
    .eq("id", sessionId)
    .select("id");
  if (error) throw error;
  // A non-owner's delete matches no rows rather than erroring — surface that.
  if (!data || data.length === 0) {
    throw new Error("Only the room's owner can delete it.");
  }
}

// Re-run `onChange` whenever this session's rows change (Postgres Changes).
export function subscribeToSession(
  sessionId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`session:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "players",
        filter: `session_id=eq.${sessionId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sessions",
        filter: `id=eq.${sessionId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------- player mutations ----------
export async function addPlayer(
  sessionId: string,
  player: NewPlayer,
): Promise<void> {
  await run(
    supabase
      .from("players")
      .insert({ session_id: sessionId, name: player.name, skill: player.skill }),
  );
}

export async function addPlayers(
  sessionId: string,
  players: NewPlayer[],
): Promise<void> {
  if (players.length === 0) return;
  await run(
    supabase.from("players").insert(
      players.map((p) => ({
        session_id: sessionId,
        name: p.name,
        skill: p.skill,
      })),
    ),
  );
}

export async function deletePlayer(playerId: string): Promise<void> {
  await run(supabase.from("players").delete().eq("id", playerId));
}

export async function deleteAllPlayers(sessionId: string): Promise<void> {
  await run(supabase.from("players").delete().eq("session_id", sessionId));
}

export async function setGamesPlayed(
  playerId: string,
  value: number,
): Promise<void> {
  await run(
    supabase.from("players").update({ games_played: value }).eq("id", playerId),
  );
}

// Rename a player and/or change their skill band. Single row, so PostgREST
// direct — no RPC needed. `name` and `skill` are both inside the column-level
// UPDATE grant on `players`, gated by the `session_is_editable(session_id)`
// policy. (Phase 3a narrowed that grant: `session_id` is no longer writable, so
// a player can't be moved into another room past its player cap.)
export async function updatePlayer(
  playerId: string,
  details: { name: string; skill: string },
): Promise<void> {
  const { data, error } = await supabase
    .from("players")
    .update({ name: details.name, skill: details.skill })
    .eq("id", playerId)
    .select("id");
  if (error) throw error;
  // A write blocked by the room lock matches no rows rather than erroring (see
  // `deleteRoom`). The edit control is already hidden in read-only mode, so this
  // only fires if the owner locks the room while someone has the modal open —
  // but there, a rename that appears to save and then reverts is worse than an
  // honest error.
  if (!data || data.length === 0) {
    throw new Error("Could not update this player — the room may be locked.");
  }
}

// ---------- queue ----------
// Append players to the back of the queue, preserving the given order.
// The starting position is computed inside the RPC's transaction, so two
// concurrent enqueues can't collide on the same position.
export async function enqueue(
  sessionId: string,
  playerIds: string[],
): Promise<void> {
  if (playerIds.length === 0) return;
  await run(
    supabase.rpc("enqueue_players", {
      p_session_id: sessionId,
      p_player_ids: playerIds,
    }),
  );
}

export async function removeFromQueue(playerId: string): Promise<void> {
  await run(
    supabase
      .from("players")
      .update({ status: "idle", queue_position: null })
      .eq("id", playerId),
  );
}

// Shuffle the front `size` players among their existing queue slots.
export async function shuffleQueueFront(
  sessionId: string,
  size = 4,
): Promise<void> {
  await run(
    supabase.rpc("shuffle_queue_front", {
      p_session_id: sessionId,
      p_size: size,
    }),
  );
}

// ---------- courts ----------
// Move the front four of the queue onto the first empty court, incrementing each
// player's games-played. The court and the four players are chosen server-side
// (inside the transaction), so concurrent starts can't double-book a court.
export async function startGame(sessionId: string): Promise<void> {
  await run(supabase.rpc("start_game", { p_session_id: sessionId }));
}

export async function endGame(
  sessionId: string,
  courtNo: number,
): Promise<void> {
  await run(
    supabase
      .from("players")
      .update({ status: "idle", court_no: null, court_slot: null })
      .eq("session_id", sessionId)
      .eq("status", "playing")
      .eq("court_no", courtNo),
  );
}

// Change the court count, idling any players stranded on removed courts. Both
// writes happen in one transaction inside the RPC, so a partial failure can't
// leave a player "playing" on a court that no longer exists.
export async function setCourts(
  sessionId: string,
  newCourts: number,
): Promise<void> {
  await run(
    supabase.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: newCourts,
    }),
  );
}
