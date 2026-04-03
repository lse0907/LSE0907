-- =========================================================
-- QR Cafe MVP - Loyalty & Coupon v1
-- Date: 2026-03-24
-- Purpose:
--  1) Member loyalty points (store-scoped wallets)
--  2) Tier/rate rules configurable per store
--  3) Store coupon templates + customer-issued coupons
--  4) Safe point/coupon application via RPC
--
-- Notes:
--  - Designed to keep guest ordering possible.
--  - Discount method is exclusive: points OR coupon.
--  - Rates are configurable by store manager in 1%~10%.
--  - Max redeem percent default 30, configurable up to 100.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- 0) Helper: updated_at trigger
-- ---------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------
-- 1) Customer profile (consumer/member)
-- ---------------------------------------------------------
create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  phone text,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_customer_profiles_updated_at on public.customer_profiles;
create trigger trg_customer_profiles_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 2) Store-scoped wallet & tier
-- ---------------------------------------------------------
create table if not exists public.customer_store_wallets (
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  point_balance integer not null default 0,
  tier text not null default 'general' check (tier in ('general','regular','vip')),
  lifetime_spent integer not null default 0 check (lifetime_spent >= 0),
  lifetime_orders integer not null default 0 check (lifetime_orders >= 0),
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (customer_user_id, store_id)
);

create index if not exists idx_customer_store_wallets_store
  on public.customer_store_wallets(store_id);

drop trigger if exists trg_customer_store_wallets_updated_at on public.customer_store_wallets;
create trigger trg_customer_store_wallets_updated_at
before update on public.customer_store_wallets
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 3) Point transaction ledger
-- ---------------------------------------------------------
create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  tx_type text not null check (tx_type in ('earn','use','expire','adjust_plus','adjust_minus','rollback')),
  points integer not null,
  balance_after integer not null,
  reason text,
  idempotency_key text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists idx_point_tx_customer_store_created
  on public.point_transactions(customer_user_id, store_id, created_at desc);

create index if not exists idx_point_tx_store_created
  on public.point_transactions(store_id, created_at desc);

-- ---------------------------------------------------------
-- 4) Store loyalty settings (manager configurable)
-- ---------------------------------------------------------
create table if not exists public.store_loyalty_settings (
  store_id text primary key references public.stores(store_id) on delete cascade,
  tier_general_rate_pct numeric(4,2) not null default 2.00 check (tier_general_rate_pct between 1.00 and 10.00),
  tier_regular_rate_pct numeric(4,2) not null default 3.00 check (tier_regular_rate_pct between 1.00 and 10.00),
  tier_vip_rate_pct numeric(4,2) not null default 5.00 check (tier_vip_rate_pct between 1.00 and 10.00),
  thank_you_every_n_orders integer not null default 10 check (thank_you_every_n_orders between 1 and 1000),
  max_redeem_pct numeric(5,2) not null default 30.00 check (max_redeem_pct between 0.00 and 100.00),
  min_redeem_points integer not null default 100 check (min_redeem_points >= 0),
  point_expiry_months integer not null default 12 check (point_expiry_months >= 0),
  allow_point_or_coupon_only boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tier_general_rate_pct <= tier_regular_rate_pct and tier_regular_rate_pct <= tier_vip_rate_pct)
);

alter table public.store_loyalty_settings
  add column if not exists thank_you_every_n_orders integer not null default 10;

drop trigger if exists trg_store_loyalty_settings_updated_at on public.store_loyalty_settings;
create trigger trg_store_loyalty_settings_updated_at
before update on public.store_loyalty_settings
for each row execute function public.set_updated_at();

-- seed defaults for existing stores
insert into public.store_loyalty_settings (store_id)
select s.store_id
from public.stores s
on conflict (store_id) do nothing;

-- ---------------------------------------------------------
-- 5) Tier rules (manager configurable)
-- ---------------------------------------------------------
create table if not exists public.store_tier_rules (
  store_id text primary key references public.stores(store_id) on delete cascade,
  lookback_months integer not null default 6 check (lookback_months between 1 and 60),
  regular_min_spent integer not null default 200000 check (regular_min_spent >= 0),
  regular_min_orders integer not null default 10 check (regular_min_orders >= 0),
  vip_min_spent integer not null default 500000 check (vip_min_spent >= 0),
  vip_min_orders integer not null default 25 check (vip_min_orders >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (vip_min_spent >= regular_min_spent),
  check (vip_min_orders >= regular_min_orders)
);

drop trigger if exists trg_store_tier_rules_updated_at on public.store_tier_rules;
create trigger trg_store_tier_rules_updated_at
before update on public.store_tier_rules
for each row execute function public.set_updated_at();

insert into public.store_tier_rules (store_id)
select s.store_id
from public.stores s
on conflict (store_id) do nothing;

-- ---------------------------------------------------------
-- 6) Coupon templates + customer coupons
-- ---------------------------------------------------------
create table if not exists public.store_coupon_templates (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete cascade,
  coupon_kind text not null check (coupon_kind in ('first_order','thank_you','event')),
  name text not null,
  discount_type text not null check (discount_type in ('fixed_amount','percent')),
  discount_value integer not null check (discount_value > 0),
  min_order_amount integer not null default 0 check (min_order_amount >= 0),
  max_discount_amount integer,
  valid_days integer not null default 30 check (valid_days between 1 and 3660),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (discount_type = 'fixed_amount' and discount_value > 0)
    or (discount_type = 'percent' and discount_value between 1 and 100)
  )
);

create index if not exists idx_store_coupon_templates_store_active
  on public.store_coupon_templates(store_id, is_active);

drop trigger if exists trg_store_coupon_templates_updated_at on public.store_coupon_templates;
create trigger trg_store_coupon_templates_updated_at
before update on public.store_coupon_templates
for each row execute function public.set_updated_at();

create table if not exists public.customer_coupons (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  template_id uuid references public.store_coupon_templates(id) on delete set null,
  status text not null default 'issued' check (status in ('issued','used','expired','cancelled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_coupons_customer_store_status
  on public.customer_coupons(customer_user_id, store_id, status);

create index if not exists idx_customer_coupons_store_status_expires
  on public.customer_coupons(store_id, status, expires_at);

drop trigger if exists trg_customer_coupons_updated_at on public.customer_coupons;
create trigger trg_customer_coupons_updated_at
before update on public.customer_coupons
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------
-- 7) orders table extension for member discount snapshots
-- ---------------------------------------------------------
alter table public.orders
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_key text,
  add column if not exists toss_order_id text,
  add column if not exists applied_discount_type text check (applied_discount_type in ('point','coupon')),
  add column if not exists used_points integer not null default 0 check (used_points >= 0),
  add column if not exists used_coupon_id uuid references public.customer_coupons(id) on delete set null,
  add column if not exists earned_points integer not null default 0 check (earned_points >= 0),
  add column if not exists points_rate_snapshot numeric(4,2),
  add column if not exists loyalty_snapshot jsonb;

alter table public.orders
  drop constraint if exists orders_discount_exclusive_check;

alter table public.orders
  add constraint orders_discount_exclusive_check
  check (
    (coalesce(used_points, 0) = 0 and used_coupon_id is null and applied_discount_type is null)
    or (coalesce(used_points, 0) > 0 and used_coupon_id is null and applied_discount_type = 'point')
    or (coalesce(used_points, 0) = 0 and used_coupon_id is not null and applied_discount_type = 'coupon')
  );

create index if not exists idx_orders_customer_store_created
  on public.orders(customer_user_id, store_id, created_at desc);

-- ---------------------------------------------------------
-- 8) Utility functions
-- ---------------------------------------------------------
create or replace function public.get_store_point_rate_pct(
  p_store_id text,
  p_tier text
)
returns numeric
language plpgsql
stable
as $$
declare
  v public.store_loyalty_settings%rowtype;
begin
  select * into v
  from public.store_loyalty_settings
  where store_id = p_store_id;

  if not found then
    -- fallback defaults
    if p_tier = 'vip' then return 5.00; end if;
    if p_tier = 'regular' then return 3.00; end if;
    return 2.00;
  end if;

  if p_tier = 'vip' then return v.tier_vip_rate_pct; end if;
  if p_tier = 'regular' then return v.tier_regular_rate_pct; end if;
  return v.tier_general_rate_pct;
end;
$$;

create or replace function public.calculate_coupon_discount(
  p_template_id uuid,
  p_order_amount integer
)
returns integer
language plpgsql
stable
as $$
declare
  t public.store_coupon_templates%rowtype;
  v_discount integer;
begin
  select * into t from public.store_coupon_templates where id = p_template_id;
  if not found then
    raise exception 'Coupon template not found';
  end if;

  if p_order_amount < t.min_order_amount then
    raise exception 'Order amount is below coupon minimum';
  end if;

  if t.discount_type = 'fixed_amount' then
    v_discount := least(t.discount_value, p_order_amount);
  else
    v_discount := floor((p_order_amount::numeric * t.discount_value::numeric) / 100.0)::integer;
    if t.max_discount_amount is not null then
      v_discount := least(v_discount, t.max_discount_amount);
    end if;
    v_discount := least(v_discount, p_order_amount);
  end if;

  return greatest(v_discount, 0);
end;
$$;

-- ---------------------------------------------------------
-- 9) RPC: issue coupon to customer
-- ---------------------------------------------------------
create or replace function public.issue_customer_coupon(
  p_store_id text,
  p_customer_user_id uuid,
  p_template_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.store_coupon_templates%rowtype;
  v_new_id uuid;
begin
  select * into t
  from public.store_coupon_templates
  where id = p_template_id
    and store_id = p_store_id
    and is_active = true;

  if not found then
    raise exception 'Active coupon template not found for store';
  end if;

  insert into public.customer_coupons (
    customer_user_id,
    store_id,
    template_id,
    status,
    expires_at
  ) values (
    p_customer_user_id,
    p_store_id,
    p_template_id,
    'issued',
    now() + make_interval(days => t.valid_days)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------
-- 10) RPC: apply points/coupon and finalize reward
-- ---------------------------------------------------------
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
set search_path = public
as $$
declare
  v_settings public.store_loyalty_settings%rowtype;
  v_wallet public.customer_store_wallets%rowtype;
  v_now timestamptz := now();
  v_tier text;
  v_rate numeric;
  v_max_redeem integer;
  v_earned integer;
  v_coupon_template_id uuid;
  v_coupon_discount integer := 0;
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

  select * into v_settings
  from public.store_loyalty_settings
  where store_id = p_store_id;

  if not found then
    insert into public.store_loyalty_settings(store_id) values (p_store_id)
    on conflict (store_id) do nothing;

    select * into v_settings
    from public.store_loyalty_settings
    where store_id = p_store_id;
  end if;

  insert into public.customer_store_wallets (customer_user_id, store_id)
  values (p_customer_user_id, p_store_id)
  on conflict (customer_user_id, store_id) do nothing;

  select * into v_wallet
  from public.customer_store_wallets
  where customer_user_id = p_customer_user_id
    and store_id = p_store_id
  for update;

  v_max_redeem := floor((p_order_amount::numeric * v_settings.max_redeem_pct) / 100.0)::integer;

  if p_used_points > 0 then
    if p_used_points < v_settings.min_redeem_points then
      raise exception 'used_points is lower than store minimum';
    end if;

    if p_used_points > v_max_redeem then
      raise exception 'used_points exceeds max redeem percent for this store';
    end if;

    if p_used_points > v_wallet.point_balance then
      raise exception 'insufficient point balance';
    end if;
  end if;

  if p_used_coupon_id is not null then
    -- lock and validate coupon
    select cc.template_id
    into v_coupon_template_id
    from public.customer_coupons cc
    where cc.id = p_used_coupon_id
      and cc.customer_user_id = p_customer_user_id
      and cc.store_id = p_store_id
      and cc.status = 'issued'
      and cc.expires_at > v_now
    for update;

    if not found then
      raise exception 'coupon is not valid';
    end if;

    v_coupon_discount := public.calculate_coupon_discount(v_coupon_template_id, p_order_amount);
  end if;

  -- load latest tier before earning
  v_tier := coalesce(v_wallet.tier, 'general');
  v_rate := public.get_store_point_rate_pct(p_store_id, v_tier);

  -- Earn point based on paid amount after chosen discount
  v_earned := floor((greatest(0, p_order_amount - p_used_points - v_coupon_discount)::numeric * v_rate) / 100.0)::integer;

  -- deduct points if used
  if p_used_points > 0 then
    update public.customer_store_wallets w
    set point_balance = w.point_balance - p_used_points,
        updated_at = v_now
    where w.customer_user_id = p_customer_user_id
      and w.store_id = p_store_id;

    insert into public.point_transactions (
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
    )
    values (
      p_customer_user_id,
      p_store_id,
      p_order_id,
      'use',
      -p_used_points,
      (
        select w.point_balance
        from public.customer_store_wallets w
        where w.customer_user_id = p_customer_user_id
          and w.store_id = p_store_id
      ),
      'order payment',
      case when p_idempotency_key is null then null else p_idempotency_key || ':use' end
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- use coupon if requested
  if p_used_coupon_id is not null then
    update public.customer_coupons
    set status = 'used',
        used_at = v_now,
        used_order_id = p_order_id,
        updated_at = v_now
    where id = p_used_coupon_id;
  end if;

  -- earn points
  if v_earned > 0 then
    update public.customer_store_wallets w
    set point_balance = w.point_balance + v_earned,
        lifetime_spent = w.lifetime_spent + greatest(0, p_order_amount - p_used_points - v_coupon_discount),
        lifetime_orders = w.lifetime_orders + 1,
        last_order_at = v_now,
        updated_at = v_now
    where w.customer_user_id = p_customer_user_id
      and w.store_id = p_store_id;

    insert into public.point_transactions (
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key, expires_at
    )
    values (
      p_customer_user_id,
      p_store_id,
      p_order_id,
      'earn',
      v_earned,
      (
        select w.point_balance
        from public.customer_store_wallets w
        where w.customer_user_id = p_customer_user_id
          and w.store_id = p_store_id
      ),
      'order payment',
      case when p_idempotency_key is null then null else p_idempotency_key || ':earn' end,
      case when v_settings.point_expiry_months = 0 then null else (v_now + make_interval(months => v_settings.point_expiry_months)) end
    )
    on conflict (idempotency_key) do nothing;
  else
    update public.customer_store_wallets w
    set lifetime_spent = w.lifetime_spent + greatest(0, p_order_amount - p_used_points - v_coupon_discount),
        lifetime_orders = w.lifetime_orders + 1,
        last_order_at = v_now,
        updated_at = v_now
    where w.customer_user_id = p_customer_user_id
      and w.store_id = p_store_id;
  end if;

  -- store order snapshots
  update public.orders
  set customer_user_id = p_customer_user_id,
      applied_discount_type = case when p_used_points > 0 then 'point' when p_used_coupon_id is not null then 'coupon' else null end,
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
        'coupon_discount', v_coupon_discount
      )
  where id = p_order_id
    and store_id = p_store_id;

  -- return latest wallet summary
  select w.point_balance, w.tier into v_wallet.point_balance, v_wallet.tier
  from public.customer_store_wallets w
  where w.customer_user_id = p_customer_user_id
    and w.store_id = p_store_id;

  used_points := p_used_points;
  used_coupon_id := p_used_coupon_id;
  earned_points := v_earned;
  point_balance := v_wallet.point_balance;
  tier := v_wallet.tier;
  rate_pct := v_rate;
  return next;
end;
$$;

-- ---------------------------------------------------------
-- 11) RPC: recalculate tier for a store/customer
-- ---------------------------------------------------------
create or replace function public.recalculate_customer_tier(
  p_store_id text,
  p_customer_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.store_tier_rules%rowtype;
  v_cutoff timestamptz;
  v_spent integer := 0;
  v_orders integer := 0;
  v_new_tier text := 'general';
begin
  select * into v_rule
  from public.store_tier_rules
  where store_id = p_store_id;

  if not found then
    insert into public.store_tier_rules(store_id) values (p_store_id)
    on conflict (store_id) do nothing;

    select * into v_rule
    from public.store_tier_rules
    where store_id = p_store_id;
  end if;

  v_cutoff := now() - make_interval(months => v_rule.lookback_months);

  select
    coalesce(sum(greatest(0, o.total_price - coalesce(o.used_points, 0))), 0)::integer,
    coalesce(count(*), 0)::integer
  into v_spent, v_orders
  from public.orders o
  where o.store_id = p_store_id
    and o.customer_user_id = p_customer_user_id
    and o.created_at >= v_cutoff
    and o.status <> 'cancelled';

  if v_spent >= v_rule.vip_min_spent or v_orders >= v_rule.vip_min_orders then
    v_new_tier := 'vip';
  elsif v_spent >= v_rule.regular_min_spent or v_orders >= v_rule.regular_min_orders then
    v_new_tier := 'regular';
  else
    v_new_tier := 'general';
  end if;

  insert into public.customer_store_wallets(customer_user_id, store_id, tier)
  values (p_customer_user_id, p_store_id, v_new_tier)
  on conflict (customer_user_id, store_id)
  do update set tier = excluded.tier, updated_at = now();

  return v_new_tier;
end;
$$;

-- ---------------------------------------------------------
-- 11-1) Auto coupon issue log (for idempotent milestone rewards)
-- ---------------------------------------------------------
create table if not exists public.coupon_auto_issue_logs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete cascade,
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  coupon_kind text not null check (coupon_kind in ('first_order','thank_you')),
  milestone integer not null default 1,
  coupon_id uuid references public.customer_coupons(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (store_id, customer_user_id, coupon_kind, milestone)
);

create index if not exists idx_coupon_auto_issue_logs_store_customer
  on public.coupon_auto_issue_logs(store_id, customer_user_id, created_at desc);

-- ---------------------------------------------------------
-- 11-2) Finalize loyalty + auto coupon issue on order completion
-- ---------------------------------------------------------
create or replace function public.finalize_order_rewards(
  p_store_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_settings public.store_loyalty_settings%rowtype;
  v_completed_count integer := 0;
  v_first_tpl_id uuid;
  v_thank_tpl_id uuid;
  v_new_coupon_id uuid;
  v_thank_every integer := 10;
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

  if v_order.status <> 'completed' then
    return jsonb_build_object('ok', true, 'skipped', 'order_not_completed');
  end if;

  if coalesce(v_order.earned_points, 0) > 0 or v_order.loyalty_snapshot is not null then
    return jsonb_build_object('ok', true, 'skipped', 'already_finalized');
  end if;

  perform public.apply_loyalty_on_paid_order(
    v_order.id,
    p_store_id,
    v_order.customer_user_id,
    coalesce(v_order.total_price, 0),
    coalesce(v_order.used_points, 0),
    v_order.used_coupon_id,
    v_order.id::text || ':loyalty'
  );

  perform public.recalculate_customer_tier(p_store_id, v_order.customer_user_id);

  select * into v_settings
  from public.store_loyalty_settings
  where store_id = p_store_id;
  v_thank_every := greatest(1, coalesce(v_settings.thank_you_every_n_orders, 10));

  select count(*)::integer into v_completed_count
  from public.orders o
  where o.store_id = p_store_id
    and o.customer_user_id = v_order.customer_user_id
    and o.status = 'completed'
    and o.payment_status in ('paid', 'not_required');

  if v_completed_count = 1 then
    select t.id into v_first_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'first_order'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_first_tpl_id is not null then
      if not exists (
        select 1 from public.coupon_auto_issue_logs l
        where l.store_id = p_store_id
          and l.customer_user_id = v_order.customer_user_id
          and l.coupon_kind = 'first_order'
          and l.milestone = 1
      ) then
        v_new_coupon_id := public.issue_customer_coupon(p_store_id, v_order.customer_user_id, v_first_tpl_id);
        insert into public.coupon_auto_issue_logs(store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id)
        values (p_store_id, v_order.customer_user_id, v_order.id, 'first_order', 1, v_new_coupon_id)
        on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
      end if;
    end if;
  end if;

  if v_completed_count >= v_thank_every and mod(v_completed_count, v_thank_every) = 0 then
    select t.id into v_thank_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'thank_you'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_thank_tpl_id is not null then
      if not exists (
        select 1 from public.coupon_auto_issue_logs l
        where l.store_id = p_store_id
          and l.customer_user_id = v_order.customer_user_id
          and l.coupon_kind = 'thank_you'
          and l.milestone = (v_completed_count / v_thank_every)
      ) then
        v_new_coupon_id := public.issue_customer_coupon(p_store_id, v_order.customer_user_id, v_thank_tpl_id);
        insert into public.coupon_auto_issue_logs(store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id)
        values (p_store_id, v_order.customer_user_id, v_order.id, 'thank_you', (v_completed_count / v_thank_every), v_new_coupon_id)
        on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'finalized', true, 'completed_orders', v_completed_count);
end;
$$;

-- ---------------------------------------------------------
-- 11-3) Rollback loyalty + coupon on cancelled/refunded orders
-- ---------------------------------------------------------
create or replace function public.rollback_order_rewards(
  p_store_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_now timestamptz := now();
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

  if coalesce(v_order.earned_points, 0) = 0 and coalesce(v_order.used_points, 0) = 0 and v_order.used_coupon_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_rewards_to_rollback');
  end if;

  if coalesce(v_order.earned_points, 0) > 0 then
    update public.customer_store_wallets w
    set point_balance = greatest(0, w.point_balance - v_order.earned_points),
        updated_at = v_now
    where w.customer_user_id = v_order.customer_user_id
      and w.store_id = p_store_id;

    insert into public.point_transactions (
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
    ) values (
      v_order.customer_user_id,
      p_store_id,
      v_order.id,
      'rollback',
      -v_order.earned_points,
      (select point_balance from public.customer_store_wallets where customer_user_id = v_order.customer_user_id and store_id = p_store_id),
      'order cancelled/refunded rollback (earn)',
      v_order.id::text || ':rollback:earn'
    ) on conflict (idempotency_key) do nothing;
  end if;

  if coalesce(v_order.used_points, 0) > 0 then
    update public.customer_store_wallets w
    set point_balance = w.point_balance + v_order.used_points,
        updated_at = v_now
    where w.customer_user_id = v_order.customer_user_id
      and w.store_id = p_store_id;

    insert into public.point_transactions (
      customer_user_id, store_id, order_id, tx_type, points, balance_after, reason, idempotency_key
    ) values (
      v_order.customer_user_id,
      p_store_id,
      v_order.id,
      'rollback',
      v_order.used_points,
      (select point_balance from public.customer_store_wallets where customer_user_id = v_order.customer_user_id and store_id = p_store_id),
      'order cancelled/refunded rollback (used points)',
      v_order.id::text || ':rollback:use'
    ) on conflict (idempotency_key) do nothing;
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

  update public.orders o
  set earned_points = 0,
      points_rate_snapshot = null,
      loyalty_snapshot = null,
      applied_discount_type = null,
      used_points = 0,
      used_coupon_id = null
  where o.store_id = p_store_id
    and o.id = p_order_id;

  return jsonb_build_object('ok', true, 'rolled_back', true);
end;
$$;

-- ---------------------------------------------------------
-- 12) RLS policies
-- ---------------------------------------------------------
alter table public.customer_profiles enable row level security;
alter table public.customer_store_wallets enable row level security;
alter table public.point_transactions enable row level security;
alter table public.store_loyalty_settings enable row level security;
alter table public.store_tier_rules enable row level security;
alter table public.store_coupon_templates enable row level security;
alter table public.customer_coupons enable row level security;
alter table public.coupon_auto_issue_logs enable row level security;

-- customer_profiles: customer self
drop policy if exists customer_profiles_select_self on public.customer_profiles;
create policy customer_profiles_select_self
on public.customer_profiles
for select
using (auth.uid() = user_id);

drop policy if exists customer_profiles_upsert_self on public.customer_profiles;
create policy customer_profiles_upsert_self
on public.customer_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- wallet: customer self + store members can view
drop policy if exists customer_store_wallets_select_self on public.customer_store_wallets;
create policy customer_store_wallets_select_self
on public.customer_store_wallets
for select
using (auth.uid() = customer_user_id);

drop policy if exists customer_store_wallets_select_store_member on public.customer_store_wallets;
create policy customer_store_wallets_select_store_member
on public.customer_store_wallets
for select
using (
  exists (
    select 1
    from public.store_members m
    where m.store_id = customer_store_wallets.store_id
      and m.user_id = auth.uid()
  )
);

-- wallet writes only by store members (for admin adjustments) or RPC owner
drop policy if exists customer_store_wallets_write_store_member on public.customer_store_wallets;
create policy customer_store_wallets_write_store_member
on public.customer_store_wallets
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = customer_store_wallets.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = customer_store_wallets.store_id
      and m.user_id = auth.uid()
  )
);

-- point transactions: customer self + store members read
drop policy if exists point_transactions_select_self on public.point_transactions;
create policy point_transactions_select_self
on public.point_transactions
for select
using (auth.uid() = customer_user_id);

drop policy if exists point_transactions_select_store_member on public.point_transactions;
create policy point_transactions_select_store_member
on public.point_transactions
for select
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = point_transactions.store_id
      and m.user_id = auth.uid()
  )
);

-- point transaction writes: store members only (or via definer function)
drop policy if exists point_transactions_write_store_member on public.point_transactions;
create policy point_transactions_write_store_member
on public.point_transactions
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = point_transactions.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = point_transactions.store_id
      and m.user_id = auth.uid()
  )
);

-- settings tables: store members manage own store
drop policy if exists store_loyalty_settings_member_rw on public.store_loyalty_settings;
create policy store_loyalty_settings_member_rw
on public.store_loyalty_settings
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_loyalty_settings.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_loyalty_settings.store_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists store_tier_rules_member_rw on public.store_tier_rules;
create policy store_tier_rules_member_rw
on public.store_tier_rules
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_tier_rules.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_tier_rules.store_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists store_coupon_templates_member_rw on public.store_coupon_templates;
create policy store_coupon_templates_member_rw
on public.store_coupon_templates
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_coupon_templates.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_coupon_templates.store_id
      and m.user_id = auth.uid()
  )
);

-- customer coupons: self read, store member read/write
drop policy if exists customer_coupons_select_self on public.customer_coupons;
create policy customer_coupons_select_self
on public.customer_coupons
for select
using (auth.uid() = customer_user_id);

drop policy if exists customer_coupons_member_rw on public.customer_coupons;
create policy customer_coupons_member_rw
on public.customer_coupons
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = customer_coupons.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = customer_coupons.store_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists coupon_auto_issue_logs_member_read on public.coupon_auto_issue_logs;
create policy coupon_auto_issue_logs_member_read
on public.coupon_auto_issue_logs
for select
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = coupon_auto_issue_logs.store_id
      and m.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------
-- 13) Public checkout-mode RPC for customer/guest pages
-- ---------------------------------------------------------
create or replace function public.get_store_checkout_mode(
  p_store_id text
)
returns table (
  is_prepay boolean,
  source text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select sa.prepay_addon_status
    into v_status
  from public.store_addons sa
  where sa.store_id = p_store_id
  limit 1;

  is_prepay := (coalesce(v_status, 'inactive') = 'active');
  source := 'store_addons';
  return next;
end;
$$;

create or replace function public.get_store_checkout_client_config(
  p_store_id text
)
returns table (
  client_key text,
  mid text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    coalesce(spc.client_key, '')::text as client_key,
    coalesce(spc.mid, '')::text as mid
  from public.store_pg_config spc
  where spc.store_id = p_store_id
  limit 1;
end;
$$;

-- ---------------------------------------------------------
-- 14) Grants for RPC
-- ---------------------------------------------------------
grant execute on function public.issue_customer_coupon(text, uuid, uuid) to authenticated;
grant execute on function public.apply_loyalty_on_paid_order(uuid, text, uuid, integer, integer, uuid, text) to authenticated;
grant execute on function public.recalculate_customer_tier(text, uuid) to authenticated;
grant execute on function public.finalize_order_rewards(text, uuid) to authenticated;
grant execute on function public.rollback_order_rewards(text, uuid) to authenticated;
grant execute on function public.get_store_checkout_mode(text) to anon, authenticated;
grant execute on function public.get_store_checkout_client_config(text) to anon, authenticated;

commit;
