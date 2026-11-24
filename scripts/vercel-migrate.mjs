// Ships the database and the Edge Functions during Vercel *production* builds
// only, ahead of the app.
//
// Runs before `next build` (see vercel.json buildCommand). Preview and local
// builds skip it entirely, so they never touch the production project. Each
// step that fails aborts the build, so database, functions and app always ship
// together and in that order — the functions call apply_paddle_event, which
// only exists once its migration has run, and the app calls the functions.
//
// Requires (Vercel → Settings → Environment Variables, Production scope):
//   SUPABASE_DB_URL       — the Supabase "Session pooler" connection string
//                           (Settings → Database → Connection string), with
//                           the database password. The session pooler works
//                           over IPv4, which the Vercel build environment needs.
//   SUPABASE_ACCESS_TOKEN — a personal access token (Account → Access Tokens),
//                           which `functions deploy` needs. Read by the CLI from
//                           the environment; never put on the command line.
//   SUPABASE_PROJECT_REF  — the project's reference id (the subdomain of its
//                           supabase.co URL).
//
// The functions' own secrets (PADDLE_*, SENTRY_DSN) are NOT deployed from here:
// they are set once by hand with `supabase secrets set`, and a build never
// pushes them. See supabase/functions/.env.example.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Pinned, and to the same version the test workflow boots
// (.github/workflows/test.yml) — tests/lib/vercel_migrate.test.ts fails if the
// two drift. Unpinned, `npx supabase` resolves to whatever is newest on the day
// of the deploy: 3.x already deprecates `--db-url`, and 4.x removes it, which
// would break a deploy of unchanged code. Bump both together, on purpose.
export const SUPABASE_CLI = "supabase@3.3.0";

const REQUIRED = ["SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"];

export function deploySteps(env) {
  const vercelEnv = env.VERCEL_ENV ?? "local";
  if (vercelEnv !== "production") {
    return {
      steps: [],
      skip: `VERCEL_ENV=${vercelEnv} — skipping migrations and functions (production deploys only).`,
    };
  }

  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      steps: [],
      error:
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. Add ` +
        "them in Vercel → Settings → Environment Variables (Production); see the " +
        "header of scripts/vercel-migrate.mjs for where each comes from.",
    };
  }

  // Two different --yes in each command: the leading one is npx's (install the
  // pinned CLI without asking), the trailing one the CLI's own. CLI 3.x accepts
  // only that flag (or SUPABASE_YES) as confirmation for a change to a hosted
  // project, and nobody is at a build's keyboard to give one.
  return {
    steps: [
      {
        label: "Applying Supabase migrations to production",
        args: ["--yes", SUPABASE_CLI, "db", "push", "--db-url", env.SUPABASE_DB_URL, "--yes"],
      },
      {
        // --use-api bundles on Supabase's side: the Vercel build has no Docker.
        // It deploys every function under supabase/functions, with the
        // [functions.*] settings (verify_jwt) from supabase/config.toml.
        label: "Deploying Edge Functions",
        args: [
          "--yes",
          SUPABASE_CLI,
          "functions",
          "deploy",
          "--use-api",
          "--project-ref",
          env.SUPABASE_PROJECT_REF,
          "--yes",
        ],
      },
    ],
  };
}

function npx(args) {
  execFileSync("npx", args, { stdio: "inherit" });
}

// Returns the process exit code. `exec` and `log` are injectable so the order
// and the stop-on-first-failure rule are testable without running anything.
export function run(env, exec = npx, log = console.log) {
  const plan = deploySteps(env);
  if (plan.skip) {
    log(`[migrate] ${plan.skip}`);
    return 0;
  }
  if (plan.error) {
    console.error(`[migrate] ${plan.error}`);
    return 1;
  }

  for (const step of plan.steps) {
    log(`[migrate] ${step.label}…`);
    try {
      exec(step.args);
    } catch {
      console.error(`[migrate] "${step.label}" failed — aborting the build.`);
      return 1;
    }
  }
  log("[migrate] Database and Edge Functions are up to date.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run(process.env));
}
