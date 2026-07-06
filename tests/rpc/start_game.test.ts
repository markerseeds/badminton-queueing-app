import { afterEach, describe, expect, it } from "vitest";
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

const onCourt = (rows: PlayerRow[], court: number) =>
  rows
    .filter((r) => r.status === "playing" && r.court_no === court)
    .sort((a, b) => (a.court_slot ?? 0) - (b.court_slot ?? 0));

const queued = (rows: PlayerRow[]) =>
  rows
    .filter((r) => r.status === "queued")
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));

function queuedSeed(n: number, startPos = 0): SeedPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Q${startPos + i}`,
    skill: "intermediate",
    status: "queued",
    queue_position: startPos + i,
  }));
}

function playingSeed(court: number): SeedPlayer[] {
  return Array.from({ length: 4 }, (_, i) => ({
    name: `C${court}-${i}`,
    skill: "intermediate",
    status: "playing",
    court_no: court,
    court_slot: i,
  }));
}

describe("start_game", () => {
  let sessionId: string;
  afterEach(async () => {
    await deleteSession(svc, sessionId);
  });

  it("moves the front four to the first empty court (slots 0-3) and increments games_played", async () => {
    sessionId = await createTestSession(svc, 3);
    await seedPlayers(svc, sessionId, queuedSeed(5));

    const { error } = await anon.rpc("start_game", { p_session_id: sessionId });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    const court1 = onCourt(rows, 1);
    expect(court1.map((r) => r.name)).toEqual(["Q0", "Q1", "Q2", "Q3"]);
    expect(court1.map((r) => r.court_slot)).toEqual([0, 1, 2, 3]);
    expect(court1.every((r) => r.games_played === 1)).toBe(true);
    expect(court1.every((r) => r.queue_position === null)).toBe(true);
    expect(queued(rows).map((r) => r.name)).toEqual(["Q4"]);
  });

  it("is a no-op when fewer than four are queued", async () => {
    sessionId = await createTestSession(svc, 3);
    await seedPlayers(svc, sessionId, queuedSeed(3));

    const { error } = await anon.rpc("start_game", { p_session_id: sessionId });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(queued(rows)).toHaveLength(3);
    expect(rows.every((r) => r.status === "queued")).toBe(true);
    expect(rows.every((r) => r.games_played === 0)).toBe(true);
  });

  it("is a no-op when every court is occupied", async () => {
    sessionId = await createTestSession(svc, 1);
    await seedPlayers(svc, sessionId, [...playingSeed(1), ...queuedSeed(4)]);

    const { error } = await anon.rpc("start_game", { p_session_id: sessionId });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(queued(rows)).toHaveLength(4);
    expect(onCourt(rows, 1).map((r) => r.name)).toEqual([
      "C1-0",
      "C1-1",
      "C1-2",
      "C1-3",
    ]);
  });

  it("fills the first empty court when an earlier court is occupied", async () => {
    sessionId = await createTestSession(svc, 2);
    await seedPlayers(svc, sessionId, [...playingSeed(1), ...queuedSeed(4)]);

    const { error } = await anon.rpc("start_game", { p_session_id: sessionId });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(onCourt(rows, 2).map((r) => r.name)).toEqual([
      "Q0",
      "Q1",
      "Q2",
      "Q3",
    ]);
    expect(queued(rows)).toHaveLength(0);
  });

  it("fills different courts without double-assigning under concurrent starts (race)", async () => {
    sessionId = await createTestSession(svc, 2);
    await seedPlayers(svc, sessionId, queuedSeed(8));

    const [r1, r2] = await Promise.all([
      anon.rpc("start_game", { p_session_id: sessionId }),
      anon.rpc("start_game", { p_session_id: sessionId }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    const c1 = onCourt(rows, 1);
    const c2 = onCourt(rows, 2);
    expect(c1).toHaveLength(4);
    expect(c2).toHaveLength(4);
    expect(new Set([...c1, ...c2].map((r) => r.id)).size).toBe(8);
    expect(queued(rows)).toHaveLength(0);
    expect([...c1, ...c2].every((r) => r.games_played === 1)).toBe(true);
  });
});
