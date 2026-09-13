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

// Every sign-in comes back to one constant URL, which redeems any claim ticket
// and then forwards on. One exact entry for Supabase's redirect allow-list, and
// one place where the messy post-redirect cases live.
export function authReturnUrl(): string {
  return `${window.location.origin}/auth/return`;
}

// Tries to upgrade the current anonymous account in place. `linkIdentity` keeps
// the same user id, so rooms they already own stay theirs and nothing else is
// needed.
//
// Returns true if the browser is now navigating to Google. **False means the
// caller must assume the anonymous identity is about to be discarded** and
// write a claim ticket before calling `signInWithGoogle` — that happens when
// manual linking is disabled on the project, which is Supabase's default.
//
// The error is swallowed rather than thrown on purpose: every reason linking
// can refuse synchronously leads to the same recovery, and the *asynchronous*
// refusal can't be observed here at all. `linkIdentity` calls
// `window.location.assign` and returns `error: null` before the provider has
// been consulted; whether the Google account already exists is decided only
// after it redirects back, and auth-js puts that error on `initializePromise`
// where every consumer awaits and discards it. That is what `/auth/return`
// exists to read out of the URL.
export async function linkGoogleIdentity(): Promise<boolean> {
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: authReturnUrl() },
  });
  return !error;
}

// A plain sign-in. This is the call that discards an anonymous identity, so
// anything that needs to survive it must already be written.
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authReturnUrl() },
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
