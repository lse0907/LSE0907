-- P1: customer benefit lifecycle and partial order settlement.
-- Existing full-cancellation primitives remain unchanged. This migration adds
-- explicit program lifecycle state, immutable adjustment ledgers, and honest
-- partial-refund payment states.

begin;

alter table public.store_loyalty_settings
  add column if not exists points_program_status text,
  add column if not exists coupons_program_status text,
  add column if not exists points_closure_notice_at timestamptz,
  add column if not exists points_redemption_ends_at timestamptz,
  add column if not exists coupons_closure_notice_at timestamptz;

update public.store_loyalty_settings
set points_program_status = case when points_enabled then 'active' else 'inactive' end,
    coupons_program_status = case when coupons_enabled then 'active' else 'inactive' end
where points_program_status is null or coupons_program_status is null;

alter table public.store_loyalty_settings
  alter column points_program_status set default 'inactive',
  alter column points_program_status set not null,
  alter column coupons_program_status set default 'inactive',
  alter column coupons_program_status set not null;

alter table public.store_loyalty_settings
  drop constraint if exists store_loyalty_settings_points_program_status_check,
  drop constraint if exists store_loyalty_settings_coupons_program_status_check;

alter table public.store_loyalty_settings
  add constraint store_loyalty_settings_points_program_status_check
    check (points_program_status in ('inactive', 'active', 'closing', 'closed')),
  add constraint store_loyalty_settings_coupons_program_status_check
    check (coupons_program_status in ('inactive', 'active', 'closing', 'closed'));

create table public.store_loyalty_program_events (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete restrict,
  benefit_type text not null check (benefit_type in ('points', 'coupons')),
  action text not null check (action in ('activated', 'closure_started', 'closed', 'reactivated')),
  previous_status text,
  next_status text not null,
  notice_at timestamptz,
  redemption_ends_at timestamptz,
  outstanding_count integer not null default 0 check (outstanding_count >= 0),
  reason text,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_store_loyalty_program_events_store_created
  on public.store_loyalty_program_events(store_id, created_at desc);

alter table public.store_loyalty_program_events enable row level security;
revoke all privileges on table public.store_loyalty_program_events from public, anon, authenticated;
grant select, insert, update, delete on table public.store_loyalty_program_events to service_role;

create or replace function public.set_store_loyalty_program_state(
  p_store_id text,
  p_benefit_type text,
  p_enabled boolean,
  p_actor_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settings public.store_loyalty_settings%rowtype;
  v_previous text;
  v_next text;
  v_outstanding integer := 0;
  v_notice timestamptz;
  v_redemption_end timestamptz;
  v_action text;
begin
  if p_benefit_type not in ('points', 'coupons') then
    raise exception 'LOYALTY_BENEFIT_TYPE_INVALID';
  end if;

  insert into public.store_loyalty_settings(store_id)
  values (p_store_id)
  on conflict (store_id) do nothing;

  select * into v_settings
  from public.store_loyalty_settings s
  where s.store_id = p_store_id
  for update;

  v_previous := case when p_benefit_type = 'points'
    then v_settings.points_program_status
    else v_settings.coupons_program_status end;

  if p_enabled then
    v_next := 'active';
    v_action := case when v_previous in ('closing', 'closed') then 'reactivated' else 'activated' end;
    update public.store_loyalty_settings s
    set points_enabled = case when p_benefit_type = 'points' then true else s.points_enabled end,
        coupons_enabled = case when p_benefit_type = 'coupons' then true else s.coupons_enabled end,
        points_program_status = case when p_benefit_type = 'points' then 'active' else s.points_program_status end,
        coupons_program_status = case when p_benefit_type = 'coupons' then 'active' else s.coupons_program_status end,
        points_closure_notice_at = case when p_benefit_type = 'points' then null else s.points_closure_notice_at end,
        points_redemption_ends_at = case when p_benefit_type = 'points' then null else s.points_redemption_ends_at end,
        coupons_closure_notice_at = case when p_benefit_type = 'coupons' then null else s.coupons_closure_notice_at end,
        updated_by = p_actor_user_id,
        updated_at = now()
    where s.store_id = p_store_id;
  else
    if p_benefit_type = 'points' then
      select count(*)::integer into v_outstanding
      from public.point_lots l
      where l.store_id = p_store_id
        and l.remaining_points > 0
        and l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now());
      v_notice := now();
      v_redemption_end := v_notice + interval '30 days';
      v_next := case when v_outstanding > 0 then 'closing' else 'closed' end;
      update public.store_loyalty_settings s
      set points_enabled = false,
          points_program_status = v_next,
          points_closure_notice_at = v_notice,
          points_redemption_ends_at = case when v_outstanding > 0 then v_redemption_end else v_notice end,
          updated_by = p_actor_user_id,
          updated_at = now()
      where s.store_id = p_store_id;

      if v_outstanding > 0 then
        update public.point_lots l
        set expires_at = case
              when l.expires_at is null then null
              else greatest(l.expires_at, v_redemption_end)
            end,
            updated_at = now()
        where l.store_id = p_store_id
          and l.remaining_points > 0
          and l.revoked_at is null
          and (l.expires_at is null or l.expires_at > now());
      end if;
    else
      select count(*)::integer into v_outstanding
      from public.customer_coupons c
      where c.store_id = p_store_id
        and c.status = 'issued'
        and (c.expires_at is null or c.expires_at > now());
      v_notice := now();
      v_next := case when v_outstanding > 0 then 'closing' else 'closed' end;
      update public.store_loyalty_settings s
      set coupons_enabled = false,
          coupons_program_status = v_next,
          coupons_closure_notice_at = v_notice,
          updated_by = p_actor_user_id,
          updated_at = now()
      where s.store_id = p_store_id;
    end if;
    v_action := case when v_outstanding > 0 then 'closure_started' else 'closed' end;
  end if;

  insert into public.store_loyalty_program_events(
    store_id, benefit_type, action, previous_status, next_status,
    notice_at, redemption_ends_at, outstanding_count, reason, actor_user_id
  ) values (
    p_store_id, p_benefit_type, v_action, v_previous, v_next,
    v_notice, v_redemption_end, v_outstanding,
    left(nullif(btrim(p_reason), ''), 500), p_actor_user_id
  );

  return jsonb_build_object(
    'ok', true,
    'benefitType', p_benefit_type,
    'status', v_next,
    'outstandingCount', v_outstanding,
    'noticeAt', v_notice,
    'redemptionEndsAt', v_redemption_end
  );
end;
$$;

revoke all privileges on function public.set_store_loyalty_program_state(text, text, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_store_loyalty_program_state(text, text, boolean, uuid, text)
  to service_role;

create or replace function public.refresh_store_loyalty_program_status(p_store_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_settings public.store_loyalty_settings%rowtype;
  v_points integer := 0;
  v_coupons integer := 0;
begin
  select * into v_settings from public.store_loyalty_settings s
  where s.store_id = p_store_id for update;
  if not found then return jsonb_build_object('ok', true, 'skipped', 'settings_not_found'); end if;
  if v_settings.points_program_status = 'closing' then
    select count(*)::integer into v_points from public.point_lots l
    where l.store_id = p_store_id and l.remaining_points > 0 and l.revoked_at is null
      and (l.expires_at is null or l.expires_at > now());
    if v_points = 0 then
      update public.store_loyalty_settings set points_program_status = 'closed', updated_at = now() where store_id = p_store_id;
      insert into public.store_loyalty_program_events(store_id, benefit_type, action, previous_status, next_status, outstanding_count, reason)
      values (p_store_id, 'points', 'closed', 'closing', 'closed', 0, '미이행 포인트 종료 완료');
    end if;
  end if;
  if v_settings.coupons_program_status = 'closing' then
    select count(*)::integer into v_coupons from public.customer_coupons c
    where c.store_id = p_store_id and c.status = 'issued' and (c.expires_at is null or c.expires_at > now());
    if v_coupons = 0 then
      update public.store_loyalty_settings set coupons_program_status = 'closed', updated_at = now() where store_id = p_store_id;
      insert into public.store_loyalty_program_events(store_id, benefit_type, action, previous_status, next_status, outstanding_count, reason)
      values (p_store_id, 'coupons', 'closed', 'closing', 'closed', 0, '미사용 쿠폰 종료 완료');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'pointsOutstanding', v_points, 'couponsOutstanding', v_coupons);
end;
$$;

revoke all privileges on function public.refresh_store_loyalty_program_status(text)
  from public, anon, authenticated;
grant execute on function public.refresh_store_loyalty_program_status(text) to service_role;

-- Settings writes now pass through the owner-authenticated server route so
-- program closure cannot be bypassed by a direct browser update.
revoke insert, update, delete on table public.store_loyalty_settings from authenticated;

alter table public.orders
  add column if not exists cancellation_type text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists adjusted_total_price integer,
  add column if not exists refunded_amount integer not null default 0,
  add column if not exists effective_used_points integer,
  add column if not exists effective_coupon_discount integer,
  add column if not exists effective_earned_points integer;

update public.orders
set adjusted_total_price = coalesce(adjusted_total_price, total_price),
    effective_used_points = coalesce(effective_used_points, used_points, 0),
    effective_coupon_discount = coalesce(
      effective_coupon_discount,
      greatest(0, coalesce((loyalty_snapshot->>'coupon_discount')::integer, 0))
    ),
    effective_earned_points = coalesce(effective_earned_points, earned_points, 0)
where adjusted_total_price is null
   or effective_used_points is null
   or effective_coupon_discount is null
   or effective_earned_points is null;

alter table public.orders
  alter column adjusted_total_price set not null,
  alter column effective_used_points set not null,
  alter column effective_coupon_discount set not null,
  alter column effective_earned_points set not null;

alter table public.orders
  drop constraint if exists orders_cancellation_type_check,
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_cancellation_type_check check (
    cancellation_type is null or cancellation_type in (
      'customer_cancelled', 'store_rejected', 'store_cancelled', 'system_cancelled'
    )
  ),
  add constraint orders_payment_status_check check (
    payment_status in (
      'not_required', 'pending', 'paid', 'cancel_pending', 'refunded', 'failed',
      'partial_refund_pending', 'partially_refunded'
    )
  );

create table public.order_partial_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  store_id text not null references public.stores(store_id) on delete restrict,
  status text not null default 'requested' check (status in (
    'requested', 'processing', 'retryable', 'pg_refunded', 'completed', 'reconcile_required'
  )),
  reason text not null,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by_pin_id uuid,
  idempotency_key uuid not null default gen_random_uuid() unique,
  adjustment_amount integer not null check (adjustment_amount > 0),
  previous_effective_total integer not null check (previous_effective_total > 0),
  final_effective_total integer not null check (final_effective_total > 0),
  previous_payable_amount integer not null check (previous_payable_amount >= 0),
  previous_refunded_amount integer not null default 0 check (previous_refunded_amount >= 0),
  refund_amount integer not null check (refund_amount >= 0),
  final_payable_amount integer not null check (final_payable_amount >= 0),
  final_used_points integer not null default 0 check (final_used_points >= 0),
  final_coupon_discount integer not null default 0 check (final_coupon_discount >= 0),
  final_earned_points integer not null default 0 check (final_earned_points >= 0),
  restored_points integer not null default 0 check (restored_points >= 0),
  revoked_points integer not null default 0 check (revoked_points >= 0),
  coupon_restored boolean not null default false,
  payment_key text,
  toss_order_id text,
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

create unique index idx_order_partial_refunds_one_open
  on public.order_partial_refunds(order_id)
  where status <> 'completed';
create index idx_order_partial_refunds_recovery
  on public.order_partial_refunds(status, next_retry_at, updated_at)
  where status in ('requested', 'processing', 'retryable', 'pg_refunded', 'reconcile_required');
create index idx_order_partial_refunds_store_created
  on public.order_partial_refunds(store_id, created_at desc);

create trigger trg_order_partial_refunds_updated_at
before update on public.order_partial_refunds
for each row execute function public.set_updated_at();

create table public.order_partial_refund_items (
  id uuid primary key default gen_random_uuid(),
  partial_refund_id uuid not null references public.order_partial_refunds(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  item_name_snapshot text not null,
  unit_amount_snapshot integer not null check (unit_amount_snapshot >= 0),
  cancelled_quantity integer not null check (cancelled_quantity > 0),
  cancelled_amount integer not null check (cancelled_amount > 0),
  created_at timestamptz not null default now(),
  unique (partial_refund_id, order_item_id)
);

create index idx_order_partial_refund_items_order
  on public.order_partial_refund_items(order_id, order_item_id);

alter table public.order_partial_refunds enable row level security;
alter table public.order_partial_refund_items enable row level security;
revoke all privileges on table public.order_partial_refunds from public, anon, authenticated;
revoke all privileges on table public.order_partial_refund_items from public, anon, authenticated;
grant select, insert, update, delete on table public.order_partial_refunds to service_role;
grant select, insert, update, delete on table public.order_partial_refund_items to service_role;

create or replace function public.claim_order_partial_refund(
  p_store_id text,
  p_order_id uuid,
  p_items jsonb,
  p_reason text,
  p_actor_user_id uuid,
  p_approved_by_pin_id uuid,
  p_final_used_points integer,
  p_final_coupon_discount integer,
  p_final_earned_points integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.order_partial_refunds%rowtype;
  v_line jsonb;
  v_item public.order_items%rowtype;
  v_qty integer;
  v_prior_qty integer;
  v_unit integer;
  v_amount integer;
  v_adjustment integer := 0;
  v_previous_total integer;
  v_final_total integer;
  v_previous_payable integer;
  v_final_payable integer;
  v_refund_amount integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'PARTIAL_REFUND_ITEMS_REQUIRED';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.store_id = p_store_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'completed' then raise exception 'PARTIAL_REFUND_COMPLETED_ONLY'; end if;
  if v_order.payment_status not in ('paid', 'partially_refunded', 'not_required') then
    raise exception 'PARTIAL_REFUND_PAYMENT_STATE_INVALID';
  end if;
  if exists (
    select 1 from public.order_partial_refunds r
    where r.order_id = p_order_id and r.status <> 'completed'
  ) then raise exception 'PARTIAL_REFUND_ALREADY_PROCESSING'; end if;

  for v_line in select value from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(0, coalesce((v_line->>'quantity')::integer, 0));
    if v_qty <= 0 then raise exception 'PARTIAL_REFUND_QUANTITY_INVALID'; end if;
    select * into v_item
    from public.order_items i
    where i.id = (v_line->>'orderItemId')::uuid
      and i.order_id = p_order_id and i.store_id = p_store_id
    for update;
    if not found then raise exception 'PARTIAL_REFUND_ITEM_NOT_FOUND'; end if;

    select coalesce(sum(ri.cancelled_quantity), 0)::integer into v_prior_qty
    from public.order_partial_refund_items ri
    join public.order_partial_refunds r on r.id = ri.partial_refund_id
    where ri.order_item_id = v_item.id and r.status = 'completed';
    if v_prior_qty + v_qty > v_item.qty then raise exception 'PARTIAL_REFUND_QUANTITY_EXCEEDED'; end if;

    select greatest(0, coalesce(v_item.price, 0) + coalesce(sum(coalesce(oi.price_delta, 0) * greatest(1, coalesce(oi.qty, 1))), 0))::integer
    into v_unit
    from public.order_item_options oi
    where oi.order_item_id = v_item.id;
    v_amount := v_unit * v_qty;
    if v_amount <= 0 then raise exception 'PARTIAL_REFUND_AMOUNT_INVALID'; end if;
    v_adjustment := v_adjustment + v_amount;
  end loop;

  v_previous_total := v_order.adjusted_total_price;
  v_final_total := v_previous_total - v_adjustment;
  if v_final_total <= 0 then raise exception 'USE_FULL_CANCELLATION_FOR_ALL_ITEMS'; end if;
  if p_final_used_points < 0 or p_final_coupon_discount < 0 or p_final_earned_points < 0 then
    raise exception 'PARTIAL_REFUND_SETTLEMENT_INVALID';
  end if;
  if p_final_used_points > 0 and p_final_coupon_discount > 0 then
    raise exception 'PARTIAL_REFUND_DISCOUNT_EXCLUSIVE';
  end if;
  v_previous_payable := greatest(0, v_previous_total - v_order.effective_used_points - v_order.effective_coupon_discount);
  v_final_payable := greatest(0, v_final_total - p_final_used_points - p_final_coupon_discount);
  v_refund_amount := greatest(0, v_previous_payable - v_final_payable);

  insert into public.order_partial_refunds(
    order_id, store_id, reason, requested_by, approved_by_pin_id,
    adjustment_amount, previous_effective_total, final_effective_total,
    previous_payable_amount, previous_refunded_amount, refund_amount, final_payable_amount,
    final_used_points, final_coupon_discount, final_earned_points,
    restored_points, revoked_points, coupon_restored, payment_key, toss_order_id
  ) values (
    p_order_id, p_store_id, left(coalesce(nullif(btrim(p_reason), ''), '부분 환불'), 500),
    p_actor_user_id, p_approved_by_pin_id,
    v_adjustment, v_previous_total, v_final_total,
    v_previous_payable, v_order.refunded_amount, v_refund_amount, v_final_payable,
    p_final_used_points, p_final_coupon_discount, p_final_earned_points,
    greatest(0, v_order.effective_used_points - p_final_used_points),
    greatest(0, v_order.effective_earned_points - p_final_earned_points),
    v_order.used_coupon_id is not null and p_final_coupon_discount = 0,
    nullif(btrim(v_order.payment_key), ''), nullif(btrim(v_order.toss_order_id), '')
  ) returning * into v_refund;

  for v_line in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_line->>'quantity')::integer;
    select * into v_item from public.order_items i where i.id = (v_line->>'orderItemId')::uuid;
    select greatest(0, coalesce(v_item.price, 0) + coalesce(sum(coalesce(oi.price_delta, 0) * greatest(1, coalesce(oi.qty, 1))), 0))::integer
    into v_unit from public.order_item_options oi where oi.order_item_id = v_item.id;
    insert into public.order_partial_refund_items(
      partial_refund_id, order_id, order_item_id, item_name_snapshot,
      unit_amount_snapshot, cancelled_quantity, cancelled_amount
    ) values (v_refund.id, p_order_id, v_item.id, v_item.name, v_unit, v_qty, v_unit * v_qty);
  end loop;

  if v_order.payment_status <> 'not_required' and v_refund_amount > 0 then
    update public.orders set payment_status = 'partial_refund_pending' where id = p_order_id;
  end if;
  insert into public.order_events(
    store_id, order_id, event_type, before_status, after_status, actor_user_id,
    approved_by_pin_id, reason_code, reason_text, metadata
  ) values (
    p_store_id, p_order_id, 'partial_refund_requested', v_order.status, v_order.status,
    p_actor_user_id, p_approved_by_pin_id, 'partial_refund', p_reason,
    jsonb_build_object('partial_refund_id', v_refund.id, 'adjustment_amount', v_adjustment, 'refund_amount', v_refund_amount)
  );

  return jsonb_build_object(
    'ok', true, 'partialRefundId', v_refund.id, 'idempotencyKey', v_refund.idempotency_key,
    'refundAmount', v_refund_amount, 'previousRefundedAmount', v_order.refunded_amount,
    'requiresPg', v_order.payment_status <> 'not_required' and v_refund_amount > 0,
    'paymentKey', v_refund.payment_key, 'tossOrderId', v_refund.toss_order_id
  );
end;
$$;

create or replace function public.finalize_order_partial_refund(
  p_partial_refund_id uuid,
  p_pg_status text default null,
  p_pg_cancel_transaction_key text default null,
  p_pg_response jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_refund public.order_partial_refunds%rowtype;
  v_order public.orders%rowtype;
  v_balance integer;
  v_remaining_revoke integer;
  v_take integer;
  v_recovery_add integer := 0;
  v_recovery_release integer := 0;
  v_release_current integer := 0;
  v_lot public.point_lots%rowtype;
  v_use_tx_id uuid;
  v_restore_tx_id uuid;
  v_restore_remaining integer;
  v_allocation record;
begin
  select * into v_refund from public.order_partial_refunds r
  where r.id = p_partial_refund_id for update;
  if not found then raise exception 'PARTIAL_REFUND_NOT_FOUND'; end if;
  select * into v_order from public.orders o
  where o.id = v_refund.order_id and o.store_id = v_refund.store_id for update;
  if v_refund.status = 'completed' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'partialRefundId', v_refund.id);
  end if;
  if v_order.payment_status <> 'not_required' and v_refund.refund_amount > 0
     and upper(coalesce(p_pg_status, '')) not in ('PARTIAL_CANCELED', 'CANCELED') then
    raise exception 'PG_PARTIAL_REFUND_NOT_CONFIRMED';
  end if;

  if v_order.customer_user_id is not null and v_refund.restored_points > 0 then
    insert into public.point_transactions(
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key,
      expires_at
    ) values (
      v_order.customer_user_id, v_order.store_id, v_order.id, 'restore', 0, 0,
      'partial refund restore used points', v_refund.id::text || ':restore',
      now() + interval '30 days'
    ) on conflict (idempotency_key) do update set reason = excluded.reason
    returning id into v_restore_tx_id;

    select t.id into v_use_tx_id
    from public.point_transactions t
    where t.order_id = v_order.id and t.customer_user_id = v_order.customer_user_id
      and t.store_id = v_order.store_id and t.tx_type = 'use'
    order by t.created_at limit 1;
    v_restore_remaining := v_refund.restored_points;
    for v_allocation in
      select a.id, a.lot_id, a.allocated_points, a.restored_points
      from public.point_lot_allocations a
      where a.use_transaction_id = v_use_tx_id
      order by a.created_at, a.id
      for update
    loop
      exit when v_restore_remaining <= 0;
      v_take := least(v_restore_remaining, v_allocation.allocated_points - v_allocation.restored_points);
      if v_take <= 0 then continue; end if;
      select * into v_lot from public.point_lots l where l.id = v_allocation.lot_id for update;
      if v_lot.revoked_at is not null then
        select least(v_take, w.point_recovery_amount) into v_release_current
        from public.customer_store_wallets w
        where w.customer_user_id = v_order.customer_user_id and w.store_id = v_order.store_id;
        update public.customer_store_wallets w
        set point_recovery_amount = w.point_recovery_amount - coalesce(v_release_current, 0), updated_at = now()
        where w.customer_user_id = v_order.customer_user_id and w.store_id = v_order.store_id;
        v_recovery_release := v_recovery_release + coalesce(v_release_current, 0);
      else
        update public.point_lots l
        set remaining_points = l.remaining_points + v_take,
            expires_at = case when l.expires_at is null then null else greatest(l.expires_at, now() + interval '30 days') end,
            expired_at = null, updated_at = now()
        where l.id = v_lot.id;
      end if;
      update public.point_lot_allocations a
      set restored_points = a.restored_points + v_take,
          restore_transaction_id = v_restore_tx_id, restored_at = now()
      where a.id = v_allocation.id;
      v_restore_remaining := v_restore_remaining - v_take;
    end loop;
    if v_restore_remaining > 0 then
      insert into public.point_lots(
        customer_user_id, store_id, source_transaction_id, source_order_id, source_kind,
        original_points, remaining_points, original_expires_at, expires_at
      ) values (
        v_order.customer_user_id, v_order.store_id, v_restore_tx_id, v_order.id, 'legacy_refund',
        v_restore_remaining, v_restore_remaining, null, now() + interval '30 days'
      );
      v_restore_remaining := 0;
    end if;
    update public.point_transactions t set points = v_refund.restored_points
    where t.id = v_restore_tx_id;
    if v_recovery_release > 0 then
      insert into public.point_transactions(
        customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
      ) values (
        v_order.customer_user_id, v_order.store_id, v_order.id, 'recovery_release', v_recovery_release, 0,
        'partial refund restored points released recovery', v_refund.id::text || ':recovery-release'
      ) on conflict (idempotency_key) do nothing;
    end if;
  end if;

  if v_order.customer_user_id is not null and v_refund.revoked_points > 0 then
    v_remaining_revoke := v_refund.revoked_points;
    for v_lot in
      select * from public.point_lots l
      where l.source_order_id = v_order.id
        and (l.remaining_points > 0 or l.expired_points > 0)
      order by l.created_at, l.id
      for update
    loop
      exit when v_remaining_revoke <= 0;
      v_take := least(v_remaining_revoke, v_lot.remaining_points);
      if v_take > 0 then
        update public.point_lots l
        set remaining_points = l.remaining_points - v_take,
            revoked_points = l.revoked_points + v_take,
            revoked_at = case when l.remaining_points = v_take and l.expired_points = 0 then now() else l.revoked_at end,
            updated_at = now()
        where l.id = v_lot.id;
        v_remaining_revoke := v_remaining_revoke - v_take;
      end if;
      if v_remaining_revoke > 0 then
        v_take := least(v_remaining_revoke, v_lot.expired_points);
        if v_take > 0 then
          update public.point_lots l
          set expired_points = l.expired_points - v_take,
              revoked_points = l.revoked_points + v_take,
              revoked_at = case when l.remaining_points = 0 and l.expired_points = v_take then now() else l.revoked_at end,
              updated_at = now()
          where l.id = v_lot.id;
          v_remaining_revoke := v_remaining_revoke - v_take;
        end if;
      end if;
    end loop;
    v_recovery_add := greatest(0, v_remaining_revoke);
    if v_recovery_add > 0 then
      update public.customer_store_wallets w
      set point_recovery_amount = w.point_recovery_amount + v_recovery_add, updated_at = now()
      where w.customer_user_id = v_order.customer_user_id and w.store_id = v_order.store_id;
      insert into public.point_transactions(
        customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
      ) values (
        v_order.customer_user_id, v_order.store_id, v_order.id, 'recovery_add', -v_recovery_add, 0,
        'partial refund earned points already spent or offset', v_refund.id::text || ':recovery-add'
      ) on conflict (idempotency_key) do nothing;
    end if;
    insert into public.point_transactions(
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
    ) values (
      v_order.customer_user_id, v_order.store_id, v_order.id, 'rollback', -v_refund.revoked_points, 0,
      'partial refund revoke earned points', v_refund.id::text || ':rollback'
    ) on conflict (idempotency_key) do nothing;
  end if;

  if v_order.customer_user_id is not null then
    v_balance := private.refresh_wallet_point_balance(v_order.customer_user_id, v_order.store_id, now());
    update public.point_transactions t set balance_after = v_balance
    where t.idempotency_key in (
      v_refund.id::text || ':restore', v_refund.id::text || ':rollback', v_refund.id::text || ':recovery-add'
      , v_refund.id::text || ':recovery-release'
    );
    update public.customer_store_wallets w
    set lifetime_spent = greatest(0, w.lifetime_spent - v_refund.refund_amount), updated_at = now()
    where w.customer_user_id = v_order.customer_user_id and w.store_id = v_order.store_id;
  end if;

  if v_refund.coupon_restored and v_order.used_coupon_id is not null then
    update public.customer_coupons c
    set status = 'issued', used_at = null, used_order_id = null, updated_at = now()
    where c.id = v_order.used_coupon_id and c.used_order_id = v_order.id;
  end if;

  update public.order_partial_refunds r
  set status = 'completed', pg_status = upper(p_pg_status),
      pg_cancel_transaction_key = nullif(btrim(p_pg_cancel_transaction_key), ''),
      pg_response = p_pg_response, failure_code = null, failure_detail = null,
      next_retry_at = null, completed_at = now()
  where r.id = v_refund.id;

  update public.orders o
  set adjusted_total_price = v_refund.final_effective_total,
      refunded_amount = o.refunded_amount + v_refund.refund_amount,
      effective_used_points = v_refund.final_used_points,
      effective_coupon_discount = v_refund.final_coupon_discount,
      effective_earned_points = v_refund.final_earned_points,
      payment_status = case when o.payment_status = 'not_required' then 'not_required' else 'partially_refunded' end
  where o.id = v_order.id;

  insert into public.order_events(
    store_id, order_id, event_type, before_status, after_status, actor_user_id,
    approved_by_pin_id, reason_code, reason_text, metadata
  ) values (
    v_order.store_id, v_order.id, 'partial_refund_completed', v_order.status, v_order.status,
    v_refund.requested_by, v_refund.approved_by_pin_id, 'partial_refund', v_refund.reason,
    jsonb_build_object('partial_refund_id', v_refund.id, 'refund_amount', v_refund.refund_amount, 'pg_status', upper(p_pg_status))
  );
  return jsonb_build_object('ok', true, 'partialRefundId', v_refund.id, 'refundAmount', v_refund.refund_amount);
end;
$$;

revoke all privileges on function public.claim_order_partial_refund(text, uuid, jsonb, text, uuid, uuid, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_order_partial_refund(text, uuid, jsonb, text, uuid, uuid, integer, integer, integer)
  to service_role;
revoke all privileges on function public.finalize_order_partial_refund(uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_order_partial_refund(uuid, text, text, jsonb)
  to service_role;

create or replace function private.sync_order_cancellation_type()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor text := coalesce(new.metadata->>'actor', 'staff');
  v_type text;
begin
  if new.event_type <> 'order_cancelled' then return new; end if;
  v_type := case
    when v_actor = 'customer' then 'customer_cancelled'
    when v_actor = 'system' then 'system_cancelled'
    when new.before_status = 'new' then 'store_rejected'
    else 'store_cancelled'
  end;
  update public.orders o
  set cancellation_type = v_type, cancelled_at = coalesce(o.cancelled_at, new.created_at)
  where o.id = new.order_id and o.store_id = new.store_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_order_cancellation_type on public.order_events;
create trigger trg_sync_order_cancellation_type
after insert on public.order_events
for each row execute function private.sync_order_cancellation_type();

revoke all privileges on function private.sync_order_cancellation_type()
  from public, anon, authenticated;

commit;
