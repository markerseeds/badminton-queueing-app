// Applies pending Supabase migrations during Vercel *production* builds only.
//
// Runs before `next build` (see vercel.json buildCommand). Preview and local
// builds skip it entirely, so they never touch the production database. If a
// migration fails, the build aborts — you never deploy against an un-migrated DB.
//
// Requires (Vercel → Settings → Environment Variables, Production scope):
//   SUPABASE_DB_URL — the Supabase "Session pooler" connection string
//                     (Settings → Database → Connection string), including your
//                     database password. The session pooler works over IPv4,
//                     which the Vercel build environment needs.
import { execFileSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV ?? "local";

if (vercelEnv !== "production") {
  console.log(
    `[migrate] VERCEL_ENV=${vercelEnv} — skipping migrations (production deploys only).`,
  );
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(
    "[migrate] SUPABASE_DB_URL is not set. Add it in Vercel → Settings → " +
      "Environment Variables (Production): the Supabase Session pooler " +
      "connection string with your database password.",
  );
  process.exit(1);
}

console.log("[migrate] Applying Supabase migrations to production…");
try {
  execFileSync(
    "npx",
    ["--yes", "supabase", "db", "push", "--db-url", dbUrl],
    { stdio: "inherit" },
  );
  console.log("[migrate] Migrations applied.");
} catch {
  console.error("[migrate] `supabase db push` failed — aborting the build.");
  process.exit(1);
}
