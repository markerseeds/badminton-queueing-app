import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Test helpers for the RPC integration suite. Two clients:
//   - anonClient    → CALLS the RPCs, exercising the real RLS path (like the app).
//   - serviceClient → bypasses RLS, used only for deterministic seed/teardown/reads.

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

// Unique share_code per call, collision-resistant across parallel test workers.
function uniqueCode(): string {
  return `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

export async function createTestSession(
  svc: SupabaseClient,
  courts = 3,
): Promise<string> {
  const { data, error } = await svc
    .from("sessions")
    .insert({ share_code: uniqueCode(), courts })
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
  return data as { id: string; share_code: string; courts: number };
}

// Deleting the session cascades to its players (ON DELETE CASCADE).
export async function deleteSession(
  svc: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await svc.from("sessions").delete().eq("id", sessionId);
  if (error) throw error;
}
