-- Badminton Queue — accounts & ownership (Phase 2).
--
-- Phase 1 shipped a deliberate placeholder: RLS was ON but every policy was
-- `using (true) with check (true)`, so a room's only gate was its unguessable
-- share code (the capability-URL model). This migration attaches rooms to real
-- accounts and gives owners an opt-in lock.
--
-- The model, in one line: a room is OPEN by default — anyone holding the code
-- edits it, exactly as before — until its owner locks it.
--
-- That default is not laziness; it is the product. On club night the organizer's
-- phone, the tablet by the courts and a co-organizer are all in the same room,
-- and all of them need to add players and start games. Owner-only editing would
-- make the organizer a bottleneck for the whole session. `owner_id` therefore
-- exists to power "My rooms" and Phase 3 entitlements, and the lock is the
-- escape hatch for organizers who want a tighter ceiling.

-- ---------------------------------------------------------------------------
-- Schema. `owner_id` already exists (nullable, added in the init migration).
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists locked boolean not null default false;

-- "My rooms" lists by owner.
create index if not exists sessions_owner_idx on public.sessions (owner_id);

-- ---------------------------------------------------------------------------
-- Editability predicate.
--
-- Note the `owner_id is null` arm. `sessions.owner_id` is ON DELETE SET NULL, so
-- deleting an account leaves its rooms ownerless — and a locked, ownerless room
-- would be editable by nobody at all, including the club still standing on the
-- court. Ownerless rooms therefore fall back to the open capability model.
-- (A CHECK constraint forbidding `locked and owner_id is null` would instead
-- make deleting the account fail outright, which is worse.)
--
-- SECURITY DEFINER so the players policies can consult `sessions` without
-- depending on that table's own SELECT policy.
-- ---------------------------------------------------------------------------
create or replace function public.session_is_editable(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.sessions s
     where s.id = p_session_id
       and (not s.locked or s.owner_id is null or s.owner_id = auth.uid())
  );
$$;

grant execute on function public.session_is_editable(uuid)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row-Level Security — replaces the Phase 1 blanket policies.
-- ---------------------------------------------------------------------------
drop policy if exists sessions_phase1_all on public.sessions;
drop policy if exists players_phase1_all  on public.players;

-- SELECT stays open on both tables. A visitor must be able to resolve a room by
-- its share code before anything is known about them — that is the capability
-- model, and it is intentional. Locking restricts writes, not reads.
create policy sessions_select on public.sessions
  for select to anon, authenticated
  using (true);

-- You may only create a room owned by you (or, for a signed-out visitor, an
-- unowned one). Prevents inserting a room pre-assigned to someone else.
create policy sessions_insert on public.sessions
  for insert to anon, authenticated
  with check (owner_id is null or owner_id = auth.uid());

-- Predicate inlined rather than calling session_is_editable(): these are direct
-- column references on the row being updated, so no subquery is needed.
create policy sessions_update on public.sessions
  for update to anon, authenticated
  using      (not locked or owner_id is null or owner_id = auth.uid())
  with check (not locked or owner_id is null or owner_id = auth.uid());

create policy sessions_delete on public.sessions
  for delete to anon, authenticated
  using (owner_id = auth.uid());

create policy players_select on public.players
  for select to anon, authenticated
  using (true);

create policy players_write on public.players
  for all to anon, authenticated
  using      (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

-- ---------------------------------------------------------------------------
-- Column privileges on `sessions`.
--
-- This is what lets room operations stay open while ownership stays safe.
-- `set_courts` is SECURITY INVOKER, so it must remain writable by non-owners —
-- but `owner_id`, `share_code` and `locked` must never be writable through
-- PostgREST. Column-level grants express that directly, with no per-column RLS
-- logic: an UPDATE touching an ungranted column is rejected outright.
--
-- service_role keeps table-level UPDATE (it bypasses RLS by design, and the
-- test helpers seed through it).
-- ---------------------------------------------------------------------------
revoke update on public.sessions from anon, authenticated;
grant  update (courts, updated_at) on public.sessions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_room_lock: the only way to toggle `locked`, since the column is ungranted.
--
-- SECURITY DEFINER (unlike the Phase 1 RPCs) precisely because it must write a
-- column no caller may write directly — so it re-checks ownership itself rather
-- than inheriting RLS. `set_room_lock` on an unowned or non-existent room
-- matches no rows and raises, so a room can never be locked away from everyone.
-- ---------------------------------------------------------------------------
create or replace function public.set_room_lock(
  p_session_id uuid,
  p_locked boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to lock a room' using errcode = '42501';
  end if;

  update public.sessions
     set locked = p_locked, updated_at = now()
   where id = p_session_id
     and owner_id = auth.uid();

  if not found then
    raise exception 'Only the room owner can change the lock'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.set_room_lock(uuid, boolean) to authenticated;
