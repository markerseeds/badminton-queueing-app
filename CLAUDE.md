# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A real-time badminton court queueing tool for club nights. An organizer creates a room (`/s/CODE`),
adds players with skill levels, sets 1–6 courts, and the app auto-picks fair groups of four. State
syncs live across every device in the room.

Product direction, phase status, and the "why" behind past decisions live in [ROADMAP.md](ROADMAP.md) —
read its **Decisions & open questions** section before changing anything about rooms, auth, or roles.

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run lint           # ESLint
npm test               # full suite (vitest run)
npm run test:watch     # watch mode
```

Local Supabase stack (Docker required — needed for most of the test suite):

```bash
npm run db:start                      # boots the stack, applies supabase/migrations/*
npx supabase status -o env > .env.test  # write connection details the tests read
npm test
npm run db:reset                      # re-apply all migrations from scratch
npm run db:stop
```

Single test file / single test:

```bash
npx vitest run tests/rpc/start_game.test.ts
npx vitest run -t "lets a stranger add, queue and delete players"
```

Only `tests/logic/` and `tests/lib/` run without the local stack; `tests/rpc/` and `tests/rls/` need it.
CI ([.github/workflows/test.yml](.github/workflows/test.yml)) boots the stack and exports the env vars itself.

The local stack listens on **55321–55329**, not the CLI's default 54321–54329, so it can run
alongside another local Supabase project (only one stack can own a port, and every project gets the
same defaults). Local only — CI boots its own stack and production is unaffected — but it does mean
`.env.local` needs the shifted API URL for `npm run dev` against local, and `.env.test` must be
regenerated after any port change.

If DB tests fail *en masse* with 20s timeouts rather than assertion errors, suspect resource
contention rather than your change: vitest runs files in parallel, and a machine hosting a second
Supabase stack — or a `npm run dev` pointed at the local one — can't keep up. Check the failure
*kind* first; timeouts with zero assertion errors is the tell. Then:

```bash
npx vitest run --no-file-parallelism   # whole suite, serialized — the reliable signal
```

That's usually enough. `npx vitest run <one file>` narrows further if it isn't.

## Architecture

### Two containment modules

Everything that touches the database goes through [app/lib/sessionStore.ts](app/lib/sessionStore.ts);
everything that touches Supabase Auth goes through [app/lib/auth.ts](app/lib/auth.ts). No component,
hook, or page calls `supabase.*` directly. Preserve this — a new feature that needs data adds a
function to `sessionStore`, it does not import the client.

Layering: pages/components → [useSession](app/hooks/useSession.ts) / [useAuth](app/hooks/useAuth.ts) → `sessionStore` / `auth` → Supabase.

### The data model is players-only

There is no queue table and no courts table. A `players` row's `status` (`idle` / `queued` / `playing`)
plus `queue_position`, `court_no`, `court_slot` **is** the queue and court state.
`assembleSession()` in `sessionStore` derives the in-memory `SessionState` (`queue[]`, `games[]`) from
those columns each load. So a queue or court feature is almost always a change to player columns and
to `assembleSession`, not a new table.

Row shapes are `snake_case`; the app's types ([app/lib/types.ts](app/lib/types.ts)) are `camelCase`.
`sessionStore` is the only place that translation happens.

### Multi-row writes must be RPCs

Any mutation that reads-then-writes, or touches multiple rows whose consistency matters, lives as a
Postgres function in [supabase/migrations/](supabase/migrations/) — `enqueue_players`, `start_game`,
`shuffle_queue_front`, `set_courts`. Each takes `pg_advisory_xact_lock` on the session id so two
organizers acting at once serialize instead of clobbering each other (two devices tapping "Start game"
must fill different courts, not double-book one).

These are `SECURITY INVOKER` **on purpose**: the function runs as the caller, so table RLS still
applies and ownership rules are inherited for free. Two exceptions are `SECURITY DEFINER`, both
because they write a column no caller may write directly, so each re-checks its own rule in its body:
`set_room_lock` re-checks **ownership**, while `set_room_name` re-checks **editability**
(`session_is_editable`) — a name is content, open to anyone holding the code, where the lock is a
security control. `set_room_name` has a second, independent reason to bypass RLS; see the plan-limits
section below.

Single-row writes (add player, set games played, remove from queue, end game) go through PostgREST
directly and don't need an RPC.

### No optimistic updates

`useSession`'s `act()` wrapper awaits the write, then reloads the whole session; Realtime propagates
the change to *other* devices. Failures surface as a dismissible error banner. A new mutation is added
to the `actions` object in `useSession` and wrapped in `act` — don't hand-roll local state patching.

### Security model: capability URL, open by default, owner-lockable

- **SELECT is open** on both tables to `anon`. A visitor must be able to resolve a share code before
  anything is known about them. Locking restricts writes, never reads.
- **Writes are open by default** even to strangers holding the code. This is the product, not an
  oversight: on club night the organizer's phone, the courtside tablet, and a co-organizer all need
  to edit. Player writes are gated by `session_is_editable(session_id)`.
- **Ownerless rooms stay open.** `owner_id` is `ON DELETE SET NULL`, so a locked room whose owner
  deleted their account would otherwise be editable by nobody. Every predicate carries an
  `owner_id is null` arm. Keep it.
- **Column grants, not policies, protect ownership.** `anon`/`authenticated` hold `UPDATE (courts,
  updated_at)` on `sessions` and nothing else, so `owner_id`, `share_code`, `locked` and `name`
  cannot be written through PostgREST at all. That's what lets `set_courts` stay open to non-owners
  safely.
  `players` is grant-restricted the same way: `UPDATE` covers name, skill, games_played, status,
  queue_position, court_no and court_slot, so `session_id` can't be rewritten to walk a player into
  another room past its player cap.

`RoomClient`'s `readOnly` flag mirrors `session_is_editable()` in SQL. If you change one, change the
other — the SQL is the real gate, the flag just keeps the UI honest.

### Plan limits are a second predicate family, asking a different question

`session_is_editable(session_id)` asks *"may the caller write here?"*. A plan cap asks *"what plan
does this room's **owner** have?"* — with no reference to `auth.uid()`, because the person changing
courts on club night is usually a stranger holding the share code. Don't bolt a plan clause onto
`session_is_editable`; the two answer different questions.

The numbers live in exactly one place, `plan_limits(plan)`. Everything else derives:
`account_plan(user_id)` → the plan on an account, `room_owner_plan(owner_id)` → the same but `null`
owner means **`pro`** (ownerless falls back to permissive, as it does for editing), and
`session_limits(session_id)` / `my_limits()` → what the UI reads so its gates can't drift from the
server's. Retuning a limit should be a one-line migration and nothing else.

**Where each cap lives is forced, not stylistic:**

- **Courts → the `sessions_update` / `sessions_insert` `with check`.** Not inside `set_courts`:
  the column grant above means `courts` is writable straight through PostgREST, so a check in the
  RPC is one `PATCH` from bypass. A `with check` failure also *raises* 42501 (a `using` failure
  silently matches no rows), which is what rolls `set_courts`' player-idling UPDATE back with it.
- **Players → an `AFTER INSERT … FOR EACH STATEMENT` trigger.** `addPlayers` sends the batch as one
  INSERT, and under READ COMMITTED every row is checked against the statement's opening snapshot —
  so a count in a `with check` or a `BEFORE ROW` trigger sees "0 players" for all of them and the
  whole batch lands. Only a statement-level AFTER trigger sees the real total. It takes the same
  `pg_advisory_xact_lock` the RPCs take.
- **Rooms → the `sessions_insert` `with check`**, counting through `owned_room_count()`.

**The court cap's blast radius reaches every other column.** A `with check` is evaluated against the
NEW row on *every* UPDATE, not only ones touching the column it names — so on a **grandfathered** room
(above its owner's cap, which it deliberately keeps) an update that changes something else entirely is
refused 42501 too. RLS can't reference `OLD`, so the clause can't be made conditional on `courts`
actually changing, and a second permissive policy carving out the other column would be a hole:
permissive policies are OR'd and can't be column-scoped, so a court raise would pass through it. This
is why `set_room_name` is a `SECURITY DEFINER` RPC rather than a widened column grant, and why **any
future writable column on `sessions` needs the same treatment.** Characterized by "refuses an
unrelated update to a room already above the cap" in `tests/rls/plan_limits.test.ts`.

**Two asymmetries that will bite you.** RLS policies exempt `service_role` automatically; a trigger
does not, so `enforce_player_limit` checks `current_user` itself — without that, every test helper
seeding a full board breaks. And it is `SECURITY INVOKER` for that reason: inside a `SECURITY
DEFINER` function `current_user` is the function's *owner*, not the caller.

Postgres also refuses transition tables on a multi-event trigger **and** on a trigger with a column
list (`0A000` both ways). That's why there's no `update of session_id` trigger — the column grant
covers it instead, at no cost to the hot paths.

### Auth: anonymous-on-create only

`ensureUser()` is called from exactly one place — `createSession`. Creating a room signs the organizer
in anonymously so the room has an owner from the first tap with no sign-up wall; `linkIdentity` later
upgrades that same user id to Google, so their rooms come with them. **Someone who merely opens a
shared link stays unauthenticated** — that's deliberate (MAU counts organizers, not players). Don't
add `ensureUser` calls to join or view paths.

### Pure logic stays pure

[app/lib/logic.ts](app/lib/logic.ts) is DB-agnostic and unit-tested. In `pickFourPlayers` the order of
operations matters: shuffle first, *then* a stable sort by games played, so ties break randomly while
the list still runs fewest-games-first. Don't "simplify" that into one comparator.

## Migrations

Timestamped SQL in `supabase/migrations/`, applied locally by `npm run db:reset` and auto-pushed on
Vercel **production** builds only ([scripts/vercel-migrate.mjs](scripts/vercel-migrate.mjs), gated on
`VERCEL_ENV`). A failed migration aborts the build.

Write every migration to be safely re-runnable (`if not exists`, `drop policy if exists`, `do $$` blocks
for publication changes) — they get replayed against fresh stacks constantly.

A new table needs three things the local stack won't give you for free:

1. `replica identity full` — Realtime filters on `session_id`, a non-PK column, and filtered
   UPDATE/DELETE events are matched against the OLD image, which otherwise holds only the PK.
2. added to the `supabase_realtime` publication.
3. explicit `grant`s to `anon`/`authenticated`/`service_role` — `supabase start` does not reproduce
   Supabase's platform default privileges, so without them local and CI have no DML at all.

## Tests

- `tests/logic/`, `tests/lib/` — pure unit tests, no DB.
- `tests/rpc/` — RPC behavior, called through the anon client so the real RLS path is exercised.
- `tests/rls/` — policy enforcement (ownership, locking, column grants).

Environment is `node`, not jsdom — there are no component tests, and adding one means adding a DOM
environment first.

[tests/helpers/db.ts](tests/helpers/db.ts) provides four clients. The convention: **act** through
`anonClient` / `authedClient` / `anonSignedInClient` (real RLS), **seed and verify** through
`serviceClient` (bypasses RLS). Tests that create users must delete them in `afterEach`.

RLS semantics gotcha that shapes assertions: a blocked INSERT raises `42501`, but a blocked
UPDATE/DELETE simply matches **no rows and returns no error**. Assert that nothing changed, not that
an error came back. (`deleteRoom` in `sessionStore` translates this into a real error for the UI.)

## Styling: tokens in CSS, layout in JSX

[app/globals.css](app/globals.css) holds the whole design system. The visual spec it implements is
[docs/design/redesign-mockup.html](docs/design/redesign-mockup.html) — an interactive mockup whose
`--mk-*` variables are a 1:1 rename of the `--bq-*` ones here, so the two stay diffable.

**One rule decides where a style goes:**

> If the mockup gave it a class name, it's a component class in `globals.css`. If it appears once,
> it's Tailwind utilities in the JSX. Tokens are only ever colours and fonts.

That split is forced, not stylistic. `@theme` exposes **only `--color-*` and `--font-*`**, because
those are the two namespaces `tailwind-merge` arbitrates for names it has never seen — `bg-surface`
correctly conflicts with `bg-danger`. A `--radius-card` would produce a `rounded-card` that does
*not* conflict with `rounded-lg` (both survive, stylesheet order decides), and a `--text-lbl` is
worse: tailwind-merge scores an unknown `text-*` as a colour, so a later `text-ink` would silently
delete the font size. Radius, shadow and sizing therefore stay raw `--bq-*` variables used by the
component classes; from JSX reach them as `rounded-(--bq-radius)`, which *is* arbitrated.
[tests/lib/cn.test.ts](tests/lib/cn.test.ts) pins all of this down — read it before adding a token.

`@theme inline` is load-bearing: it makes `bg-surface` compile to `background-color:
var(--bq-surface)` rather than `var(--color-surface)`, which is what lets the dark block re-point
every utility with **no `dark:` variants anywhere**. Plain `@theme` would snapshot the light value.

Dark mode follows the OS. The `[data-theme]` blocks are a dormant hook for a future toggle; the dark
values are deliberately duplicated between the media query and the attribute selector because CSS
can't share a block between them — **edit both**.

Tailwind declares `@layer theme, base, components, utilities`, so a utility passed through `cn()`
beats any component class regardless of specificity. That's why `cn("prow-acts", readOnly &&
"hidden")` works, and why base rules must stay inside `@layer base`.

## Conventions

- Comments explain *why*, not what — the codebase carries its rationale inline, especially around
  RLS, auth, and race safety. Match that density when touching those areas.
- `cn()` ([app/lib/cn.ts](app/lib/cn.ts)) merges class names so a passed utility beats the base one.
  Components in [app/components/ui.tsx](app/components/ui.tsx) all use it. `Button` takes a
  `variant` (`primary` / `ghost` / `quiet` / `danger` / `dangerSolid`) rather than a raw colour
  class; the variants are registered with tailwind-merge so a passed one still wins.
- Every touch target clears 44px (`--bq-touch`). Steppers relax to 34px from `md` up, where the
  input is a mouse. Don't reintroduce a control shorter than that on a phone.
- `Player.skill` is a plain `string`, not the `Skill` union, so a row can hold a band outside
  `SKILLS`. Anything that renders or offers a skill goes through
  [app/lib/skillDisplay.ts](app/lib/skillDisplay.ts), which keeps the legacy value visible instead
  of silently demoting it.
- Next.js 16: route `params` are async (`Promise<{ code: string }>`).
- Share codes are uppercase, from an unambiguous alphabet (no I/L/O/0/1); routes normalize with
  `.toUpperCase()`.
- `@/*` maps to the repo root in tsconfig, but the code uses relative imports throughout.
