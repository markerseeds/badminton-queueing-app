// Deno-only wiring: turns the function's environment into the dependencies the
// pure handlers in this folder take. Everything that touches `Deno.env` or the
// Supabase client lives here or in an entry file, so the handlers themselves
// stay runnable under vitest.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.0";
import { authUserFrom, type AuthUser } from "./http.ts";
import type { ApplyResult } from "./webhook.ts";

// Unset and empty mean the same thing: `supabase secrets set X=` leaves X empty.
export function env(name: string): string | undefined {
  return Deno.env.get(name) || undefined;
}

// The service-role key, legacy or new. Projects still on the legacy JWT keys
// get SUPABASE_SERVICE_ROLE_KEY; projects moved to the new API keys get a JSON
// map in SUPABASE_SECRET_KEYS instead. Either way this client bypasses RLS,
// which is the webhook's whole position: `entitlements` is writable by
// service_role and nobody else.
function serviceKey(): string | undefined {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = env("SUPABASE_SECRET_KEYS");
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return undefined;
  }
}

let admin: SupabaseClient | null = null;

// Built on first use rather than at import, so a missing variable surfaces as a
// reported 500 on the request instead of a function that never boots.
export function adminClient(): SupabaseClient {
  if (admin) return admin;
  const url = env("SUPABASE_URL");
  const key = serviceKey();
  if (!url || !key) throw new Error("SUPABASE_URL or the service-role key is not available");
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

export function applyEventWith(db: SupabaseClient) {
  return async (event: unknown, priceId: string): Promise<ApplyResult> => {
    const { data, error } = await db.rpc("apply_paddle_event", {
      p_event: event,
      p_price_id: priceId,
    });
    if (error) throw new Error(`apply_paddle_event: ${error.code ?? ""} ${error.message}`.trim());
    return data as ApplyResult;
  };
}

// `auth.getUser(jwt)` asks GoTrue, i.e. reads auth.users — so `is_anonymous`
// and the email are current even when the token predates a linkIdentity. A
// refused token is "not signed in"; anything else (GoTrue unreachable) throws,
// so it becomes a reported 500 rather than a misleading "sign in".
export function getUserWith(db: SupabaseClient) {
  return async (token: string): Promise<AuthUser | null> => {
    const { data, error } = await db.auth.getUser(token);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403 || error.name === "AuthSessionMissingError") return null;
      throw error;
    }
    return data.user ? authUserFrom(data.user) : null;
  };
}

export function accountPlanWith(db: SupabaseClient) {
  return async (userId: string): Promise<"free" | "pro"> => {
    const { data, error } = await db.rpc("account_plan", { p_user_id: userId });
    if (error) throw error;
    return data === "pro" ? "pro" : "free";
  };
}

// Newest first and capped: every tap of Buy that ends in a closed overlay
// leaves a pending row, and one forgotten checkout shouldn't make every later
// sync slower. A payment older than a month that never produced a webhook is a
// support ticket, not something to poll for.
export function listPendingWith(db: SupabaseClient) {
  return async (userId: string): Promise<{ provider_transaction_id: string }[]> => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from("purchases")
      .select("provider_transaction_id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;
    return data ?? [];
  };
}

export function insertPendingWith(db: SupabaseClient) {
  return async (row: {
    user_id: string;
    provider_transaction_id: string;
    provider_customer_id: string;
    price_id: string;
  }): Promise<void> => {
    const { error } = await db.from("purchases").insert({ ...row, status: "pending" });
    if (error) throw error;
  };
}
