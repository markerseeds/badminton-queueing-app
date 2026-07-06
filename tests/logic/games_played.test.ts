import { describe, expect, it } from "vitest";
import { clampGamesPlayed, parseGamesPlayedInput } from "../../app/lib/logic";

// Pure-logic unit tests — no Supabase. Guard the bug-prone edges of the
// per-player games counter: negatives (from the − stepper) and empty/garbage
// text (from clearing the input mid-typing).
describe("clampGamesPlayed", () => {
  it("never returns a negative count", () => {
    expect(clampGamesPlayed(-1)).toBe(0);
    expect(clampGamesPlayed(-100)).toBe(0);
  });

  it("passes through non-negative counts", () => {
    expect(clampGamesPlayed(0)).toBe(0);
    expect(clampGamesPlayed(7)).toBe(7);
  });

  it("floors fractional values to whole games", () => {
    expect(clampGamesPlayed(3.9)).toBe(3);
  });

  it("treats NaN / non-finite input as 0", () => {
    expect(clampGamesPlayed(NaN)).toBe(0);
    expect(clampGamesPlayed(Infinity)).toBe(0);
  });
});

describe("parseGamesPlayedInput", () => {
  it("parses a numeric string", () => {
    expect(parseGamesPlayedInput("12")).toBe(12);
  });

  it("treats empty or non-numeric input as 0 (not NaN)", () => {
    expect(parseGamesPlayedInput("")).toBe(0);
    expect(parseGamesPlayedInput("abc")).toBe(0);
  });

  it("never yields a negative count", () => {
    expect(parseGamesPlayedInput("-3")).toBe(0);
  });
});
