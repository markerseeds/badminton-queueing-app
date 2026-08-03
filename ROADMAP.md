# Badminton Queue — Product Roadmap

> **Living document.** This is the single source of truth for turning this app from a personal
> tool into a commercial, professional product with a free tier and a one-time paid unlock.
> Update the **Status** columns as you go. Add notes, dates, and decisions at the bottom.
>
> **Backend:** **migrated** from Firebase Firestore → **Supabase** (Postgres + Auth + Realtime
> + Row-Level Security). _Decision 2026-07-03 · migration shipped 2026-07-04._
>
> _Last reviewed: 2026-08-03_

---

## How to use this doc

Phases are ordered by **dependency**, not just priority — each one unlocks the next. They're
sized for **solo, nights-and-weekends** work, so effort is given in rough "weekend" units. Every
phase has a goal, a scope, and a **"Done when"** checklist so you always know when to move on.

Don't try to do it all at once. **Phases 0–2 are the ones that actually block commercialization**
(clean base → Supabase + isolated sessions → accounts) — everything else is easier once those land.

---

## 1. Where the app is today

**Current stack:** Next.js 16, React 19, **Supabase** (Postgres + Realtime + Row-Level Security),
Tailwind CSS 4. _(Migrated off Firebase Firestore 2026-07-04; unused `framer-motion` removed.)_

**Still to come on Supabase:** payments via Edge Functions (Phase 3). _(Authentication and
owner-scoped authorization landed 2026-08-03 — rooms have owners, RLS is owner-aware, and organizers
can lock a room. Google sign-in is wired but needs OAuth credentials; see Phase 2.)_

**What it does:** One live "room" where an organizer adds players (with a skill level), sets 1–6
courts, builds a queue, and auto-picks fair, skill-matched groups of 4. It tracks games played,
supports batch-add, shuffle-teams, delete-all, and syncs in real time across devices.

**What's genuinely good:**

- Real-time multi-device sync works — Supabase Realtime (Postgres Changes) now drives it, replacing
  the Firestore `onSnapshot` subscription with no change in behaviour for users.
- The auto-pick logic is thoughtful — fewest games played first, then keeps the four players within
  one skill band, with a sensible fallback. **This logic is DB-agnostic and carries over as-is.**
- Confirmation modals on destructive actions; clean Tailwind UI; batch import.

**The core limitation — now resolved:** it *was* built as a **single, shared room for one club**
(`sessionId` hardcoded to `"club-session-1"`). As of 2026-07-04 this is fixed: the Supabase migration
shipped a multi-tenant schema with shareable-code rooms (`/s/CODE`), so every club runs an
independent, real-time room. This was the spine of the roadmap — Phase 1 is done.

---

## 2. Audit findings

Grouped by severity. Locations reference the current `app/page.tsx` unless noted. Each item notes
**→ how the plan fixes it** (most map to the Supabase migration).

> **Status (2026-07-04):** Phases 0 & 1 shipped, resolving **C1, H1, H2, H3, M1, M2, M3, M4** and the
> low-severity **metadata**, **dark-mode**, and **framer-motion** items. **C2** is partially
> addressed — RLS is enabled on every table, but with a permissive capability-URL policy (any
> anon-key holder can read/write any room; a room's only gate is its unguessable code); it tightens
> to owner-scoped RLS in Phase 2. **C3** (auth) and **C4** (payments) remain (Phases 2–3).
>
> **Status (2026-08-03):** **C3 is resolved** — every room now has an `owner_id` backed by a real
> `auth.users` row, so Phase 3 has something to hang an entitlement on. **C2 is closed as far as the
> product allows**: the blanket `using (true)` policies are gone, replaced by owner-aware policies
> plus column-level grants that make `owner_id` / `share_code` / `locked` unwritable through the API.
> An *unlocked* room's contents are still reachable by anyone with the code — that is the deliberate
> product choice (club night needs shared editing), and the per-room **lock** is the opt-in ceiling
> for organizers who want one. **C4** (payments) remains (Phase 3).

### 🔴 Critical — these block commercialization outright

| # | Finding | Where | Why it matters → Fix |
|---|---------|-------|----------------------|
| C1 | **Every user shares ONE session.** `sessionId` is hardcoded to `"club-session-1"`. | `page.tsx:89` | Any two clubs read/write the **same** row and overwrite each other. → **Phase 1**: multi-tenant Supabase schema (`sessions` table) + shareable codes. |
| C2 | **No database security rules.** No `firestore.rules` exists. | repo (verified absent) | The DB is currently unprotected. → **Phases 1–2**: **Supabase Row-Level Security (RLS)** scoped first to session, then to authenticated owner. RLS replaces Firestore rules and is more powerful. |
| C3 | **No authentication.** No concept of a user. | whole app | Can't identify who paid or who owns what. → **Phase 2**: **Supabase Auth** (built in — no separate provider needed). |
| C4 | **No payment or entitlement layer.** | — | Nothing to sell or gate yet. → **Phase 3**: `entitlements`/`plan` in Postgres + a webhook (Supabase Edge Function). |

> **Note on public keys:** exposing Firebase's `apiKey` today — and Supabase's `anon` key after the
> migration — is **normal and expected**. Both are public identifiers, not secrets; the real
> protection is **RLS + Auth**, which is exactly what we're adding. Don't waste time "hiding" keys.

### 🟠 High — will bite you as soon as you have real, concurrent users

| # | Finding | Where | Why it matters → Fix |
|---|---------|-------|----------------------|
| H1 | **Read-modify-write on the whole document.** Every action rebuilds the full `players`/`queue`/`games` arrays from local state and writes them back. | via `updateSession` | Two organizers acting at once = **lost updates**. → **Largely resolved by Phase 1**: with relational rows you mutate specific records, and Postgres handles concurrency with row locking / transactions. |
| H2 | **Everything lives in one growing document.** | data model | Firestore's 1 MiB doc limit; every write re-sends the whole doc. → **Resolved by Phase 1**: separate `sessions` / `players` / `games` tables, no document-size ceiling. |
| H3 | **Config is hardcoded, not env-driven.** No `process.env` usage. | `firebase.ts` | Blocks clean dev/prod split. → **Phase 0**: move Supabase URL + anon key to `NEXT_PUBLIC_*` env vars. |

### 🟡 Medium — quality and maintainability

| # | Finding | Where | Why it matters → Fix |
|---|---------|-------|----------------------|
| M1 | **No error handling on any DB call.** | all writes | Failures are silent; the organizer thinks it saved. → **Phase 0**: try/catch + a small toast. Applies equally to Supabase calls. |
| M2 | **IDs use `Math.random`** (9-char base36). | `page.tsx:160` | Collision-prone. → **Resolved by Phase 1**: Postgres generates keys (`uuid default gen_random_uuid()`). |
| M3 | **`useEffect` missing-dependency warning** (`sessionRef`). | `page.tsx:138` | Benign now, a footgun once the session ID is dynamic. → **Phase 0** during refactor. |
| M4 | **Monolithic 867-line `page.tsx`.** | `page.tsx` | UI, state, logic, and data access all in one component. → **Phase 0**: split into components, `types.ts`, a `useSession` hook, and a **data-access service module** (this makes the Supabase swap a near drop-in). |
| M5 | **No match results / history / scores.** | data model | Limits your best paid features. → **Phase 4**, made easy by the relational schema. |
| M6 | **No persistent roster.** "Delete All" wipes everything. | app | Clubs re-enter the same people weekly. → **Phase 4** (a `players` table tied to the owner makes this trivial). |

### ⚪ Low — polish for a professional launch

- **Metadata:** description is still `"Generated by create next app"`; README is the default template. Set real title/description/OG tags.
- **Dark-mode bug:** `globals.css` defines dark background vars, but `body` forces black text and cards are `bg-white` — broken in dark mode. Fix or disable.
- **Accessibility:** emoji-as-icons, low-contrast text, missing `aria-label`s, unlabeled number input — **largely addressed 2026-07-06** (aria labels/roles, dialog semantics, disclosure menu, WCAG-AA contrast). _Remaining before launch:_ full modal focus-trapping / return-focus.
- **No landing / pricing pages** — the app boots straight into the tool (Phase 4).
- **No analytics, error monitoring, or PWA/offline** — all matter for a professional launch, especially offline resilience (courtside wifi is unreliable). _(Automated **tests + CI** now exist — a vitest suite of pure-logic + local-Supabase RPC tests runs on every PR via GitHub Actions.)_

**Verification run:** `tsc --noEmit` passes clean; `eslint` reports only the one `useEffect`
warning (M3); no security-rules file found; no `process.env` usage; `framer-motion` confirmed unused.

---

## 3. Product & monetization strategy

### The model

**Free tier + one-time paid "Pro" unlock.** You've chosen a one-time purchase to lower the barrier
and attract users — a reasonable launch strategy for an indie tool.

**One honest caveat to keep in view (not to act on yet):** a one-time price earns revenue *once*,
but cloud costs recur *forever* per retained user. At small scale this is a non-issue — Supabase's
free tier will likely cover you. Two cheap insurance policies for later:

1. **Keep the free tier genuinely limited** so free users stay cheap to serve.
2. **Store the plan as a field** (`plan: "free" | "pro"`), *not* a boolean — so a future
   subscription or team tier needs no migration.

> **Supabase free-tier reality check:** 500 MB database, 50k monthly active auth users, 200
> concurrent realtime connections, 2M realtime messages/month — ample for early clubs. **Gotcha:**
> free projects **pause after ~1 week of inactivity**, so once you have real users you'll want the
> $25/mo Pro plan (or a scheduled keep-alive ping). Budget for that around launch.

### Who pays

The **organizer / session host** pays. Players never need an account — they just watch the screen
or open a shared room. Keep player-side friction at zero.

### Recommended free vs Pro split

Free should be enough to run *one small club night* and fall in love. Pro should be what a *regular*
organizer needs.

| Capability | Free | Pro (one-time) |
|---|:---:|:---:|
| Core queue + auto-pick | ✅ | ✅ |
| Courts | up to 2 | unlimited (up to 6+) |
| Players per session | ~16 | unlimited |
| Saved sessions | 1 | multiple / named |
| Persistent player roster (reuse weekly) | — | ✅ |
| Match history & score tracking | — | ✅ |
| Stats (games played, fairness, win/loss) | basic | full |
| Courtside "TV mode" big-screen display | — | ✅ |
| CSV export | — | ✅ |
| Custom skill labels / club name | — | ✅ |

_(Exact limits are a starting point — validate against how real clubs use it.)_

### Pricing

A one-time unlock in the **~$20–40** range (adjust for region) is a sensible starting hypothesis.
Consider a lower **founder's price** at launch to seed reviews. Keep it simple: **one unlock per
account.** Treat the number as a hypothesis to test.

### Payment mechanics (Supabase-native)

- **Recommended: a merchant-of-record** — **Lemon Squeezy** or **Paddle** — so global sales tax /
  VAT is handled for you (a real burden lifted off a solo developer).
- **Alternative:** **Stripe Checkout** (one-time mode) — more control, but you own tax compliance.
- **Flow:** checkout succeeds → provider webhook hits a **Supabase Edge Function** → the function
  (using the service-role key) sets `plan: "pro"` on the user's row / `entitlements` table → the
  client reads the entitlement via RLS-protected query and unlocks features. Refunds flip it back to
  `free`. Nice bonus: the webhook lives on the same platform as your DB.

---

## 4. The roadmap

**Status legend:** ⬜ Not started · 🟨 In progress · ✅ Done
**Effort:** rough "weekend" units for solo, part-time work.

---

### Phase 0 — Foundations & safety `✅`  *(DB-agnostic — done 2026-07-04)*

**Goal:** clean up the current app so the Supabase migration is a smooth swap, not a rewrite.

**Scope**

- **Refactor** `page.tsx` into components (`Court`, `Queue`, `PlayerList`, modals), a `types.ts`, a
  `useSession` hook, and — most important — a **single data-access service module** that wraps every
  read/write. Migrating to Supabase then means changing *one* module, not the whole app (M4).
- Add **error handling + a small toast** around every data write (M1).
- Fix the **`useEffect` dependency** warning (M3).
- Move config to **env vars** (`NEXT_PUBLIC_*`) (H3).
- Housekeeping: real **metadata**, rewrite the **README**, fix the **dark-mode** conflict, remove
  unused **framer-motion**.
- **Security note:** since this is a new, not-yet-public app, don't invest in hardening the current
  Firestore — just keep it private until Phase 1. (If you *do* expose it before migrating, add a
  temporary locked-down rule.)

**Done when:** all data access goes through one service module; writes fail gracefully with user
feedback; no config inline; app builds clean.

**✅ Done (2026-07-04):** `page.tsx` split into `CourtBoard` / `QueuePanel` / `PlayerList` / modals /
`ui` components, a `useSession` hook, `lib/types.ts` + `lib/constants.ts` + `lib/logic.ts`, and the
single data-access module `lib/sessionStore.ts`. Per-write `try/catch` surfacing a dismissible error
banner; `useEffect` dep fixed; config moved to `NEXT_PUBLIC_*`; dark-mode conflict fixed; real
metadata; README rewritten; `framer-motion` removed. `tsc` / `eslint` / `build` all clean.

**Effort:** ~2 weekends.

---

### Phase 1 — Migrate to Supabase + multi-tenant schema `✅`  *(the critical unlock — done 2026-07-04)*

**Goal:** move onto Supabase **and** fix the single-shared-session problem in one move, by designing
the schema multi-tenant from day one. Fixes **C1, H1, H2** together.

**Scope**

- Stand up a **Supabase project**; add the client SDK; wire the anon key via env.
- Design the **relational schema**, multi-tenant from the start:
  - `sessions` (id, share_code, courts, owner_id [nullable until Phase 2], created_at)
  - `players` (id, session_id → sessions, name, skill, games_played)
  - `games` / `court_state` (id, session_id, court_no, player_ids / positions)
  - (roster/results tables come later)
- Point the **Phase 0 data-access module** at Supabase; replace the `onSnapshot` subscription with a
  **Supabase Realtime** subscription on the session's rows.
- **Shareable rooms via code/URL** (e.g. `/s/ABC123`) — no login required yet. Create a room, share
  the link, everyone who opens it joins the same live room.
- Turn on **Row-Level Security** with an initial policy scoped to the session/share-code.
- Migrate the auto-pick, queue, and games logic unchanged (it's pure client logic).

**Done when:** two browsers with different codes have fully independent, real-time state; the global
`club-session-1` doc is gone; RLS is on; the app runs entirely on Supabase.

**✅ Done (2026-07-04):** Two-table schema `sessions` + `players`, where a player's `status` /
`queue_position` / `court_no` / `court_slot` columns carry queue and court state (simpler than the
separate `games`/`court_state` table originally sketched; a match-history table stays a Phase 4
concern). RLS on with the capability-URL policy; Supabase Realtime (Postgres Changes filtered by
`session_id`, with `REPLICA IDENTITY FULL` so filtered DELETEs propagate) replaced `onSnapshot`; a
create/join landing plus `/s/CODE` rooms; the auto-pick / queue / games logic carried over unchanged.
`useSession` also refetches after each write for resilience if realtime lags. Verified end-to-end
against the live DB (CRUD, RLS, constraints, cascade, realtime INSERT/UPDATE/DELETE). **Bonus:**
migrations auto-apply on Vercel **production** builds via a gated build step (`supabase db push`).

**Effort:** ~3–4 weekends (the biggest phase — new schema + realtime + routing).

---

### Phase 2 — Accounts & ownership `✅`  *(done 2026-08-03)*

**Goal:** organizers get a persistent identity so data and entitlements attach to them (C3), and
RLS can enforce real ownership (C2).

**Scope**

- Add **Supabase Auth** (email magic-link and/or Google — lowest friction). Support anonymous →
  account upgrade so people can try before signing up.
- Set `sessions.owner_id` on creation; add a **"My sessions"** list.
- Tighten **RLS**: owners manage their sessions; shared-code users operate or view-only (decide the
  role model).
- **Harden multi-row writes** `✅ 2026-07-06` — `startGame` / `enqueue` / `shuffleQueueFront` /
  `setCourts` are now **transactional Postgres RPCs** (one transaction + a per-session advisory lock),
  so a partial failure can't leave half-applied state and concurrent organizers can't clobber each
  other. Landed ahead of the rest of Phase 2; see the 2026-07-06 changelog entry.

**Done when:** a user signs in, creates and saves multiple sessions tied to their account, and RLS
stops anyone editing sessions they don't own.

**✅ Done (2026-08-03):** ownership, the room lock, owner-aware RLS, column grants, "My rooms", and
Google sign-in. The migration is applied to production and both providers are live there
(`/auth/v1/settings` reports `anonymous_users: true`, `google: true`).

Verified end-to-end against the **production** project, not just locally — anonymous sign-in, room
creation with `owner_id`, a stranger editing an unlocked room (the club-night guarantee), the owner
locking it, the stranger then being blocked (42501), the owner still editing, an ownership-hijack
attempt rejected by the column grants (42501), and the room appearing under "My rooms".

_Config note:_ `supabase/config.toml` governs the **local** stack only — production auth is
configured in the dashboard. For local Google testing, set
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET`, flip `[auth.external.google] enabled = true`,
and add `http://localhost:3000/**` to the dashboard's **Redirect URLs**.

Email magic-link remains a deliberate later addition.

**Effort:** ~2 weekends (Supabase Auth + RLS does most of the heavy lifting).

---

### Phase 3 — Free vs Paid + payments `⬜`

**Goal:** actually sell the Pro unlock (C4).

**Scope**

- **Entitlement model:** a `plan` column (or `entitlements` table) on the user, read via
  RLS-protected query to gate features (a field, not a boolean — future-proofing).
- Build the **feature gates** for the split in §3 (court/player limits, multiple sessions, etc.).
- **Checkout:** Lemon Squeezy / Paddle (recommended) or Stripe; a **Supabase Edge Function** webhook
  verifies the purchase and sets `plan: "pro"`.
- Handle **restore / verify** across devices and **refunds** (flip back to free).
- Add a **pricing page** and upgrade CTAs at each gate.

**Done when:** a test purchase flips the account to Pro and unlocks features; free limits are
enforced; the entitlement survives refresh and works across devices.

**Effort:** ~3 weekends.

---

### Phase 4 — Make it feel professional `⬜`

**Goal:** the things that make strangers trust it, enjoy it, and tell other clubs.

**Scope**

- **Landing page** (what it is, screenshots, pricing, FAQ), proper metadata/OG, favicon, real name.
- **Onboarding**, empty states, optional sample data.
- **Courtside "TV mode"** — big-screen view of courts + who's up next _(Pro)_.
- **Match history + score tracking + basic stats** _(Pro)_ — add results tables (M5).
- **Persistent roster** — save players between nights _(Pro)_ (M6).
- **CSV export** _(Pro)_.
- **PWA + offline resilience**, mobile-layout polish, and finishing the **a11y pass** (labels / roles / dialog semantics / AA contrast done 2026-07-06; **modal focus-trapping** remains). _(The dark-mode conflict was already resolved in Phase 0.)_

**Done when:** a brand-new user lands, understands it, runs a full club night on their phone, and the
Pro features are genuinely worth paying for.

**Effort:** ongoing — sequence by feedback. ~4–6 weekends, spread out.

---

### Phase 5 — Launch & iterate `⬜`

**Goal:** get real users, learn, improve.

**Scope**

- **Privacy-friendly analytics** + **error monitoring** (e.g. Sentry).
- A **feedback channel** and a lightweight changelog.
- **Launch** to local badminton communities, subreddits, clubs, Product Hunt.
- Watch **free → paid conversion**; tune the split and price. Revisit a subscription/team tier
  **only if** costs or demand justify it.

**Done when:** real clubs use it weekly, you have a feedback loop, and you've made your first sales.

**Effort:** ongoing.

---

## 5. Roadmap at a glance

| Phase | Goal | Unlocks | Effort | Status |
|---|---|---|---|:---:|
| 0 | Foundations & safety (DB-agnostic) | A clean base + easy migration | ~2 wknds | ✅ |
| 1 | **Migrate to Supabase + multi-tenant schema** | Multiple clubs, real DB | ~3–4 wknds | ✅ |
| 2 | Accounts & ownership (Supabase Auth + RLS) | Identity for entitlements | ~2 wknds | ✅ |
| 3 | Free vs Paid + payments | Revenue | ~3 wknds | ⬜ |
| 4 | Professional polish | Trust + Pro value | ~4–6 wknds | ⬜ |
| 5 | Launch & iterate | Users + learning | ongoing | ⬜ |

---

## 6. Quick wins for this weekend

**✅ All done (2026-07-04)** — these landed as part of Phase 0; kept here for the record:

1. **Extract all data access into one service module** — the single highest-leverage step; it turns
   the Supabase swap into a one-file change.
2. **Add error toasts** to every write — stop silent failures (M1).
3. **Fix the dark-mode CSS conflict** — quick visual-credibility win.
4. **Set real page metadata + rewrite the README.**
5. **Remove unused `framer-motion`** (or actually use it).

---

## 7. Decisions & open questions

Track choices here so the "why" isn't lost.

- [x] **Database / backend** — ✅ **Supabase** (Postgres + Auth + Realtime + RLS), replacing Firestore. _(2026-07-03)_
- [ ] **Payment provider** — merchant-of-record (Lemon Squeezy/Paddle) vs Stripe? _(leaning MoR for tax simplicity; webhook runs on Supabase Edge Functions either way)_
- [x] **Auth method** — **Google first**, email magic-link later. Magic links break on phones (the
  link opens in the mail app's in-app browser, so the session lands in the wrong one) and this is a
  phone-first courtside tool. Supabase links identities by email, so adding email later is additive.
  _(2026-08-03)_
- [x] **How a room gets its owner** — **anonymous sign-in on create.** "Create a room" stays one tap;
  the app signs the organizer in anonymously so `owner_id` is set from the first moment, and
  `linkIdentity` later upgrades that same user id to Google without orphaning their rooms. Only room
  *creators* get an `auth.users` row — joiners stay unauthenticated, so MAU tracks organizers, not
  players. _(2026-08-03)_
- [ ] **Free-tier limits** — exact court/player/session caps (validate with real use).
- [ ] **Price point** — the one-time number + whether to run a founder's price.
- [x] **Roles (Phase 1)** — shared-code users can **fully edit** (capability-URL model); a room's
  only gate is its unguessable code. Revisit view-only / owner-only roles in Phase 2. _(2026-07-04)_
- [x] **Roles (Phase 2)** — **open by default, owner-lockable.** Anyone with the code keeps full edit
  rights, because club night depends on it: the tablet by the courts and a co-organizer's phone must
  both be able to queue players, and owner-only editing would make the organizer a bottleneck for the
  whole session. Owners get a per-room **lock** that restricts writes to them alone — a real security
  ceiling when wanted, and a natural Pro feature later. _(2026-08-03)_
- [x] **Migrations on deploy** — auto-applied on Vercel **production** builds via a gated step
  (`supabase db push`); preview/local builds skip so they never touch prod. _(2026-07-04)_
- [ ] **One-time vs subscription** — revisit after launch, once you see real usage costs (and the Supabase Pro $25/mo threshold).

---

## Changelog

- **2026-08-03** — **Phase 2: accounts & ownership.** Rooms now belong to someone. Tapping "Create a
  room" signs the organizer in **anonymously** (`ensureUser` in the new `lib/auth.ts`) and stamps
  `owner_id`, so a room has an owner from the first tap with no sign-in wall; `linkIdentity` later
  upgrades that same user id to Google, so their rooms come with them. Only *creators* get an
  `auth.users` row — opening a shared link never creates an account, keeping MAU to organizers.
  **The Phase 1 blanket `using (true)` policies are gone**, replaced by per-operation owner-aware
  policies and a new per-room **lock**: open by default (the club-night guarantee — the courtside
  tablet and co-organizers keep editing), owner-only once locked. **The subtle part was `set_courts`**:
  it's `SECURITY INVOKER` and writes `sessions`, so a naive owner-scoped UPDATE policy would have
  broken court changes for every non-owner. Fixed with **column-level grants** — UPDATE is granted
  only on `(courts, updated_at)`, leaving `owner_id` / `share_code` / `locked` unwritable through
  PostgREST regardless of the row policy — so `locked` is toggled through a `SECURITY DEFINER`
  `set_room_lock` RPC that re-checks ownership itself. Ownerless rooms (legacy, or whose owner
  deleted their account — `owner_id` is `ON DELETE SET NULL`) deliberately fall back to *open* rather
  than becoming rooms nobody can edit. New **"My rooms"** page (`/rooms`) with owner-only delete, an
  account strip on the landing page, and a lock toggle + read-only mode in the room (a `readOnly`
  prop threaded through `CourtBoard` / `QueuePanel` / `PlayerList` so no control is offered that RLS
  would reject). **TDD'd**: 22 new tests written before the migration across `tests/rls/` and
  `tests/rpc/set_room_lock.test.ts` — including the no-regression case that a stranger can still run
  an unlocked room, and proof that an anonymously signed-in creator gets full ownership powers. All
  49 tests pass and the four pre-existing RPC suites are unchanged. `tsc` / `eslint` clean (also
  eslint-ignored the `supabase/.temp` bundle that `supabase start` generates). The migration was
  then applied to **production** and the whole flow re-verified against the live project — anonymous
  sign-in, owned room creation, a stranger editing an unlocked room, the lock, the stranger being
  blocked, the owner still editing, an ownership-hijack rejection, and "My rooms". **Still
  deferred:** email magic-link sign-in, and a `transfer_room_ownership` RPC for the case where an
  anonymous user links a Google account that already exists.
- **2026-07-06** — **Deferred polish: number-input UX, className merge, and an a11y pass.**
  Cleared three items parked since Phases 0/1. **(1) Games counter** is now a `GamesCounter`
  component — a `type="text"` + `inputMode="numeric"` field (no more native spinner clashing with
  the −/+ buttons) that keeps what you type instead of snapping to 0 mid-edit, commits a clamped
  value on blur/Enter, and floors at 0 so the − stepper can't go negative. Backed by two new pure
  functions (`clampGamesPlayed`, `parseGamesPlayedInput`) in `lib/logic.ts`, **TDD'd** with a new
  `tests/logic/games_played.test.ts`; `useSession.setGamesPlayed` now clamps at the source too.
  **(2) className merge:** a `cn()` helper (`clsx` + `tailwind-merge`) replaces string-concat in the
  `Card`/`Button`/`Input`/`Select` primitives, so a passed class reliably overrides the base —
  also fixed a latent bug where `Input`/`Select` silently *dropped* any passed `className` (e.g. the
  courts `<Select className="w-20">`). Contract covered by `tests/lib/cn.test.ts`. **(3) a11y pass**
  across the interactive surface: associated the courts + join-code labels, `aria-label`ed the games
  input and its steppers, gave the players dropdown a disclosure pattern (`aria-expanded` /
  `aria-haspopup`), marked decorative emoji/SVGs `aria-hidden`, added `role="dialog"` / `aria-modal` /
  `aria-labelledby` + autofocus + Escape-to-close to all three modals (via a shared `useEscapeKey`
  hook), `role="alert"` on error banners, and bumped low-contrast grays to meet WCAG AA. `tsc` /
  `eslint` / `next build` clean; 13 pure-logic tests pass. **Still deferred:** full modal
  focus-trapping / return-focus (autofocus + Escape landed; Tab-cycling within the dialog did not).
- **2026-07-06** — **Auto-pick fairness fix.** `pickFourPlayers` sorted by games played and
  then shuffled the *whole* pool, discarding that ordering — so a player who'd already played
  10 games was just as likely to be auto-picked as one who'd played none. Swapped to the correct
  idiom: **shuffle first, then a *stable* sort** by `gamesPlayed` (JS `Array.prototype.sort` is
  stable, ES2019+), so the pool now runs fewest-games-first with ties still broken randomly.
  Skill-band windowing and the fallback are unchanged. Added the repo's **first pure-logic unit
  test** (`tests/logic/pick_four_players.test.ts`) — DB-free, so it runs under `vitest run`
  without a local Supabase stack — including a regression case that fails on the old ordering
  and passes on the new. Clears the auto-pick fairness tweak deferred on 2026-07-04.
- **2026-07-06** — **Transactional multi-row RPCs shipped** — a Phase 2 hardening item, landed early.
  Replaced the four client-side multi-write mutations (`enqueue`, `startGame`, `shuffleQueueFront`,
  `setCourts`) with `plpgsql` RPCs, each running as one transaction under a per-session advisory lock:
  a partial failure can no longer leave half-applied state, and two organizers acting at once can't
  clobber each other (closes the **H1** read-modify-write race for these paths). Derived values (next
  queue position, first empty court, front four, games+1) are computed inside the transaction; the
  auto-pick skill-matching stays client-side. `SECURITY INVOKER`, so RLS still applies and Phase 2
  owner-scoping is inherited for free. Added the repo's **first automated tests** — a vitest suite
  against a local Supabase stack (per-RPC correctness + two race tests + a rollback/atomicity test,
  each verified to fail without the fix) — and a **GitHub Actions** workflow that runs them on every
  PR. Also made the `anon` / `authenticated` / `service_role` table grants **explicit** so a fresh
  `supabase start` (local + CI) matches production. **Still deferred to Phase 2:** Supabase Auth,
  `owner_id` ownership, and owner-scoped RLS.
- **2026-07-04** — **Phases 0 & 1 shipped.** Refactored `page.tsx` into components + a `useSession`
  hook + `lib/` modules (types, constants, logic, `sessionStore` data-access, `supabase` client).
  Migrated Firestore → Supabase: multi-tenant `sessions` / `players` schema, RLS (capability-URL
  model), Realtime (with `REPLICA IDENTITY FULL`), shareable `/s/CODE` rooms + create/join landing;
  removed Firebase and `framer-motion`; fixed dark-mode, metadata, README, and the `useEffect`
  warning. Added auto-migration on Vercel production builds. Ran a full-branch code review and
  applied the safe fixes (batch line numbers, `getAvailablePlayers` dedupe, `setCourts` write order);
  **deferred:** transactional multi-row RPCs and owner-scoped RLS (Phase 2), the auto-pick fairness
  tweak, the number-input UX, and the `className`-merge cleanup.
- **2026-07-03** — Backend decision: **migrate to Supabase**. Reworked Phase 1 into the Supabase
  migration + multi-tenant schema; auth/authorization now via Supabase Auth + RLS; payment webhook
  via Supabase Edge Functions.
- **2026-07-03** — Initial roadmap created from full-codebase audit.
