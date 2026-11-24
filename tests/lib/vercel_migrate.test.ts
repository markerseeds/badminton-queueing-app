import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deploySteps,
  run,
  SUPABASE_CLI,
} from "../../scripts/vercel-migrate.mjs";

// The production build step that ships the database and the Edge Functions
// ahead of the app (vercel.json: `node scripts/vercel-migrate.mjs && next
// build`). Every failure here stops the build, so database, functions and app
// go out together and in that order — or not at all — and nothing here ever
// runs outside a production build.

const PRODUCTION = {
  VERCEL_ENV: "production",
  SUPABASE_DB_URL: "postgresql://postgres.ref:pw@pooler.example:5432/postgres",
  SUPABASE_ACCESS_TOKEN: "sbp_test_token_not_real",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
};

describe("deploySteps", () => {
  it("does nothing outside a production build", () => {
    for (const VERCEL_ENV of ["preview", "development", undefined]) {
      const plan = deploySteps({ ...PRODUCTION, VERCEL_ENV });
      expect(plan.steps).toEqual([]);
      expect(plan.skip).toMatch(/production deploys only/);
    }
  });

  // Migrations first: the functions call apply_paddle_event, which only exists
  // once its migration has run. Two different --yes: the leading one is npx's
  // (install without asking), the trailing one the CLI's — 3.x says a hosted
  // change accepts only that flag or SUPABASE_YES as confirmation, and nobody
  // is at a build's keyboard to give one.
  it("pushes migrations, then deploys the functions, in that order", () => {
    const plan = deploySteps(PRODUCTION);
    expect(plan.error).toBeUndefined();
    expect(plan.steps.map((s) => s.args)).toEqual([
      ["--yes", SUPABASE_CLI, "db", "push", "--db-url", PRODUCTION.SUPABASE_DB_URL, "--yes"],
      [
        "--yes",
        SUPABASE_CLI,
        "functions",
        "deploy",
        "--use-api",
        "--project-ref",
        PRODUCTION.SUPABASE_PROJECT_REF,
        "--yes",
      ],
    ]);
  });

  // The CLI reads SUPABASE_ACCESS_TOKEN from the environment by itself; on the
  // command line it could end up in a build log.
  it("keeps the access token off the command line", () => {
    const args = deploySteps(PRODUCTION).steps.flatMap((s) => s.args);
    expect(args).not.toContain(PRODUCTION.SUPABASE_ACCESS_TOKEN);
  });

  it("refuses a production build that is missing any of its variables", () => {
    for (const name of ["SUPABASE_DB_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]) {
      const plan = deploySteps({ ...PRODUCTION, [name]: undefined });
      expect(plan.steps, name).toEqual([]);
      expect(plan.error).toContain(name);
    }
  });

  // The same CLI the test workflow boots, so what deploys is what was tested —
  // and an exact version, so a new CLI major (3.x already deprecates
  // `--db-url`; 4.x removes it) can't break a deploy of unchanged code.
  it("pins the same exact CLI version as CI", () => {
    expect(SUPABASE_CLI).toMatch(/^supabase@\d+\.\d+\.\d+$/);
    const workflow = readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8");
    const ciVersion = /uses: supabase\/setup-cli@v1\s+with:\s+version: (\S+)/.exec(workflow)?.[1];
    expect(SUPABASE_CLI).toBe(`supabase@${ciVersion}`);
  });
});

describe("run", () => {
  it("runs every step and succeeds", () => {
    const ran: string[][] = [];
    const code = run(PRODUCTION, (args) => {
      ran.push(args);
    }, () => {});
    expect(code).toBe(0);
    expect(ran).toHaveLength(2);
  });

  it("stops at the first failing step and fails the build", () => {
    const ran: string[][] = [];
    const code = run(
      PRODUCTION,
      (args) => {
        ran.push(args);
        throw new Error("db push failed");
      },
      () => {},
    );
    expect(code).toBe(1);
    // Functions never deploy against a database whose migration didn't apply.
    expect(ran).toHaveLength(1);
  });

  it("fails without running anything when misconfigured", () => {
    const ran: string[][] = [];
    const code = run({ ...PRODUCTION, SUPABASE_PROJECT_REF: undefined }, (args) => {
      ran.push(args);
    }, () => {});
    expect(code).toBe(1);
    expect(ran).toEqual([]);
  });

  it("succeeds without running anything outside production", () => {
    const ran: string[][] = [];
    const code = run({ VERCEL_ENV: "preview" }, (args) => {
      ran.push(args);
    }, () => {});
    expect(code).toBe(0);
    expect(ran).toEqual([]);
  });
});
