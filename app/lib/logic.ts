// Pure, DB-agnostic game logic. These functions operate only on in-memory
// arrays and have no knowledge of Firebase or Supabase.

import { SKILLS } from "./constants";
import type { NewPlayer, Player, SessionState } from "./types";

// Maps a skill string to its ordinal (0..5); -1 if unknown.
export const getSkillIndex = (skill: string): number => SKILLS.indexOf(skill);

// In-place Fisher-Yates shuffle. Returns the same array for convenience.
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Auto-pick the best group of four from the available players:
//   1. shuffle, then STABLY sort by games played (fewest first) — so the list runs
//      fewest-games-first with ties broken randomly,
//   2. slide a window of four and take the first group within one skill band,
//   3. fall back to the first four if no in-band group exists.
// Operates on a copy so the caller's array is left untouched.
export function pickFourPlayers(available: Player[]): Player[] {
  if (available.length < 4) return [];

  // Shuffle first, then a *stable* sort by games played. Array.prototype.sort is
  // stable (ES2019+), so equal-games players keep their shuffled (random) order
  // while the overall list still runs fewest-games-first.
  const players = shuffleArray([...available]);
  players.sort((a, b) => a.gamesPlayed - b.gamesPlayed);

  let group: Player[] = [];
  for (let i = 0; i <= players.length - 4; i++) {
    const potentialGroup = players.slice(i, i + 4);
    const skillIndices = potentialGroup.map((p) => getSkillIndex(p.skill));
    const minSkill = Math.min(...skillIndices);
    const maxSkill = Math.max(...skillIndices);
    if (maxSkill - minSkill <= 1) {
      group = potentialGroup;
      break;
    }
  }

  if (group.length === 0) {
    group = players.slice(0, 4);
    console.warn(
      "Could not find 4 players within 1 skill level difference. Picking the 4 with the lowest games played.",
    );
  }

  return group;
}

// Parse the batch-add textarea ("Name, Skill" per line). Returns the parsed
// players or the first validation error (1-indexed line number).
export function parseBatchInput(text: string): {
  players?: NewPlayer[];
  error?: string;
} {
  const rawLines = text.split("\n");
  const players: NewPlayer[] = [];

  // Iterate over the raw lines so error messages report the real textarea line
  // number (blank lines are skipped but still counted toward the number).
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].trim() === "") continue;

    const [name, skill] = rawLines[i].split(",").map((item) => item.trim());

    if (!name || !skill) {
      return { error: `Line ${i + 1}: Format must be "Name, Skill"` };
    }

    const formattedSkill = skill.toLowerCase();
    if (!SKILLS.includes(formattedSkill)) {
      return { error: `Line ${i + 1}: "${skill}" is not a valid skill level.` };
    }

    players.push({ name, skill: formattedSkill });
  }

  return { players };
}

// Clamp a games-played count to a non-negative whole number. Guards the −
// stepper (which can otherwise go below zero) and any stray fractional/NaN value.
export function clampGamesPlayed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

// Parse the games-counter text input into a non-negative whole number. Empty or
// non-numeric input (e.g. while the field is being cleared) becomes 0, not NaN.
export function parseGamesPlayedInput(raw: string): number {
  return clampGamesPlayed(parseInt(raw, 10));
}

// Trim a player name typed into the add or edit form. An empty result means
// "no name" — callers treat that as a reason not to write, so a rename can
// never blank out a player.
export function normalizePlayerName(raw: string): string {
  return raw.trim();
}

// Matches the `char_length(name) between 1 and 60` arm of `sessions_name_check`.
// A room name is a headline, not a description.
export const MAX_ROOM_NAME = 60;

// Normalize a room name typed into the rename dialog. The mirror image of
// `normalizePlayerName`: a player must be called something, so there an empty
// result means "don't write", while a room need not be, so here it means
// "clear the name" and resolves to null. That keeps "no name" to one
// representation, so no rendering surface has to tell null from "".
//
// Three things about the order, each load-bearing:
//
//  1. Runs of whitespace collapse rather than merely trimming, because the value
//     lands in `document.title` and in single-line `truncate` elements. The
//     input is single-line so a newline can't be typed — but it can be pasted.
//     Control characters join the class (`\p{Cc}`): JS `\s` covers \t\n\v\f\r
//     and misses the rest, and a NUL reaches Postgres as an encoding error
//     (22021) rather than an honest constraint violation.
//  2. Truncation is by **code point**, not `.slice()`. Slicing counts UTF-16
//     units, so a name one emoji over the cap loses half a surrogate pair and
//     the lone surrogate is again a raw 22021 in the user's error banner.
//  3. The final trim catches a cut that lands in the gap between two words,
//     which would otherwise leave a trailing space for `sessions_name_check`'s
//     `btrim(name) = name` arm to reject.
//
// Normalizing twice must equal normalizing once: `useSession` compares a fresh
// candidate against the stored value to skip a no-op write, and an unstable
// normalizer would make every save a write.
export function normalizeRoomName(raw: string): string | null {
  const collapsed = raw.replace(/[\s\p{Cc}]+/gu, " ").trim();
  return [...collapsed].slice(0, MAX_ROOM_NAME).join("").trim() || null;
}

// Normalize a skill typed or picked in the edit form, the same way
// `parseBatchInput` does for imported rows: lowercase it if it's one we know.
// An unrecognized value is returned as-is rather than coerced to SKILLS[0] —
// `Player.skill` is a plain string on purpose, and silently demoting a legacy
// value to "new" just because someone opened the edit modal would lose data.
export function normalizeSkill(raw: string): string {
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();
  return SKILLS.includes(lowered) ? lowered : trimmed;
}

// Players who are neither on a court nor in the queue — i.e. selectable.
export function getAvailablePlayers(state: SessionState): Player[] {
  const playing = new Set(
    state.games.flatMap((g) => g.players).map((p) => p.id),
  );
  const queued = new Set(state.queue.map((p) => p.id));
  return state.players.filter((p) => !playing.has(p.id) && !queued.has(p.id));
}
