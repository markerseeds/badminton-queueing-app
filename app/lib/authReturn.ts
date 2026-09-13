// The decisions the post-OAuth return page makes, with no Supabase and no
// `window` — so they can be unit-tested in the `node` environment the suite
// runs in, where there is no DOM. The hook that uses them supplies the href and
// the current user; everything here is a pure function of its arguments.
//
// Deliberately not in `logic.ts`, which is scoped to DB-agnostic *game* logic.
//
// Why any of this is needed: @supabase/auth-js decides an identity-link failure
// only AFTER the provider redirects back, inside `_initialize()`. It puts the
// error on `initializePromise`, and every internal consumer awaits and discards
// it — so it never reaches `onAuthStateChange` and never reaches `useAuth`.
// The one surviving trace is the URL itself: `_getSessionFromURL` clears the
// fragment only on the success path, throwing before it on error. Reading that
// URL is the only way to know a link attempt failed.

export type OAuthError = { code: string; description: string };

// Mirrors auth-js's own `parseParametersFromURL`: merge the fragment first,
// then let the query string overwrite it — "search parameters take precedence
// over hash parameters" (helpers.js:101). GoTrue's implicit-flow error redirect
// populates both, so reading only the fragment is a latent bug.
//
// Returns null for a URL that carries no failure, including the success path's
// `#access_token=…`, so a live session can never render as a failed sign-in.
export function parseOAuthError(href: string): OAuthError | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const params: Record<string, string> = {};
  if (url.hash.startsWith("#")) {
    // URLSearchParams also decodes `+` as a space, which these params are
    // form-encoded with — hand-rolling it with decodeURIComponent leaves
    // "Identity+is+already+linked" in front of the user.
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      params[key] = value;
    });
  }
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  // The same three keys auth-js treats as "this redirect is a failure", in the
  // same order of preference: providers vary on which they send.
  const code = params.error_code || params.error;
  if (!code && !params.error_description) return null;

  return {
    code: code || "unspecified_code",
    description: params.error_description ?? "",
  };
}

const DEFAULT_NEXT = "/rooms";

// Where to go once the return page is done. The value comes back out of
// localStorage, which any script on the origin can write, so it is treated as
// untrusted even though we put it there ourselves: it must be a path on this
// site and nothing else.
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/")) return DEFAULT_NEXT;
  // `//evil.test` is protocol-relative, and browsers normalize the backslash in
  // `/\evil.test` to a forward slash — both navigate off-origin.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_NEXT;
  // Same class of problem `normalizeRoomName` strips for: JS `\s` doesn't match
  // most C0 controls, and a newline here can smuggle past a naive check.
  if (/\p{Cc}/u.test(raw)) return DEFAULT_NEXT;
  return raw;
}

export type ReturnAction =
  // Linking refused because the Google account is already its own user. The
  // anonymous identity is about to be discarded, so write a claim ticket and
  // then sign in plainly.
  | "claim-then-retry"
  // Back as a real account holding a ticket — move the rooms across.
  | "redeem"
  // Nothing to do.
  | "done"
  // Terminal. Say so; do not bounce to the provider again.
  | "failed";

export type ReturnInput = {
  // Null when nobody is signed in at all.
  user: { id: string; isAnonymous: boolean } | null;
  error: OAuthError | null;
  // The stashed nonce, if this browser has one.
  nonce: string | null;
};

export function decideReturnAction({
  user,
  error,
  nonce,
}: ReturnInput): ReturnAction {
  if (error) {
    // Only ever retry the one error the fallback exists for. Treating every
    // error as "try again" sends someone who pressed Cancel at Google straight
    // back to Google, forever.
    //
    // `!nonce` is the loop guard, and the reason there is no separate "already
    // retried" flag: a ticket is only ever written immediately before
    // `signInWithOAuth`, so holding one IS the record of having been here once.
    if (error.code === "identity_already_exists" && user?.isAnonymous && !nonce) {
      return "claim-then-retry";
    }
    return "failed";
  }

  // No check that the ticket names someone other than the current user: the RPC
  // returns 0 when a ticket names its own caller, so the server stays the
  // authority — the same way `readOnly` defers to `session_is_editable()`.
  if (user && !user.isAnonymous && nonce) return "redeem";

  // Includes "came back anonymous with no error" (cancelled, or a provider that
  // reports nothing). The stash is left alone rather than cleared, so a later
  // successful sign-in in this browser can still use it.
  return "done";
}
