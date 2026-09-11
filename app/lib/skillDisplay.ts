// Presentation helpers for skill bands. DB-agnostic and unit-tested, like the
// rest of lib/logic.ts — nothing here reads or writes a player.
//
// The reason this file exists: `Player.skill` is a plain `string`, not the
// `Skill` union (see lib/types.ts), so a row can legitimately carry a value
// outside SKILLS. Every piece of UI that renders or offers a skill has to
// decide what to do about that, and it should decide the same way each time.

import { SKILLS } from "./constants";

export type SkillOption = {
  value: string;
  /** 1-based position in SKILLS; 0 for a band we don't know. */
  rank: number;
  legacy: boolean;
};

// SKILLS is ascending, and the index is what the auto-pick band window runs on,
// so rank doubles as the position on the badge's colour ramp.
export function skillRank(skill: string): number {
  return SKILLS.indexOf(skill.trim().toLowerCase()) + 1;
}

// Only "upper intermediate" is too long for a badge; the rest are just
// capitalised. An unrecognized band is returned as-is rather than coerced,
// matching normalizeSkill's deliberate refusal to rewrite legacy values.
const SHORT_LABELS: Record<string, string> = {
  new: "New",
  beginner: "Beginner",
  intermediate: "Intermediate",
  "upper intermediate": "Upper int.",
  advanced: "Advanced",
  expert: "Expert",
};

export function skillLabel(skill: string): string {
  return SHORT_LABELS[skill.trim().toLowerCase()] ?? skill;
}

// The options a skill picker should offer, given the value currently saved.
//
// The old native <select> needed a special case here because it silently
// reports its *first* option when handed a value it doesn't have, which would
// demote a legacy player to "new" just by opening and saving the dialog. A
// button/radio grid can't do that — but it can do something just as bad: show
// six unselected bands, telling the organizer nothing about what the player
// currently is and giving them no way to put the value back after a mis-tap.
//
// So an out-of-range value gets its own option. Callers must derive this from
// the *saved* skill, not from the current selection, so it stays available for
// the whole editing session exactly as the extra <option> did.
export function skillOptions(current: string): SkillOption[] {
  const known: SkillOption[] = SKILLS.map((value, i) => ({
    value,
    rank: i + 1,
    legacy: false,
  }));

  const trimmed = current.trim();
  // An empty value is absence, not a band worth preserving a slot for.
  if (!trimmed || skillRank(trimmed) > 0) return known;

  return [{ value: trimmed, rank: 0, legacy: true }, ...known];
}
