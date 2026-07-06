import { describe, expect, it } from "vitest";
import { pickFourPlayers } from "../../app/lib/logic";
import type { Player } from "../../app/lib/types";

// Pure-logic unit test — no Supabase, no .env.test. `pickFourPlayers` only
// imports constants/types, so importing it never touches the DB helpers.
const mk = (id: string, gamesPlayed: number, skill = "intermediate"): Player => ({
  id,
  name: id,
  skill,
  gamesPlayed,
});

describe("pickFourPlayers", () => {
  it("returns [] when fewer than four are available", () => {
    expect(pickFourPlayers([mk("a", 0), mk("b", 0), mk("c", 0)])).toHaveLength(0);
  });

  it("honours fewest-games-first: never picks a higher-games player over eligible lower ones", () => {
    // Five same-skill players with distinct games counts. The four lowest
    // (0,1,2,3) must always be chosen; the 4-games player must never appear.
    const players = [mk("g0", 0), mk("g1", 1), mk("g2", 2), mk("g3", 3), mk("g4", 4)];
    for (let i = 0; i < 200; i++) {
      const games = pickFourPlayers(players)
        .map((p) => p.gamesPlayed)
        .sort((a, b) => a - b);
      expect(games).toEqual([0, 1, 2, 3]);
    }
  });

  it("still breaks ties randomly among equal-games players", () => {
    // Eight same-skill, same-games players: which four get picked should vary
    // across runs. Guards against an over-correction that drops the shuffle.
    const players = Array.from({ length: 8 }, (_, i) => mk(`p${i}`, 0));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const key = pickFourPlayers(players)
        .map((p) => p.id)
        .sort()
        .join(",");
      seen.add(key);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps the group within one skill band when possible", () => {
    // Only the back four (all intermediate) form an in-band group; the
    // lowest-games players are too spread in skill, so the in-band four win.
    const players = [
      mk("new0", 0, "new"),
      mk("exp0", 1, "expert"),
      mk("int0", 2, "intermediate"),
      mk("int1", 3, "intermediate"),
      mk("int2", 4, "intermediate"),
      mk("int3", 5, "intermediate"),
    ];
    const skills = pickFourPlayers(players).map((p) => p.skill);
    expect(new Set(skills)).toEqual(new Set(["intermediate"]));
  });
});
