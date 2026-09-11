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
            <span>{error}</span>
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

        {authLoading || rooms === null ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-(--bq-radius-sm) bg-surface-2" />
            <div className="h-16 animate-pulse rounded-(--bq-radius-sm) bg-surface-2" />
            <span className="sr-only">Loading your rooms…</span>
          </div>
        ) : rooms.length === 0 ? (
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
