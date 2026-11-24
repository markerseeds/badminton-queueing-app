import { describe, expect, it } from "vitest";
import { authUserFrom } from "../../supabase/functions/_shared/http.ts";

// How the functions read the account behind a request, from GoTrue's own user
// record (auth.getUser), never from claims in the JWT.
//
// The email has to be one the account controls, since the Paddle customer is
// keyed on it. `email_confirmed_at` says so for most accounts — but this app's
// main path is an ANONYMOUS account upgraded in place by linkIdentity, and
// whether GoTrue stamps `email_confirmed_at` on that upgrade isn't something
// this suite can observe (the admin API can't reproduce a real Google link).
// Refusing such a buyer would block the very path Phase 3b built, so a linked
// identity whose provider verified that same address counts as verified too.
// identity_data is written by GoTrue from the provider; unlike user_metadata,
// the user can't edit it.

const base = {
  id: "33333333-3333-4333-8333-333333333333",
  email: "sam@example.com",
  email_confirmed_at: null as string | null,
  is_anonymous: false,
  identities: [] as { provider: string; identity_data?: Record<string, unknown> }[],
};

describe("authUserFrom", () => {
  it("treats a confirmed email as verified", () => {
    expect(authUserFrom({ ...base, email_confirmed_at: "2026-11-24T00:00:00Z" })).toEqual({
      id: base.id,
      email: "sam@example.com",
      emailVerified: true,
      isAnonymous: false,
    });
  });

  it("accepts a linked identity that verified the same address", () => {
    const user = {
      ...base,
      identities: [
        { provider: "anonymous", identity_data: {} },
        { provider: "google", identity_data: { email: "Sam@Example.com", email_verified: true } },
      ],
    };
    expect(authUserFrom(user).emailVerified).toBe(true);
  });

  it("refuses an identity that verified some other address, or didn't verify", () => {
    for (const identity_data of [
      { email: "someone.else@example.com", email_verified: true },
      { email: "sam@example.com", email_verified: false },
      { email: "sam@example.com" },
    ]) {
      expect(authUserFrom({ ...base, identities: [{ provider: "google", identity_data }] }).emailVerified).toBe(false);
    }
  });

  it("carries anonymity through, and copes with no email at all", () => {
    expect(authUserFrom({ ...base, email: undefined, is_anonymous: true })).toEqual({
      id: base.id,
      email: null,
      emailVerified: false,
      isAnonymous: true,
    });
  });
});
