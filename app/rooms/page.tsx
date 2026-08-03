"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountBar } from "../components/AccountBar";
import { ConfirmationModal } from "../components/ConfirmationModal";
import { Button, Card } from "../components/ui";
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
    <div className="min-h-screen flex flex-col items-center p-6 gap-6">
      <AccountBar />

      <Card className="p-8 w-full max-w-md space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">My rooms</h1>
          <p className="text-sm text-gray-600">
            Rooms you&rsquo;ve created on this device.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-red-700 text-sm">
            <span aria-hidden="true">⚠️</span> {error}
          </p>
        )}

        {/* An anonymous owner's rooms live only in this browser — say so plainly
            rather than presenting a generic "you're logged out" state. */}
        {user && !isSignedIn && (
          <p className="text-sm bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded-lg">
            These rooms are saved to this browser only. Sign in with Google to
            keep them if you clear your data or switch devices.
          </p>
        )}

        {authLoading || rooms === null ? (
          <p className="text-gray-600 text-sm">Loading…</p>
        ) : rooms.length === 0 ? (
          <div className="space-y-3">
            <p className="text-gray-600 text-sm">
              You haven&rsquo;t created any rooms yet.
            </p>
            <Link href="/" className="text-blue-700 hover:underline text-sm">
              Create your first room
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/s/${room.shareCode}`}
                    className="font-mono font-semibold text-blue-700 hover:underline"
                  >
                    {room.shareCode}
                  </Link>
                  <p className="text-xs text-gray-600">
                    {room.courts} court{room.courts === 1 ? "" : "s"} ·{" "}
                    {formatDate(room.createdAt)}
                    {room.locked && (
                      <>
                        {" · "}
                        <span className="text-gray-800">
                          <span aria-hidden="true">🔒</span> Locked
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <Button
                  className="bg-red-700 text-xs"
                  aria-label={`Delete room ${room.shareCode}`}
                  onClick={() => setPendingDelete(room)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Link href="/" className="block text-sm text-blue-700 hover:underline">
          ← Back to start
        </Link>
      </Card>

      {pendingDelete && (
        <ConfirmationModal
          message={`Delete room ${pendingDelete.shareCode}? Every player and court in it will be removed. This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
