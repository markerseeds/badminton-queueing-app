"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { cn } from "../lib/cn";

// The one upgrade affordance, so a plan gate reads the same wherever it's hit:
// what the ceiling is, and the single place to lift it.
//
// Deliberately not a `.banner` — hitting a plan limit is a fact about the room,
// not something going wrong, and the warn/danger banners are already spoken for
// by the room lock and by real errors. All of its styling is utilities on top of
// the existing `.tiny`, so it needs nothing in globals.css.
//
// Phase 3b: an *anonymous* organizer gets a sign-in prompt here instead of the
// Upgrade link. Pro can never be held by an anonymous account — that is now
// enforced in Postgres, not merely intended — so pointing her at /pricing is a
// link into a wall. Putting the branch in this one component is also how the
// room's gates gained the affordance at all: CourtBoard, PlayerList,
// BatchAddModal and "My rooms" all funnel through here, so no props are threaded
// through three components and the four call sites cannot drift apart.
//
// Worded as keeping her rooms rather than as upgrading, because Pro is not on
// sale until Phase 3c — and keeping them is a real thing signing in does today.
//
// Cost accepted: each rendered note mounts its own `useAuth` and so resolves its
// own `getUser()`. A note only renders when a gate is actually showing, so it is
// at most two on a screen; a shared auth context is the fix if it ever shows.
export function LimitNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { user, isSignedIn, signInWithGoogle } = useAuth();
  const anonymous = Boolean(user) && !isSignedIn;

  return (
    <p className={cn("tiny flex flex-wrap items-center gap-x-1.5", className)}>
      <span>
        {children}
        {anonymous && " Pro needs an account."}
      </span>
      {anonymous ? (
        <button
          type="button"
          onClick={() => signInWithGoogle()}
          className="font-semibold text-accent hover:underline"
        >
          Sign in with Google
        </button>
      ) : (
        <Link
          href="/pricing"
          className="font-semibold text-accent hover:underline"
        >
          Upgrade
        </Link>
      )}
    </p>
  );
}
