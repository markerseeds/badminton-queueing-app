import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestSession,
  deleteSession,
  getPlayers,
  seedPlayers,
  serviceClient,
  type PlayerRow,
} from "../helpers/db";

const svc = serviceClient();
const anon = anonClient();

const queued = (rows: PlayerRow[]) =>
  rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));

describe("enqueue_players", () => {
  let sessionId: string;

  beforeEach(async () => {
    sessionId = await createTestSession(svc);
  });
  afterEach(async () => {
    await deleteSession(svc, sessionId);
  });

  it("queues players in the given order with contiguous positions from 0", async () => {
    const [a, b, c] = await seedPlayers(svc, sessionId, [
      { name: "A", skill: "intermediate" },
      { name: "B", skill: "intermediate" },
      { name: "C", skill: "intermediate" },
    ]);

    const { error } = await anon.rpc("enqueue_players", {
      p_session_id: sessionId,
      p_player_ids: [c.id, a.id, b.id],
    });
    expect(error).toBeNull();

    const rows = queued(await getPlayers(svc, sessionId));
    expect(rows.map((r) => r.name)).toEqual(["C", "A", "B"]);
    expect(rows.map((r) => r.queue_position)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.court_no === null && r.court_slot === null)).toBe(
      true,
    );
  });

  it("appends to the back of an existing queue", async () => {
    await seedPlayers(svc, sessionId, [
      { name: "Q0", skill: "intermediate", status: "queued", queue_position: 0 },
      { name: "Q1", skill: "intermediate", status: "queued", queue_position: 1 },
    ]);
    const [x, y] = await seedPlayers(svc, sessionId, [
      { name: "X", skill: "intermediate" },
      { name: "Y", skill: "intermediate" },
    ]);

    const { error } = await anon.rpc("enqueue_players", {
      p_session_id: sessionId,
      p_player_ids: [x.id, y.id],
    });
    expect(error).toBeNull();

    const rows = queued(await getPlayers(svc, sessionId));
    expect(rows.map((r) => r.name)).toEqual(["Q0", "Q1", "X", "Y"]);
    expect(rows.map((r) => r.queue_position)).toEqual([0, 1, 2, 3]);
  });

  it("keeps positions distinct and contiguous under concurrent enqueues (race)", async () => {
    const players = await seedPlayers(svc, sessionId, [
      { name: "A", skill: "intermediate" },
      { name: "B", skill: "intermediate" },
      { name: "C", skill: "intermediate" },
      { name: "D", skill: "intermediate" },
      { name: "E", skill: "intermediate" },
      { name: "F", skill: "intermediate" },
    ]);
    const first = players.slice(0, 3).map((p) => p.id);
    const second = players.slice(3).map((p) => p.id);

    const [r1, r2] = await Promise.all([
      anon.rpc("enqueue_players", {
        p_session_id: sessionId,
        p_player_ids: first,
      }),
      anon.rpc("enqueue_players", {
        p_session_id: sessionId,
        p_player_ids: second,
      }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();

    const rows = queued(await getPlayers(svc, sessionId));
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.queue_position)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
