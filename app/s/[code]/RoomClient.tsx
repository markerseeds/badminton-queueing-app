"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddPlayerModal } from "../../components/AddPlayerModal";
import { BatchAddModal } from "../../components/BatchAddModal";
import { ConfirmationModal } from "../../components/ConfirmationModal";
import { CourtBoard } from "../../components/CourtBoard";
import { EditPlayerModal } from "../../components/EditPlayerModal";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  LockIcon,
  PencilIcon,
  UnlockIcon,
  WarningIcon,
} from "../../components/icons";
import { PlayerList } from "../../components/PlayerList";
import { QueuePanel } from "../../components/QueuePanel";
import { RenameRoomModal } from "../../components/RenameRoomModal";
import { Button, IconButton } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { useSession } from "../../hooks/useSession";
import { cn } from "../../lib/cn";
import { getAvailablePlayers } from "../../lib/logic";
import type { Player } from "../../lib/types";

type PendingConfirm = {
  message: string;
  confirmLabel: string;
  action: () => void;
};

export function RoomClient({ code }: { code: string }) {
  const { state, status, error, dismissError, actions } = useSession(code);
  const { user } = useAuth();

  const [showModal, setShowModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [copied, setCopied] = useState(false);

  // Above the early returns below, or it's a rules-of-hooks violation.
  //
  // Set in an effect rather than through `generateMetadata` in page.tsx: that
  // would need a server-side Supabase read, and `lib/supabase.ts` is the browser
  // client — adding a server client to title a tab would breach the one-module
  // containment rule for something cosmetic. It would also go stale on rename.
  //
  // No cleanup restoring a previous title: the effect re-runs on rename, so a
  // captured "previous" would be the *room's* own title from the second run
  // onward and unmounting would pin it. The App Router emits the destination
  // route's title on navigation, so there is nothing to undo.
  useEffect(() => {
    if (!state) return;
    // Falls back to the code so two unnamed rooms stay distinguishable — the
    // tab strip is a wayfinding surface, which is the point of doing this.
    document.title = state.name
      ? `${state.name} · Badminton Queue`
      : `Room ${state.shareCode} · Badminton Queue`;
  }, [state]);

  if (status === "loading") {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-5xl flex-col gap-4 p-4"
      >
        <p className="muted">Loading room…</p>
        {/* Shaped like what it replaces — the share strip, then the court
            board. Bars on `.card`, so the placeholder sits on the real surface
            instead of the recessed one it used to vanish into. The strip now
            stacks three bars: the room name (text-lg), the "Room code" label,
            and the code itself. An approximation by construction — `.share`
            wraps, so the real header is taller again once the button cluster
            drops to its own line on a phone. */}
        <div aria-hidden="true" className="flex flex-col gap-4">
          <div className="card flex h-28 items-center gap-3 p-4">
            <div className="flex flex-1 flex-col gap-2">
              <div className="skel h-5 w-40" />
              <div className="skel h-3 w-16" />
              <div className="skel h-5 w-28" />
            </div>
            <div className="skel size-11 shrink-0 rounded-(--bq-radius-sm)" />
          </div>
          <div className="card flex h-52 flex-col gap-3 p-4">
            <div className="skel h-3 w-16" />
            <div className="skel h-4 w-40" />
            <div className="skel h-4 w-36" />
          </div>
        </div>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-start gap-3 p-6">
        <h1 className="heading text-xl">Room not found</h1>
        <p className="muted">
          No room exists for code <span className="font-mono">{code}</span>.
          Double-check it with whoever shared it.
        </p>
        <Link href="/" className="text-sm font-medium text-accent underline">
          Back to start
        </Link>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-start gap-3 p-6">
        <div role="alert" className="banner banner-danger">
          <WarningIcon size={18} className="mt-0.5 shrink-0" />
          <span>{error ?? "Could not load this room."}</span>
        </div>
        <Link href="/" className="text-sm font-medium text-accent underline">
          Back to start
        </Link>
      </div>
    );
  }

  const confirmDeletePlayer = (player: Player) =>
    setPendingConfirm({
      message: `${player.name} and their games-played count will be removed from this room. You can't undo this.`,
      confirmLabel: `Remove ${player.name}`,
      action: () => actions.deletePlayer(player),
    });

  const confirmEndGame = (courtNumber: number) =>
    setPendingConfirm({
      message: `The four players on Court ${courtNumber} go back to the players list and their games count goes up by one.`,
      confirmLabel: `End Court ${courtNumber}`,
      action: () => actions.endGame(courtNumber),
    });

  const confirmDeleteAll = () =>
    setPendingConfirm({
      message: `All ${state.players.length} players, every game in progress and the whole queue will be removed, along with their games-played counts. You can't undo this.`,
      confirmLabel: `Remove all ${state.players.length}`,
      action: () => actions.deleteAll(),
    });

  const handleConfirm = () => {
    pendingConfirm?.action();
    setPendingConfirm(null);
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
  const firstFreeCourt = state.games.find((g) => g.players.length === 0);
  const startDisabled = state.queue.length < 4 || firstFreeCourt === undefined;

  // Mirrors the server-side predicate in `session_is_editable()`. The
  // `ownerId !== null` arm matters: an ownerless room (created before accounts,
  // or whose owner deleted their account) stays open to everyone, so a stale
  // lock can't strand a club mid-night.
  const isOwner = state.ownerId !== null && state.ownerId === user?.id;
  const readOnly = state.locked && state.ownerId !== null && !isOwner;

  // The plan gates mirror their SQL counterparts the same way `readOnly` mirrors
  // session_is_editable(). Note these follow the room's OWNER, not whoever is
  // looking — a stranger holding the code is judged by the owner's plan, because
  // that is what the policies will judge their writes by. Counted against the
  // whole roster: queued and on-court players still occupy a slot.
  const playersRemaining = Math.max(
    0,
    state.limits.maxPlayers - state.players.length,
  );

  const nextFour = state.queue.slice(0, 4);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
      {/* SHARE HEADER — the name is the room's identity, the code is how
          anyone else gets in. The name goes first, and gives the page its first
          real <h1>; it had none before. */}
      <header className="share">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h1
              className={cn(
                "heading truncate text-lg",
                !state.name && "font-normal text-ink-3",
              )}
            >
              {state.name ?? "Untitled room"}
            </h1>
            {/* Gated on readOnly, NOT isOwner: renaming is an edit, and every
                edit here is open to whoever holds the code. Keeps the full 44px
                target and absorbs the bulk with -my-2 — margins don't clip the
                hit area. The size-8 shrink on the error banner's dismiss below
                is not a precedent for this; that's a dismiss, this is the
                affordance that makes the whole feature discoverable. */}
            {!readOnly && (
              <IconButton
                aria-label={state.name ? `Rename ${state.name}` : "Name this room"}
                className="-my-2 shrink-0 border-0 bg-transparent"
                onClick={() => setRenaming(true)}
              >
                <PencilIcon size={16} />
              </IconButton>
            )}
          </div>
          <div className="lbl mt-1">Room code</div>
          <div className="code num">{state.shareCode}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={copyLink}>
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            {copied ? "Link copied" : "Copy link"}
          </Button>
          {isOwner && (
            <Button
              variant="quiet"
              size="sm"
              aria-pressed={state.locked}
              onClick={() => actions.setLocked(!state.locked)}
            >
              {state.locked ? <LockIcon size={15} /> : <UnlockIcon size={15} />}
              {state.locked ? "Locked to you" : "Lock to just me"}
            </Button>
          )}
        </div>
      </header>

      {readOnly && (
        <div className="banner banner-warn">
          <LockIcon size={18} className="mt-0.5 shrink-0" />
          <span>View only — the organizer has locked this room.</span>
        </div>
      )}

      {error && (
        <div role="alert" className="banner banner-danger">
          <WarningIcon size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <IconButton
            aria-label="Dismiss error"
            className="-my-1 size-8 border-0 bg-transparent"
            onClick={dismissError}
          >
            <CloseIcon size={16} />
          </IconButton>
        </div>
      )}

      <CourtBoard
        games={state.games}
        courts={state.courts}
        maxCourts={state.limits.maxCourts}
        readOnly={readOnly}
        onChangeCourts={actions.changeCourts}
        onEndGame={(courtNumber) => confirmEndGame(courtNumber)}
        onSendNextFour={actions.startGame}
        canSendNextFour={!startDisabled}
      />

      <div className="room-body">
        <QueuePanel
          queue={state.queue}
          startDisabled={startDisabled}
          nextCourt={firstFreeCourt?.court ?? null}
          readOnly={readOnly}
          onStartGame={actions.startGame}
          onShuffleTop={actions.shuffleTop}
          onRemoveFromQueue={actions.removeFromQueue}
        />
        <PlayerList
          availablePlayers={availablePlayers}
          playersRemaining={playersRemaining}
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

      {/* The most-tapped control of the night, in the thumb zone. Phone only —
          QueuePanel carries its own Start Game from tablet up. */}
      {!readOnly && !startDisabled && (
        <div className="actionbar">
          <div className="min-w-0 flex-1">
            <div className="lbl">Court {firstFreeCourt?.court} is free</div>
            <div className="truncate text-sm font-semibold">
              {nextFour.map((p) => p.name).join(", ")}
            </div>
          </div>
          <Button size="lg" onClick={actions.startGame}>
            Start game
          </Button>
        </div>
      )}

      {showModal && (
        <AddPlayerModal
          onSubmit={(np) => {
            actions.addPlayer(np);
            setShowModal(false);
          }}
          onCancel={() => setShowModal(false)}
        />
      )}

      {renaming && (
        <RenameRoomModal
          name={state.name}
          shareCode={state.shareCode}
          onSubmit={(raw) => {
            actions.renameRoom(raw);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
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

      {pendingConfirm && (
        <ConfirmationModal
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={handleConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {showBatchModal && (
        <BatchAddModal
          remaining={playersRemaining}
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
