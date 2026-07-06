import { defineConfig } from "vitest/config";

// Integration tests run against a local Supabase stack (`npx supabase start`).
// Connection details come from `.env.test` (see tests/setup.ts), generated with
// `npx supabase status -o env > .env.test`.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
