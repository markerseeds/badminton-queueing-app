"use client";

import { useEffect, useRef, useState } from "react";
import * as auth from "../lib/auth";
import {
  decideReturnAction,
  parseOAuthError,
  safeNext,
} from "../lib/authReturn";
import { clearClaim, mintNonce, readClaim, writeClaim } from "../lib/claimTicket";
import { createClaimTicket, redeemClaimTicket } from "../lib/sessionStore";

export type ReturnState =
  | { status: "working" }
  // Nothing to say — the caller forwards on without showing anything.
  | { status: "done"; next: string }
  | { status: "moved"; count: number; next: string }
  // Terminal but recoverable: the rooms wouldn't fit. The ticket is still good,
  // so "My rooms" can finish the job after they delete one.
  | { status: "overCap"; message: string }
  | { status: "failed"; message: string };

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// Everything that happens when the OAuth provider redirects back. Runs once.
export function useAuthReturn(): ReturnState {
  const [state, setState] = useState<ReturnState>({ status: "working" });

  // Set synchronously before the first await, so React's development
  // double-effect cannot run the body twice. (The RPC is idempotent anyway — a
  // replayed ticket returns 0 rather than raising — but a second run would also
  // mint a second nonce and write a second row for nothing.)
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const href = window.location.href;
      const stash = readClaim();
      const next = safeNext(stash.next);

      try {
        // Must come before reading the URL: `getUser()` awaits auth-js's
        // `initializePromise`, which is what parses the fragment and clears it
        // on success. Reading first could see a hash that is about to be a
        // valid session.
        const user = await auth.getUser();
        const error = parseOAuthError(window.location.href || href);

        switch (
          decideReturnAction({ user, error, nonce: stash.nonce ?? null })
        ) {
          case "claim-then-retry": {
            // Linking was refused because the Google account already exists as
            // its own user. Sign in to it plainly instead — but write the
            // ticket first, because that call discards this identity.
            const nonce = mintNonce();
            await createClaimTicket(nonce, user!.id);
            if (!writeClaim({ nonce })) {
              throw new Error(
                "This browser won't let the app save anything, so signing in " +
                  "would lose your rooms. Check your privacy settings.",
              );
            }
            await auth.signInWithGoogle();
            // Navigating away; stay on "working" so nothing flashes.
            return;
          }

          case "redeem": {
            try {
              const count = await redeemClaimTicket(stash.nonce!);
              clearClaim();
              setState({ status: "moved", count, next });
            } catch (e) {
              if ((e as { code?: string })?.code === "23514") {
                // Deliberately does NOT clear the stash: this refusal leaves
                // the ticket redeemable, and "My rooms" is where they make
                // space and finish.
                setState({
                  status: "overCap",
                  message: messageOf(e, "Your account is full."),
                });
                return;
              }
              // Expired or already gone — nothing left to recover, so stop
              // offering it.
              clearClaim();
              setState({
                status: "failed",
                message: messageOf(e, "Could not move your rooms."),
              });
            }
            return;
          }

          case "failed":
            setState({
              status: "failed",
              message:
                error?.description ||
                "Google sign-in didn't complete. Please try again.",
            });
            return;

          default:
            setState({ status: "done", next });
        }
      } catch (e) {
        setState({
          status: "failed",
          message: messageOf(e, "Could not finish signing in."),
        });
      }
    })();
  }, []);

  return state;
}
