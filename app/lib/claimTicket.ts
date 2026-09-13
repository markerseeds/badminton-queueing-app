// The browser-side half of a claim ticket: the nonce, and where to go once the
// sign-in round trip is over.
//
// Why localStorage is acceptable here, given it is normally the wrong place for
// anything load-bearing: supabase-js already persists the auth session there by
// default. A browser that cannot hold localStorage cannot hold an anonymous
// session across a reload at all, so such a user never had rooms to keep and
// there is nothing for this to lose. It adds no failure mode that isn't already
// fatal to the feature.
//
// This is also why the destination is stashed rather than carried as `?next=`
// on the redirect: Supabase matches redirect URLs against an allow-list of
// *exact* URLs, so a query string would need a wildcard entry, and reading it
// back would need `useSearchParams` inside a Suspense boundary. One constant
// redirect URL is a smaller surface in both places.

const KEY = "bq.roomClaim";

export type Claim = {
  // Present only once a ticket has actually been written — which happens only
  // immediately before the anonymous identity is discarded. Its presence is
  // therefore also the record that the fallback has already been attempted.
  nonce?: string;
  // An in-app path. Treated as untrusted on the way out (see `safeNext`).
  next?: string;
};

export function readClaim(): Claim {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const { nonce, next } = parsed as Claim;
    return {
      nonce: typeof nonce === "string" ? nonce : undefined,
      next: typeof next === "string" ? next : undefined,
    };
  } catch {
    // Private browsing, blocked site data, or a value someone else wrote.
    return {};
  }
}

// Merges into whatever is already stashed, because the two fields are written
// at different moments: `next` when a sign-in starts, `nonce` only if and when
// the identity is about to be thrown away.
//
// Returns false if storage refused. Callers must treat that as fatal before
// `signInWithGoogle`: discarding the anonymous identity without a stashed nonce
// loses the rooms with no way back.
export function writeClaim(patch: Claim): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readClaim(), ...patch }));
    return true;
  } catch {
    return false;
  }
}

export function clearClaim(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — a stale stash is harmless; the ticket expires anyway.
  }
}

// A v4 UUID, matching the `nonce uuid` column. 122 random bits, and the only
// copy lives in this browser — which is what makes possession of it proof of
// having been the anonymous user. `randomUUID` needs a secure context; both
// production (https) and `next dev` (localhost/127.0.0.1) are one, and if it is
// ever missing this throws before the identity is discarded, which is the safe
// direction to fail in.
export function mintNonce(): string {
  return crypto.randomUUID();
}
