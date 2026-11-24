import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonSignedInClient,
  authedClient,
  deleteUser,
  serviceClient,
  setPlan,
} from "../helpers/db";

// create-checkout and sync-purchase end to end, for every path that answers
// BEFORE Paddle is called — there are no Paddle credentials yet, and the
// fixture's API key reaches nothing. Those paths are the refusals, which are
// the part that protects a customer: nobody anonymous or already-Pro ever gets
// a transaction to pay. What happens after the refusals is pinned by the unit
// suite with a fake Paddle (tests/logic/checkout_handler.test.ts) and by the
// sandbox check once the owner's keys exist.
//
// Same prerequisites as tests/functions/paddle_webhook.test.ts.

const FUNCTIONS_URL = process.env.FUNCTIONS_URL;
const ANON_KEY = process.env.ANON_KEY;
const SECRET = process.env.PADDLE_WEBHOOK_SECRET;

const svc = serviceClient();
const users: string[] = [];

afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(svc, id);
});

async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  return data.session!.access_token;
}

function call(fn: string, opts: { token?: string; method?: string } = {}) {
  const headers: Record<string, string> = { apikey: ANON_KEY! };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return fetch(`${FUNCTIONS_URL}/${fn}`, { method: opts.method ?? "POST", headers });
}

describe.skipIf(!FUNCTIONS_URL || !ANON_KEY || !SECRET)("create-checkout over HTTP", () => {
  it("refuses a caller with no session", async () => {
    const res = await call("create-checkout");
    expect(res.status).toBe(401);
  });

  it("refuses an anonymous account with 403 before creating anything", async () => {
    const anonymous = await anonSignedInClient();
    users.push(anonymous.userId);

    const res = await call("create-checkout", { token: await tokenOf(anonymous.client) });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "anonymous" });
  });

  it("refuses an account that already has Pro with 409", async () => {
    const signedIn = await authedClient(svc);
    users.push(signedIn.userId);
    await setPlan(svc, signedIn.userId, "pro");

    const res = await call("create-checkout", { token: await tokenOf(signedIn.client) });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "already_pro" });
  });

  // The browser can only read any of the answers above if the preflight passes.
  it("answers the CORS preflight", async () => {
    const res = await call("create-checkout", { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe.skipIf(!FUNCTIONS_URL || !ANON_KEY || !SECRET)("sync-purchase over HTTP", () => {
  it("answers the plan of an account with nothing pending", async () => {
    const signedIn = await authedClient(svc);
    users.push(signedIn.userId);

    const res = await call("sync-purchase", { token: await tokenOf(signedIn.client) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: "free", processing: false });
  });

  it("refuses a caller with no session", async () => {
    const res = await call("sync-purchase");
    expect(res.status).toBe(401);
  });
});
