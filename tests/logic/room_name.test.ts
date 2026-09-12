import { describe, expect, it } from "vitest";
import { MAX_ROOM_NAME, normalizeRoomName } from "../../app/lib/logic";

// Pure-logic unit tests — no Supabase. A room's name is optional, which makes
// this the mirror image of `normalizePlayerName`: there, an empty result means
// "don't write"; here it means "clear the name", and it has to be reachable.
//
// The output is also the exact value that reaches `sessions_name_check`
// (`char_length between 1 and 60 and btrim(name) = name`), so anything this
// function lets through untrimmed becomes a 23514 at the database.

describe("normalizeRoomName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeRoomName("  Tuesday club  ")).toBe("Tuesday club");
  });

  it("leaves an already-clean name untouched", () => {
    expect(normalizeRoomName("Tuesday club")).toBe("Tuesday club");
  });

  // The field is a single-line input, so these can't be typed — but they can be
  // pasted, and a newline mid-name would break the one-line header layout.
  it("collapses internal runs of whitespace", () => {
    expect(normalizeRoomName("Tuesday    club")).toBe("Tuesday club");
    expect(normalizeRoomName("Tuesday\nclub")).toBe("Tuesday club");
    expect(normalizeRoomName("Tuesday\t\tclub")).toBe("Tuesday club");
  });

  // Clearing the name is a legitimate action, so blank resolves to null rather
  // than to "" — that keeps "no name" to a single representation and spares
  // every rendering surface from distinguishing the two.
  it("reduces a blank name to null", () => {
    expect(normalizeRoomName("")).toBeNull();
    expect(normalizeRoomName("   ")).toBeNull();
    expect(normalizeRoomName("\n\t ")).toBeNull();
  });

  it("truncates at the maximum length", () => {
    const long = "a".repeat(MAX_ROOM_NAME + 40);
    expect(normalizeRoomName(long)).toHaveLength(MAX_ROOM_NAME);
  });

  // The load-bearing case, and the reason the order is collapse → trim →
  // truncate → trim *again*. Slicing at a fixed offset can land in a gap
  // between words and leave a trailing space, which `sessions_name_check`
  // rejects outright — so the truncation has to be re-trimmed after the cut.
  it("never leaves a trailing space after truncating", () => {
    // 59 characters, then a space, then more — the cut lands on the gap.
    const name = `${"a".repeat(59)} bcdefgh`;
    const result = normalizeRoomName(name)!;
    expect(result).toBe("a".repeat(59));
    expect(result).toBe(result.trim());
  });

  // Truncation counts code points, not UTF-16 units. A plain `.slice()` cuts a
  // surrogate pair in half here and yields a lone surrogate, which Postgres
  // rejects as invalid UTF-8 (22021) — a raw encoding error in the user's error
  // banner, earned by typing one emoji too many.
  it("truncates by code point, never splitting a surrogate pair", () => {
    const result = normalizeRoomName("🏸".repeat(MAX_ROOM_NAME + 10))!;
    expect([...result]).toHaveLength(MAX_ROOM_NAME);
    expect(result).toBe("🏸".repeat(MAX_ROOM_NAME));
  });

  // JS `\s` covers \t\n\v\f\r but not the other C0 controls, and a NUL reaches
  // Postgres as an encoding error rather than a constraint violation.
  it("strips control characters", () => {
    const nul = String.fromCharCode(0);
    const bell = String.fromCharCode(7);
    expect(normalizeRoomName(`Tuesday${nul}club`)).toBe("Tuesday club");
    expect(normalizeRoomName(`Tuesday${bell} club`)).toBe("Tuesday club");
  });

  it("keeps punctuation and emoji", () => {
    expect(normalizeRoomName("Tuesday @ St Mary's 🏸")).toBe(
      "Tuesday @ St Mary's 🏸",
    );
  });

  // The property the hook's no-op early-out rests on: it compares a freshly
  // normalized candidate against the already-normalized stored value, so
  // normalizing twice has to be the same as normalizing once or every save
  // writes and the modal reopens showing something other than what was typed.
  it("is idempotent", () => {
    for (const input of [
      "  Tuesday   club  ",
      "🏸".repeat(MAX_ROOM_NAME + 10),
      `${"a".repeat(59)} bcdefgh`,
      `Tuesday${String.fromCharCode(0)}club`,
      "St. Mary's — Tue 7pm",
    ]) {
      const once = normalizeRoomName(input)!;
      expect(normalizeRoomName(once)).toBe(once);
    }
  });
});
