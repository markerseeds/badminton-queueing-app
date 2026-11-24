// supabase-js reports any non-2xx from an Edge Function as one generic error
// ("Edge Function returned a non-2xx status code") with the Response tucked into
// `error.context`. The functions answer every refusal as {error, code}, and the
// code is what lets the pricing page tell "you already have Pro" — good news —
// from a real failure, so this digs both back out.
//
// Kept out of sessionStore so it can be unit-tested: sessionStore can't be
// imported without the NEXT_PUBLIC_SUPABASE_* variables.

export type FunctionError = Error & { code?: string };

export async function functionErrorFrom(
  error: unknown,
  fallback: string,
): Promise<FunctionError> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown; code?: unknown };
      if (typeof body?.error === "string") {
        return Object.assign(new Error(body.error), {
          code: typeof body.code === "string" ? body.code : undefined,
        });
      }
    } catch {
      // Not the functions' JSON — a gateway page, say. Fall through.
    }
  }
  return new Error(fallback);
}
