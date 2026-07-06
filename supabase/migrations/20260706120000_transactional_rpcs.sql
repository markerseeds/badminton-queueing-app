-- Transactional, race-safe RPCs replacing the client's multi-row writes.
--
-- Each function body is one implicit transaction (all-or-nothing) and takes a
-- per-session transaction-level advisory lock, so concurrent organizers acting
-- on the same room serialize instead of clobbering each other (audit H1).
-- SECURITY INVOKER (the default): the function runs as the calling role, so
-- table RLS still applies and Phase 2 owner-scoping is inherited for free.

-- enqueue_players: append the given players to the back of the queue, in order.
create or replace function public.enqueue_players(
  p_session_id uuid,
  p_player_ids uuid[]
) returns void
language plpgsql
security invoker
as $$
declare
  start_pos int;
begin
  if array_length(p_player_ids, 1) is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));
  select coalesce(max(queue_position), -1) + 1
    into start_pos
    from public.players
   where session_id = p_session_id and status = 'queued';
  update public.players p
     set status = 'queued',
         queue_position = start_pos + (o.ord::int - 1),
         court_no = null,
         court_slot = null
    from unnest(p_player_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.session_id = p_session_id;
end;
$$;

grant execute on function public.enqueue_players(uuid, uuid[])
  to anon, authenticated, service_role;

-- start_game: move the front four of the queue onto the first empty court.
-- The court and the four players are chosen inside the transaction (under the
-- advisory lock), so two organizers starting a game at once fill different
-- courts instead of double-booking. No-op if there is no empty court or fewer
-- than four players are queued (mirrors the client-side guard).
create or replace function public.start_game(
  p_session_id uuid
) returns void
language plpgsql
security invoker
as $$
declare
  n_courts int;
  target_court int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select courts into n_courts from public.sessions where id = p_session_id;
  if n_courts is null then
    return;
  end if;

  select g.court
    into target_court
    from generate_series(1, n_courts) as g(court)
   where not exists (
     select 1 from public.players
      where session_id = p_session_id
        and status = 'playing'
        and court_no = g.court)
   order by g.court
   limit 1;
  if target_court is null then
    return;
  end if;

  if (select count(*) from public.players
       where session_id = p_session_id and status = 'queued') < 4 then
    return;
  end if;

  with front4 as (
    select id, (row_number() over (order by queue_position))::int - 1 as slot
      from public.players
     where session_id = p_session_id and status = 'queued'
     order by queue_position
     limit 4
  )
  update public.players p
     set status = 'playing',
         court_no = target_court,
         court_slot = f.slot,
         games_played = p.games_played + 1,
         queue_position = null
    from front4 f
   where p.id = f.id;
end;
$$;

grant execute on function public.start_game(uuid)
  to anon, authenticated, service_role;

-- shuffle_queue_front: randomly permute which player holds each of the front
-- p_size queue positions, leaving the rest of the queue untouched. No-op if
-- fewer than p_size players are queued.
create or replace function public.shuffle_queue_front(
  p_session_id uuid,
  p_size int default 4
) returns void
language plpgsql
security invoker
as $$
declare
  cnt int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  select count(*) into cnt
    from public.players
   where session_id = p_session_id and status = 'queued';
  if cnt < p_size then
    return;
  end if;

  with front as (
    select id, queue_position
      from public.players
     where session_id = p_session_id and status = 'queued'
     order by queue_position
     limit p_size
  ),
  slots as (
    select queue_position,
           row_number() over (order by queue_position) as rn
      from front
  ),
  shuffled as (
    select id, row_number() over (order by random()) as rn
      from front
  )
  update public.players p
     set queue_position = s.queue_position
    from shuffled sh
    join slots s on s.rn = sh.rn
   where p.id = sh.id;
end;
$$;

grant execute on function public.shuffle_queue_front(uuid, int)
  to anon, authenticated, service_role;

-- set_courts: change the court count, idling any players left on courts that no
-- longer exist. Both writes happen in one transaction, so a failure (e.g. the
-- `courts` check constraint) can't leave players idled on a still-valid layout.
create or replace function public.set_courts(
  p_session_id uuid,
  p_courts int
) returns void
language plpgsql
security invoker
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text, 0));

  update public.players
     set status = 'idle', court_no = null, court_slot = null
   where session_id = p_session_id
     and status = 'playing'
     and court_no > p_courts;

  update public.sessions
     set courts = p_courts, updated_at = now()
   where id = p_session_id;
end;
$$;

grant execute on function public.set_courts(uuid, int)
  to anon, authenticated, service_role;
