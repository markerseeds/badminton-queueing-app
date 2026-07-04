"use client";

import { useEffect, useRef, useState } from "react";
import { getAvailablePlayers, pickFourPlayers } from "../lib/logic";
import * as store from "../lib/sessionStore";
import type { LoadedSession, NewPlayer, Player } from "../lib/types";

type SessionStatus = "loading" | "ready" | "not_found" | "error";

function messageFrom(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}

export function useSession(code: string) {
  const [state, setState] = useState<LoadedSession | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Latest loader, so a mutation can refresh immediately without waiting on realtime.
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    const load = async () => {
      try {
        const loaded = await store.getSessionByCode(code);
        if (!active) return;
        if (!loaded) {
          setStatus("not_found");
          return;
        }
        sessionIdRef.current = loaded.id;
        setState(loaded);
        setStatus("ready");
      } catch (e) {
        if (!active) return;
        setError(messageFrom(e));
        setStatus((prev) => (prev === "ready" ? prev : "error"));
      }
    };
    reloadRef.current = load;

    (async () => {
      await load();
      if (active && sessionIdRef.current) {
        unsubscribe = store.subscribeToSession(sessionIdRef.current, load);
      }
    })();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [code]);

  // Runs a mutation, surfacing any failure as a dismissible error. Realtime
  // then pushes the change back and refreshes state — no optimistic update.
  const act = async (fn: (s: LoadedSession) => Promise<void>) => {
    if (!state) return;
    try {
      await fn(state);
      // Refresh right away so the acting device updates instantly, even if the
      // realtime event is delayed or the connection dropped. Realtime still
      // propagates the change to other devices.
      await reloadRef.current();
    } catch (e) {
      setError(messageFrom(e));
    }
  };

  const actions = {
    addPlayer: (player: NewPlayer) => act((s) => store.addPlayer(s.id, player)),
    batchAdd: (players: NewPlayer[]) =>
      act((s) => store.addPlayers(s.id, players)),
    deletePlayer: (player: Player) => act(() => store.deletePlayer(player.id)),
    deleteAll: () => act((s) => store.deleteAllPlayers(s.id)),
    setGamesPlayed: (playerId: string, value: number) =>
      act(() => store.setGamesPlayed(playerId, isNaN(value) ? 0 : value)),

    addToQueue: (player: Player) =>
      act(async (s) => {
        if (s.queue.some((p) => p.id === player.id)) return;
        await store.enqueue(s.id, [player.id]);
      }),
    autoPick: () =>
      act(async (s) => {
        const picked = pickFourPlayers(getAvailablePlayers(s));
        if (picked.length === 0) return;
        await store.enqueue(
          s.id,
          picked.map((p) => p.id),
        );
      }),
    removeFromQueue: (player: Player) =>
      act(() => store.removeFromQueue(player.id)),
    shuffleTop: () => act((s) => store.shuffleQueueFront(s.id)),

    startGame: () =>
      act(async (s) => {
        const emptyCourt = s.games.find((g) => g.players.length === 0);
        if (!emptyCourt || s.queue.length < 4) return;
        const four = s.queue.slice(0, 4);
        await store.startGame(
          emptyCourt.court,
          four.map((p) => ({ id: p.id, gamesPlayed: p.gamesPlayed + 1 })),
        );
      }),
    endGame: (courtNo: number) => act((s) => store.endGame(s.id, courtNo)),
    changeCourts: (newCourts: number) =>
      act(async (s) => {
        if (newCourts === s.courts) return;
        await store.setCourts(s.id, newCourts);
      }),
  };

  return {
    state,
    status,
    error,
    dismissError: () => setError(null),
    actions,
  };
}
