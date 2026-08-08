"use client";

import Link from "next/link";
import { useState } from "react";
import { AddPlayerModal } from "../../components/AddPlayerModal";
import { BatchAddModal } from "../../components/BatchAddModal";
import { ConfirmationModal } from "../../components/ConfirmationModal";
import { CourtBoard } from "../../components/CourtBoard";
import { EditPlayerModal } from "../../components/EditPlayerModal";
import { PlayerList } from "../../components/PlayerList";
import { QueuePanel } from "../../components/QueuePanel";
import { useAuth } from "../../hooks/useAuth";
import { useSession } from "../../hooks/useSession";
import { getAvailablePlayers } from "../../lib/logic";
import type { Player } from "../../lib/types";

export function RoomClient({ code }: { code: string }) {
  const { state, status, error, dismissError, actions } = useSession(code);
  const { user } = useAuth();

  const [showModal, setShowModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [copied, setCopied] = useState(false);

  if (status === "loading") {
    return <div className="p-6">Loading session…</div>;
  }

  if (status === "not_found") {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-xl font-semibold">Room not found</h1>
        <p className="text-gray-600">
          No room exists for code{" "}
          <span className="font-mono">{code}</span>.
        </p>
        <Link href="/" className="text-blue-600 underline">
          Back to start
        </Link>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-red-600">{error ?? "Could not load this room."}</p>
        <Link href="/" className="text-blue-600 underline">
          Back to start
        </Link>
      </div>
    );
  }

  const requestConfirm = (message: string, action: () => void) => {
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setShowConfirmModal(true);
  };

  const confirmDeletePlayer = (player: Player) =>
    requestConfirm(
      `Are you sure you want to delete player: ${player.name}? This cannot be undone.`,
      () => actions.deletePlayer(player),
    );

  const confirmEndGame = (courtNumber: number) =>
    requestConfirm(
      `Are you sure you want to end the game on Court ${courtNumber}? The players will return to the available list.`,
      () => actions.endGame(courtNumber),
    );

  const confirmDeleteAll = () =>
    requestConfirm(
      "DANGER: Are you sure you want to delete ALL players and clear all courts? This action cannot be undone.",
      () => actions.deleteAll(),
    );

  const handleConfirm = () => {
    confirmAction?.();
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const handleCancel = () => {
    setShowConfirmModal(false);
    setConfirmAction(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (e.g. non-secure context); ignore.
    }
  };

  const availablePlayers = getAvailablePlayers(state);
  const startDisabled =
    state.queue.length < 4 || state.games.every((g) => g.players.length > 0);

  // Mirrors the server-side predicate in `session_is_editable()`. The
  // `ownerId !== null` arm matters: an ownerless room (created before accounts,
  // or whose owner deleted their account) stays open to everyone, so a stale
  // lock can't strand a club mid-night.
  const isOwner = state.ownerId !== null && state.ownerId === user?.id;
  const readOnly = state.locked && state.ownerId !== null && !isOwner;

  return (
    <div className="p-6 space-y-6">
      {/* ROOM HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-600">
          Room code:{" "}
          <span className="font-mono font-semibold text-gray-900">
            {state.shareCode}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button
              type="button"
              aria-pressed={state.locked}
              onClick={() => actions.setLocked(!state.locked)}
              className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition-colors"
            >
              <span aria-hidden="true">{state.locked ? "🔒" : "🔓"}</span>{" "}
              {state.locked ? "Locked — only you can edit" : "Lock to just me"}
            </button>
          )}
          <button
            type="button"
            onClick={copyLink}
            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition-colors"
          >
            {copied ? "Link copied!" : "Copy invite link"}
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 rounded-lg">
          <span aria-hidden="true">🔒</span> View only — the organizer has locked
          this room.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg"
        >
          <span>
            <span aria-hidden="true">⚠️</span> {error}
          </span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={dismissError}
            className="font-bold px-2"
          >
            ×
          </button>
        </div>
      )}

      <CourtBoard
        games={state.games}
        courts={state.courts}
        readOnly={readOnly}
        onChangeCourts={actions.changeCourts}
        onEndGame={(courtNumber) => confirmEndGame(courtNumber)}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QueuePanel
          queue={state.queue}
          startDisabled={startDisabled}
          readOnly={readOnly}
          onStartGame={actions.startGame}
          onShuffleTop={actions.shuffleTop}
          onRemoveFromQueue={actions.removeFromQueue}
        />
        <PlayerList
          availablePlayers={availablePlayers}
          readOnly={readOnly}
          onAdd={() => setShowModal(true)}
          onAutoPick={actions.autoPick}
          onBatchAdd={() => setShowBatchModal(true)}
          onDeleteAll={confirmDeleteAll}
          onQueue={actions.addToQueue}
          onDeletePlayer={confirmDeletePlayer}
          onEditPlayer={setEditingPlayer}
          onUpdateGamesPlayed={actions.setGamesPlayed}
        />
      </div>

      {showModal && (
        <AddPlayerModal
          onSubmit={(np) => {
            actions.addPlayer(np);
            setShowModal(false);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}

      {editingPlayer && (
        <EditPlayerModal
          player={editingPlayer}
          onSubmit={(details) => {
            actions.updatePlayer(editingPlayer.id, details);
            setEditingPlayer(null);
          }}
          onCancel={() => setEditingPlayer(null)}
        />
      )}

      {showConfirmModal && (
        <ConfirmationModal
          message={confirmMessage}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {showBatchModal && (
        <BatchAddModal
          onSubmit={(nps) => {
            actions.batchAdd(nps);
            setShowBatchModal(false);
          }}
          onCancel={() => setShowBatchModal(false)}
        />
      )}
    </div>
  );
}
