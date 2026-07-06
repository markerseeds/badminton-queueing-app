import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestSession,
  deleteSession,
  getPlayers,
  seedPlayers,
  serviceClient,
  type PlayerRow,
  type SeedPlayer,
} from "../helpers/db";

const svc = serviceClient();
const anon = anonClient();

const queued = (rows: PlayerRow[]) =>
  rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));

function queuedSeed(names: string[]): SeedPlayer[] {
  return names.map((name, i) => ({
    name,
    skill: "intermediate",
    status: "queued",
    queue_position: i,
  }));
}

describe("shuffle_queue_front", () => {
  let sessionId: string;
  beforeEach(async () => {
    sessionId = await createTestSession(svc);
  });
  afterEach(async () => {
    await deleteSession(svc, sessionId);
  });

  it("permutes only the front four, preserving id/position sets and leaving the rest untouched", async () => {
    const seeded = await seedPlayers(
      svc,
      sessionId,
      queuedSeed(["F0", "F1", "F2", "F3", "R4", "R5"]),
    );
    const frontIds = new Set(seeded.slice(0, 4).map((p) => p.id));

    const { error } = await anon.rpc("shuffle_queue_front", {
      p_session_id: sessionId,
    });
    expect(error).toBeNull();

    const rows = queued(await getPlayers(svc, sessionId));
    expect(rows.map((r) => r.queue_position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(rows.slice(0, 4).map((r) => r.id))).toEqual(frontIds);
    // positions 4 and 5 are outside the shuffled window — exact mapping intact
    expect(rows[4].name).toBe("R4");
    expect(rows[5].name).toBe("R5");
  });

  it("is a no-op when fewer than four are queued", async () => {
    await seedPlayers(svc, sessionId, queuedSeed(["A", "B", "C"]));

    const { error } = await anon.rpc("shuffle_queue_front", {
      p_session_id: sessionId,
    });
    expect(error).toBeNull();

    const rows = queued(await getPlayers(svc, sessionId));
    expect(rows.map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(rows.map((r) => r.queue_position)).toEqual([0, 1, 2]);
  });

  it("actually randomizes the front order across repeated calls", async () => {
    await seedPlayers(svc, sessionId, queuedSeed(["A", "B", "C", "D"]));

    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { error } = await anon.rpc("shuffle_queue_front", {
        p_session_id: sessionId,
      });
      expect(error).toBeNull();
      const order = queued(await getPlayers(svc, sessionId))
        .map((r) => r.name)
        .join(",");
      seen.add(order);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
