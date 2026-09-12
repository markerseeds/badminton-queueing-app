# Badminton Queue — Product Roadmap

> **Living document.** This is the single source of truth for turning this app from a personal
> tool into a commercial, professional product with a free tier and a one-time paid unlock.
> Update the **Status** columns as you go. Add notes, dates, and decisions at the bottom.
>
> **Backend:** **migrated** from Firebase Firestore → **Supabase** (Postgres + Auth + Realtime
> + Row-Level Security). _Decision 2026-07-03 · migration shipped 2026-07-04._
>
> _Last reviewed: 2026-09-12_

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
>
> **Status (2026-09-12):** **C4 is half closed.** Phase 3a shipped the entitlement layer and the
> feature gates — there is now a `plan` to hang a purchase on, and free-tier limits enforced in
> Postgres rather than in the client. What remains is taking the money: checkout, the webhook that
> writes `plan = 'pro'`, and refunds (Phase 3c).

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
- **Dark-mode bug:** `globals.css` defined dark background vars, but `body` forced black text and cards were `bg-white` — broken in dark mode. **Resolved twice:** Phase 0 took the cheap option and deleted the dark vars; **Phase 2.6 (2026-09-11) built a real dark theme** off design tokens, following the OS.
- **Accessibility:** emoji-as-icons, low-contrast text, missing `aria-label`s, unlabeled number input — **largely addressed 2026-07-06** (aria labels/roles, dialog semantics, disclosure menu, WCAG-AA contrast); **emoji-as-icons cleared 2026-09-11** (replaced by an inline SVG set), and the skill `<select>` became a labelled radio group. _Remaining before launch:_ full modal focus-trapping / return-focus.
- **No landing / pricing pages** — Phase 2.6 gave the landing route a real hero and value proposition, but there is still no **pricing** page and no marketing surface beyond it (Phase 4).
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

### Phase 2.5 — Edit player name & skill `✅`  *(inserted ahead of Phase 3 — done 2026-08-08)*

**Goal:** let an organizer correct a player's name or skill band in place, instead of deleting and
re-adding them.

**Why it jumped the queue.** Slotted in before Phase 3 deliberately, and it earns the slot: skill is
not cosmetic. `getSkillIndex` drives the ±1 band window in `pickFourPlayers`, so a player entered at
the wrong level distorts who they get matched with for the rest of the night. The only remedy was
delete-and-re-add — which discards `games_played`, the very number the fewest-games-first auto-pick
ordering runs on. A typo therefore cost you either fair matching or fair rotation, with no third
option. Cheap to fix, and it makes the tool feel finished in a way that matters before anyone is
asked to pay for it.

**Scope**

- A pencil affordance on each row of the Players panel, opening a small **Edit Player** dialog
  (name field + skill dropdown, Cancel/Save).
- `updatePlayer` in `sessionStore` and a matching `useSession` action.
- `normalizePlayerName` / `normalizeSkill` in `lib/logic.ts`, unit-tested.

**Done when:** an organizer can rename a player and change their skill without losing their games
count; the change reaches other devices; a locked room refuses the edit.

**✅ Done (2026-08-08):** pencil → `EditPlayerModal` (a near-copy of `AddPlayerModal`, seeded from
the player), `sessionStore.updatePlayer`, and a `useSession.updatePlayer` action that re-normalizes
its input and short-circuits a no-op save. **No migration was needed** — and confirming that was most
of the analysis. Unlike `sessions`, whose UPDATE is revoked and re-granted on `(courts, updated_at)`
only, `players` carries a plain full-column grant gated solely by the `players_write` policy's
`session_is_editable(session_id)` predicate, so `name` and `skill` were already writable in an
unlocked room and already blocked in a locked one. Realtime needed nothing either.

**Two subtleties worth remembering.** (1) `Player.skill` is typed `string`, not the `Skill` union, so
rows can hold values outside `SKILLS` — and a native `<select>` handed an unknown value silently
reports its *first* option, meaning a legacy player would have been demoted to "new" just by opening
and saving the dialog. The modal prepends the current value to the option list when it isn't
recognized, and `normalizeSkill` returns an unknown skill unchanged rather than coercing it.
(2) `updatePlayer` uses the `.select("id")`-and-throw idiom from `deleteRoom` rather than a bare
`run()`: a lock-blocked UPDATE matches no rows *without* erroring, so a rename would otherwise appear
to save and then quietly revert on the next reload.

**TDD'd**: the pure-logic tests were written first and watched fail. Two RLS cases added to
`tests/rls/room_ownership.test.ts` — a stranger renaming in an unlocked room (asserting
`games_played` survives, which is the whole point) and being blocked in a locked one (0 rows, no
error — the usual UPDATE semantics).

**Effort:** ~0.5 weekend.

---

### Phase 2.6 — UI redesign: design tokens, dark mode, phone-first layout `✅`  *(done 2026-09-11)*

**Goal:** stop looking like a scaffold before Phase 3 starts asking people for money.

**Why it jumped the queue.** Phase 3 puts a price on this app, and the UI it would have been sold
with had a 24px touch target as its *base button size* (`px-3 py-1`, inherited by every control),
Delete sitting a thumb-width from Queue on every player row, no dark mode at all, and a webfont that
was downloaded on every page load and never rendered — `globals.css` hardcoded `font-family: Arial`
on `body`, overriding the `next/font` wiring. None of that is fatal on its own; together they are
the difference between a tool someone pays $30 for and one they assume is abandoned.

**Scope**

- **Design tokens** in [globals.css](app/globals.css) replacing 39 hardcoded colour utilities spread
  across 11 files — where red meant Team 2 *and* destructive *and* error, and blue meant Team 1
  *and* link.
- **Dark mode**, following the OS. There was none.
- **Phone-first layout rework**: 44px targets throughout, destructive behind an overflow menu, a
  sticky Start-game bar in the thumb zone, courts as a swipe rail, an explicit "up next", and skill
  as an ordinal badge instead of grey lowercase text in brackets.
- Rewritten [ui.tsx](app/components/ui.tsx) primitives with a `variant` API, an SVG icon set
  replacing emoji, and a radio-based skill picker replacing the native `<select>`.

**Done when:** every screen uses tokens, dark mode works, no touch target is under 44px, and
`sessionStore` / the hooks / the migrations are untouched.

**✅ Done (2026-09-11):** all of the above. Direction chosen from a four-way interactive mockup kept
at [docs/design/redesign-mockup.html](docs/design/redesign-mockup.html), which is now the spec —
its `--mk-*` variables are a 1:1 rename of the app's `--bq-*`, so the two stay diffable.

**The subtle part was which tokens can exist at all.** `@theme` exposes only `--color-*` and
`--font-*`, because those are the two namespaces `tailwind-merge` arbitrates for names it has never
seen. A `--radius-card` would generate a `rounded-card` that does *not* conflict with `rounded-lg`
— both survive and stylesheet order decides, silently breaking the `cn()` override contract the
whole component library rests on. A `--text-lbl` is worse: tailwind-merge scores an unknown
`text-*` as a *colour*, so a later `text-ink` deletes the font size with no warning. Radius, shadow
and sizing therefore stay raw variables consumed by component classes. Second subtlety:
`@theme inline` is load-bearing — it compiles `bg-surface` to `var(--bq-surface)` rather than
`var(--color-surface)`, which is the only reason re-pointing a variable under a dark selector
reaches the utilities. Plain `@theme` would have snapshotted the light value and dark mode would
have silently done nothing.

**Two regressions caught before they shipped.** The mockup replaced the games counter with static
text, dropping the typeable input and its `parseGamesPlayedInput` / `clampGamesPlayed` backing —
kept the input instead. And the mockup's six-button skill grid had no slot for a band outside
`SKILLS`; the old `<select>` needed a special case there because it silently reports its first
option for an unknown value, and while a radio grid can't demote silently, it *can* show six
unselected bands and tell the organizer nothing. New [skillDisplay.ts](app/lib/skillDisplay.ts)
renders an out-of-range band as its own option, derived from the saved value rather than the current
selection so a mis-tap is recoverable.

**Also fixed:** the Geist/Arial bug — and note the trap, since deleting the Arial line alone is not
enough. Preflight sets `font-family` on `html` while `next/font` put the variable on `<body>`, so
the declaration was invalid at computed-value time; the variables moved to `<html>` and the
fallbacks moved inside the `var()`.

**TDD'd**: 6 `cn()` assertions written first and watched fail on the button-variant case, plus 14
`skillDisplay` tests. 35 pure tests pass, up from 21. `tsc` / `eslint` / `next build` clean.

**Deliberately not done:** TV mode (a new route and a Phase 4 *Pro* feature — building it now means
shipping a paid feature free, then taking it away), a manual theme toggle (the `[data-theme]` hooks
ship dormant so it's purely additive later), and the QR code / per-court timers the mockup's footer
already marks out of scope.

**Follow-up (2026-09-11):** the loading placeholders this phase tokenised were measured *invisible*
— `bg-surface-2` against the ground is 1.21:1 in dark and 1.05:1 in light, and `animate-pulse` moves
opacity only. Fixed with a `.skel` component class, and the dormant reduced-motion block turned out
to have real teeth; see the changelog entry of the same date.

**Effort:** ~1 weekend.

---

### Phase 3 — Free vs Paid + payments `🟨`

**Goal:** actually sell the Pro unlock (C4).

**Split into three, 2026-09-12.** What was one phase is really three subsystems, and only the first
is shippable without choosing a payment provider. Splitting them means the free-tier numbers get
validated against real club nights *before* a price is committed to — which is what the open
question in §7 asks for — and keeps every piece runnable in the existing CI, which a checkout flow
would not be.

- **3a — entitlements & server-enforced limits** `✅ 2026-09-12`
- **3b — the identity chain at the paywall** `⬜`
- **3c — checkout, webhook & error monitoring** `⬜`

---

#### Phase 3a — Entitlements & server-enforced limits `✅` *(done 2026-09-12)*

**Goal:** build the gate that Phase 3c's checkout will flip. No money changes hands; `pro` is
writable only by `service_role`, which is enough to exercise every limit end-to-end.

**Shipped:** free = **2 courts, 10 players per room, 2 saved rooms**; pro = 6 courts (the table's
`CHECK` ceiling) and unlimited players and rooms. An `entitlements` table, a `plan_limits()` /
`account_plan()` / `room_owner_plan()` predicate family, `session_limits()` + `my_limits()` as the
UI's honest mirror, a `/pricing` page that reads its own numbers out of `plan_limits()` so it
cannot advertise a ceiling the server would refuse, and upgrade affordances at each gate.

**The rule the whole design encodes:** a limit follows the room's **owner**, not the caller.
`session_is_editable()` asks "may *you* write here?"; a cap asks "what plan does this room's owner
have?" — with no reference to `auth.uid()`, because the person changing courts on club night is
usually a stranger holding the share code and `set_courts` stays open to them on purpose.

**Three mechanics that were forced rather than chosen** — each one a wrong turn avoided:

1. **The court cap cannot live inside `set_courts`.** Phase 2 granted `anon`/`authenticated` a
   column-level `UPDATE (courts, updated_at)` — that is what lets the RPC stay `SECURITY INVOKER`
   and open to non-owners — so `courts` is writable straight through PostgREST and a check inside
   the function would be one `PATCH` away from bypass. It lives in the `sessions_update`
   `with check`, which covers both paths. Being a `with check` rather than a `using` also makes the
   failure honest: a `using` miss matches no rows silently, while a with-check violation raises
   42501 and takes `set_courts`' player-idling UPDATE down with it. *(Verified over HTTP: a direct
   `PATCH {"courts":5}` on a free room is refused.)*
2. **The player cap cannot be a `with check` or a `BEFORE ROW` trigger.** `addPlayers` sends the
   batch as one INSERT, and under READ COMMITTED every row is checked against the statement's
   opening snapshot — so all 15 pasted names independently see "0 players, fine" and all land.
   **Measured, not assumed:** the test was written first and watched do exactly that. It needs an
   `AFTER … FOR EACH STATEMENT` trigger, which is the only place the real total exists.
3. **Policies for courts and rooms, a trigger for players — and the asymmetry costs a line.**
   Policies exempt `service_role` automatically, which the test helpers and the Phase 3c webhook
   both need; a trigger does not, so the exemption is written out in its body.

**Two things Postgres refused along the way**, both worth remembering: transition tables can't be
used on a multi-event trigger, *or* on a trigger with a column list (`0A000` either way). So the
"move a player into a full room" route is closed by a **column grant** instead — `players` had a
plain full-column UPDATE grant, and `session_id` / `id` / `created_at` are now revoked, since
nothing has ever written them. Same mechanism Phase 2 used for `owner_id`, and it costs nothing on
`enqueue_players` / `start_game` / the games counter, which a catch-all UPDATE trigger would have
taxed all night.

**Also settled:** an **ownerless room resolves to `pro`**, for the same reason it falls back to
*open* for editing — a deleted account shouldn't truncate a club from 6 courts to 2 mid-night. That
is only safe because `sessions_insert` **lost its `owner_id is null` arm** in the same migration;
otherwise a free unlimited tier would be one `curl` away. The arm stays in the *editability*
predicates, where it is still right.

**Grandfathering:** a room above its cap keeps its courts until someone changes them, then ratchets
down. The stepper's `−` jumps straight to the ceiling rather than one step at a time, because every
intermediate value is still over the cap and would be rejected the whole way down.

**TDD'd**: `tests/rls/plan_limits.test.ts` written first and watched fail — 16 cases including the
bulk-insert one above, both directions of "the owner's plan, not the caller's", the ownerless
carve-out, the grandfathered ratchet, and the `service_role` exemption. **89 tests pass**, up from
73. One pre-existing test needed the owner marked Pro: its subject is a stranger being *allowed* to
act, not the cap. `tsc` / `eslint` / `next build` clean, and the gates re-verified over real HTTP.

**Deliberately not done:** anything that takes money (3b/3c below), and publishing `entitlements` to
Realtime — while upgrades are manual a plan change need not reach an open room live, though 3c will
want it.

**Nobody is grandfathered, including the author** _(decided 2026-09-12, at deploy)_. Every existing
account starts on free, and no `pro` row is seeded. Two reasons: these numbers are an explicit
hypothesis, and the fastest way to find out whether 2 courts and 10 players actually fit a club
night is to run one under them; and a grandfathered cohort would be permanently invisible in the
data, indistinguishable from people who paid once 3c ships. The cost is real — existing rooms sit
above their cap until someone lowers them (they keep playing; see the ratchet above) — and it is
accepted rather than overlooked.

---

#### Phase 3b — The identity chain at the paywall `⬜`

Claim tickets, `transfer_room_ownership`, just-in-time sign-in at the gate, and the
`plan = 'pro' ⇒ is_anonymous = false` invariant. All three are settled in §7 — see _Paying requires
a real account_, _When the sign-in happens_ and _Rooms follow the sign-in_. Also fixes the known gap
where linking a Google account that already exists drops rooms off "My rooms".

---

#### Phase 3c — Checkout, webhook & error monitoring `⬜`

**Before starting.** Two structural things are easy to get wrong and cheaper to settle first:

- **There is no `supabase/functions/` yet**, and [vercel-migrate.mjs](scripts/vercel-migrate.mjs)
  only runs `db push` — so function deploys and `supabase secrets set` need their own build step.
  `supabase/config.toml` also has no `[functions.*]` block, so a webhook endpoint needing
  `verify_jwt = false` (providers can't send a Supabase JWT) has no precedent in the file.
- **Error monitoring belongs before the first sale, not in Phase 5** — a webhook that 500s is a
  customer who paid and got nothing. Pair it with a `webhook_events` table keyed on the provider's
  event id; providers retry, so idempotency is a requirement, and keeping the raw payloads turns
  "I paid and nothing happened" into a two-minute lookup.

**Scope**

- **Checkout:** Lemon Squeezy / Paddle (recommended) or Stripe; a **Supabase Edge Function** webhook
  verifies the purchase and writes `entitlements.plan = 'pro'` with the service-role key. Phase 3a
  already made that the *only* way in: `entitlements` has RLS on, no policies, and no DML grant to
  `anon`/`authenticated`. Provider customer ids and receipt data go in their own table with an
  owner-only policy, **not** on `sessions` — `sessions_select` is `using (true)`, so anything stored
  there is world-readable.
- Assert the **`plan = 'pro' ⇒ is_anonymous = false`** invariant in the function, not only the UI, so
  a replayed webhook or a hand-made checkout URL can't violate it (needs 3b).
- Handle **restore / verify** across devices and **refunds** (flip back to free).
- Publish `entitlements` to Realtime, or reload on upgrade — Phase 3a left it unpublished because a
  manual plan change needn't reach an open room live, but a purchase should.
- Wire the `/pricing` page's Pro card to real checkout (the page, its limits and the upgrade
  affordances at each gate already exist).

**Done when:** a test purchase flips the account to Pro and unlocks features; the entitlement
survives refresh and works across devices; a replayed webhook is a no-op.

**Effort:** ~2 weekends (3a took the gates off the top).

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
- **PWA + offline resilience**, and finishing the **a11y pass** (labels / roles / dialog semantics / AA contrast done 2026-07-06, emoji icons replaced 2026-09-11; **modal focus-trapping** remains). _(Mobile-layout polish and dark mode both landed in Phase 2.6 — don't re-scope them here.)_

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
| 2.5 | Edit player name & skill _(inserted)_ | Fix a typo without losing games played | ~0.5 wknd | ✅ |
| 2.6 | **UI redesign** _(inserted)_ | Tokens, dark mode, 44px targets — something you can charge for | ~1 wknd | ✅ |
| 3a | **Entitlements & server-enforced limits** | Something to sell, and gates that hold | ~1 wknd | ✅ |
| 3b | Identity chain at the paywall | A purchase that survives the browser | ~1 wknd | ⬜ |
| 3c | Checkout, webhook & error monitoring | Revenue | ~2 wknds | ⬜ |
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
- [x] **Paying requires a real account** — **anonymous accounts are permanently free tier.** An
  anonymous user is a real `auth.users` row with no email and no credential; its only proof of
  identity is a refresh token in one browser's `localStorage`. Attaching a one-time purchase to that
  means the purchase dies with the browser profile — cleared site data, a new phone, or Safari's ITP
  evicting script-written storage after ~7 days idle — and nothing can recover it afterwards, because
  the merchant knows an email the database has never seen. There is no join key. So the invariant is
  **`plan = 'pro'` implies `is_anonymous = false`**, asserted in the checkout Edge Function and not
  only in the UI, so a replayed webhook or a hand-made checkout URL can't violate it. _(2026-09-11)_
- [x] **When the sign-in happens — at the paywall, just-in-time.** No earlier nudge: anonymous
  organizers use the app exactly as they do today until they hit a gate. Accepted cost: the entire
  identity chain (OAuth redirect → `linkIdentity` → possible fallback → room transfer) then runs at
  the worst possible moment — courtside, mid-session, wanting a third court *now* — so a hiccup there
  costs the sale rather than costing nothing. Chosen anyway, to keep the zero-friction create path
  undiluted. Revisit if conversion at the gate turns out poor. _(2026-09-11)_
- [x] **Rooms follow the sign-in** — when `linkIdentity` falls back to a plain sign-in (because the
  Google account already exists as its own user), every room owned by the discarded anonymous id
  moves to the account just signed into. **Not keyed off the share code** — a code proves *access*,
  not ownership, so that would be exactly the hijack the column grants exist to block. Instead the
  anonymous user writes a single-use, expiring claim ticket *before* the redirect (RLS forces
  `from_user_id = auth.uid()`, so the row's existence is the proof); afterwards a `SECURITY DEFINER`
  RPC redeems the nonce and reassigns `owner_id`. `SECURITY DEFINER` is forced regardless — `owner_id`
  is ungranted at the column level, so PostgREST cannot write it at all. Moves **all** her rooms, not
  just the one she's standing in, and runs before checkout, so there is no window in which she is Pro
  but the room in front of her is not. _(2026-09-11)_
- [x] **What plan does an ownerless room get? — `pro`.** `owner_id` is `ON DELETE SET NULL`, so a
  Pro owner deleting their account leaves rooms with no owner and therefore no plan. Falling back to
  *free* would truncate a club from 6 courts to 2 mid-night, on a room whose owner is already gone;
  ownerless therefore falls back to permissive, never punitive, exactly as it already does for
  *editing*. That is only safe because `sessions_insert` lost its `owner_id is null` arm in the same
  migration — otherwise an uncapped room would be mintable by anyone straight against the API. The
  arm stays in the *editability* predicates, where it is still right. _(2026-09-12)_
- [x] **Free-tier limits — 2 courts, 10 players per room, 2 saved rooms.** Deliberately tighter than
  the table in §3 sketched (2/16/1), on the reasoning in §3 that a free tier has to stay cheap to
  serve when the revenue is one-time. Still a hypothesis: they live in one `plan_limits()` function
  and nothing else — not the policies, not the UI, not the pricing page — so re-tuning them after
  real club nights is a one-line migration. Note the consequence that forced a second change: a free
  cap of 2 made `createSession`'s hardcoded `courts: 3` illegal, so new rooms now start at 2 and
  every pre-existing room is above its cap (it keeps its courts, and ratchets down). _(2026-09-12)_
- [ ] **Price point** — the one-time number + whether to run a founder's price.
- [x] **Roles (Phase 1)** — shared-code users can **fully edit** (capability-URL model); a room's
  only gate is its unguessable code. Revisit view-only / owner-only roles in Phase 2. _(2026-07-04)_
- [x] **Roles (Phase 2)** — **open by default, owner-lockable.** Anyone with the code keeps full edit
  rights, because club night depends on it: the tablet by the courts and a co-organizer's phone must
  both be able to queue players, and owner-only editing would make the organizer a bottleneck for the
  whole session. Owners get a per-room **lock** that restricts writes to them alone — a real security
  ceiling when wanted, and a natural Pro feature later. _(2026-08-03)_
- [x] **Editing a player — pencil opens a modal, not an inline field.** The games counter on the
  same row edits inline, so inline was the obvious parallel — but the row is a `p-3` card with
  Queue/Delete already on it, two per line at `sm:`, and a text field plus a skill dropdown don't fit
  on a phone. The deciding argument was semantics, not space: commit-on-blur is unambiguous for a
  number, but for a `<select>` it isn't, and a mistyped rename with no Cancel is a worse failure than
  a mistyped games count. Scope is the **Players panel only** — queued and on-court players aren't
  listed there, so they stay uneditable until their game ends. Revisit if that bites in practice.
  _(2026-08-08)_
- [x] **A loading placeholder must be legible with no motion at all.** `globals.css` applies
  `animation-duration: 0.01ms !important` to everything under `prefers-reduced-motion`, and a
  component class can't outrank it. Worse, that doesn't *stop* an infinite animation — it samples it
  at an arbitrary point every frame, which flickers. So a skeleton's **colour** has to carry the
  meaning on its own, and any animation is decoration layered on top, removable with `display: none`
  (a property that block doesn't touch). Hence `.skel` is a static fill plus a sweep on `::after`,
  never an animated background, and any future animation in this codebase inherits the same
  constraint. `--bq-skel` / `--bq-skel-hi` also stay out of `@theme` deliberately: a `bg-skel`
  utility would let someone paint a static box that looks like a loading bar without being one.
  _(2026-09-11)_
- [x] **Migrations on deploy** — auto-applied on Vercel **production** builds via a gated step
  (`supabase db push`); preview/local builds skip so they never touch prod. _(2026-07-04)_
- [ ] **One-time vs subscription** — revisit after launch, once you see real usage costs (and the Supabase Pro $25/mo threshold).

---

## Changelog

- **2026-09-12** — **Phase 3a: entitlements and server-enforced free-tier limits.** The app now has
  something to sell and gates that hold. Free gets **2 courts, 10 players per room, 2 saved rooms**;
  Pro lifts all three. New `entitlements` table, writable only by `service_role` — RLS on, no
  policies, no DML grant to `anon`/`authenticated` at all, the same "make the wrong write impossible"
  philosophy as the ungranted `locked` column — plus a `plan_limits()` / `account_plan()` /
  `room_owner_plan()` predicate family and `session_limits()` / `my_limits()` as the UI's mirror, the
  way `readOnly` mirrors `session_is_editable()`. **The rule underneath all of it:** a limit follows
  the room's *owner*, not the caller, because the person changing courts on club night is usually a
  stranger holding the code. **Three mechanics were forced, not chosen.** (1) The court cap can't
  live in `set_courts`: Phase 2's column-level `UPDATE (courts, updated_at)` grant means `courts` is
  writable straight through PostgREST, so a check in the RPC is one `PATCH` from bypass — it lives in
  the `sessions_update` `with check`, which also raises 42501 instead of silently matching no rows,
  taking the RPC's player-idling UPDATE down with it. (2) The player cap can't be a `with check` or a
  `BEFORE ROW` trigger: `addPlayers` is one INSERT, and under READ COMMITTED all 15 pasted names see
  the statement's opening snapshot and all land — **measured first, then fixed** with an
  `AFTER … FOR EACH STATEMENT` trigger. (3) Courts and rooms are policies but players is a trigger,
  and policies exempt `service_role` automatically while a trigger does not — so that exemption is
  written out, or every helper that seeds a full board breaks. **Two Postgres refusals worth
  remembering:** transition tables are rejected on a multi-event trigger *and* on one with a column
  list (`0A000`), so "move a player into a full room" is closed by **revoking the `session_id`
  column grant** instead — nothing has ever written it, and a catch-all UPDATE trigger would have
  taxed `enqueue_players` / `start_game` / the games counter all night. **Also:** an ownerless room
  resolves to `pro` (a deleted account shouldn't truncate a club mid-night), which is only safe
  because `sessions_insert` lost its `owner_id is null` arm in the same migration; `createSession`
  now starts rooms at 2 courts, since 3 is no longer legal on free; and `/pricing` reads its own
  numbers out of `plan_limits()` so it can't advertise a ceiling the server would refuse. **TDD'd**:
  `tests/rls/plan_limits.test.ts` written first and watched fail — 16 cases, including both
  directions of owner-not-caller, the ownerless carve-out, the grandfathered ratchet and the
  `service_role` exemption. 89 tests pass, up from 73; one pre-existing test needed its owner marked
  Pro, since its subject is a stranger being *allowed* to act. `tsc` / `eslint` / `next build` clean,
  and the gates re-verified over real HTTP — including that the direct `PATCH {"courts":5}` bypass is
  refused. New: `app/pricing/page.tsx`, `app/components/LimitNote.tsx`. **Deliberately not done:**
  anything that takes money, grandfathering existing accounts into Pro, and publishing `entitlements`
  to Realtime. **Unrelated but discovered:** local ports moved off the CLI's `5432x` defaults to
  `5532x` so this stack can coexist with another local Supabase project (local only — CI and
  production are untouched), and the DB suite is **flaky under file parallelism on a machine running
  two stacks** — proven pre-existing by reproducing it on the pre-Phase-3a schema, so it is a
  resource-contention problem, not a regression.
- **2026-09-11** — **Loading states that actually read as loading.** The `/rooms` placeholder
  rendered as two blank rounded rectangles. It used `bg-surface-2` — the *recessed* tone — with no
  border, plus Tailwind's `animate-pulse`, which animates opacity only. Measured, the bar sat at
  **1.21:1** against the dark ground and **1.05:1** against the light one: an empty box in *both*
  themes, not just dark. Replaced by a `.skel` class carrying a static fill plus a travelling sheen
  on `::after`. **That split is forced, not stylistic** — the global `prefers-reduced-motion` block
  sets `animation-duration: 0.01ms !important`, which a component class cannot outrank, and which
  does not *stop* an infinite animation but samples it at an arbitrary point every frame. So the
  fill has to carry the state alone, and the sheen is removed with `display: none`, a property that
  block doesn't touch. The `/rooms` placeholder **reuses `.roomrow` itself**, so surface, border and
  the 4rem height can't drift from the real row and nothing shifts when the rows land; bars are
  sized to the content they wait on (an 8-char share code is 88px, not 72px). **Also fixed a real
  bug this exposed:** on a failed fetch `rooms` stayed `null` forever, so the error banner and an
  animating skeleton sat on screen together indefinitely — the skeleton is now gated on there being
  no error, and the banner gained a **Try again**, where the only way out had been a page reload.
  Same treatment on `RoomClient`, and on `AccountBar`'s reserved strip — the other blank patch while
  auth resolved. No migration, no `sessionStore`, no hooks, no `@theme` change. **Verified** beyond
  `eslint` / 35 pure tests / `next build`: against the *built* CSS, `--bq-skel` appears 3× (light
  plus **both** dark blocks — the duplication trap the file warns about) and `bq-skel-sweep` 2×,
  confirming `@keyframes` survives inside `@layer components`. Not verified: how it looks — there
  are no component tests and the environment is `node`. **Deliberately not done:** shortening the
  wait itself (`useAuth` resolves `getUser()`, then `listMyRooms` runs its *own* before the select,
  and `AccountBar` a third — three auth round-trips, two of them in series ahead of the query; safe
  to collapse, since `sessions_select` is `using (true)` and the `.eq("owner_id", …)` filter is not
  the security boundary, but it touches both containment modules and is its own change), a
  `Skeleton` primitive in `ui.tsx`, and a delay before showing the skeleton to avoid a flash on fast
  loads.
- **2026-09-11** — **Phase 2.6 (inserted): the UI redesign.** Design tokens in `globals.css`
  replace 39 hardcoded colour utilities across 11 files, ending the collisions where red meant Team
  2 *and* destructive *and* error; dark mode exists for the first time, following the OS; every
  touch target clears 44px, up from the `px-3 py-1` (~24px) base every control used to inherit;
  Delete moves off the player row into an overflow menu, away from the Queue button it sat beside;
  Start Game gets a sticky bar in the thumb zone; courts become a swipe rail on a phone; "up next"
  is stated rather than inferred from row tinting; and skill becomes an ordinal badge instead of
  grey lowercase text in brackets. Also: the Geist webfont now actually renders — it had been
  downloaded on every page load and overridden by a hardcoded `font-family: Arial` since Phase 0.
  **The subtle part was which tokens can exist**: `@theme` exposes only `--color-*` and `--font-*`,
  because those are the only namespaces `tailwind-merge` arbitrates for unknown names. A
  `--radius-card` would produce a `rounded-card` that doesn't conflict with `rounded-lg`, quietly
  breaking the `cn()` override contract; a `--text-lbl` is worse, since tailwind-merge scores an
  unknown `text-*` as a colour and a later `text-ink` would delete the font size. And `@theme
  inline` is what makes dark mode possible at all — it compiles `bg-surface` to `var(--bq-surface)`
  rather than `var(--color-surface)`, so re-pointing one variable moves every utility, with zero
  `dark:` variants in the codebase. **Two regressions caught before shipping**: the mockup had
  quietly dropped the typeable games counter, and its six-button skill grid had no slot for a band
  outside `SKILLS` — new `lib/skillDisplay.ts` keeps a legacy value visible and recoverable.
  **TDD'd**: `cn()` assertions written first and watched fail on the button-variant case, plus 14
  `skillDisplay` tests; 35 pure tests pass, up from 21. New: `icons.tsx`, `SkillBadge.tsx`,
  `SkillPicker.tsx`, `lib/skillDisplay.ts`, and the four-way mockup at
  `docs/design/redesign-mockup.html` that the direction was chosen from. `sessionStore`, the hooks,
  `logic.ts` and the migrations were not touched. **Deliberately not done:** TV mode (a new route
  and a Phase 4 Pro feature), a manual theme toggle (hooks ship dormant), QR join codes, and
  per-court timers (that one needs a `started_at` column).
- **2026-08-08** — **Phase 2.5 (inserted): edit a player's name and skill.** A pencil on each Players
  row opens an **Edit Player** dialog — name field, skill dropdown, Cancel/Save — so a typo or a
  wrong skill band no longer means delete-and-re-add. That mattered because re-adding resets
  `games_played`, which is what the fewest-games-first auto-pick ordering runs on, while a wrong
  skill distorts the ±1 band window in `pickFourPlayers` all night: previously you could fix the
  matching or keep the rotation fair, never both. **No migration** — `players` turns out to carry a
  plain full-column UPDATE grant gated only by `session_is_editable(session_id)`, unlike `sessions`
  whose UPDATE is column-restricted to `(courts, updated_at)`; `name`/`skill` were already writable
  in an unlocked room and already blocked in a locked one, and Realtime needed nothing. **The subtle
  part was the `<select>`**: `Player.skill` is a plain `string` on purpose so legacy rows can hold
  values outside `SKILLS`, and a native select handed an unknown value silently reports its first
  option — so merely opening and saving the dialog would have demoted such a player to "new". The
  modal prepends the current value when it isn't recognized, and `normalizeSkill` returns an unknown
  skill unchanged instead of coercing it. `updatePlayer` also uses `deleteRoom`'s
  `.select("id")`-and-throw idiom rather than a bare `run()`, because a lock-blocked UPDATE matches
  no rows *without* erroring — a rename would otherwise appear to save and then revert on reload.
  **TDD'd**: 8 pure-logic tests written and watched fail before the helpers existed, plus 2 RLS cases
  (a stranger renaming in an unlocked room, asserting `games_played` survives; and being blocked in a
  locked one). 59 tests pass, up from 49; `tsc` / `eslint` clean. New: `EditPlayerModal.tsx`,
  `tests/logic/player_details.test.ts`. **Deliberately not done:** editing a player who is queued or
  on court — they aren't listed in the Players panel, and putting a pencil on the courtside display
  would clutter the view it exists to keep readable.
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
