// Shared domain types for the badminton queue app.

// The six skill bands, ordered from lowest to highest. The index in this order
// is what the auto-pick logic uses to keep a group within one skill band.
export type Skill =
  | "new"
  | "beginner"
  | "intermediate"
  | "upper intermediate"
  | "advanced"
  | "expert";

// A player's state within a session. In the relational schema this maps to the
// `status` column; the queue/court arrays in SessionState are derived from it.
export type PlayerStatus = "idle" | "queued" | "playing";

export type Player = {
  id: string;
  name: string;
  // Kept as a plain string (not the Skill union) to stay tolerant of existing
  // data; validated against SKILLS on input.
  skill: string;
  gamesPlayed: number;
};

// A player about to be created — no id/gamesPlayed yet (the DB assigns them).
export type NewPlayer = {
  name: string;
  skill: string;
};

export type CourtGame = {
  court: number;
  players: Player[];
};

// The in-memory shape the whole UI renders from. `players` is the full roster;
// `queue` and `games[].players` are derived subsets.
export type SessionState = {
  courts: number;
  players: Player[];
  queue: Player[];
  games: CourtGame[];
};

export type PlanName = "free" | "pro";

// The ceilings this room is judged by, read from the `session_limits()` SQL
// function the policies themselves consult — so the gates the UI renders can't
// drift from the gates the server enforces.
//
// These follow the room's OWNER, not the viewer. A stranger holding the share
// code sees the owner's ceilings, because that is what the server will enforce
// on their writes.
export type SessionLimits = {
  plan: PlanName;
  maxCourts: number;
  maxPlayers: number;
};

// What the signed-in account itself is entitled to, for surfaces that aren't
// about one particular room (the "My rooms" list).
export type AccountLimits = SessionLimits & {
  maxRooms: number;
};

// A loaded session also carries its identity (used for realtime + writes) and
// its ownership, which the UI uses to decide whether to offer the lock toggle
// or show a read-only notice. RLS is the real gate; these just keep the UI
// honest about what the current viewer can do.
export type LoadedSession = SessionState & {
  id: string;
  shareCode: string;
  // Null for rooms created before accounts existed, and for rooms whose owner
  // deleted their account. Such rooms stay open to anyone with the code.
  ownerId: string | null;
  locked: boolean;
  limits: SessionLimits;
};

// A row in the "My rooms" list — enough to identify a room without loading it.
export type RoomSummary = {
  id: string;
  shareCode: string;
  courts: number;
  locked: boolean;
  createdAt: string;
};
