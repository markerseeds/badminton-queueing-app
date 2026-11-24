-- ---------------------------------------------------------------------------
-- Phase 3c — selling Pro through Paddle.
--
-- Paddle is the merchant of record. The browser never creates a checkout: the
-- create-checkout Edge Function does, after refusing anonymous and already-Pro
-- accounts, and records the Paddle transaction id as a `pending` purchase so a
-- missed webhook can be recovered later. Paddle then reports what happened to
-- that transaction through signed webhooks, and every one of them — plus every
-- "Verify purchase" sync — goes through apply_paddle_event() below.
--
-- **Pro is derived from purchases, never switched on and off.** An account is
-- `pro` exactly when it holds at least one purchase that is completed and not
-- refunded. Recomputing that after every event is what lets out-of-order
-- delivery, buying twice and partial refunds need no special cases: there is no
-- "turn Pro off" event that could arrive before the "turn it on" one. (A plan
-- set by hand in `entitlements` is therefore overwritten by the next event for
-- that account. Nobody holds one — Phase 3a grandfathered nobody — and that is
-- the point of deriving it.)
--
-- Nothing here takes anything back from a ROOM. A refund turns the account free
-- again, and its rooms keep any courts above the free cap until someone changes
-- them — the same grandfathering Phase 3a applies everywhere — rather than a
-- club losing courts mid-night because a refund was approved.
--
-- Grants are stated both ways throughout. On the local stack (measured on CLI
-- 3.3.0) a new table is born with full DML for anon/authenticated and a new
-- function with EXECUTE for PUBLIC/anon/authenticated; production's default
-- can't be measured from here and two CLI releases have described it in
-- opposite ways. So: revoke everything a client must not have, then grant
-- explicitly what each role needs — service_role included.
-- ---------------------------------------------------------------------------

-- One row per Paddle transaction: the receipt, and what the plan is derived
-- from. In its own table rather than on `sessions`, because `sessions_select`
-- is `using (true)` and anything stored on a room is world-readable.
create table if not exists public.purchases (
  id                      uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE: the money moved whether or not the account still
  -- exists, and the receipt is what a refund or a tax question is answered from.
  user_id                 uuid references auth.users (id) on delete set null,
  provider_transaction_id text not null unique,
  provider_customer_id    text,
  price_id                text,
  status                  text not null default 'pending'
                            check (status in ('pending', 'completed', 'refunded', 'chargeback')),
  -- Minor units, as Paddle reports them. `total` is details.totals.grand_total:
  -- what the customer was actually charged.
  currency_code           text,
  subtotal                bigint,
  tax                     bigint,
  total                   bigint,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz,
  revoked_at              timestamptz,
  -- The occurred_at of the newest event applied to this purchase. Paddle does
  -- not promise delivery order, so anything older than this is stale.
  last_event_at           timestamptz
);

-- The plan recompute and "my purchases" both look purchases up by account.
create index if not exists purchases_user_idx on public.purchases (user_id);

-- Deliberately NOT given `replica identity full` and NOT added to the
-- supabase_realtime publication: nothing subscribes to it. Open rooms learn
-- about a plan change through `sessions` instead (see the room touch below).
alter table public.purchases enable row level security;

-- Read-only to its owner and invisible to everyone else. No client may write:
-- an INSERT or UPDATE grant would let a browser mint a completed purchase, and
-- with it Pro, without paying. create-checkout and the webhook write as
-- service_role. The revoke comes first because a narrow grant on top of the
-- default ACL restricts nothing — and with no grant left, a refused write is an
-- honest 42501 rather than RLS silently matching zero rows.
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;
grant select, insert, update, delete on public.purchases to service_role;

drop policy if exists purchases_select_own on public.purchases;
create policy purchases_select_own on public.purchases
  for select to authenticated
  using (user_id = auth.uid());

-- Every verified delivery, raw. Keyed on Paddle's event id, which stays the
-- same across retries — that is what makes a redelivery a no-op — and kept
-- whatever happens next, which turns "I paid and nothing happened" into a
-- two-minute lookup instead of an archaeology project.
create table if not exists public.webhook_events (
  event_id     text primary key,
  event_type   text not null,
  occurred_at  timestamptz,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  attempts     int not null default 1,
  -- Set once the event has been dealt with — applied, ignored or stale. A
  -- FAILED event is left unprocessed on purpose, so Paddle's retry runs it
  -- again instead of being swallowed as a duplicate.
  processed_at timestamptz,
  outcome      text check (outcome in ('applied', 'ignored', 'stale', 'failed')),
  error        text
);

-- service_role only: RLS on with no policies AND no client grant, the same
-- "make the wrong read impossible" posture as `entitlements`. Not published to
-- Realtime — nothing subscribes, and payloads carry customer details.
alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from anon, authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- apply_paddle_event: the one code path from a Paddle event to a plan.
--
-- p_price_id is the price this app sells (PADDLE_PRICE_ID in the Edge
-- Functions). It is a parameter rather than a constant because it differs
-- between the sandbox and live accounts, and it lives with the functions'
-- other Paddle secrets. A transaction.completed counts as ours when it sells
-- that price OR when create-checkout already wrote a pending row for it — the
-- second arm is what keeps a checkout opened just before the price is changed
-- from being silently ignored after the customer has paid.
--
-- SECURITY INVOKER, and callable by service_role alone. Postgres grants EXECUTE
-- to PUBLIC by default and Supabase's default ACL adds anon and authenticated
-- by name, so without the revoke at the bottom anyone holding the anon key
-- could hand themselves Pro by calling this with a made-up event. As INVOKER
-- run by service_role it needs no privilege beyond the explicit grants above.
--
-- Returns {outcome, event_id, event_type, transaction_id, user_id, plan,
-- plan_changed} where outcome is one of:
--   applied   — the event was ours and has been acted on (perhaps a no-op);
--   duplicate — this event id was already processed; nothing changed but the
--               attempt counter;
--   ignored   — not something this app acts on (another price, a pending or
--               partial refund, a credit, a chargeback warning, …);
--   stale     — older than the last event applied to its purchase;
--   failed    — raised; payload and error kept, effects undone, event left
--               unprocessed so a retry can succeed. The webhook answers 500.
-- ---------------------------------------------------------------------------
create or replace function public.apply_paddle_event(p_event jsonb, p_price_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_event_id    text := p_event->>'event_id';
  v_event_type  text := p_event->>'event_type';
  v_data        jsonb := coalesce(p_event->'data', '{}'::jsonb);
  v_occurred_at timestamptz;
  v_processed   timestamptz;
  v_outcome     text;
  v_txn         text;
  v_purchase    public.purchases%rowtype;
  v_found       boolean := false;
  v_user        uuid;
  v_action      text;
  v_adj_type    text;
  v_adj_status  text;
  v_status      text;
  v_old_plan    text;
  v_new_plan    text;
  v_changed     boolean := false;
  v_state       text;
  v_message     text;
begin
  -- Without these there is nothing to dedupe on and nowhere to keep the
  -- payload, so this is the one refusal that raises rather than returning
  -- `failed`. The webhook only gets here with a signature-verified body.
  if v_event_id is null or v_event_type is null then
    raise exception 'Not a Paddle event: event_id and event_type are required'
      using errcode = '22023';
  end if;

  -- Parsed defensively so a malformed timestamp is still recorded, and then
  -- fails inside the protected block below with the payload kept.
  begin
    v_occurred_at := (p_event->>'occurred_at')::timestamptz;
  exception when others then
    v_occurred_at := null;
  end;

  -- Step 1: record the delivery. On a redelivery the conflicting row is locked
  -- by the upsert, so two copies of one event arriving at once queue up here:
  -- the second waits for the first to commit, then reads its processed_at.
  insert into public.webhook_events as w (event_id, event_type, occurred_at, payload)
  values (v_event_id, v_event_type, v_occurred_at, p_event)
  on conflict (event_id) do update
     set attempts = w.attempts + 1
  returning w.processed_at into v_processed;

  if v_processed is not null then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'event_id', v_event_id,
      'event_type', v_event_type);
  end if;

  -- Step 2, inside its own exception block: a failure rolls back everything the
  -- event did — the purchase, the plan, the room touch — but not step 1, so the
  -- payload survives together with the error that stopped it.
  begin
    if v_occurred_at is null then
      raise exception 'Event % has no usable occurred_at', v_event_id
        using errcode = '22023';
    end if;

    if v_event_type = 'transaction.completed' then
      v_txn := v_data->>'id';
      if v_txn is null then
        raise exception 'transaction.completed without a transaction id'
          using errcode = '22023';
      end if;
      -- Fail loudly rather than ignore: with no configured price, every
      -- purchase would be "not ours" and paying customers would get nothing
      -- while the webhook answered 200.
      if coalesce(p_price_id, '') = '' then
        raise exception 'apply_paddle_event needs the price id this app sells'
          using errcode = '22023';
      end if;

      -- Serializes every event about one transaction. Same 64-bit hash space as
      -- the per-session locks; a collision costs a wait, not correctness.
      perform pg_advisory_xact_lock(hashtextextended('paddle:' || v_txn, 0));

      select * into v_purchase
        from public.purchases
       where provider_transaction_id = v_txn
         for update;
      v_found := found;

      if coalesce(v_data->>'status', 'completed') <> 'completed'
         or not (
           v_found
           or exists (
             select 1
               from jsonb_array_elements(coalesce(v_data->'items', '[]'::jsonb)) i
              where i->'price'->>'id' = p_price_id)
         ) then
        v_outcome := 'ignored';

      elsif v_found and v_purchase.last_event_at is not null
            and v_occurred_at < v_purchase.last_event_at then
        v_outcome := 'stale';

      else
        -- The buyer is whoever create-checkout wrote the pending row for. Only
        -- without one does custom_data speak, since a checkout can be opened by
        -- hand with any custom_data at all (which buys someone else Pro, at the
        -- buyer's own expense — harmless).
        v_user := v_purchase.user_id;
        if v_user is null then
          v_user := nullif(v_data->'custom_data'->>'user_id', '')::uuid;
        end if;
        -- Someone has paid and cannot be matched to an account. That is what
        -- monitoring is for, so it fails — and alerts — rather than recording a
        -- purchase nobody will ever see.
        if v_user is null then
          raise exception
            'Cannot tell who bought %: no pending purchase and no custom_data.user_id',
            v_txn
            using errcode = 'P0002';
        end if;

        insert into public.purchases as p (
          user_id, provider_transaction_id, provider_customer_id, price_id,
          status, currency_code, subtotal, tax, total, completed_at, last_event_at)
        values (
          v_user,
          v_txn,
          v_data->>'customer_id',
          coalesce(v_purchase.price_id, p_price_id),
          'completed',
          v_data->>'currency_code',
          (v_data->'details'->'totals'->>'subtotal')::bigint,
          (v_data->'details'->'totals'->>'tax')::bigint,
          coalesce(v_data->'details'->'totals'->>'grand_total',
                   v_data->'details'->'totals'->>'total')::bigint,
          v_occurred_at,
          v_occurred_at)
        on conflict (provider_transaction_id) do update
           set user_id              = coalesce(p.user_id, excluded.user_id),
               provider_customer_id = coalesce(excluded.provider_customer_id,
                                               p.provider_customer_id),
               -- Only pending moves to completed. A refunded or charged-back
               -- purchase is not resurrected by a completion, even a newer one.
               status               = case when p.status = 'pending'
                                           then 'completed' else p.status end,
               currency_code        = excluded.currency_code,
               subtotal             = excluded.subtotal,
               tax                  = excluded.tax,
               total                = excluded.total,
               completed_at         = coalesce(p.completed_at, excluded.completed_at),
               last_event_at        = excluded.last_event_at;

        v_outcome := 'applied';
      end if;

    elsif v_event_type in ('adjustment.created', 'adjustment.updated') then
      v_txn        := v_data->>'transaction_id';
      v_action     := v_data->>'action';
      v_adj_status := v_data->>'status';
      -- `type` sits on the adjustment itself; derive it from the items for a
      -- payload that predates the field.
      v_adj_type := coalesce(
        v_data->>'type',
        case
          when jsonb_typeof(v_data->'items') = 'array'
               and jsonb_array_length(v_data->'items') > 0
               and not exists (
                 select 1 from jsonb_array_elements(v_data->'items') i
                  where i->>'type' is distinct from 'full')
          then 'full'
          else 'partial'
        end);

      -- The refund policy, in one condition: only an APPROVED, FULL refund,
      -- chargeback or chargeback reversal changes anything. A refund pending
      -- approval, a rejected one, a partial one, a credit and a chargeback
      -- warning are all ignored — decided 2026-11-24, see ROADMAP §7.
      if v_adj_status is distinct from 'approved'
         or v_adj_type is distinct from 'full'
         or coalesce(v_action, '') not in ('refund', 'chargeback', 'chargeback_reverse') then
        v_outcome := 'ignored';
      else
        if v_txn is null then
          raise exception 'Adjustment without a transaction_id'
            using errcode = '22023';
        end if;

        perform pg_advisory_xact_lock(hashtextextended('paddle:' || v_txn, 0));

        select * into v_purchase
          from public.purchases
         where provider_transaction_id = v_txn
           for update;

        -- Fails rather than being ignored, because the likeliest cause is
        -- ordering: the transaction.completed this refunds has not arrived yet.
        -- Failing answers 500, Paddle retries, and by then it has.
        if not found then
          raise exception
            'No purchase for transaction % — its transaction.completed may not have arrived yet',
            v_txn
            using errcode = 'P0002';
        end if;

        if v_purchase.last_event_at is not null
           and v_occurred_at < v_purchase.last_event_at then
          v_outcome := 'stale';
        else
          v_status := case v_action
            when 'refund'     then 'refunded'
            when 'chargeback' then 'chargeback'
            -- A won dispute restores only what the dispute took.
            else case when v_purchase.status = 'chargeback'
                      then 'completed' else v_purchase.status end
          end;

          update public.purchases
             set status        = v_status,
                 revoked_at    = case
                                   when v_status in ('refunded', 'chargeback')
                                     then coalesce(revoked_at, v_occurred_at)
                                   when v_status = 'completed' then null
                                   else revoked_at
                                 end,
                 last_event_at = v_occurred_at
           where id = v_purchase.id;

          v_user := v_purchase.user_id;
          v_outcome := 'applied';
        end if;
      end if;

    else
      v_outcome := 'ignored';
    end if;

    -- Recompute the plan from purchases. Skipped when the account is gone
    -- (user_id SET NULL): there is no plan left to change.
    if v_outcome = 'applied' and v_user is not null then
      -- The per-account lock, keyed exactly as transfer_room_ownership keys
      -- its own. Two events about DIFFERENT transactions of one buyer — a
      -- refund of one purchase racing the completion of another — would each
      -- recompute from a snapshot missing the other's write, and the last to
      -- commit would win. Taken after the purchase write, so whichever waits
      -- re-reads a total that includes the other's.
      perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

      v_old_plan := public.account_plan(v_user);
      v_new_plan := case
        when exists (
          select 1 from public.purchases
           where user_id = v_user and status = 'completed')
        then 'pro' else 'free'
      end;

      if v_new_plan is distinct from v_old_plan then
        -- enforce_pro_requires_account (Phase 3b) fires here, with no
        -- service_role exemption: an anonymous buyer makes this raise 23514,
        -- which lands in the handler below with the payload kept.
        insert into public.entitlements as e (user_id, plan, updated_at)
        values (v_user, v_new_plan, now())
        on conflict (user_id) do update
           set plan = excluded.plan, updated_at = excluded.updated_at;

        -- How open rooms find out without `entitlements` being published:
        -- `sessions` already is, so every device in these rooms — the
        -- courtside tablet included, which is not the owner and could never
        -- read `entitlements` — gets an UPDATE and reloads its limits.
        -- Touched only when the plan actually moved, so a replay or a no-op
        -- refresh does not make every open room reload for nothing.
        update public.sessions
           set updated_at = now()
         where owner_id = v_user;

        v_changed := true;
      end if;
    end if;

    update public.webhook_events
       set processed_at = now(),
           outcome      = v_outcome,
           error        = null
     where event_id = v_event_id;

  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    update public.webhook_events
       set outcome = 'failed',
           error   = v_state || ': ' || v_message
     where event_id = v_event_id;
    return jsonb_build_object(
      'outcome', 'failed',
      'event_id', v_event_id,
      'event_type', v_event_type,
      'transaction_id', v_txn,
      'user_id', v_user,
      'sqlstate', v_state,
      'error', v_message);
  end;

  return jsonb_build_object(
    'outcome', v_outcome,
    'event_id', v_event_id,
    'event_type', v_event_type,
    'transaction_id', v_txn,
    'user_id', v_user,
    'plan', v_new_plan,
    'plan_changed', v_changed);
end;
$$;

revoke execute on function public.apply_paddle_event(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.apply_paddle_event(jsonb, text) to service_role;
