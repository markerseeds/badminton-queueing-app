// Small HTTP helpers shared by the Edge Functions. Plain Fetch API, so they run
// under Deno and under vitest alike.

// create-checkout and sync-purchase are called from the browser, cross-origin
// (the app is on Vercel, the functions on supabase.co). `*` is safe here: the
// caller authenticates with a bearer token, never a cookie, so a hostile page
// can't borrow anyone's session through it. The header list is what
// supabase-js's functions.invoke sends.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// The account behind a request, as the functions need it. Read from
// `auth.getUser()` — i.e. from auth.users, not from claims inside the JWT — so
// `isAnonymous` and the email are current even if the token was minted before
// the account linked Google.
export type AuthUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
};
