-- Badminton Queue — initial multi-tenant schema (Phase 1).
--
-- Two tables: a `sessions` row per shareable room, and a `players` row per
-- person. A player's status columns (status / queue_position / court_no /
-- court_slot) carry the queue and court state, so no separate games table is
-- needed yet (match history is a Phase 4 concern).

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  share_code  text unique not null,
  courts      int  not null default 3 check (courts between 1 and 6),
  owner_id    uuid references auth.users (id) on delete set null, -- null until Phase 2
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.players (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions (id) on delete cascade,
  name           text not null,
  skill          text not null,
  games_played   int  not null default 0,
  status         text not null default 'idle'
                   check (status in ('idle', 'queued', 'playing')),
  queue_position int,                                   -- ordering while status = 'queued'
  court_no       int,                                   -- court while status = 'playing'
  court_slot     smallint check (court_slot between 0 and 3), -- 0-1 = Team 1, 2-3 = Team 2
  created_at     timestamptz not null default now()
);

create index if not exists players_session_status_idx
  on public.players (session_id, status);

-- Realtime subscriptions filter on session_id (a non-primary-key column). For
-- UPDATE/DELETE, the filter is matched against the row's OLD image, which by
-- default only contains the primary key — so filtered DELETE events would be
-- dropped. FULL replica identity includes every column in that image.
alter table public.sessions replica identity full;
alter table public.players  replica identity full;

-- ---------------------------------------------------------------------------
-- Row-Level Security.
--
-- Phase 1 uses the capability-URL model: RLS is ON, but the anon role may
-- read/write any room. A room's only gate is its long, unguessable share_code.
-- Phase 2 (accounts) tightens these policies to owner_id = auth.uid().
-- ---------------------------------------------------------------------------
alter table public.sessions enable row level security;
alter table public.players  enable row level security;

drop policy if exists sessions_phase1_all on public.sessions;
create policy sessions_phase1_all on public.sessions
  for all to anon, authenticated
  using (true) with check (true);

drop policy if exists players_phase1_all on public.players;
create policy players_phase1_all on public.players
  for all to anon, authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Realtime: publish both tables so clients get Postgres Changes. Each client
-- subscribes filtered by session_id, so it only receives its own room's events.
-- Wrapped so the whole migration is safe to re-run.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;
