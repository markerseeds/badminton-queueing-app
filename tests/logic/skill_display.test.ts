import { describe, expect, it } from "vitest";
import { SKILLS } from "../../app/lib/constants";
import {
  skillLabel,
  skillOptions,
  skillRank,
} from "../../app/lib/skillDisplay";

describe("skillRank", () => {
  it("ranks the known bands from 1, in SKILLS order", () => {
    expect(skillRank("new")).toBe(1);
    expect(skillRank("intermediate")).toBe(3);
    expect(skillRank("expert")).toBe(SKILLS.length);
  });

  it("ranks an unknown band 0", () => {
    // 0 is a real value, not an error: the badge's colour ramp only defines
    // steps 1-6, so rank 0 falls through to the neutral default rather than
    // rendering a broken dot.
    expect(skillRank("pro")).toBe(0);
    expect(skillRank("")).toBe(0);
  });
});

describe("skillLabel", () => {
  it("shortens only the one band too long for a badge", () => {
    expect(skillLabel("upper intermediate")).toBe("Upper int.");
    expect(skillLabel("intermediate")).toBe("Intermediate");
    expect(skillLabel("new")).toBe("New");
  });

  it("passes an unknown band through untouched", () => {
    // Same principle as normalizeSkill: never invent a value for a legacy row.
    expect(skillLabel("pro")).toBe("pro");
  });
});

describe("skillOptions", () => {
  it("offers exactly the known bands when the current value is one", () => {
    const options = skillOptions("intermediate");
    expect(options).toHaveLength(SKILLS.length);
    expect(options.map((o) => o.value)).toEqual(SKILLS);
    expect(options.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(options.some((o) => o.legacy)).toBe(false);
  });

  it("prepends an out-of-range value as its own option", () => {
    // Player.skill is a plain string, so a row can hold a band we never listed
    // (legacy data, or one we later removed). Without this the picker would
    // show six unselected bands and no clue what the player currently is —
    // destructive in a different way than the old <select>, which at least
    // displayed the value.
    const options = skillOptions("pro");
    expect(options).toHaveLength(SKILLS.length + 1);
    expect(options[0]).toEqual({ value: "pro", rank: 0, legacy: true });
    expect(options.slice(1).map((o) => o.value)).toEqual(SKILLS);
  });

  it("does not invent a legacy option for an empty value", () => {
    // An empty string is absence, not a band worth preserving.
    expect(skillOptions("")).toHaveLength(SKILLS.length);
    expect(skillOptions("   ")).toHaveLength(SKILLS.length);
  });

  it("matches a known band case-insensitively", () => {
    // parseBatchInput lowercases on import, but a row written before that, or
    // by hand, could carry "Advanced" — which is the same band, not a new one.
    expect(skillOptions("Advanced")).toHaveLength(SKILLS.length);
  });
});
