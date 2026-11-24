// The error-reporting seam. Handlers report through this interface rather than
// importing Sentry, so the request logic stays free of `npm:` imports — vitest
// runs it with a recorder, and the entry files pass the Sentry-backed one from
// sentry.ts.
//
// Every report is awaited before the response goes out: an Edge Function's
// isolate can be frozen the moment it answers, and a report still in flight
// would be lost exactly when it mattered.

export type ReportTags = Record<string, string | number | boolean | null | undefined>;

export type Reporter = {
  // Something threw.
  exception(error: unknown, tags?: ReportTags): Promise<void>;
  // Nothing threw, but a person should know: a refused signature, an event the
  // database refused, a missing secret.
  message(level: "warning" | "error", message: string, tags?: ReportTags): Promise<void>;
};
