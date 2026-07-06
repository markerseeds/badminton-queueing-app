// The single data-access module. Everything that reads from or writes to the
// database goes through here, so the rest of the app never touches Supabase
// directly. Assembles the relational rows back into the in-memory SessionState
// shape the UI renders from.

import { supabase } from "./supabase";
import type {
  CourtGame,
  LoadedSession,
  NewPlayer,
  Player,
  PlayerStatus,
} from "./types";

// ---------- row shapes (snake_case, as stored) ----------
type SessionRow = {
  id: string;
  share_code: string;
  courts: number;
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

function assembleSession(session: SessionRow, rows: PlayerRow[]): LoadedSession {
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
    courts: session.courts,
    players,
    queue,
    games,
  };
}

// ---------- session lifecycle ----------
export async function createSession(): Promise<{ id: string; shareCode: string }> {
  // Retry on the (rare) share_code collision surfaced by the unique constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    const shareCode = generateShareCode();
    const { data, error } = await supabase
      .from("sessions")
      .insert({ share_code: shareCode, courts: 3 })
      .select("id, share_code")
      .single();

    if (!error && data) return { id: data.id, shareCode: data.share_code };
    if (error && error.code !== "23505") throw error; // 23505 = unique_violation
  }
  throw new Error("Could not generate a unique room code. Please try again.");
}

export async function getSessionByCode(
  code: string,
): Promise<LoadedSession | null> {
  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, share_code, courts")
    .eq("share_code", code)
    .maybeSingle();
  if (error) throw error;
  if (!session) return null;

  const { data: rows, error: rowsError } = await supabase
    .from("players")
    .select(
      "id, session_id, name, skill, games_played, status, queue_position, court_no, court_slot",
    )
    .eq("session_id", session.id);
  if (rowsError) throw rowsError;

  return assembleSession(session as SessionRow, (rows ?? []) as PlayerRow[]);
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
