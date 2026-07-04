// Pure, DB-agnostic game logic. These functions operate only on in-memory
// arrays and have no knowledge of Firebase or Supabase.

import { SKILLS } from "./constants";
import type { NewPlayer, Player } from "./types";

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
//   1. sort by games played (fewest first), then shuffle for fair tie-breaking,
//   2. slide a window of four and take the first group within one skill band,
//   3. fall back to the first four if no in-band group exists.
// Operates on a copy so the caller's array is left untouched.
export function pickFourPlayers(available: Player[]): Player[] {
  if (available.length < 4) return [];

  let players = [...available];
  players.sort((a, b) => a.gamesPlayed - b.gamesPlayed);
  players = shuffleArray(players);

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
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const players: NewPlayer[] = [];

  for (let i = 0; i < lines.length; i++) {
    const [name, skill] = lines[i].split(",").map((item) => item.trim());

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
