"use client";

import Link from "next/link";
import { useAuth } from "../hooks/useAuth";

// The account strip shared by the landing page and "My rooms".
//
// Note the three states, not two. Someone who has created a room is signed in
// *anonymously*: they own rooms and should see "My rooms", but their account
// lives only in this browser — so they still get the sign-in prompt, worded as
// keeping their rooms rather than as logging in.
export function AccountBar() {
  const { user, isSignedIn, loading, error, dismissError, signInWithGoogle, signOut } =
    useAuth();

  if (loading) return null;

  return (
    <div className="w-full max-w-md space-y-2">
      <div className="flex items-center justify-end gap-3 text-sm">
        {user && (
          <Link href="/rooms" className="text-blue-700 hover:underline">
            My rooms
          </Link>
        )}

        {isSignedIn ? (
          <>
            <span className="text-gray-600 truncate max-w-[12rem]" title={user!.email ?? ""}>
              {user!.email}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="text-gray-700 hover:underline"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => signInWithGoogle()}
            className="text-blue-700 hover:underline"
          >
            {user ? "Save my rooms" : "Sign in"} with Google
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg"
        >
          <span>
            <span aria-hidden="true">⚠️</span> {error}
          </span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={dismissError}
            className="font-bold px-2"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
