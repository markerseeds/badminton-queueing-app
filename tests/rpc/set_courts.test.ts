import { afterEach, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestSession,
  deleteSession,
  getPlayers,
  getSession,
  seedPlayers,
  serviceClient,
  type PlayerRow,
  type SeedPlayer,
} from "../helpers/db";

const svc = serviceClient();
const anon = anonClient();

const onCourt = (rows: PlayerRow[], court: number) =>
  rows.filter((r) => r.status === "playing" && r.court_no === court);
const idle = (rows: PlayerRow[]) => rows.filter((r) => r.status === "idle");

function playingSeed(court: number): SeedPlayer[] {
  return Array.from({ length: 4 }, (_, i) => ({
    name: `C${court}-${i}`,
    skill: "intermediate",
    status: "playing",
    court_no: court,
    court_slot: i,
  }));
}

describe("set_courts", () => {
  let sessionId: string;
  afterEach(async () => {
    await deleteSession(svc, sessionId);
  });

  it("idles players on removed courts and updates the court count", async () => {
    sessionId = await createTestSession(svc, 3);
    await seedPlayers(svc, sessionId, [
      ...playingSeed(1),
      ...playingSeed(2),
      ...playingSeed(3),
    ]);

    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 2,
    });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(onCourt(rows, 1)).toHaveLength(4);
    expect(onCourt(rows, 2)).toHaveLength(4);
    expect(onCourt(rows, 3)).toHaveLength(0);
    const idled = idle(rows);
    expect(idled.map((r) => r.name).sort()).toEqual([
      "C3-0",
      "C3-1",
      "C3-2",
      "C3-3",
    ]);
    expect(idled.every((r) => r.court_no === null && r.court_slot === null)).toBe(
      true,
    );
    expect((await getSession(svc, sessionId)).courts).toBe(2);
  });

  it("only updates the count when increasing courts", async () => {
    sessionId = await createTestSession(svc, 2);
    await seedPlayers(svc, sessionId, [...playingSeed(1), ...playingSeed(2)]);

    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 4,
    });
    expect(error).toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(onCourt(rows, 1)).toHaveLength(4);
    expect(onCourt(rows, 2)).toHaveLength(4);
    expect(idle(rows)).toHaveLength(0);
    expect((await getSession(svc, sessionId)).courts).toBe(4);
  });

  it("rolls back the idling when the new court count is invalid (atomicity)", async () => {
    sessionId = await createTestSession(svc, 3);
    await seedPlayers(svc, sessionId, playingSeed(3));

    // p_courts = 0 would idle every playing player (court_no > 0) BEFORE the
    // sessions update trips the `courts BETWEEN 1 AND 6` check — so if the two
    // writes weren't atomic, court 3 would be left wrongly idled.
    const { error } = await anon.rpc("set_courts", {
      p_session_id: sessionId,
      p_courts: 0,
    });
    expect(error).not.toBeNull();

    const rows = await getPlayers(svc, sessionId);
    expect(onCourt(rows, 3)).toHaveLength(4);
    expect(idle(rows)).toHaveLength(0);
    expect((await getSession(svc, sessionId)).courts).toBe(3);
  });
});
