import { afterEach, describe, expect, it } from "vitest";
import {
  anonSignedInClient,
  authedClient,
  deleteUser,
  serviceClient,
  setPlan,
} from "../helpers/db";

// The invariant from ROADMAP §7: `plan = 'pro'` implies `is_anonymous = false`.
//
// An anonymous account's only proof of identity is a refresh token in one
// browser. A one-time purchase attached to it dies with the browser profile and
// cannot be recovered afterwards, because the merchant knows an email the
// database has never seen — there is no join key. So the database refuses to
// hold the row at all.
//
// Enforced with NO service_role exemption, which is the opposite of
// `enforce_player_limit`'s decision and the opposite reason: that trigger
// exempts service_role so helpers can seed past a *product* limit, whereas this
// one is guarding against service_role itself. `entitlements` is granted to
// service_role and nobody else, so a replayed Phase 3c webhook or a hand-made
// checkout URL is exactly what could violate this, and nothing sits above
// service_role to catch it.
//
// Every write below therefore goes through `setPlan`, i.e. service_role — the
// most privileged caller there is, and still refused.

const svc = serviceClient();

const users: string[] = [];

afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

describe("pro requires a real account", () => {
  it("refuses Pro on an anonymous account, even through service_role", async () => {
    const anonUser = await anonSignedInClient();
    users.push(anonUser.userId);

    await expect(setPlan(svc, anonUser.userId, "pro")).rejects.toMatchObject({
      code: "23514",
    });
  });

  // An INSERT-only trigger passes the case above and still lets this through —
  // and this is the shape the real code uses, since `setPlan` upserts and the
  // Phase 3c webhook will too.
  it("refuses the UPDATE path, not just the INSERT", async () => {
    const anonUser = await anonSignedInClient();
    users.push(anonUser.userId);

    // First write lands: free is legal for an anonymous account.
    await setPlan(svc, anonUser.userId, "free");
    // Second write is `on conflict do update` — a different code path.
    await expect(setPlan(svc, anonUser.userId, "pro")).rejects.toMatchObject({
      code: "23514",
    });
  });

  // One-directional on purpose. Being anonymous is not itself a problem; only
  // paying while anonymous is, so an anonymous account still gets an
  // entitlements row like anyone else.
  it("allows free on an anonymous account", async () => {
    const anonUser = await anonSignedInClient();
    users.push(anonUser.userId);

    await expect(setPlan(svc, anonUser.userId, "free")).resolves.toBeUndefined();
  });

  // The canary. If this function ends up owned by a role that cannot read
  // auth.users it fails closed — safe, but it would silently break every Pro
  // path, including the two existing suites that mark an owner Pro.
  it("allows Pro on a real account", async () => {
    const real = await authedClient(svc);
    users.push(real.userId);

    await expect(setPlan(svc, real.userId, "pro")).resolves.toBeUndefined();
  });

  // Phase 3c flips this back on a refund.
  it("round-trips pro then free on a real account", async () => {
    const real = await authedClient(svc);
    users.push(real.userId);

    await setPlan(svc, real.userId, "pro");
    await expect(setPlan(svc, real.userId, "free")).resolves.toBeUndefined();
  });
});

// Not covered here, and not coverable: an account that STOPS being anonymous
// (linkIdentity flipping is_anonymous) becoming eligible for Pro. The admin API
// cannot reproduce that transition, so it stays a manual check against a real
// Google sign-in.
