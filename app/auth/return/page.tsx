"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CheckIcon, WarningIcon } from "../../components/icons";
import { useAuthReturn } from "../../hooks/useAuthReturn";

// Where every Google sign-in lands. A renderer over `useAuthReturn`, the way
// RoomClient is over useSession — all the decisions live in the hook.
//
// No AccountBar: it mounts its own `useAuth`, and an auth strip re-rendering
// mid-redemption is noise on a screen that exists for about a second.
export default function AuthReturnPage() {
  const state = useAuthReturn();
  const router = useRouter();

  // Nothing happened worth reporting, or nothing moved — just carry on to
  // wherever they were. `replace`, not `push`, so Back doesn't re-run this.
  const passthrough =
    state.status === "done" ||
    (state.status === "moved" && state.count === 0);
  const next = state.status === "done" || state.status === "moved" ? state.next : null;

  useEffect(() => {
    if (passthrough && next) router.replace(next);
  }, [passthrough, next, router]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 p-6">
      {(state.status === "working" || passthrough) && (
        <div role="status" className="flex flex-col gap-3">
          <p className="muted">Finishing sign-in…</p>
          <div className="skel h-4 w-48" />
          <div className="skel h-4 w-32" />
        </div>
      )}

      {state.status === "moved" && state.count > 0 && (
        <div className="flex flex-col items-start gap-4">
          <span className="flex items-center gap-2 text-accent">
            <CheckIcon size={20} />
            <span className="lbl text-accent">Signed in</span>
          </span>
          <h1 className="heading text-xl">
            {state.count} room{state.count === 1 ? "" : "s"} moved to your
            account
          </h1>
          <p className="muted">
            {state.count === 1 ? "It's" : "They're"} yours on any device now,
            not just this browser.
          </p>
          <Link href={state.next} className="btn btn-primary">
            Continue
          </Link>
        </div>
      )}

      {/* Terminal and explicit, deliberately — not a redirect. They are signed
          in to an account that can't hold these rooms yet, and the only way
          through is to make space. Saying so and stopping beats dropping them
          somewhere and hoping they find the banner. */}
      {state.status === "overCap" && (
        <div className="flex flex-col items-start gap-4">
          <div role="alert" className="banner banner-warn">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Your rooms are waiting</p>
              <p className="mt-1 text-[0.8125rem] opacity-90">{state.message}</p>
            </div>
          </div>
          <p className="muted">
            You&rsquo;re signed in. Delete a room you no longer need and move
            them across from there — nothing has been lost.
          </p>
          <Link href="/rooms" className="btn btn-primary">
            Go to My rooms
          </Link>
        </div>
      )}

      {state.status === "failed" && (
        <div className="flex flex-col items-start gap-4">
          <div role="alert" className="banner banner-danger">
            <WarningIcon size={18} className="mt-0.5 shrink-0" />
            <span>{state.message}</span>
          </div>
          <p className="muted">
            Your rooms are still here — nothing was lost. You can keep using
            them in this browser and try again later.
          </p>
          <Link href="/rooms" className="btn btn-ghost">
            Go to My rooms
          </Link>
        </div>
      )}
    </div>
  );
}
