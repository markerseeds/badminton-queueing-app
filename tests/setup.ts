import { config } from "dotenv";

// Load local Supabase connection details (API_URL / ANON_KEY / SERVICE_ROLE_KEY)
// into process.env before any test runs. In CI these are set directly via
// `supabase status -o env >> $GITHUB_ENV`, so a missing .env.test is fine there.
config({ path: ".env.test" });
