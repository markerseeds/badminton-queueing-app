import { describe, expect, it } from "vitest";
import { normalizePlayerName, normalizeSkill } from "../../app/lib/logic";

// Pure-logic unit tests — no Supabase. These guard the normalization applied
// when an existing player's name or skill is edited. The environment is `node`,
// so the modal itself can't be tested; the rules it depends on live here.

describe("normalizePlayerName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizePlayerName("  Mark  ")).toBe("Mark");
  });

  it("leaves an already-clean name untouched", () => {
    expect(normalizePlayerName("Mark")).toBe("Mark");
  });

  it("preserves internal spacing", () => {
    expect(normalizePlayerName("  Mary Jane  ")).toBe("Mary Jane");
  });

  // The caller treats an empty result as "don't write" — a rename must never be
  // able to blank out a player's name.
  it("reduces a whitespace-only name to an empty string", () => {
    expect(normalizePlayerName("   ")).toBe("");
    expect(normalizePlayerName("")).toBe("");
  });
});

describe("normalizeSkill", () => {
  it("lowercases a known skill", () => {
    expect(normalizeSkill("Intermediate")).toBe("intermediate");
    expect(normalizeSkill("UPPER INTERMEDIATE")).toBe("upper intermediate");
  });

  it("passes a known lowercase skill through", () => {
    expect(normalizeSkill("advanced")).toBe("advanced");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSkill("  expert ")).toBe("expert");
  });

  // The load-bearing case. `Player.skill` is deliberately typed `string`, not
  // the `Skill` union, so rows can carry values outside SKILLS. Coercing an
  // unrecognized skill to SKILLS[0] would silently demote such a player to
  // "new" the moment someone opened and saved the edit modal.
  it("returns an unrecognized skill unchanged rather than coercing it", () => {
    expect(normalizeSkill("semi-pro")).toBe("semi-pro");
    expect(normalizeSkill("Legacy Value")).toBe("Legacy Value");
  });
});
