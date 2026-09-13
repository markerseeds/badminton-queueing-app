"use client";

import { useEffect, useState } from "react";
import * as auth from "../lib/auth";
import type { AuthUser } from "../lib/auth";
import { mintNonce, writeClaim } from "../lib/claimTicket";
import { createClaimTicket } from "../lib/sessionStore";

// Current account state. Deliberately read-only about *creating* a user: a room
// creator is signed in anonymously by `createSession`, not by this hook, so
// merely opening a shared link never creates an account.
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    auth
      .getUser()
      .then((u) => {
        if (active) setUser(u);
      })
      .catch(() => {
        // A missing/expired session is not an error worth showing — it just
        // means signed out.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = auth.onAuthChange((u) => {
      if (active) setUser(u);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // The identity chain starts here. This hook is the only layer allowed to
  // orchestrate it, because it needs both containment modules and `auth.ts`
  // cannot import `sessionStore.ts` — sessionStore already imports `ensureUser`
  // from it, so the dependency would be a cycle.
  //
  // `next` is where to land afterwards, defaulting to wherever the user is
  // standing: hitting a plan gate courtside and being dumped on "My rooms" is
  // the behaviour this replaces.
  const signInWithGoogle = async (next?: string) => {
    setError(null);
    try {
      writeClaim({
        next: next ?? `${window.location.pathname}${window.location.search}`,
      });

      const current = await auth.getUser();
      if (current?.isAnonymous) {
        // Best case: the same auth.users row gains a Google identity, the user
        // id never changes, and the rooms need no moving at all.
        if (await auth.linkGoogleIdentity()) return;

        // Linking refused outright, so the next call replaces this identity
        // with a different one. Everything needed to get the rooms back has to
        // be written first — and if either write fails we must NOT sign in,
        // because that would discard the identity with no way to reclaim it.
        const nonce = mintNonce();
        await createClaimTicket(nonce, current.id);
        if (!writeClaim({ nonce })) {
          throw new Error(
            "This browser won't let the app save anything, so signing in " +
              "would lose your rooms. Check your privacy settings and retry.",
          );
        }
      }

      await auth.signInWithGoogle();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not sign in. Please try again.",
      );
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      await auth.signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out.");
    }
  };

  return {
    user,
    // An anonymous user owns rooms but can't get them back on another device,
    // so the UI still treats them as "not signed in" when prompting.
    isSignedIn: Boolean(user) && !user?.isAnonymous,
    loading,
    error,
    dismissError: () => setError(null),
    signInWithGoogle,
    signOut,
  };
}
