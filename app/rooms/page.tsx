"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountBar } from "../components/AccountBar";
import { ConfirmationModal } from "../components/ConfirmationModal";
import { LockIcon, MoreIcon, TrashIcon, WarningIcon } from "../components/icons";
import { IconButton } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { deleteRoom, listMyRooms } from "../lib/sessionStore";
import type { RoomSummary } from "../lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Stands in for the room list, and reuses `.roomrow` itself — so the
// placeholder can't drift from the real row's surface, border or 4rem height,
// and nothing below it shifts when the rows arrive. The bars are sized to the
// content they're waiting on: an 8-char share code at 1rem mono/0.08em is
// ~88px, the "3 courts · 11 Sep 2026" line ~120px, and the trailing square is
// the 44px IconButton.
function RoomsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="muted">Loading your rooms…</p>
      <ul aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <li key={i} className="roomrow">
            <div className="min-w-0 flex-1">
              <div className="skel h-4 w-22" />
              <div className="skel mt-2 h-3 w-30" />
            </div>
            <div className="skel size-11 shrink-0 rounded-(--bq-radius-sm)" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MyRoomsPage() {
  const { user, isSignedIn, loading: authLoading } = useAuth();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoomSummary | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // Latest loader, so deleting a room can refresh the list without re-running
  // the effect — the same shape `useSession` uses for its post-write reload.
  const reloadRef = useRef<() => Promise<void>>(async () => {});

  // `listMyRooms` already resolves to [] when signed out, so there's no need to
  // branch on `user` here — re-running on identity change is enough.
  useEffect(() => {
    if (authLoading) return;
    let active = true;

    const load = async () => {
      try {
        const data = await listMyRooms();
        if (!active) return;
        setRooms(data);
        setError(null);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Could not load your rooms.");
      }
    };
    reloadRef.current = load;

    (async () => {
      await load();
    })();

    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const room = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteRoom(room.id);
      await reloadRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that room.");
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-5 p-4 md:p-6">
      <AccountBar />

      <main className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="heading text-2xl">My rooms</h1>
            <p className="muted mt-1">Rooms you&rsquo;ve created.</p>
          </div>
          <Link href="/" className="btn btn-primary btn-sm">
            New room
          </Link>
        </div>

        {error && (
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            {/* Without this the error is a dead end — the only way back was a
                page reload. Clearing the error first is what lets the skeleton
                return while the retry is in flight. */}
            <button
              type="button"
              className="shrink-0 font-semibold underline"
              onClick={() => {
                setError(null);
                setRooms(null);
                void reloadRef.current();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* An anonymous owner's rooms live only in this browser — say so plainly
            rather than presenting a generic "you're logged out" state. */}
        {user && !isSignedIn && (
          <div className="banner banner-warn flex-col items-stretch sm:flex-row sm:items-start">
            <div className="flex items-start gap-2.5">
              <WarningIcon size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  These rooms live in this browser only
                </p>
                <p className="mt-1 text-[0.8125rem] opacity-90">
                  Clear your site data or switch phones and they&rsquo;re gone.
                  Sign in with Google to keep them.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* `rooms === null` means "still loading", so it has to be paired with
            "and nothing has failed" — a failed load leaves it null forever, and
            the skeleton would sit under the error banner indefinitely. */}
        {authLoading || (rooms === null && error === null) ? (
          <RoomsSkeleton />
        ) : rooms === null ? null /* the banner above already says what went wrong */ : rooms.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="muted">You haven&rsquo;t created any rooms yet.</p>
            <Link href="/" className="btn btn-ghost btn-sm">
              Create your first room
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.id} className="roomrow">
                <div className="min-w-0 flex-1">
                  <Link href={`/s/${room.shareCode}`} className="rc num">
                    {room.shareCode}
                  </Link>
                  <p className="tiny num mt-0.5">
                    {room.courts} court{room.courts === 1 ? "" : "s"} ·{" "}
                    {formatDate(room.createdAt)}
                  </p>
                </div>

                {room.locked && (
                  <span className="pill pill-warn">
                    <LockIcon size={11} />
                    Locked
                  </span>
                )}

                <div className="relative">
                  <IconButton
                    aria-label={`Actions for room ${room.shareCode}`}
                    aria-haspopup="true"
                    aria-expanded={openMenu === room.id}
                    onClick={() =>
                      setOpenMenu(openMenu === room.id ? null : room.id)
                    }
                  >
                    <MoreIcon />
                  </IconButton>

                  {openMenu === room.id && (
                    <>
                      <div
                        aria-hidden="true"
                        className="fixed inset-0 z-10"
                        onClick={() => setOpenMenu(null)}
                      />
                      <div className="card absolute right-0 z-20 mt-2 flex w-48 flex-col overflow-hidden py-1 shadow-lg">
                        <button
                          type="button"
                          className="flex min-h-11 items-center gap-2.5 px-3.5 text-left text-sm text-danger hover:bg-danger-soft"
                          onClick={() => {
                            setPendingDelete(room);
                            setOpenMenu(null);
                          }}
                        >
                          <TrashIcon size={16} />
                          Delete room
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/"
          className="text-sm font-medium text-accent hover:underline"
        >
          ← Back to start
        </Link>
      </main>

      {pendingDelete && (
        <ConfirmationModal
          message={`Room ${pendingDelete.shareCode} and every player and court in it will be removed. Anyone holding the link will find nothing there. You can't undo this.`}
          confirmLabel={`Delete ${pendingDelete.shareCode}`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
