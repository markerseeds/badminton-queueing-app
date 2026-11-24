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

type GoTrueUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  is_anonymous?: boolean | null;
  identities?: { provider?: string; identity_data?: Record<string, unknown> }[] | null;
};

// Reads the account out of GoTrue's user record. The email counts as verified
// when GoTrue confirmed it, or when a linked identity's provider verified that
// same address. The second arm is for this app's main path, an anonymous
// account upgraded in place by linkIdentity: whether GoTrue stamps
// email_confirmed_at on that upgrade isn't observable from the test suite, and
// refusing those buyers would block the path Phase 3b built. identity_data is
// written by GoTrue from the provider; unlike user_metadata, the user can't
// edit it.
export function authUserFrom(user: GoTrueUser): AuthUser {
  const email = user.email || null;
  const identityVerified = Boolean(
    email &&
      (user.identities ?? []).some((identity) => {
        const data = identity.identity_data ?? {};
        return (
          data.email_verified === true &&
          typeof data.email === "string" &&
          data.email.toLowerCase() === email.toLowerCase()
        );
      }),
  );
  return {
    id: user.id,
    email,
    emailVerified: Boolean(email && user.email_confirmed_at) || identityVerified,
    isAnonymous: Boolean(user.is_anonymous),
  };
}
