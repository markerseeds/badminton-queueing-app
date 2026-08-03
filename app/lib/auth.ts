// The single auth-access module. Everything that touches Supabase Auth goes
// through here, so the rest of the app never calls `supabase.auth` directly —
// the same containment `sessionStore.ts` gives the database.
//
// The model: creating a room signs the organizer in ANONYMOUSLY, so the room has
// an owner from the first tap with no sign-in wall. Linking Google later keeps
// the same user id, so their rooms come with them. Nothing else in the app calls
// `ensureUser` — someone who merely opens a shared link stays unauthenticated,
// which keeps monthly-active-user counts to organizers only.

import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AuthUser = {
  id: string;
  email: string | null;
  // Anonymous users are real `auth.users` rows with no identity attached. They
  // own rooms just like anyone else, but can't be recovered on another device —
  // which is exactly what the "sign in to keep your rooms" prompt is for.
  isAnonymous: boolean;
};

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? false,
  };
}

export async function getUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getUser();
  return toAuthUser(data.user);
}

// Returns the current user, signing in anonymously if there isn't one. Called
// only from `createSession` — see the note at the top of this file.
export async function ensureUser(): Promise<AuthUser> {
  const existing = await getUser();
  if (existing) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  const user = toAuthUser(data.user);
  if (!user) throw new Error("Could not start a session. Please try again.");
  return user;
}

// Upgrades an anonymous account in place (`linkIdentity` keeps the user id, so
// rooms they already own stay theirs) or signs in normally when there's no
// anonymous session to upgrade.
//
// Known gap: if the Google account already exists as a separate user, linking
// fails and we fall back to a plain sign-in — rooms owned by the discarded
// anonymous id stay reachable by code but drop off "My rooms".
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const options = {
    redirectTo: redirectTo ?? `${window.location.origin}/rooms`,
  };

  const current = await getUser();
  if (current?.isAnonymous) {
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options,
    });
    if (!error) return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Fires on sign-in, sign-out and token refresh. Returns an unsubscribe function,
// matching `subscribeToSession` in sessionStore.
export function onAuthChange(
  onChange: (user: AuthUser | null) => void,
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
    onChange(toAuthUser(session?.user ?? null));
  });

  return () => subscription.unsubscribe();
}
