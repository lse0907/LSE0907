-- P0-B: keep order cancellation and customer PG cancellation consistent.
--
-- The browser never receives access to this ledger. Server routes claim an
-- order cancellation transactionally, use the persisted idempotency key with
-- Toss Payments, and only mark a payment refunded after a verified CANCELED
-- response is finalized in Postgres.

begin;

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (
    payment_status in (
      'not_required',
      'pending',
      'paid',
      'cancel_pending',
      'refunded',
      'failed'
    )
  ) not valid;

alter table public.orders
  validate constraint orders_payment_status_check;

create table public.order_payment_cancel_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  store_id text not null references public.stores(store_id) on delete restrict,
  payment_key text,
  toss_order_id text,
  cancel_reason text not null,
  reason_code text not null default 'other',
  actor_type text not null check (actor_type in ('customer', 'staff', 'system', 'ops')),
  requested_by uuid references auth.users(id) on delete set null,
  actor_pin_id uuid,
  approved_by_pin_id uuid,
  idempotency_key uuid not null default gen_random_uuid() unique,
  status text not null default 'requested' check (
    status in (
      'requested',
      'processing',
      'retryable',
      'pg_cancelled',
      'completed',
      'reconcile_required'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  pg_status text,
  pg_cancel_transaction_key text,
  pg_response jsonb,
  failure_code text,
  failure_detail text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_order_payment_cancel_attempts_recovery
  on public.order_payment_cancel_attempts(status, next_retry_at, updated_at)
  where status in ('requested', 'processing', 'retryable', 'pg_cancelled', 'reconcile_required');

create index idx_order_payment_cancel_attempts_store_created
  on public.order_payment_cancel_attempts(store_id, created_at desc);

create index idx_order_payment_cancel_attempts_requested_by
  on public.order_payment_cancel_attempts(requested_by)
  where requested_by is not null;

create trigger trg_order_payment_cancel_attempts_updated_at
before update on public.order_payment_cancel_attempts
for each row execute function public.set_updated_at();

alter table public.order_payment_cancel_attempts enable row level security;
revoke all privileges on table public.order_payment_cancel_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.order_payment_cancel_attempts to service_role;

create or replace function public.claim_order_cancellation(
  p_store_id text,
  p_order_id uuid,
  p_expected_status text,
  p_cancel_reason text,
  p_reason_code text,
  p_actor_type text,
  p_actor_user_id uuid default null,
  p_actor_pin_id uuid default null,
  p_approved_by_pin_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.order_payment_cancel_attempts%rowtype;
  v_requires_pg boolean := false;
  v_next_payment_status text;
begin
  if p_actor_type not in ('customer', 'staff', 'system', 'ops') then
    raise exception 'CANCEL_ACTOR_INVALID';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.store_id = p_store_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_attempt
  from public.order_payment_cancel_attempts a
  where a.order_id = p_order_id;

  if v_order.status = 'cancelled' then
    if v_order.payment_status = 'not_required' then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'requires_pg', false,
        'order_status', v_order.status,
        'payment_status', v_order.payment_status
      );
    end if;

    if v_order.payment_status in ('cancel_pending', 'refunded', 'failed') and v_attempt.id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'requires_pg', v_order.payment_status = 'cancel_pending',
        'order_status', v_order.status,
        'payment_status', v_order.payment_status,
        'attempt_id', v_attempt.id,
        'attempt_status', v_attempt.status,
        'cancel_reason', v_attempt.cancel_reason,
        'idempotency_key', v_attempt.idempotency_key,
        'payment_key', v_attempt.payment_key,
        'toss_order_id', v_attempt.toss_order_id
      );
    end if;

    raise exception 'LEGACY_CANCEL_REQUIRES_RECONCILIATION';
  end if;

  if v_order.status = 'completed' then
    raise exception 'ORDER_LOCKED';
  end if;

  if p_expected_status is not null and v_order.status <> p_expected_status then
    raise exception 'ORDER_STATUS_CHANGED';
  end if;

  v_requires_pg := v_order.payment_status in ('paid', 'pending');
  v_next_payment_status := case
    when v_requires_pg then 'cancel_pending'
    else v_order.payment_status
  end;

  if v_requires_pg then
    insert into public.order_payment_cancel_attempts (
      order_id,
      store_id,
      payment_key,
      toss_order_id,
      cancel_reason,
      reason_code,
      actor_type,
      requested_by,
      actor_pin_id,
      approved_by_pin_id
    ) values (
      v_order.id,
      v_order.store_id,
      nullif(btrim(v_order.payment_key), ''),
      nullif(btrim(v_order.toss_order_id), ''),
      left(coalesce(nullif(btrim(p_cancel_reason), ''), '주문 취소'), 500),
      left(coalesce(nullif(btrim(p_reason_code), ''), 'other'), 100),
      p_actor_type,
      p_actor_user_id,
      p_actor_pin_id,
      p_approved_by_pin_id
    )
    returning * into v_attempt;
  end if;

  update public.orders o
  set status = 'cancelled',
      payment_status = v_next_payment_status
  where o.id = v_order.id
    and o.store_id = v_order.store_id;

  perform public.rollback_order_rewards(v_order.store_id, v_order.id);

  insert into public.order_events (
    store_id,
    order_id,
    event_type,
    before_status,
    after_status,
    actor_user_id,
    actor_pin_id,
    approved_by_pin_id,
    reason_code,
    reason_text,
    metadata
  ) values (
    v_order.store_id,
    v_order.id,
    'order_cancelled',
    v_order.status,
    'cancelled',
    p_actor_user_id,
    p_actor_pin_id,
    p_approved_by_pin_id,
    left(coalesce(nullif(btrim(p_reason_code), ''), 'other'), 100),
    left(coalesce(nullif(btrim(p_cancel_reason), ''), '주문 취소'), 500),
    jsonb_build_object(
      'actor', p_actor_type,
      'payment_status_before', v_order.payment_status,
      'payment_status_after', v_next_payment_status,
      'cancel_attempt_id', v_attempt.id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'requires_pg', v_requires_pg,
    'order_status', 'cancelled',
    'payment_status', v_next_payment_status,
    'attempt_id', v_attempt.id,
    'attempt_status', v_attempt.status,
    'cancel_reason', v_attempt.cancel_reason,
    'idempotency_key', v_attempt.idempotency_key,
    'payment_key', v_attempt.payment_key,
    'toss_order_id', v_attempt.toss_order_id
  );
end;
$$;

create or replace function public.finalize_order_payment_cancellation(
  p_attempt_id uuid,
  p_pg_status text,
  p_pg_cancel_transaction_key text default null,
  p_pg_response jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.order_payment_cancel_attempts%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_attempt
  from public.order_payment_cancel_attempts a
  where a.id = p_attempt_id
  for update;

  if not found then
    raise exception 'CANCEL_ATTEMPT_NOT_FOUND';
  end if;

  select * into v_order
  from public.orders o
  where o.id = v_attempt.order_id
    and o.store_id = v_attempt.store_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_attempt.status = 'completed' and v_order.payment_status = 'refunded' then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'order_id', v_order.id,
      'order_status', v_order.status,
      'payment_status', v_order.payment_status
    );
  end if;

  if upper(coalesce(p_pg_status, '')) <> 'CANCELED' then
    raise exception 'PG_CANCELLATION_NOT_CONFIRMED';
  end if;

  if v_order.status <> 'cancelled' or v_order.payment_status <> 'cancel_pending' then
    raise exception 'CANCEL_FINALIZE_STATE_MISMATCH';
  end if;

  update public.order_payment_cancel_attempts a
  set status = 'completed',
      pg_status = upper(p_pg_status),
      pg_cancel_transaction_key = nullif(btrim(p_pg_cancel_transaction_key), ''),
      pg_response = p_pg_response,
      failure_code = null,
      failure_detail = null,
      next_retry_at = null,
      completed_at = now()
  where a.id = v_attempt.id;

  update public.orders o
  set payment_status = 'refunded'
  where o.id = v_order.id
    and o.store_id = v_order.store_id;

  insert into public.order_events (
    store_id,
    order_id,
    event_type,
    before_status,
    after_status,
    actor_user_id,
    actor_pin_id,
    approved_by_pin_id,
    reason_code,
    reason_text,
    metadata
  ) values (
    v_order.store_id,
    v_order.id,
    'payment_refunded',
    v_order.status,
    v_order.status,
    v_attempt.requested_by,
    v_attempt.actor_pin_id,
    v_attempt.approved_by_pin_id,
    v_attempt.reason_code,
    v_attempt.cancel_reason,
    jsonb_build_object(
      'payment_status_before', v_order.payment_status,
      'payment_status_after', 'refunded',
      'cancel_attempt_id', v_attempt.id,
      'pg_status', upper(p_pg_status),
      'pg_cancel_transaction_key', nullif(btrim(p_pg_cancel_transaction_key), '')
    )
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', v_order.id,
    'order_status', v_order.status,
    'payment_status', 'refunded'
  );
end;
$$;

create or replace function public.begin_order_payment_cancel_attempt(
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.order_payment_cancel_attempts%rowtype;
begin
  update public.order_payment_cancel_attempts a
  set status = 'processing',
      attempt_count = a.attempt_count + 1,
      last_attempt_at = now(),
      next_retry_at = null,
      failure_code = null,
      failure_detail = null
  where a.id = p_attempt_id
    and a.status <> 'completed'
  returning * into v_attempt;

  if not found then
    select * into v_attempt
    from public.order_payment_cancel_attempts a
    where a.id = p_attempt_id;
  end if;

  if v_attempt.id is null then
    raise exception 'CANCEL_ATTEMPT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt.id,
    'status', v_attempt.status,
    'attempt_count', v_attempt.attempt_count,
    'completed', v_attempt.status = 'completed'
  );
end;
$$;

revoke all privileges on function public.claim_order_cancellation(
  text, uuid, text, text, text, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.claim_order_cancellation(
  text, uuid, text, text, text, text, uuid, uuid, uuid
) to service_role;

revoke all privileges on function public.finalize_order_payment_cancellation(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_order_payment_cancellation(
  uuid, text, text, jsonb
) to service_role;

revoke all privileges on function public.begin_order_payment_cancel_attempt(
  uuid
) from public, anon, authenticated;
grant execute on function public.begin_order_payment_cancel_attempt(
  uuid
) to service_role;

commit;
