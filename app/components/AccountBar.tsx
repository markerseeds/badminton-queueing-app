"use client";

import Link from "next/link";
import { CloseIcon, WarningIcon } from "./icons";
import { useAuth } from "../hooks/useAuth";
import { IconButton } from "./ui";

// The account strip shared by the landing page and "My rooms".
//
// Note the three states, not two. Someone who has created a room is signed in
// *anonymously*: they own rooms and should see "My rooms", but their account
// lives only in this browser — so they still get the sign-in prompt, worded as
// keeping their rooms rather than as logging in.
export function AccountBar() {
  const {
    user,
    isSignedIn,
    loading,
    error,
    dismissError,
    signInWithGoogle,
    signOut,
  } = useAuth();

  // Reserve the row's height while auth resolves, so the page below doesn't
  // jump once it does — and show a placeholder in it, or this strip is the one
  // blank patch left while everything under it is visibly loading.
  //
  // Stays aria-hidden: the pages this sits on announce their own wait through a
  // role="status", and a second voice for a 36px strip would only compete.
  if (loading) {
    return (
      <div aria-hidden="true" className="flex h-9 items-center justify-end">
        <div className="skel h-4 w-40" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-9 items-center justify-end gap-4 text-sm">
        {user && (
          <Link
            href="/rooms"
            className="font-medium text-accent hover:underline"
          >
            My rooms
          </Link>
        )}

        {isSignedIn ? (
          <>
            <span
              className="max-w-48 truncate text-ink-2"
              title={user!.email ?? ""}
            >
              {user!.email}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="text-ink-2 hover:text-ink hover:underline"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            className="font-medium text-accent hover:underline"
          >
            {user ? "Save my rooms" : "Sign in"} with Google
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="banner banner-danger">
          <WarningIcon size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <IconButton
            aria-label="Dismiss error"
            className="-my-1 size-8 border-0 bg-transparent"
            onClick={dismissError}
          >
            <CloseIcon size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
