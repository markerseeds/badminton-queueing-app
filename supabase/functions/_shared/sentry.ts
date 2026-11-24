// The Sentry-backed Reporter, following Supabase's guide for Edge Functions
// (supabase.com/docs/guides/functions/examples/sentry-monitoring).
//
// Scoped to the Edge Functions on purpose: this is where a failure costs a
// customer money — a webhook that 500s is someone who paid and got nothing.
// App-wide monitoring is Phase 5.
//
// Two rules from that guide shape everything here:
//   * the Deno SDK doesn't instrument Deno.serve, so there is no per-request
//     scope — default integrations stay off, and every report sets its tags
//     inside its own withScope rather than on the global scope;
//   * the isolate can be frozen as soon as the response is sent, so every
//     report is flushed before the handler returns.
//
// Without SENTRY_DSN nothing is sent, and reports still go to the function's
// log, which is where the local stack and the dashboard show them.

import * as Sentry from "npm:@sentry/deno@11.16.0";
import type { Reporter, ReportTags } from "./report.ts";

const dsn = Deno.env.get("SENTRY_DSN") || undefined;

if (dsn) {
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    // Errors only. Tracing a handful of webhook calls a day isn't worth the
    // free plan's quota.
    tracesSampleRate: 0,
    // Keeps sandbox purchases apart from real ones in the Sentry UI.
    environment: Deno.env.get("PADDLE_ENV") ?? "unknown",
  });
  Sentry.setTag("region", Deno.env.get("SB_REGION"));
  Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID"));
}

function setTags(scope: Sentry.Scope, functionName: string, tags: ReportTags = {}): void {
  scope.setTag("function", functionName);
  for (const [key, value] of Object.entries(tags)) {
    if (value !== null && value !== undefined) scope.setTag(key, String(value));
  }
}

function logLine(functionName: string, text: string, tags: ReportTags = {}): void {
  console.error(`[${functionName}] ${text} ${JSON.stringify(tags)}`);
}

export function sentryReporter(functionName: string): Reporter {
  return {
    async exception(error, tags) {
      logLine(functionName, error instanceof Error ? error.stack ?? error.message : String(error), tags);
      if (!dsn) return;
      Sentry.withScope((scope) => {
        setTags(scope, functionName, tags);
        Sentry.captureException(error);
      });
      await Sentry.flush(2000);
    },

    async message(level, message, tags) {
      logLine(functionName, `${level}: ${message}`, tags);
      if (!dsn) return;
      Sentry.withScope((scope) => {
        setTags(scope, functionName, tags);
        scope.setLevel(level);
        Sentry.captureMessage(message);
      });
      await Sentry.flush(2000);
    },
  };
}
