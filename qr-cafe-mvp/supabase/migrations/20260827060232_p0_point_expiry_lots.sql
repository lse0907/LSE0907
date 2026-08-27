-- P0: enforce point expiry with immutable earn lots, FIFO consumption, exact
-- restoration, and an internal recovery balance for cancelled earned points.
--
-- This migration intentionally does not install a cron job. Expired lots are
-- excluded at read time and are materialized into the ledger on the next
-- loyalty write for the customer/store pair.

begin;

alter table public.customer_store_wallets
  add column if not exists point_recovery_amount integer not null default 0;

alter table public.customer_store_wallets
  drop constraint if exists customer_store_wallets_point_recovery_amount_check;

alter table public.customer_store_wallets
  add constraint customer_store_wallets_point_recovery_amount_check
  check (point_recovery_amount >= 0) not valid;

alter table public.customer_store_wallets
  validate constraint customer_store_wallets_point_recovery_amount_check;

alter table public.point_transactions
  drop constraint if exists point_transactions_tx_type_check;

alter table public.point_transactions
  add constraint point_transactions_tx_type_check
  check (
    tx_type in (
      'earn',
      'use',
      'expire',
      'adjust_plus',
      'adjust_minus',
      'rollback',
      'restore',
      'recovery_add',
      'recovery_offset',
      'recovery_release'
    )
  ) not valid;

alter table public.point_transactions
  validate constraint point_transactions_tx_type_check;

create table public.point_lots (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  source_transaction_id uuid references public.point_transactions(id) on delete restrict,
  source_order_id uuid references public.orders(id) on delete set null,
  source_kind text not null check (
    source_kind in ('order', 'adjustment', 'legacy_backfill', 'legacy_refund')
  ),
  original_points integer not null check (original_points > 0),
  remaining_points integer not null check (remaining_points >= 0),
  expired_points integer not null default 0 check (expired_points >= 0),
  revoked_points integer not null default 0 check (revoked_points >= 0),
  original_expires_at timestamptz,
  expires_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_points + expired_points + revoked_points <= original_points)
);

create unique index point_lots_source_transaction_unique
  on public.point_lots(source_transaction_id)
  where source_transaction_id is not null;

create unique index point_lots_legacy_backfill_unique
  on public.point_lots(customer_user_id, store_id)
  where source_kind = 'legacy_backfill';

create index point_lots_fifo_lookup
  on public.point_lots(
    customer_user_id,
    store_id,
    expires_at,
    created_at,
    id
  )
  where remaining_points > 0 and revoked_at is null;

create index point_lots_store_lookup
  on public.point_lots(store_id, customer_user_id, created_at desc);

create index point_lots_source_order
  on public.point_lots(source_order_id)
  where source_order_id is not null;

create trigger trg_point_lots_updated_at
before update on public.point_lots
for each row execute function public.set_updated_at();

create table public.point_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  use_transaction_id uuid not null references public.point_transactions(id) on delete restrict,
  lot_id uuid not null references public.point_lots(id) on delete restrict,
  allocated_points integer not null check (allocated_points > 0),
  restored_points integer not null default 0 check (restored_points >= 0),
  restore_transaction_id uuid references public.point_transactions(id) on delete restrict,
  restored_at timestamptz,
  created_at timestamptz not null default now(),
  check (restored_points <= allocated_points),
  unique (use_transaction_id, lot_id)
);

create index point_lot_allocations_lot
  on public.point_lot_allocations(lot_id);

create index point_lot_allocations_restore_transaction
  on public.point_lot_allocations(restore_transaction_id)
  where restore_transaction_id is not null;

alter table public.point_lots enable row level security;
alter table public.point_lot_allocations enable row level security;

revoke all privileges on table public.point_lots from public, anon, authenticated;
revoke all privileges on table public.point_lot_allocations from public, anon, authenticated;
grant select on table public.point_lots to authenticated;
grant select on table public.point_lot_allocations to authenticated;
grant select, insert, update, delete on table public.point_lots to service_role;
grant select, insert, update, delete on table public.point_lot_allocations to service_role;

create policy point_lots_select_self
on public.point_lots
for select
to authenticated
using ((select auth.uid()) = customer_user_id);

create policy point_lots_select_store_member
on public.point_lots
for select
to authenticated
using (public.is_store_member(store_id) or public.is_ops_user());

create policy point_lot_allocations_select_self
on public.point_lot_allocations
for select
to authenticated
using (
  exists (
    select 1
    from public.point_lots l
    where l.id = point_lot_allocations.lot_id
      and l.customer_user_id = (select auth.uid())
  )
);

create policy point_lot_allocations_select_store_member
on public.point_lot_allocations
for select
to authenticated
using (
  exists (
    select 1
    from public.point_lots l
    where l.id = point_lot_allocations.lot_id
      and (public.is_store_member(l.store_id) or public.is_ops_user())
  )
);

-- Preserve every pre-migration positive wallet balance as a non-expiring lot.
insert into public.point_lots (
  customer_user_id,
  store_id,
  source_kind,
  original_points,
  remaining_points,
  original_expires_at,
  expires_at,
  created_at,
  updated_at
)
select
  w.customer_user_id,
  w.store_id,
  'legacy_backfill',
  w.point_balance,
  w.point_balance,
  null,
  null,
  w.created_at,
  now()
from public.customer_store_wallets w
where w.point_balance > 0
on conflict (customer_user_id, store_id)
  where source_kind = 'legacy_backfill'
do nothing;

do $$
declare
  v_wallet_total bigint;
  v_legacy_total bigint;
begin
  select coalesce(sum(w.point_balance), 0)
  into v_wallet_total
  from public.customer_store_wallets w
  where w.point_balance > 0;

  select coalesce(sum(l.remaining_points), 0)
  into v_legacy_total
  from public.point_lots l
  where l.source_kind = 'legacy_backfill';

  if v_wallet_total <> v_legacy_total then
    raise exception 'POINT_LOT_BACKFILL_MISMATCH: wallet %, lot %',
      v_wallet_total,
      v_legacy_total;
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.current_available_points(
  p_customer_user_id uuid,
  p_store_id text,
  p_at timestamptz default now()
)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    0,
    coalesce((
      select sum(l.remaining_points)::integer
      from public.point_lots l
      where l.customer_user_id = p_customer_user_id
        and l.store_id = p_store_id
        and l.remaining_points > 0
        and l.revoked_at is null
        and (l.expires_at is null or l.expires_at > p_at)
    ), 0) - coalesce((
      select w.point_recovery_amount
      from public.customer_store_wallets w
      where w.customer_user_id = p_customer_user_id
        and w.store_id = p_store_id
    ), 0)
  )::integer;
$$;

create or replace function private.refresh_wallet_point_balance(
  p_customer_user_id uuid,
  p_store_id text,
  p_at timestamptz default now()
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_balance integer;
begin
  v_balance := private.current_available_points(
    p_customer_user_id,
    p_store_id,
    p_at
  );

  update public.customer_store_wallets w
  set point_balance = v_balance,
      updated_at = p_at
  where w.customer_user_id = p_customer_user_id
    and w.store_id = p_store_id;

  return v_balance;
end;
$$;

create or replace function private.expire_due_point_lots(
  p_customer_user_id uuid,
  p_store_id text,
  p_at timestamptz default now()
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_lot record;
  v_expired_total integer := 0;
  v_balance integer;
begin
  for v_lot in
    select l.id, l.remaining_points, l.expires_at
    from public.point_lots l
    where l.customer_user_id = p_customer_user_id
      and l.store_id = p_store_id
      and l.remaining_points > 0
      and l.revoked_at is null
      and l.expires_at is not null
      and l.expires_at <= p_at
    order by l.expires_at, l.created_at, l.id
    for update
  loop
    update public.point_lots l
    set remaining_points = 0,
        expired_points = l.expired_points + v_lot.remaining_points,
        expired_at = p_at,
        updated_at = p_at
    where l.id = v_lot.id;

    v_expired_total := v_expired_total + v_lot.remaining_points;
    v_balance := private.refresh_wallet_point_balance(
      p_customer_user_id,
      p_store_id,
      p_at
    );

    insert into public.point_transactions (
      customer_user_id,
      store_id,
      tx_type,
      points,
      balance_after,
      reason,
      idempotency_key,
      expires_at
    ) values (
      p_customer_user_id,
      p_store_id,
      'expire',
      -v_lot.remaining_points,
      v_balance,
      'point lot expired',
      'point-lot:' || v_lot.id::text || ':expire:' || v_lot.expires_at::text,
      v_lot.expires_at
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  return v_expired_total;
end;
$$;

create or replace function private.consume_point_lots(
  p_customer_user_id uuid,
  p_store_id text,
  p_order_id uuid,
  p_points integer,
  p_idempotency_key text,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_available integer;
  v_remaining integer := p_points;
  v_take integer;
  v_tx_id uuid;
  v_existing_tx_id uuid;
  v_lot record;
  v_balance integer;
begin
  if p_points <= 0 then
    return null;
  end if;

  select t.id into v_existing_tx_id
  from public.point_transactions t
  where t.idempotency_key = p_idempotency_key;

  if v_existing_tx_id is not null then
    return v_existing_tx_id;
  end if;

  v_available := private.current_available_points(
    p_customer_user_id,
    p_store_id,
    p_at
  );

  if p_points > v_available then
    raise exception 'insufficient point balance';
  end if;

  insert into public.point_transactions (
    customer_user_id,
    store_id,
    order_id,
    tx_type,
    points,
    balance_after,
    reason,
    idempotency_key
  ) values (
    p_customer_user_id,
    p_store_id,
    p_order_id,
    'use',
    -p_points,
    greatest(0, v_available - p_points),
    'order payment',
    p_idempotency_key
  )
  returning id into v_tx_id;

  for v_lot in
    select l.id, l.remaining_points
    from public.point_lots l
    where l.customer_user_id = p_customer_user_id
      and l.store_id = p_store_id
      and l.remaining_points > 0
      and l.revoked_at is null
      and (l.expires_at is null or l.expires_at > p_at)
    order by l.expires_at asc nulls last, l.created_at, l.id
    for update
  loop
    exit when v_remaining = 0;
    v_take := least(v_remaining, v_lot.remaining_points);

    update public.point_lots l
    set remaining_points = l.remaining_points - v_take,
        updated_at = p_at
    where l.id = v_lot.id;

    insert into public.point_lot_allocations (
      use_transaction_id,
      lot_id,
      allocated_points
    ) values (
      v_tx_id,
      v_lot.id,
      v_take
    );

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining <> 0 then
    raise exception 'POINT_LOT_ALLOCATION_MISMATCH';
  end if;

  v_balance := private.refresh_wallet_point_balance(
    p_customer_user_id,
    p_store_id,
    p_at
  );

  update public.point_transactions t
  set balance_after = v_balance
  where t.id = v_tx_id;

  return v_tx_id;
end;
$$;

create or replace view public.customer_point_summaries
with (security_invoker = true)
as
select
  w.customer_user_id,
  w.store_id,
  greatest(
    0,
    coalesce(p.active_points, 0) - w.point_recovery_amount
  )::integer as point_balance,
  w.tier,
  w.lifetime_spent,
  w.lifetime_orders,
  w.last_order_at,
  w.created_at,
  w.updated_at,
  case
    when greatest(0, coalesce(p.active_points, 0) - w.point_recovery_amount) > 0
      then p.nearest_expiry_at
    else null
  end as nearest_expiry_at,
  least(
    greatest(0, coalesce(p.active_points, 0) - w.point_recovery_amount),
    coalesce(p.expiring_soon_points, 0)
  )::integer as expiring_soon_points
from public.customer_store_wallets w
left join lateral (
  select
    coalesce(sum(l.remaining_points), 0)::integer as active_points,
    min(l.expires_at) filter (where l.expires_at is not null) as nearest_expiry_at,
    coalesce(sum(l.remaining_points) filter (
      where l.expires_at is not null
        and l.expires_at <= now() + interval '30 days'
    ), 0)::integer as expiring_soon_points
  from public.point_lots l
  where l.customer_user_id = w.customer_user_id
    and l.store_id = w.store_id
    and l.remaining_points > 0
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
) p on true;

revoke all privileges on table public.customer_point_summaries
from public, anon, authenticated;
grant select on table public.customer_point_summaries to authenticated, service_role;

create or replace function public.apply_loyalty_on_paid_order(
  p_order_id uuid,
  p_store_id text,
  p_customer_user_id uuid,
  p_order_amount integer,
  p_used_points integer default 0,
  p_used_coupon_id uuid default null,
  p_idempotency_key text default null
)
returns table (
  used_points integer,
  used_coupon_id uuid,
  earned_points integer,
  point_balance integer,
  tier text,
  rate_pct numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_settings public.store_loyalty_settings%rowtype;
  v_wallet public.customer_store_wallets%rowtype;
  v_now timestamptz := now();
  v_tier text;
  v_rate numeric;
  v_max_redeem integer;
  v_earned integer;
  v_net_earned integer;
  v_recovery_offset integer := 0;
  v_coupon_template_id uuid;
  v_coupon_discount_type text;
  v_coupon_discount_value integer;
  v_coupon_min_order_amount integer;
  v_coupon_max_discount_amount integer;
  v_coupon_discount integer := 0;
  v_expiry timestamptz;
  v_earn_tx_id uuid;
  v_balance integer;
  v_key text := coalesce(nullif(p_idempotency_key, ''), p_order_id::text || ':loyalty');
begin
  if p_customer_user_id is null then
    raise exception 'customer_user_id is required for loyalty';
  end if;
  if coalesce(p_order_amount, 0) <= 0 then
    raise exception 'order_amount must be positive';
  end if;
  if p_used_points < 0 then
    raise exception 'used_points cannot be negative';
  end if;
  if p_used_points > 0 and p_used_coupon_id is not null then
    raise exception 'Only one discount method allowed (point OR coupon)';
  end if;

  -- The order row is the first lock and the idempotency guard. No wallet,
  -- coupon, lot, or ledger mutation occurs before this check.
  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.store_id = p_store_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;
  if v_order.customer_user_id is not null
     and v_order.customer_user_id <> p_customer_user_id then
    raise exception 'order customer mismatch';
  end if;

  if v_order.loyalty_snapshot is not null then
    used_points := coalesce(v_order.used_points, 0);
    used_coupon_id := v_order.used_coupon_id;
    earned_points := coalesce(v_order.earned_points, 0);
    point_balance := private.current_available_points(
      p_customer_user_id,
      p_store_id,
      v_now
    );
    tier := coalesce(v_order.loyalty_snapshot->>'tier', 'general');
    rate_pct := coalesce((v_order.loyalty_snapshot->>'rate_pct')::numeric, 0);
    return next;
    return;
  end if;

  select * into v_settings
  from public.store_loyalty_settings s
  where s.store_id = p_store_id;

  if not found then
    insert into public.store_loyalty_settings(store_id)
    values (p_store_id)
    on conflict (store_id) do nothing;

    select * into v_settings
    from public.store_loyalty_settings s
    where s.store_id = p_store_id;
  end if;

  insert into public.customer_store_wallets (customer_user_id, store_id)
  values (p_customer_user_id, p_store_id)
  on conflict (customer_user_id, store_id) do nothing;

  select * into v_wallet
  from public.customer_store_wallets w
  where w.customer_user_id = p_customer_user_id
    and w.store_id = p_store_id
  for update;

  perform private.expire_due_point_lots(
    p_customer_user_id,
    p_store_id,
    v_now
  );

  v_max_redeem := floor(
    (p_order_amount::numeric * v_settings.max_redeem_pct) / 100.0
  )::integer;

  if p_used_points > 0 then
    if p_used_points < v_settings.min_redeem_points then
      raise exception 'used_points is lower than store minimum';
    end if;
    if p_used_points > v_max_redeem then
      raise exception 'used_points exceeds max redeem percent for this store';
    end if;
    if p_used_points > private.current_available_points(
      p_customer_user_id,
      p_store_id,
      v_now
    ) then
      raise exception 'insufficient point balance';
    end if;
  end if;

  if p_used_coupon_id is not null then
    select
      cc.template_id,
      cc.discount_type_snapshot,
      cc.discount_value_snapshot,
      cc.min_order_amount_snapshot,
      cc.max_discount_amount_snapshot
    into
      v_coupon_template_id,
      v_coupon_discount_type,
      v_coupon_discount_value,
      v_coupon_min_order_amount,
      v_coupon_max_discount_amount
    from public.customer_coupons cc
    where cc.id = p_used_coupon_id
      and cc.customer_user_id = p_customer_user_id
      and cc.store_id = p_store_id
      and cc.status = 'issued'
      and (cc.expires_at is null or cc.expires_at > v_now)
    for update;

    if not found then
      raise exception 'coupon is not valid';
    end if;

    if v_coupon_discount_type is not null
      and v_coupon_discount_value is not null
      and v_coupon_min_order_amount is not null then
      if p_order_amount < v_coupon_min_order_amount then
        raise exception 'Order amount is below coupon minimum';
      end if;
      if v_coupon_discount_type = 'fixed_amount' then
        v_coupon_discount := least(v_coupon_discount_value, p_order_amount);
      else
        v_coupon_discount := floor(
          (p_order_amount::numeric * v_coupon_discount_value::numeric) / 100.0
        )::integer;
        if v_coupon_max_discount_amount is not null then
          v_coupon_discount := least(
            v_coupon_discount,
            v_coupon_max_discount_amount
          );
        end if;
        v_coupon_discount := least(v_coupon_discount, p_order_amount);
      end if;
      v_coupon_discount := greatest(v_coupon_discount, 0);
    elsif v_coupon_template_id is not null then
      v_coupon_discount := public.calculate_coupon_discount(
        v_coupon_template_id,
        p_order_amount
      );
    else
      raise exception 'coupon template data is missing; please reissue this coupon';
    end if;
  end if;

  v_tier := coalesce(v_wallet.tier, 'general');
  v_rate := public.get_store_point_rate_pct(p_store_id, v_tier);
  v_earned := floor((
    greatest(0, p_order_amount - p_used_points - v_coupon_discount)::numeric
    * v_rate
  ) / 100.0)::integer;

  if p_used_points > 0 then
    perform private.consume_point_lots(
      p_customer_user_id,
      p_store_id,
      p_order_id,
      p_used_points,
      v_key || ':use',
      v_now
    );
  end if;

  if p_used_coupon_id is not null then
    update public.customer_coupons c
    set status = 'used',
        used_at = v_now,
        used_order_id = p_order_id,
        updated_at = v_now
    where c.id = p_used_coupon_id;
  end if;

  if v_earned > 0 then
    select least(v_earned, w.point_recovery_amount)
    into v_recovery_offset
    from public.customer_store_wallets w
    where w.customer_user_id = p_customer_user_id
      and w.store_id = p_store_id;

    v_net_earned := v_earned - coalesce(v_recovery_offset, 0);
    v_expiry := case
      when v_settings.point_expiry_months = 0 then null
      else v_now + make_interval(months => v_settings.point_expiry_months)
    end;

    insert into public.point_transactions (
      customer_user_id,
      store_id,
      order_id,
      tx_type,
      points,
      balance_after,
      reason,
      idempotency_key,
      expires_at
    ) values (
      p_customer_user_id,
      p_store_id,
      p_order_id,
      'earn',
      v_earned,
      0,
      'order payment',
      v_key || ':earn',
      v_expiry
    )
    returning id into v_earn_tx_id;

    if v_recovery_offset > 0 then
      update public.customer_store_wallets w
      set point_recovery_amount = w.point_recovery_amount - v_recovery_offset,
          updated_at = v_now
      where w.customer_user_id = p_customer_user_id
        and w.store_id = p_store_id;
    end if;

    if v_net_earned > 0 then
      insert into public.point_lots (
        customer_user_id,
        store_id,
        source_transaction_id,
        source_order_id,
        source_kind,
        original_points,
        remaining_points,
        original_expires_at,
        expires_at
      ) values (
        p_customer_user_id,
        p_store_id,
        v_earn_tx_id,
        p_order_id,
        'order',
        v_net_earned,
        v_net_earned,
        v_expiry,
        v_expiry
      );
    end if;

    v_balance := private.refresh_wallet_point_balance(
      p_customer_user_id,
      p_store_id,
      v_now
    );

    update public.point_transactions t
    set balance_after = v_balance
    where t.id = v_earn_tx_id;

    if v_recovery_offset > 0 then
      insert into public.point_transactions (
        customer_user_id,
        store_id,
        order_id,
        tx_type,
        points,
        balance_after,
        reason,
        idempotency_key
      ) values (
        p_customer_user_id,
        p_store_id,
        p_order_id,
        'recovery_offset',
        -v_recovery_offset,
        v_balance,
        'earned points offset recovery amount',
        v_key || ':recovery-offset'
      );
    end if;
  else
    v_net_earned := 0;
    v_balance := private.refresh_wallet_point_balance(
      p_customer_user_id,
      p_store_id,
      v_now
    );
  end if;

  update public.customer_store_wallets w
  set lifetime_spent = w.lifetime_spent + greatest(
        0,
        p_order_amount - p_used_points - v_coupon_discount
      ),
      lifetime_orders = w.lifetime_orders + 1,
      last_order_at = v_now,
      updated_at = v_now
  where w.customer_user_id = p_customer_user_id
    and w.store_id = p_store_id;

  update public.orders o
  set customer_user_id = p_customer_user_id,
      applied_discount_type = case
        when p_used_points > 0 then 'point'
        when p_used_coupon_id is not null then 'coupon'
        else null
      end,
      used_points = p_used_points,
      used_coupon_id = p_used_coupon_id,
      earned_points = v_earned,
      points_rate_snapshot = v_rate,
      loyalty_snapshot = jsonb_build_object(
        'tier', v_tier,
        'rate_pct', v_rate,
        'max_redeem_pct', v_settings.max_redeem_pct,
        'min_redeem_points', v_settings.min_redeem_points,
        'point_expiry_months', v_settings.point_expiry_months,
        'point_expires_at', v_expiry,
        'gross_earned_points', v_earned,
        'recovery_offset_points', v_recovery_offset,
        'net_lot_points', v_net_earned,
        'coupon_discount', v_coupon_discount
      )
  where o.id = p_order_id
    and o.store_id = p_store_id;

  used_points := p_used_points;
  used_coupon_id := p_used_coupon_id;
  earned_points := v_earned;
  point_balance := v_balance;
  tier := v_tier;
  rate_pct := v_rate;
  return next;
end;
$$;

create or replace function public.rollback_order_rewards(
  p_store_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
  v_coupon_discount integer := 0;
  v_paid_amount integer := 0;
  v_revoked_remaining integer := 0;
  v_expired_from_earn integer := 0;
  v_recovery_add integer := 0;
  v_recovery_release integer := 0;
  v_release_for_allocation integer := 0;
  v_use_tx_id uuid;
  v_restore_tx_id uuid;
  v_allocation record;
  v_lot public.point_lots%rowtype;
  v_restore_points integer;
  v_restored_total integer := 0;
  v_allocation_count integer := 0;
  v_balance integer;
begin
  select * into v_order
  from public.orders o
  where o.store_id = p_store_id
    and o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;
  if v_order.customer_user_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest_order');
  end if;
  if v_order.status not in ('cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'skipped', 'order_not_cancelled_or_refunded');
  end if;
  if coalesce(v_order.earned_points, 0) = 0
     and coalesce(v_order.used_points, 0) = 0
     and v_order.used_coupon_id is null
     and v_order.loyalty_snapshot is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_rewards_to_rollback');
  end if;

  insert into public.customer_store_wallets (customer_user_id, store_id)
  values (v_order.customer_user_id, p_store_id)
  on conflict (customer_user_id, store_id) do nothing;

  perform 1
  from public.customer_store_wallets w
  where w.customer_user_id = v_order.customer_user_id
    and w.store_id = p_store_id
  for update;

  perform private.expire_due_point_lots(
    v_order.customer_user_id,
    p_store_id,
    v_now
  );

  v_coupon_discount := greatest(
    0,
    coalesce((v_order.loyalty_snapshot->>'coupon_discount')::integer, 0)
  );
  v_paid_amount := greatest(
    0,
    coalesce(v_order.total_price, 0)
      - coalesce(v_order.used_points, 0)
      - v_coupon_discount
  );

  if coalesce(v_order.earned_points, 0) > 0 then
    perform 1
    from public.point_lots l
    where l.source_order_id = v_order.id
      and l.customer_user_id = v_order.customer_user_id
      and l.store_id = p_store_id
    order by l.expires_at asc nulls last, l.created_at, l.id
    for update;

    select
      coalesce(sum(l.remaining_points), 0)::integer,
      coalesce(sum(l.expired_points), 0)::integer
    into v_revoked_remaining, v_expired_from_earn
    from public.point_lots l
    where l.source_order_id = v_order.id
      and l.customer_user_id = v_order.customer_user_id
      and l.store_id = p_store_id;

    update public.point_lots l
    set remaining_points = 0,
        revoked_points = l.revoked_points + l.remaining_points,
        revoked_at = v_now,
        updated_at = v_now
    where l.source_order_id = v_order.id
      and l.customer_user_id = v_order.customer_user_id
      and l.store_id = p_store_id
      and l.revoked_at is null;

    v_recovery_add := greatest(
      0,
      v_order.earned_points - v_revoked_remaining - v_expired_from_earn
    );

    if v_recovery_add > 0 then
      update public.customer_store_wallets w
      set point_recovery_amount = w.point_recovery_amount + v_recovery_add,
          updated_at = v_now
      where w.customer_user_id = v_order.customer_user_id
        and w.store_id = p_store_id;
    end if;

    v_balance := private.refresh_wallet_point_balance(
      v_order.customer_user_id,
      p_store_id,
      v_now
    );

    insert into public.point_transactions (
      customer_user_id,
      store_id,
      order_id,
      tx_type,
      points,
      balance_after,
      reason,
      idempotency_key
    ) values (
      v_order.customer_user_id,
      p_store_id,
      v_order.id,
      'rollback',
      -v_order.earned_points,
      v_balance,
      'order cancelled/refunded rollback (earn)',
      v_order.id::text || ':rollback:earn'
    ) on conflict (idempotency_key) do nothing;

    if v_recovery_add > 0 then
      insert into public.point_transactions (
        customer_user_id,
        store_id,
        order_id,
        tx_type,
        points,
        balance_after,
        reason,
        idempotency_key
      ) values (
        v_order.customer_user_id,
        p_store_id,
        v_order.id,
        'recovery_add',
        -v_recovery_add,
        v_balance,
        'cancelled earned points already spent or offset',
        v_order.id::text || ':rollback:recovery-add'
      ) on conflict (idempotency_key) do nothing;
    end if;
  end if;

  if coalesce(v_order.used_points, 0) > 0 then
    select t.id into v_use_tx_id
    from public.point_transactions t
    where t.order_id = v_order.id
      and t.customer_user_id = v_order.customer_user_id
      and t.store_id = p_store_id
      and t.tx_type = 'use'
    order by t.created_at
    limit 1;

    insert into public.point_transactions (
      customer_user_id,
      store_id,
      order_id,
      tx_type,
      points,
      balance_after,
      reason,
      idempotency_key
    ) values (
      v_order.customer_user_id,
      p_store_id,
      v_order.id,
      'restore',
      v_order.used_points,
      0,
      'order cancelled/refunded restore used points',
      v_order.id::text || ':rollback:use'
    )
    on conflict (idempotency_key) do nothing
    returning id into v_restore_tx_id;

    if v_restore_tx_id is not null and v_use_tx_id is not null then
      for v_allocation in
        select a.id, a.lot_id, a.allocated_points, a.restored_points
        from public.point_lot_allocations a
        where a.use_transaction_id = v_use_tx_id
        order by a.created_at, a.id
        for update
      loop
        v_allocation_count := v_allocation_count + 1;
        v_restore_points := v_allocation.allocated_points - v_allocation.restored_points;
        if v_restore_points <= 0 then
          continue;
        end if;

        select * into v_lot
        from public.point_lots l
        where l.id = v_allocation.lot_id
        for update;

        if v_lot.revoked_at is not null then
          select least(v_restore_points, w.point_recovery_amount)
          into v_release_for_allocation
          from public.customer_store_wallets w
          where w.customer_user_id = v_order.customer_user_id
            and w.store_id = p_store_id;

          update public.customer_store_wallets w
          set point_recovery_amount = w.point_recovery_amount
                - v_release_for_allocation,
              updated_at = v_now
          where w.customer_user_id = v_order.customer_user_id
            and w.store_id = p_store_id;

          v_recovery_release := v_recovery_release
            + coalesce(v_release_for_allocation, 0);
        else
          update public.point_lots l
          set remaining_points = l.remaining_points + v_restore_points,
              expires_at = case
                when l.expires_at is null then null
                else greatest(l.expires_at, v_now + interval '30 days')
              end,
              expired_at = null,
              updated_at = v_now
          where l.id = v_lot.id;
        end if;

        update public.point_lot_allocations a
        set restored_points = a.restored_points + v_restore_points,
            restore_transaction_id = v_restore_tx_id,
            restored_at = v_now
        where a.id = v_allocation.id;

        v_restored_total := v_restored_total + v_restore_points;
      end loop;
    end if;

    if v_restore_tx_id is not null and v_allocation_count = 0 then
      insert into public.point_lots (
        customer_user_id,
        store_id,
        source_transaction_id,
        source_order_id,
        source_kind,
        original_points,
        remaining_points,
        original_expires_at,
        expires_at
      ) values (
        v_order.customer_user_id,
        p_store_id,
        v_restore_tx_id,
        v_order.id,
        'legacy_refund',
        v_order.used_points,
        v_order.used_points,
        null,
        v_now + interval '30 days'
      );
      v_restored_total := v_order.used_points;
    end if;

    v_balance := private.refresh_wallet_point_balance(
      v_order.customer_user_id,
      p_store_id,
      v_now
    );

    if v_restore_tx_id is not null then
      update public.point_transactions t
      set balance_after = v_balance,
          points = v_restored_total
      where t.id = v_restore_tx_id;
    end if;

    if v_recovery_release > 0 then
      insert into public.point_transactions (
        customer_user_id,
        store_id,
        order_id,
        tx_type,
        points,
        balance_after,
        reason,
        idempotency_key
      ) values (
        v_order.customer_user_id,
        p_store_id,
        v_order.id,
        'recovery_release',
        v_recovery_release,
        v_balance,
        'restored use released recovery amount',
        v_order.id::text || ':rollback:recovery-release'
      ) on conflict (idempotency_key) do nothing;
    end if;
  end if;

  if v_order.used_coupon_id is not null then
    update public.customer_coupons c
    set status = 'issued',
        used_at = null,
        used_order_id = null,
        updated_at = v_now
    where c.id = v_order.used_coupon_id
      and c.store_id = p_store_id
      and c.customer_user_id = v_order.customer_user_id;
  end if;

  if v_order.loyalty_snapshot is not null then
    update public.customer_store_wallets w
    set lifetime_spent = greatest(0, w.lifetime_spent - v_paid_amount),
        lifetime_orders = greatest(0, w.lifetime_orders - 1),
        updated_at = v_now
    where w.customer_user_id = v_order.customer_user_id
      and w.store_id = p_store_id;
  end if;

  update public.customer_coupons c
  set status = 'cancelled',
      updated_at = v_now
  where c.id in (
    select l.coupon_id
    from public.coupon_auto_issue_logs l
    where l.store_id = p_store_id
      and l.customer_user_id = v_order.customer_user_id
      and l.order_id = v_order.id
      and l.coupon_id is not null
  )
    and c.status = 'issued';

  delete from public.coupon_auto_issue_logs l
  where l.store_id = p_store_id
    and l.customer_user_id = v_order.customer_user_id
    and l.order_id = v_order.id;

  update public.orders o
  set earned_points = 0,
      points_rate_snapshot = null,
      loyalty_snapshot = null,
      applied_discount_type = null,
      used_points = 0,
      used_coupon_id = null
  where o.id = v_order.id
    and o.store_id = p_store_id;

  perform private.refresh_wallet_point_balance(
    v_order.customer_user_id,
    p_store_id,
    v_now
  );

  if v_order.loyalty_snapshot is not null then
    perform public.recalculate_customer_tier(
      p_store_id,
      v_order.customer_user_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'rolled_back', true,
    'restored_points', v_restored_total,
    'recovery_added', v_recovery_add,
    'recovery_released', v_recovery_release
  );
end;
$$;

create or replace function public.admin_search_coupon_targets(
  p_store_id text,
  p_query text default '',
  p_tier text default 'all',
  p_min_points integer default 0,
  p_min_orders integer default 0,
  p_min_spent integer default 0,
  p_recent_days integer default null,
  p_inactive_days integer default null,
  p_registered_min_days integer default null,
  p_template_id uuid default null,
  p_exclude_existing boolean default true,
  p_limit integer default 100
)
returns table (
  customer_user_id uuid,
  name text,
  phone text,
  point_balance integer,
  tier text,
  lifetime_spent integer,
  lifetime_orders integer,
  last_order_at timestamptz,
  registered_at timestamptz,
  already_has_coupon boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  return query
  with latest_orders as (
    select o.customer_user_id, max(o.created_at) as last_order_at
    from public.orders o
    where o.store_id = p_store_id
      and o.customer_user_id is not null
    group by o.customer_user_id
  ), target_rows as (
    select
      v.customer_user_id,
      cp.name,
      cp.phone,
      v.point_balance,
      v.tier,
      v.lifetime_spent,
      v.lifetime_orders,
      coalesce(v.last_order_at, lo.last_order_at) as last_order_at,
      v.created_at as registered_at,
      exists (
        select 1
        from public.customer_coupons cc
        where cc.store_id = p_store_id
          and cc.customer_user_id = v.customer_user_id
          and cc.template_id = p_template_id
          and cc.status <> 'cancelled'
      ) as already_has_coupon
    from public.customer_point_summaries v
    left join public.customer_profiles cp
      on cp.user_id = v.customer_user_id
    left join latest_orders lo
      on lo.customer_user_id = v.customer_user_id
    where v.store_id = p_store_id
      and (coalesce(p_tier, 'all') = 'all' or v.tier = p_tier)
      and v.point_balance >= greatest(coalesce(p_min_points, 0), 0)
      and v.lifetime_orders >= greatest(coalesce(p_min_orders, 0), 0)
      and v.lifetime_spent >= greatest(coalesce(p_min_spent, 0), 0)
      and (
        v_query = ''
        or coalesce(cp.name, '') ilike '%' || v_query || '%'
        or coalesce(cp.phone, '') ilike '%' || v_query || '%'
        or v.customer_user_id::text ilike '%' || v_query || '%'
      )
      and (
        p_recent_days is null
        or coalesce(v.last_order_at, lo.last_order_at)
          >= now() - make_interval(days => greatest(p_recent_days, 0))
      )
      and (
        p_inactive_days is null
        or coalesce(v.last_order_at, lo.last_order_at, 'epoch'::timestamptz)
          < now() - make_interval(days => greatest(p_inactive_days, 0))
      )
      and (
        p_registered_min_days is null
        or v.created_at
          <= now() - make_interval(days => greatest(p_registered_min_days, 0))
      )
  )
  select *
  from target_rows tr
  where not (
    coalesce(p_exclude_existing, true)
    and p_template_id is not null
    and tr.already_has_coupon
  )
  order by
    tr.tier desc,
    tr.lifetime_spent desc,
    tr.lifetime_orders desc,
    tr.registered_at desc
  limit v_limit;
end;
$$;

-- Keep wallet.point_balance as a compatibility cache for legacy code paths.
update public.customer_store_wallets w
set point_balance = private.current_available_points(
  w.customer_user_id,
  w.store_id,
  now()
);

revoke all privileges on function public.apply_loyalty_on_paid_order(
  uuid, text, uuid, integer, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.apply_loyalty_on_paid_order(
  uuid, text, uuid, integer, integer, uuid, text
) to service_role;

revoke all privileges on function public.rollback_order_rewards(text, uuid)
from public, anon, authenticated;
grant execute on function public.rollback_order_rewards(text, uuid)
to service_role;

revoke all privileges on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) to service_role;

revoke all privileges on function private.current_available_points(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all privileges on function private.refresh_wallet_point_balance(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all privileges on function private.expire_due_point_lots(
  uuid, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all privileges on function private.consume_point_lots(
  uuid, text, uuid, integer, text, timestamptz
) from public, anon, authenticated, service_role;

commit;
