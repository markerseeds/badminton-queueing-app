import { describe, expect, it } from "vitest";
import {
  decideReturnAction,
  parseOAuthError,
  safeNext,
} from "../../app/lib/authReturn";

// Pure-logic unit tests — no Supabase, no `window`. These three functions are
// everything the post-OAuth return page decides with, pulled out of the hook so
// the decisions can be asserted in a `node` environment (there is no DOM here).
//
// The whole flow rests on one quirk of @supabase/auth-js: `_getSessionFromURL`
// clears `window.location.hash` only on the SUCCESS path, throwing before it on
// error — so the failure params are still in the URL when we get control, and
// are the only evidence that a link attempt failed at all. The error never
// reaches `onAuthStateChange`; it is put on `initializePromise` and every
// internal consumer awaits and discards it.

describe("parseOAuthError", () => {
  it("reads the error out of the fragment", () => {
    const err = parseOAuthError(
      "https://app.test/auth/return#error=server_error&error_code=identity_already_exists",
    );
    expect(err?.code).toBe("identity_already_exists");
  });

  it("reads the error out of the query string", () => {
    const err = parseOAuthError(
      "https://app.test/auth/return?error=server_error&error_code=identity_already_exists",
    );
    expect(err?.code).toBe("identity_already_exists");
  });

  // Mirrors auth-js's own precedence — `parseParametersFromURL` merges the hash
  // first and then lets the search params overwrite it, commented in the source
  // as "search parameters take precedence over hash parameters" (helpers.js:101).
  // GoTrue's implicit-flow error redirect populates both, so a hash-only parser
  // reads a stale value on any provider that sets them differently.
  it("lets the query string win over the fragment", () => {
    const err = parseOAuthError(
      "https://app.test/auth/return?error_code=access_denied#error_code=identity_already_exists",
    );
    expect(err?.code).toBe("access_denied");
  });

  // Params arrive form-encoded, where a space is `+`, not `%20`. Hand-rolling
  // this with `decodeURIComponent` leaves the pluses in and puts
  // "Identity+is+already+linked" in front of the user; URLSearchParams doesn't.
  it("decodes + as a space in the description", () => {
    const err = parseOAuthError(
      "https://app.test/auth/return#error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user",
    );
    expect(err?.description).toBe("Identity is already linked to another user");
  });

  it("falls back to `error` when there is no `error_code`", () => {
    const err = parseOAuthError("https://app.test/auth/return#error=access_denied");
    expect(err?.code).toBe("access_denied");
  });

  it("returns null for a clean URL", () => {
    expect(parseOAuthError("https://app.test/auth/return")).toBeNull();
  });

  // The success path must not read as a failure. On success auth-js has already
  // cleared the fragment by the time we look, but a race or a re-render must not
  // be able to turn a live session into a "sign-in failed" screen.
  it("returns null when the fragment carries a session", () => {
    expect(
      parseOAuthError(
        "https://app.test/auth/return#access_token=abc&refresh_token=def&token_type=bearer",
      ),
    ).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps an in-app path", () => {
    expect(safeNext("/s/ABCD2345")).toBe("/s/ABCD2345");
    expect(safeNext("/rooms?x=1")).toBe("/rooms?x=1");
  });

  // The stash is localStorage, which any script on the origin can write, so this
  // value is treated as untrusted even though we put it there ourselves.
  it("rejects a protocol-relative path", () => {
    expect(safeNext("//evil.test")).toBe("/rooms");
  });

  // Browsers normalize a backslash to a forward slash in the authority, so
  // `/\evil.test` navigates off-origin exactly as `//evil.test` does.
  it("rejects a backslash-smuggled host", () => {
    expect(safeNext("/\\evil.test")).toBe("/rooms");
  });

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.test")).toBe("/rooms");
  });

  it("rejects control characters", () => {
    expect(safeNext("/rooms\n/evil")).toBe("/rooms");
  });

  it("falls back for blank or missing input", () => {
    expect(safeNext("")).toBe("/rooms");
    expect(safeNext(null)).toBe("/rooms");
    expect(safeNext(undefined)).toBe("/rooms");
  });
});

describe("decideReturnAction", () => {
  const anon = { id: "anon-1", isAnonymous: true };
  const account = { id: "acct-1", isAnonymous: false };
  const alreadyExists = {
    code: "identity_already_exists",
    description: "Identity is already linked to another user",
  };

  // The fallback the roadmap describes, finally reachable: linking refused
  // because the Google account is its own user, so the anonymous identity is
  // about to be discarded and needs a claim ticket written before it goes.
  it("claims and retries when linking hit an existing identity", () => {
    expect(
      decideReturnAction({ user: anon, error: alreadyExists, nonce: null }),
    ).toBe("claim-then-retry");
  });

  // The loop guard, and the reason no separate "retried" flag exists: a ticket
  // is only ever minted immediately before `signInWithOAuth`, so a stashed nonce
  // IS the record that we have already been round once. Without this the page
  // redirects to Google forever.
  it("fails instead of retrying when a ticket was already written", () => {
    expect(
      decideReturnAction({ user: anon, error: alreadyExists, nonce: "n-1" }),
    ).toBe("failed");
  });

  // A naive build treats every error as "try the fallback", which turns a user
  // who pressed Cancel at Google into an infinite redirect back to Google.
  it("fails on any other OAuth error rather than retrying", () => {
    expect(
      decideReturnAction({
        user: anon,
        error: { code: "access_denied", description: "The user denied access" },
        nonce: null,
      }),
    ).toBe("failed");
  });

  it("redeems when a signed-in account returns holding a ticket", () => {
    expect(
      decideReturnAction({ user: account, error: null, nonce: "n-1" }),
    ).toBe("redeem");
  });

  // No comparison against the id the ticket was written for: the RPC returns 0
  // when the ticket names its own caller, so the server stays the authority —
  // the same way `readOnly` defers to `session_is_editable()`.
  it("redeems without second-guessing which account it is", () => {
    expect(
      decideReturnAction({
        user: { id: "anon-1", isAnonymous: false },
        error: null,
        nonce: "n-1",
      }),
    ).toBe("redeem");
  });

  it("is done when a signed-in account returns with no ticket", () => {
    expect(decideReturnAction({ user: account, error: null, nonce: null })).toBe(
      "done",
    );
  });

  // Came back anonymous with no error at all — cancelled, or a provider that
  // reports nothing. Nothing to redeem as this identity, and the stash is left
  // alone so a later successful sign-in can still use it.
  it("is done when nothing happened", () => {
    expect(decideReturnAction({ user: anon, error: null, nonce: "n-1" })).toBe(
      "done",
    );
    expect(decideReturnAction({ user: null, error: null, nonce: null })).toBe(
      "done",
    );
  });
});
