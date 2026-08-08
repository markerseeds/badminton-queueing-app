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
applies and ownership rules are inherited for free. The one exception is `set_room_lock`, which is
`SECURITY DEFINER` because it must write a column no caller may write directly — so it re-checks
ownership in its own body.

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
  updated_at)` on `sessions` and nothing else, so `owner_id`, `share_code`, and `locked` cannot be
  written through PostgREST at all. That's what lets `set_courts` stay open to non-owners safely.

`RoomClient`'s `readOnly` flag mirrors `session_is_editable()` in SQL. If you change one, change the
other — the SQL is the real gate, the flag just keeps the UI honest.

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

## Conventions

- Comments explain *why*, not what — the codebase carries its rationale inline, especially around
  RLS, auth, and race safety. Match that density when touching those areas.
- `cn()` ([app/lib/cn.ts](app/lib/cn.ts)) merges class names so a passed utility beats the base one.
  Components in [app/components/ui.tsx](app/components/ui.tsx) all use it.
- Next.js 16: route `params` are async (`Promise<{ code: string }>`).
- Share codes are uppercase, from an unambiguous alphabet (no I/L/O/0/1); routes normalize with
  `.toUpperCase()`.
- `@/*` maps to the repo root in tsconfig, but the code uses relative imports throughout.
