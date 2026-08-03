"use client";

import { useEffect, useState } from "react";
import * as auth from "../lib/auth";
import type { AuthUser } from "../lib/auth";

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

  const signInWithGoogle = async (redirectTo?: string) => {
    setError(null);
    try {
      await auth.signInWithGoogle(redirectTo);
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
