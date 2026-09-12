-- Room names.
--
-- A room's only identity was its share code — deliberately unguessable, and so
-- necessarily unmemorable. `name` is an optional label on top of it. The code
-- stays the address; the name is never one.

alter table public.sessions
  add column if not exists name text;

-- "No name" gets exactly one representation (null), so no rendering surface has
-- to tell null from "". The btrim arm keeps stored names tidy enough to drop
-- straight into a flex row, and 60 chars makes it a headline, not a description.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_name_check'
  ) then
    alter table public.sessions
      add constraint sessions_name_check
      check (name is null
             or (char_length(name) between 1 and 60 and btrim(name) = name));
  end if;
end $$;

-- Renaming is open to anyone holding the code, gated only by the room lock —
-- the same rule as the court count and player names. A name is content, not a
-- security control; `locked` and `owner_id` are the security controls.
--
-- SECURITY DEFINER is forced twice over.
--
-- (1) `name` sits outside the column-level UPDATE grant Phase 2 installed
--     (`courts, updated_at`), so PostgREST cannot write it at all. Same reason
--     `set_room_lock` is DEFINER — and the grant is deliberately left alone, so
--     this function stays the only door.
--
-- (2) The sharper one. `sessions_update`'s with-check carries the Phase 3a plan
--     court cap, and a with-check is evaluated against the NEW row on EVERY
--     update — not only ones that touch the column it names. A room
--     grandfathered above its owner's cap (6 courts on free, which is where
--     three existing rooms sit) therefore fails `courts <= max_courts` on a
--     pure rename and is refused 42501, on a room the product deliberately lets
--     keep its courts. A policy cannot reference OLD, so the clause cannot be
--     made conditional on `courts` actually changing. Running as the definer
--     sidesteps the policy and re-checks only what a rename implicates.
--     Characterized by "refuses an unrelated update to a room already above the
--     cap" in tests/rls/plan_limits.test.ts.
--
-- And the repair that looks obvious but is a security hole: a *second*
-- permissive UPDATE policy carving out renames would not work, because
-- permissive policies for the same command are OR'd together and cannot be
-- scoped to a column — a `PATCH {"courts": 6}` would simply pass through the
-- new policy instead of the capped one. Restrictive policies only AND, so they
-- can't help either. There is no policy-level fix; that is what leaves the RPC.
--
-- No `pg_advisory_xact_lock`: the other RPCs take one because they read then
-- write across rows. This is a single-row blind write with nothing to race.
create or replace function public.set_room_name(
  p_session_id uuid,
  p_name text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  -- Checked separately from editability so a deleted room and a locked one
  -- don't collapse into the same message — `session_is_editable()` returns
  -- false for both.
  select exists (select 1 from public.sessions where id = p_session_id)
    into v_exists;
  if not v_exists then
    raise exception 'That room no longer exists' using errcode = 'P0002';
  end if;

  -- The same predicate the players policy uses, so a rename is gated exactly as
  -- a player edit is: open to anyone with the code, closed once locked, and
  -- still open on an ownerless room.
  if not public.session_is_editable(p_session_id) then
    raise exception 'This room is locked by its organizer'
      using errcode = '42501';
  end if;

  update public.sessions
     -- A blank name clears it. The client normalizes first (normalizeRoomName),
     -- so this only catches a caller that didn't; the length arm of the CHECK
     -- is left to raise rather than silently truncating someone's name.
     set name = nullif(btrim(p_name), ''),
         updated_at = now()
   where id = p_session_id;
end;
$$;

grant execute on function public.set_room_name(uuid, text)
  to anon, authenticated, service_role;
