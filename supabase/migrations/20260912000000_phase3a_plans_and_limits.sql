-- ---------------------------------------------------------------------------
-- Phase 3a — entitlements and server-enforced free-tier limits.
--
--   free → 2 courts, 10 players per room, 2 saved rooms
--   pro  → 6 courts (the sessions CHECK ceiling), unlimited players and rooms
--
-- Nothing here sells anything. `pro` is writable only by service_role, which is
-- where the Phase 3c checkout function will sit; this migration builds the gate
-- that function will flip.
--
-- The rule every predicate below encodes: **a limit follows the room's OWNER,
-- not the caller.** `session_is_editable()` asks "may *you* write here?"; a cap
-- asks "what plan does this room's owner have?" — with no reference to
-- auth.uid() at all, because on club night the person changing courts is
-- usually a stranger holding the share code, and set_courts stays open to them
-- on purpose.
-- ---------------------------------------------------------------------------

create table if not exists public.entitlements (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  plan       text not null default 'free' check (plan in ('free', 'pro')),
  updated_at timestamptz not null default now()
);

-- RLS on with NO policies and NO grant to anon/authenticated, so the table is
-- unreachable through PostgREST in either direction. Same philosophy as the
-- ungranted `locked` column: make the wrong write impossible rather than merely
-- denied. Everything a client legitimately needs comes from the SECURITY
-- DEFINER accessors below, which expose ceilings without exposing who is on
-- which plan — and receipts / provider customer ids, when Phase 3c adds them,
-- get their own table rather than joining this one.
--
-- Deliberately NOT given `replica identity full` and NOT added to the
-- supabase_realtime publication. CLAUDE.md's three-step rule for new tables is
-- about tables the client subscribes to; nothing subscribes to this one, and
-- while upgrades are manual a plan change need not reach an open room live.
alter table public.entitlements enable row level security;

grant select, insert, update, delete on public.entitlements to service_role;

-- ---------------------------------------------------------------------------
-- The limits themselves, and the two questions asked of them.
-- ---------------------------------------------------------------------------

-- The single place the numbers live. `immutable` so the planner can fold it
-- into the policy predicates below.
--
-- Pro's court ceiling is 6 rather than "unlimited" because sessions.courts
-- carries `check (courts between 1 and 6)` from Phase 1 — a higher number here
-- would be a limit the table rejects anyway.
create or replace function public.plan_limits(p_plan text)
returns table (max_courts int, max_players int, max_rooms int)
language sql
immutable
as $$
  select t.max_courts, t.max_players, t.max_rooms
    from (values
      ('free', 2, 10,         2),
      ('pro',  6, 2147483647, 2147483647)
    ) as t(plan, max_courts, max_players, max_rooms)
   where t.plan = coalesce(p_plan, 'free');
$$;

-- The plan on an ACCOUNT. No row (or no such user) means free.
--
-- SECURITY DEFINER so a policy — and the trigger further down — can consult
-- `entitlements` without any caller holding SELECT on it.
create or replace function public.account_plan(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select e.plan from public.entitlements e where e.user_id = p_user_id),
    'free');
$$;

-- The plan a ROOM is judged by. Differs from account_plan() in exactly one way,
-- and that difference is the point of the separate name: an ownerless room
-- resolves to 'pro'.
--
-- `sessions.owner_id` is ON DELETE SET NULL, so deleting an account leaves its
-- rooms ownerless. Falling back to 'free' there would truncate a club from 6
-- courts to 2 mid-night, on a room whose owner is already gone — so ownerless
-- falls back to permissive, never punitive, exactly as the `owner_id is null`
-- arm in session_is_editable() already does for editing. The abuse route that
-- would otherwise open (minting ownerless rooms straight against the API) is
-- closed below by dropping that same arm from sessions_insert, where it is
-- *not* right.
create or replace function public.room_owner_plan(p_owner_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner_id is null then 'pro'
    else public.account_plan(p_owner_id)
  end;
$$;

-- SECURITY DEFINER for the same reason session_is_editable() is: a policy that
-- subqueries its own table would otherwise depend on that table's SELECT policy.
create or replace function public.owned_room_count(p_owner_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.sessions where owner_id = p_owner_id;
$$;

-- What the room UI reads, so the gates it renders cannot drift from the gates
-- the policies enforce — the same relationship `readOnly` has to
-- session_is_editable(). SECURITY DEFINER so a stranger holding the share code
-- learns the room's ceilings without learning whose account they belong to.
create or replace function public.session_limits(p_session_id uuid)
returns table (plan text, max_courts int, max_players int)
language sql
stable
security definer
set search_path = public
as $$
  select p.plan, l.max_courts, l.max_players
    from public.sessions s
    cross join lateral (select public.room_owner_plan(s.owner_id) as plan) p
    cross join lateral public.plan_limits(p.plan) l
   where s.id = p_session_id;
$$;

-- What "My rooms" reads. Uses account_plan() rather than room_owner_plan() on
-- purpose: the latter's null arm means "ownerless room", and reusing it here
-- would quietly hand Pro limits to a caller with no session at all. A signed-out
-- caller gets no row rather than a default.
create or replace function public.my_limits()
returns table (plan text, max_courts int, max_players int, max_rooms int)
language sql
stable
security definer
set search_path = public
as $$
  select p.plan, l.max_courts, l.max_players, l.max_rooms
    from (select public.account_plan(auth.uid()) as plan
           where auth.uid() is not null) p
    cross join lateral public.plan_limits(p.plan) l;
$$;

-- A function called inside an RLS policy runs as the invoking role, so EXECUTE
-- must be granted even on the ones only policies call (cf. session_is_editable).
grant execute on function public.plan_limits(text)      to anon, authenticated, service_role;
grant execute on function public.account_plan(uuid)     to anon, authenticated, service_role;
grant execute on function public.room_owner_plan(uuid)  to anon, authenticated, service_role;
grant execute on function public.owned_room_count(uuid) to anon, authenticated, service_role;
grant execute on function public.session_limits(uuid)   to anon, authenticated, service_role;
grant execute on function public.my_limits()            to authenticated, service_role;

-- A new room has to be legal for a free account, and 3 courts no longer is.
alter table public.sessions alter column courts set default 2;

-- ---------------------------------------------------------------------------
-- Court and room caps: in the sessions policies, NOT inside set_courts.
--
-- set_courts is not the only way to write `courts`. Phase 2 granted
-- anon/authenticated a column-level UPDATE (courts, updated_at) — that is what
-- lets the RPC stay SECURITY INVOKER and open to non-owners — and the side
-- effect is that `courts` is writable straight through PostgREST. A check
-- inside the function would be one PATCH away from being bypassed. A `with
-- check` on the policy covers both paths with one predicate.
--
-- Being a `with check` rather than a `using` also makes the failure honest: a
-- `using` miss matches no rows silently, while a with-check violation raises
-- 42501 — which is what rolls set_courts' player-idling UPDATE back along with
-- the court change, instead of leaving players idled on a layout that never
-- changed.
--
-- These are policies rather than triggers on purpose: policies exempt
-- service_role automatically, which both the test helpers and the Phase 3c
-- webhook need. (The player cap below cannot be a policy, and pays for that
-- with an explicit exemption.)
-- ---------------------------------------------------------------------------
drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to anon, authenticated
  with check (
    -- Phase 2 also allowed `owner_id is null`, "for a signed-out visitor".
    -- createSession has always called ensureUser() first, so the app never used
    -- that arm — and now that an ownerless room is an uncapped one, leaving it
    -- would put a free unlimited tier one curl away.
    owner_id = auth.uid()
    and courts <= (select max_courts
                     from public.plan_limits(public.room_owner_plan(owner_id)))
    and public.owned_room_count(auth.uid())
        < (select max_rooms
             from public.plan_limits(public.account_plan(auth.uid())))
  );

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to anon, authenticated
  using      (not locked or owner_id is null or owner_id = auth.uid())
  with check (
    (not locked or owner_id is null or owner_id = auth.uid())
    -- No floor, deliberately. A room already above its cap — created before
    -- these limits existed, or belonging to an account that has since lapsed —
    -- keeps its courts until someone changes them, and can then only ratchet
    -- down. Forcing it down on sight would truncate a club mid-night.
    and courts <= (select max_courts
                     from public.plan_limits(public.room_owner_plan(owner_id)))
  );

-- ---------------------------------------------------------------------------
-- The player cap has to be a statement-level trigger.
--
-- addPlayers() sends a whole batch as ONE insert. Under READ COMMITTED every
-- row of a single statement is checked against the snapshot taken when that
-- statement began, so a count subquery in a `with check` — or in a BEFORE ROW
-- trigger — has all 15 pasted names independently observe "0 players so far,
-- fine", and all 15 land. (Measured: they do.) An AFTER ... FOR EACH STATEMENT
-- trigger runs once, after the rows are in and visible, which is the only place
-- the real total exists.
--
-- SECURITY INVOKER, unlike the accessors above, for two reasons: `current_user`
-- inside a DEFINER function reports the function's owner rather than the
-- caller, which would break the service_role exemption below; and it needs no
-- extra privilege, since the entitlements read is delegated to
-- room_owner_plan() and both sessions and players are `select using (true)`.
--
-- INSERT only. Moving an existing player into a full room would evade an
-- insert-time cap, but the answer to that is the column grant below rather than
-- a second trigger: Postgres refuses transition tables both on multi-event
-- triggers and on triggers with column lists (0A000 either way), so covering
-- the move here would mean firing on *every* UPDATE — taking an advisory lock
-- and two queries on enqueue_players, start_game and the games-played counter,
-- the three hottest writes of a club night.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_player_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  r   record;
  cap int;
  n   int;
begin
  -- The asymmetry worth remembering: RLS policies exempt service_role for free,
  -- a trigger does not. The test helpers seed full boards through it, so the
  -- exemption has to be written out.
  if current_user = 'service_role' then
    return null;
  end if;

  for r in select distinct session_id from inserted loop
    -- The same per-session lock the Phase 1 RPCs take. Without it two devices
    -- adding at once each count only their own rows, both pass at 10, and 11
    -- land. Held to commit, so the second transaction's count sees the first.
    perform pg_advisory_xact_lock(hashtextextended(r.session_id::text, 0));

    select l.max_players
      into cap
      from public.sessions s
      cross join lateral
        public.plan_limits(public.room_owner_plan(s.owner_id)) l
     where s.id = r.session_id;

    -- No such room: leave it to the foreign key to reject.
    if cap is null then
      continue;
    end if;

    select count(*) into n
      from public.players
     where session_id = r.session_id;

    if n > cap then
      raise exception
        'Free rooms are limited to % players — this would make %.', cap, n
        using errcode = '23514';
    end if;
  end loop;

  return null;
end;
$$;

drop trigger if exists players_enforce_limit on public.players;
create trigger players_enforce_limit
  after insert on public.players
  referencing new table as inserted
  for each statement
  execute function public.enforce_player_limit();

-- ---------------------------------------------------------------------------
-- Column privileges on `players` — closing the "move a player into a full room"
-- route the same way Phase 2 closed ownership hijacking on `sessions`: by
-- making the write impossible rather than checking for it.
--
-- Until now `players` carried a plain full-column UPDATE grant gated only by
-- `players_write`. Nothing in the app has ever written `session_id`, `id` or
-- `created_at` — a player belongs to the room they were added to — so revoking
-- them costs nothing and removes the only path by which a room's player count
-- can grow without passing the INSERT trigger above.
--
-- The granted set is exactly what the app writes: name/skill (updatePlayer),
-- games_played (the counter and start_game), and status/queue_position/
-- court_no/court_slot (the queue and court RPCs, which are SECURITY INVOKER and
-- so need the privilege as the caller).
--
-- service_role keeps table-level UPDATE — it bypasses RLS by design and the
-- test helpers seed through it.
-- ---------------------------------------------------------------------------
revoke update on public.players from anon, authenticated;
grant  update (name, skill, games_played, status, queue_position, court_no, court_slot)
  on public.players to anon, authenticated;
