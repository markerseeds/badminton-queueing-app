import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Copy .env.local.example to " +
      ".env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

// Public browser client. The anon key is a public identifier — Row-Level
// Security is what protects the data. (Auth/SSR cookies arrive in Phase 2.)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
