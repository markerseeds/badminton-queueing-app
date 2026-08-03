import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Test helpers for the RPC + RLS integration suites. Three clients:
//   - anonClient    → CALLS the RPCs, exercising the real RLS path (like the app).
//   - serviceClient → bypasses RLS, used only for deterministic seed/teardown/reads.
//   - authedClient  → a signed-in user, so `auth.uid()` is set in RLS policies.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Start the local stack and run:\n` +
        `  npx supabase status -o env > .env.test`,
    );
  }
  return value;
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

export function anonClient(): SupabaseClient {
  return createClient(requireEnv("API_URL"), requireEnv("ANON_KEY"), clientOptions);
}

export function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("API_URL"),
    requireEnv("SERVICE_ROLE_KEY"),
    clientOptions,
  );
}

// A client carrying a real user's JWT, so `auth.uid()` resolves inside RLS
// policies. Created through the admin API (pre-confirmed) and signed in on a
// fresh anon-key client — the same path the browser app takes.
export async function authedClient(
  svc: SupabaseClient,
): Promise<{ client: SupabaseClient; userId: string }> {
  const email = `test-${uniqueSuffix()}@example.com`;
  const password = "test-password-1234";

  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const client = createClient(
    requireEnv("API_URL"),
    requireEnv("ANON_KEY"),
    clientOptions,
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;

  return { client, userId: data.user.id };
}

// An anonymously signed-in client — the exact path "Create a room" takes. Such
// users carry the `authenticated` role (with an is_anonymous claim), so they own
// rooms and may lock them just like a Google-linked account.
export async function anonSignedInClient(): Promise<{
  client: SupabaseClient;
  userId: string;
}> {
  const client = createClient(
    requireEnv("API_URL"),
    requireEnv("ANON_KEY"),
    clientOptions,
  );
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user!.id };
}

export async function deleteUser(
  svc: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export type SeedPlayer = {
  name: string;
  skill: string;
  status?: "idle" | "queued" | "playing";
  queue_position?: number | null;
  court_no?: number | null;
  court_slot?: number | null;
  games_played?: number;
};

export type PlayerRow = {
  id: string;
  session_id: string;
  name: string;
  skill: string;
  games_played: number;
  status: "idle" | "queued" | "playing";
  queue_position: number | null;
  court_no: number | null;
  court_slot: number | null;
};

// Collision-resistant across parallel test workers — used for both share codes
// and test-user emails.
function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueCode(): string {
  return `T${uniqueSuffix()}`.toUpperCase();
}

// `owner` / `locked` default to the pre-Phase-2 shape (an unowned, open room),
// so the existing RPC suites keep exercising the permissive path unchanged.
export async function createTestSession(
  svc: SupabaseClient,
  courts = 3,
  opts: { ownerId?: string; locked?: boolean } = {},
): Promise<string> {
  const { data, error } = await svc
    .from("sessions")
    .insert({
      share_code: uniqueCode(),
      courts,
      owner_id: opts.ownerId ?? null,
      locked: opts.locked ?? false,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function seedPlayers(
  svc: SupabaseClient,
  sessionId: string,
  players: SeedPlayer[],
): Promise<PlayerRow[]> {
  const rows = players.map((p) => ({ session_id: sessionId, ...p }));
  const { data, error } = await svc.from("players").insert(rows).select("*");
  if (error) throw error;
  return data as PlayerRow[];
}

export async function getPlayers(
  svc: SupabaseClient,
  sessionId: string,
): Promise<PlayerRow[]> {
  const { data, error } = await svc
    .from("players")
    .select("*")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data as PlayerRow[];
}

export async function getSession(svc: SupabaseClient, sessionId: string) {
  const { data, error } = await svc
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    share_code: string;
    courts: number;
    owner_id: string | null;
    locked: boolean;
  };
}

// Deleting the session cascades to its players (ON DELETE CASCADE).
export async function deleteSession(
  svc: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await svc.from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}
