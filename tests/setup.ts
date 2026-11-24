import { config } from "dotenv";

// Load local Supabase connection details (API_URL / ANON_KEY / SERVICE_ROLE_KEY)
// into process.env before any test runs. Local runs and CI both write the file
// the same way — `supabase status -o env > .env.test` — because the CLI quotes
// every value and dotenv is what strips the quotes. (CI used to append that
// output to $GITHUB_ENV instead, which kept them, so API_URL arrived with
// literal quote marks and every DB test file failed to build a client.)
//
// dotenv never overrides a variable that is already set, so don't export these
// into the environment some other way: a quoted value there would still win.
config({ path: ".env.test" });
