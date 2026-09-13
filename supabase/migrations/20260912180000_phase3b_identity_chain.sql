-- ---------------------------------------------------------------------------
-- Phase 3b — the identity chain at the paywall.
--
-- An organizer who taps "Create a room" is signed in anonymously, so the room
-- has an owner from the first tap with no sign-up wall. That identity is a
-- refresh token in one browser's localStorage and nothing else. When she later
-- signs in with Google, one of two things happens:
--
--   * `linkIdentity` upgrades the same auth.users row in place. Her rooms come
--     with her because the user id never changed, and nothing here is needed.
--
--   * The Google account already exists as its own user, so linking is refused
--     and the app falls back to a plain sign-in — a DIFFERENT user id. Every
--     room she owns is now owned by an identity she can never sign in as again.
--     They stay reachable by share code, but they are gone from "My rooms" and
--     she is a stranger to any of them she had locked.
--
-- This migration makes the second case recoverable. Immediately before the
-- anonymous identity is discarded the client writes a single-use claim ticket;
-- afterwards it redeems the nonce and the rooms move in one transaction.
--
-- Not keyed off the share code, which is the obvious shortcut: a code proves
-- ACCESS, not ownership, so keying a transfer off one would be exactly the
-- hijack the Phase 2 column grants exist to block. The ticket's own existence
-- is the proof instead — RLS forces `from_user_id = auth.uid()`, so only the
-- anonymous user herself could ever have written it, and possession of the
-- nonce afterwards is possession of the browser that was her.
-- ---------------------------------------------------------------------------

create table if not exists public.room_claims (
  nonce        uuid primary key,
  from_user_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  -- 24 hours, not one. The single recoverable failure in this flow — the move
  -- would put the target account over its saved-room cap — is fixed by going to
  -- /rooms, deleting a room and coming back, and she is courtside when it
  -- happens. An hour is shorter than "I'll sort that out after the session".
  -- Expiry here is hygiene rather than a control: the nonce is 122 random bits
  -- held only in the originating browser, and the row cannot be read back at
  -- all (see the grants below).
  expires_at   timestamptz not null default now() + interval '24 hours',
  redeemed_at  timestamptz
);

-- No unique index on (from_user_id) where redeemed_at is null, deliberately.
-- "One live ticket per user" describes the intended flow, but enforcing it
-- would turn a lost localStorage stash into a permanent dead end: a client
-- cannot read this table, so it could neither find the live ticket nor mint a
-- replacement. Several tickets naming the same from_user_id are equivalent and
-- redeem idempotently, so allowing them is the safer failure.
--
-- Deliberately NOT given `replica identity full` and NOT added to the
-- supabase_realtime publication, for the same reason `entitlements` wasn't:
-- CLAUDE.md's three-step rule for new tables is about tables a client
-- subscribes to, and nothing subscribes to this one.
alter table public.room_claims enable row level security;

-- The REVOKE is load-bearing, and measuring it corrected an assumption.
--
-- Supabase's stack ships `alter default privileges in schema public grant all
-- on tables to anon, authenticated, service_role` — verified present locally in
-- pg_default_acl, contrary to the note in CLAUDE.md. So a new table in `public`
-- is born with FULL insert/select/update/delete for anon, and a narrow column
-- grant added on top of that restricts precisely nothing. Phase 2 got this
-- right for `sessions` (`revoke update … from anon, authenticated` before
-- `grant update (courts, updated_at)`); without the same revoke here, a client
-- could set its own `expires_at` and mint a permanent standing claim on an
-- identity's rooms.
--
-- Revoking SELECT as well is what makes the refusals honest: with no grant,
-- PostgREST raises 42501, where RLS-with-no-policy would silently match zero
-- rows. Characterized by "refuses to let a client set expires_at" and "refuses
-- to let anyone read a ticket back" in tests/rls/room_claims.test.ts.
revoke all on public.room_claims from anon, authenticated;

-- Column-level INSERT, the same mechanism that protects `owner_id` on sessions.
-- A client may state who it is and nothing else: it cannot mint itself a ticket
-- that never expires, or one that arrives already redeemed. An INSERT touching
-- an ungranted column is rejected at privilege-check time, before RLS.
grant insert (nonce, from_user_id) on public.room_claims to authenticated;
grant select, insert, update, delete on public.room_claims to service_role;

-- Same discovery applied to `entitlements`, which Phase 3a described as having
-- "no DML grant to anon/authenticated at all" — it inherited the full default
-- grant and was protected only by RLS having no policies. That is still a real
-- gate, but the table holds what Phase 3c will sell, and the stated philosophy
-- there is to make the wrong write impossible rather than merely denied. This
-- makes the comment true.
revoke all on public.entitlements from anon, authenticated;

drop policy if exists room_claims_insert on public.room_claims;
create policy room_claims_insert on public.room_claims
  for insert to authenticated
  with check (from_user_id = auth.uid());

-- No SELECT, UPDATE or DELETE policy, and no grant for them — the table is
-- write-only to clients, the same "make the wrong write impossible rather than
-- merely denied" posture as the ungranted `locked` column and the policy-less
-- `entitlements`. It also means a nonce that was never stolen cannot be
-- discovered, because it cannot be read back by anyone holding the anon key.
--
-- The nonce is generated client-side (crypto.randomUUID) precisely so the row
-- never needs reading back: the client already knows the value it wrote, which
-- is what lets this table have no SELECT grant at all.

-- ---------------------------------------------------------------------------
-- transfer_room_ownership: redeem a ticket, move every room it covers.
--
-- SECURITY DEFINER is forced twice over, exactly as it is for set_room_name.
--
-- (1) `owner_id` sits outside the column-level UPDATE grant Phase 2 installed
--     (`courts, updated_at`), so PostgREST cannot write it at all. The grant is
--     deliberately left alone, so this function stays the only door.
--
-- (2) `sessions_update`'s with-check carries the Phase 3a plan court cap, and a
--     with-check is evaluated against the NEW row on EVERY update — not only
--     ones that touch the column it names. A room grandfathered above its
--     owner's cap would therefore refuse an ownership change with 42501, on a
--     room the product deliberately lets keep its courts. Running as the
--     definer sidesteps the policy and re-checks only what a transfer
--     implicates: does this ticket entitle you, and will the rooms fit?
--
-- A transfer can only ever RAISE or hold a room's court ceiling, never lower
-- it: the source is always an anonymous account, an anonymous account is always
-- free (which is precisely what enforce_pro_requires_account below guarantees),
-- and the target is free or better. So no room is ever grandfathered *by* a
-- transfer, and entitlements need no merging — the source can never hold the
-- better plan.
--
-- The room cap is derived from the same three functions `sessions_insert`
-- consults rather than restated, because the numbers live in plan_limits() and
-- nowhere else. Note the off-by-one against that policy: it asks `count < max`
-- because its own row is not in yet, this asks `count + n <= max`.
-- ---------------------------------------------------------------------------
create or replace function public.transfer_room_ownership(p_nonce uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from     uuid;
  v_expires  timestamptz;
  v_redeemed timestamptz;
  v_moving   int;
  v_owned    int;
  v_cap      int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to move your rooms' using errcode = '42501';
  end if;

  -- The read-then-write hazard the Phase 1 RPCs take a lock for, on a different
  -- resource: the room count below is read and then acted on. The key is the
  -- TARGET account, because that is what is being counted. (Same 64-bit hash
  -- space as the per-session locks; a collision costs a wait, not correctness.)
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  select from_user_id, expires_at, redeemed_at
    into v_from, v_expires, v_redeemed
    from public.room_claims
   where nonce = p_nonce
     for update;

  if not found then
    raise exception 'That sign-in has expired — sign in again from the room'
      using errcode = 'P0002';
  end if;

  -- A replay is a no-op, not an error. Two things land here: React's
  -- development double-effect, and a second tab that was open through the same
  -- sign-in. Both mean the work is already done, and "0 more rooms moved" is
  -- the honest answer to both — where raising would show an error after a
  -- transfer that actually succeeded.
  if v_redeemed is not null then
    return 0;
  end if;

  if v_expires <= now() then
    raise exception 'That sign-in has expired — sign in again from the room'
      using errcode = 'P0002';
  end if;

  -- linkIdentity kept the user id after all, or she cancelled at Google and
  -- came back to the same anonymous session. Nothing to move, and the ticket is
  -- left unclaimed in case the real fallback still happens later in this
  -- browser.
  if v_from = auth.uid() then
    return 0;
  end if;

  select count(*) into v_moving
    from public.sessions
   where owner_id = v_from;

  if v_moving = 0 then
    return 0;
  end if;

  v_owned := public.owned_room_count(auth.uid());
  select max_rooms into v_cap
    from public.plan_limits(public.account_plan(auth.uid()));

  -- All or nothing, and it RAISES rather than returning a refusal. Raising is
  -- what guarantees the ticket survives: the exception rolls the transaction
  -- back, so the claim below is undone with it and she can delete a room and
  -- redeem the same nonce. She has to be able to — by the time she sees this
  -- she has already lost the anonymous session, and those rooms are reachable
  -- only by share code. (The claim is also written AFTER this check, so the
  -- property does not rest on rollback alone.)
  --
  -- A partial move was the tempting middle ground and is worse: it would split
  -- one organizer's rooms across two identities, one of which she can no longer
  -- sign in as — so she could not even see what had been left behind.
  if v_owned + v_moving > v_cap then
    raise exception
      'Moving % rooms would put you over your limit of % — delete % first',
      v_moving, v_cap, v_owned + v_moving - v_cap
      using errcode = '23514';
  end if;

  update public.room_claims
     set redeemed_at = now()
   where nonce = p_nonce;

  -- updated_at is bumped on purpose: `sessions` is published to Realtime, so
  -- every device currently open in these rooms reloads and recomputes isOwner —
  -- which is what makes a room she had locked editable by her again.
  update public.sessions
     set owner_id = auth.uid(),
         updated_at = now()
   where owner_id = v_from;

  return v_moving;
end;
$$;

grant execute on function public.transfer_room_ownership(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- plan = 'pro' implies is_anonymous = false.
--
-- An anonymous user is a real auth.users row with no email and no credential;
-- its only proof of identity is a refresh token in one browser. Attaching a
-- one-time purchase to that means the purchase dies with the browser profile,
-- and nothing can recover it afterwards, because the merchant knows an email
-- the database has never seen. There is no join key. (ROADMAP §7, 2026-09-11.)
--
-- Deliberately NOT exempt for service_role — the exact opposite of
-- enforce_player_limit's decision, and for the opposite reason. That trigger
-- exempts service_role because the test helpers and the Phase 3c webhook must
-- be able to seed past a product limit. This one is guarding against the
-- webhook itself: service_role holds the only grant on `entitlements`, so a
-- replayed webhook or a hand-made checkout URL is precisely what could violate
-- the invariant, and there is nothing above service_role to catch it otherwise.
--
-- That is also what frees it to be SECURITY DEFINER. The `current_user` trap —
-- which reports the function's OWNER inside a definer function, and is why
-- enforce_player_limit is INVOKER — only bites a function that needs to know
-- who is calling. This one exempts nobody, so it never asks. And DEFINER is
-- required: none of anon/authenticated/service_role may read auth.users. The
-- JWT claim is no substitute either, since the webhook's JWT belongs to
-- service_role, not to the user whose row it is writing.
--
-- BEFORE INSERT OR UPDATE, not INSERT alone: `entitlements` is written by
-- upsert, so an insert-only trigger would pass the obvious test and still let
-- the `on conflict do update` path through.
--
-- One direction is enough. A user can stop being anonymous (that is the whole
-- point of linkIdentity) but can never become anonymous, so a row that was
-- legal when written stays legal.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_pro_requires_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from auth.users u
     where u.id = new.user_id and u.is_anonymous
  ) then
    raise exception
      'A Pro plan needs a signed-in account — this one is anonymous'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists entitlements_pro_requires_account on public.entitlements;
create trigger entitlements_pro_requires_account
  before insert or update on public.entitlements
  for each row
  -- Keeps the auth.users read off the free path entirely, which is every row
  -- until Phase 3c starts selling anything.
  when (new.plan = 'pro')
  execute function public.enforce_pro_requires_account();
