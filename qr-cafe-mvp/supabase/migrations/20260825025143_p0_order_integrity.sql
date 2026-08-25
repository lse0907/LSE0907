-- P0 order integrity hardening.
--
-- This migration is intentionally additive for the checkout path. Existing
-- orders remain valid, while all new server routes can use durable checkout
-- attempts and a single transactional order finalizer.

begin;

-- Fail before creating unique indexes when legacy duplicates exist. This keeps
-- deployment safe and forces an explicit reconciliation instead of silently
-- choosing one paid order.
do $$
begin
  if exists (
    select 1 from public.orders
    where payment_key is not null and btrim(payment_key) <> ''
    group by payment_key having count(*) > 1
  ) then
    raise exception 'P0_PREFLIGHT_DUPLICATE_PAYMENT_KEY';
  end if;

  if exists (
    select 1 from public.orders
    where toss_order_id is not null and btrim(toss_order_id) <> ''
    group by toss_order_id having count(*) > 1
  ) then
    raise exception 'P0_PREFLIGHT_DUPLICATE_TOSS_ORDER_ID';
  end if;
end;
$$;

create table if not exists public.order_checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id),
  client_request_id uuid not null,
  request_fingerprint text not null,
  checkout_type text not null check (checkout_type in ('postpaid', 'prepaid')),
  status text not null default 'quoted' check (
    status in (
      'quoted',
      'confirming',
      'approved_not_applied',
      'completed',
      'failed',
      'expired',
      'cancel_pending',
      'cancelled'
    )
  ),
  customer_user_id uuid references auth.users(id) on delete set null,
  mode text not null check (mode in ('dine-in', 'takeout')),
  table_no text,
  request_note text not null default '',
  cart_snapshot jsonb not null check (jsonb_typeof(cart_snapshot) = 'array'),
  total_count integer not null check (total_count > 0),
  total_price integer not null check (total_price >= 0),
  used_points integer not null default 0 check (used_points >= 0),
  used_coupon_id uuid references public.customer_coupons(id) on delete set null,
  coupon_discount integer not null default 0 check (coupon_discount >= 0),
  payable_amount integer not null check (payable_amount >= 0),
  toss_order_id text,
  payment_key text,
  pg_status text,
  pg_approved_at timestamptz,
  confirm_idempotency_key uuid,
  toss_response jsonb,
  order_id uuid references public.orders(id) on delete set null,
  recovery_token_hash text not null,
  failure_code text,
  failure_detail text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, client_request_id),
  unique (toss_order_id),
  unique (payment_key),
  unique (order_id),
  check (checkout_type = 'prepaid' or toss_order_id is null),
  check (status <> 'completed' or order_id is not null)
);

create index if not exists idx_order_checkout_attempts_recovery
  on public.order_checkout_attempts(status, updated_at)
  where status in ('confirming', 'approved_not_applied', 'cancel_pending');

create index if not exists idx_order_checkout_attempts_store_created
  on public.order_checkout_attempts(store_id, created_at desc);

drop trigger if exists trg_order_checkout_attempts_updated_at
  on public.order_checkout_attempts;
create trigger trg_order_checkout_attempts_updated_at
before update on public.order_checkout_attempts
for each row execute function public.set_updated_at();

alter table public.order_checkout_attempts enable row level security;
revoke all privileges on table public.order_checkout_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.order_checkout_attempts to service_role;

alter table public.orders
  add column if not exists client_request_id uuid,
  add column if not exists checkout_attempt_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_checkout_attempt_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_checkout_attempt_id_fkey
      foreign key (checkout_attempt_id)
      references public.order_checkout_attempts(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('not_required', 'pending', 'paid')) not valid;
    alter table public.orders validate constraint orders_payment_status_check;
  end if;
end;
$$;

create unique index if not exists orders_store_client_request_unique
  on public.orders(store_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists orders_checkout_attempt_unique
  on public.orders(checkout_attempt_id)
  where checkout_attempt_id is not null;

create unique index if not exists orders_payment_key_unique
  on public.orders(payment_key)
  where payment_key is not null and btrim(payment_key) <> '';

create unique index if not exists orders_toss_order_id_unique
  on public.orders(toss_order_id)
  where toss_order_id is not null and btrim(toss_order_id) <> '';

create table if not exists public.store_daily_order_counters (
  store_id text not null references public.stores(store_id),
  order_date text not null,
  last_no integer not null check (last_no between 0 and 9999),
  updated_at timestamptz not null default now(),
  primary key (store_id, order_date)
);

insert into public.store_daily_order_counters(store_id, order_date, last_no)
select
  o.store_id,
  o.order_date,
  max(case when o.display_no ~ '^[0-9]{1,4}$' then o.display_no::integer else 0 end)
from public.orders o
group by o.store_id, o.order_date
on conflict (store_id, order_date) do update
set last_no = greatest(public.store_daily_order_counters.last_no, excluded.last_no),
    updated_at = now();

alter table public.store_daily_order_counters enable row level security;
revoke all privileges on table public.store_daily_order_counters from public, anon, authenticated;
grant select, insert, update, delete on table public.store_daily_order_counters to service_role;

create or replace function public.finalize_order_checkout_attempt(p_attempt_id uuid)
returns table (
  order_id uuid,
  access_token text,
  order_date text,
  display_no text,
  total_count integer,
  total_price integer,
  payable_amount integer,
  payment_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.order_checkout_attempts%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_access_token text := gen_random_uuid()::text;
  v_order_date text := (timezone('Asia/Seoul', now()))::date::text;
  v_display_no text;
  v_next_no integer;
  v_payment_status text;
  v_line jsonb;
  v_group jsonb;
  v_option jsonb;
  v_order_item_id uuid;
begin
  select * into v_attempt
  from public.order_checkout_attempts a
  where a.id = p_attempt_id
  for update;

  if not found then
    raise exception 'CHECKOUT_ATTEMPT_NOT_FOUND';
  end if;

  if v_attempt.status = 'completed' and v_attempt.order_id is not null then
    return query
    select
      o.id,
      o.access_token,
      o.order_date,
      o.display_no,
      o.total_count,
      o.total_price,
      v_attempt.payable_amount,
      o.payment_status
    from public.orders o
    where o.id = v_attempt.order_id;
    return;
  end if;

  if v_attempt.expires_at <= now() and v_attempt.status = 'quoted' then
    update public.order_checkout_attempts
    set status = 'expired', failure_code = 'CHECKOUT_ATTEMPT_EXPIRED'
    where id = v_attempt.id;
    raise exception 'CHECKOUT_ATTEMPT_EXPIRED';
  end if;

  if v_attempt.checkout_type = 'prepaid' then
    if v_attempt.status <> 'approved_not_applied'
      or v_attempt.pg_status <> 'DONE'
      or v_attempt.payment_key is null
      or v_attempt.toss_order_id is null
      or v_attempt.pg_approved_at is null then
      raise exception 'PAYMENT_ATTEMPT_NOT_APPROVED';
    end if;
    v_payment_status := 'paid';
  else
    if v_attempt.status <> 'quoted' then
      raise exception 'POSTPAID_ATTEMPT_NOT_READY';
    end if;
    v_payment_status := 'not_required';
  end if;

  insert into public.store_daily_order_counters(store_id, order_date, last_no)
  values (v_attempt.store_id, v_order_date, 1)
  on conflict (store_id, order_date) do update
  set last_no = public.store_daily_order_counters.last_no + 1,
      updated_at = now()
  returning last_no into v_next_no;

  if v_next_no > 9999 then
    raise exception 'DAILY_ORDER_NUMBER_EXHAUSTED';
  end if;
  v_display_no := lpad(v_next_no::text, 4, '0');

  insert into public.orders (
    id,
    access_token,
    created_at,
    order_date,
    display_no,
    mode,
    table_no,
    request_note,
    total_count,
    total_price,
    status,
    payment_status,
    payment_key,
    toss_order_id,
    customer_user_id,
    used_points,
    used_coupon_id,
    applied_discount_type,
    store_id,
    client_request_id,
    checkout_attempt_id
  ) values (
    v_order_id,
    v_access_token,
    now(),
    v_order_date,
    v_display_no,
    v_attempt.mode,
    case when v_attempt.mode = 'dine-in' then nullif(btrim(v_attempt.table_no), '') else null end,
    v_attempt.request_note,
    v_attempt.total_count,
    v_attempt.total_price,
    'new',
    v_payment_status,
    case when v_attempt.checkout_type = 'prepaid' then v_attempt.payment_key else null end,
    case when v_attempt.checkout_type = 'prepaid' then v_attempt.toss_order_id else null end,
    v_attempt.customer_user_id,
    v_attempt.used_points,
    v_attempt.used_coupon_id,
    case
      when v_attempt.used_points > 0 then 'point'
      when v_attempt.used_coupon_id is not null then 'coupon'
      else null
    end,
    v_attempt.store_id,
    v_attempt.client_request_id,
    v_attempt.id
  );

  for v_line in
    select value from jsonb_array_elements(v_attempt.cart_snapshot)
  loop
    v_order_item_id := gen_random_uuid();
    insert into public.order_items (
      id, order_id, menu_id, name, price, qty, store_id
    ) values (
      v_order_item_id,
      v_order_id,
      v_line->>'menuId',
      v_line->>'name',
      (v_line->>'basePrice')::integer,
      (v_line->>'qty')::integer,
      v_attempt.store_id
    );

    for v_group in
      select value from jsonb_array_elements(coalesce(v_line->'options', '[]'::jsonb))
    loop
      for v_option in
        select value from jsonb_array_elements(coalesce(v_group->'items', '[]'::jsonb))
      loop
        insert into public.order_item_options (
          id, order_item_id, group_id, option_id, name, price_delta, qty, store_id
        ) values (
          gen_random_uuid(),
          v_order_item_id,
          v_group->>'groupId',
          v_option->>'id',
          v_option->>'name',
          (v_option->>'priceDelta')::integer,
          (v_option->>'qty')::integer,
          v_attempt.store_id
        );
      end loop;
    end loop;
  end loop;

  if v_attempt.customer_user_id is not null then
    perform public.apply_loyalty_on_paid_order(
      v_order_id,
      v_attempt.store_id,
      v_attempt.customer_user_id,
      v_attempt.total_price,
      v_attempt.used_points,
      v_attempt.used_coupon_id,
      v_order_id::text || ':loyalty'
    );
  end if;

  update public.order_checkout_attempts
  set order_id = v_order_id,
      status = 'completed',
      failure_code = null,
      failure_detail = null
  where id = v_attempt.id;

  return query
  select
    o.id,
    o.access_token,
    o.order_date,
    o.display_no,
    o.total_count,
    o.total_price,
    v_attempt.payable_amount,
    o.payment_status
  from public.orders o
  where o.id = v_order_id;
end;
$$;

revoke all privileges on function public.finalize_order_checkout_attempt(uuid)
from public, anon, authenticated;
grant execute on function public.finalize_order_checkout_attempt(uuid)
to service_role;

-- Loyalty read access remains available, but direct ledger/balance/coupon writes
-- are server-only. Store-level settings stay editable by Owner/OPS only.
drop policy if exists customer_store_wallets_write_store_member
on public.customer_store_wallets;
drop policy if exists point_transactions_write_store_member
on public.point_transactions;
drop policy if exists customer_coupons_member_rw
on public.customer_coupons;
drop policy if exists store_coupon_templates_member_rw
on public.store_coupon_templates;
drop policy if exists store_loyalty_settings_member_rw
on public.store_loyalty_settings;
drop policy if exists store_tier_rules_member_rw
on public.store_tier_rules;

drop policy if exists customer_coupons_select_store_member
on public.customer_coupons;
create policy customer_coupons_select_store_member
on public.customer_coupons
for select
to authenticated
using (public.is_store_member(store_id) or public.is_ops_user());

drop policy if exists store_coupon_templates_owner_ops_select
on public.store_coupon_templates;
create policy store_coupon_templates_owner_ops_select
on public.store_coupon_templates
for select
to authenticated
using (public.is_store_member(store_id) or public.is_ops_user());

drop policy if exists store_coupon_templates_owner_ops_insert
on public.store_coupon_templates;
create policy store_coupon_templates_owner_ops_insert
on public.store_coupon_templates
for insert
to authenticated
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_coupon_templates_owner_ops_update
on public.store_coupon_templates;
create policy store_coupon_templates_owner_ops_update
on public.store_coupon_templates
for update
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user())
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_coupon_templates_owner_ops_delete
on public.store_coupon_templates;
create policy store_coupon_templates_owner_ops_delete
on public.store_coupon_templates
for delete
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_loyalty_settings_member_select
on public.store_loyalty_settings;
create policy store_loyalty_settings_member_select
on public.store_loyalty_settings
for select
to authenticated
using (public.is_store_member(store_id) or public.is_ops_user());

drop policy if exists store_loyalty_settings_owner_ops_insert
on public.store_loyalty_settings;
create policy store_loyalty_settings_owner_ops_insert
on public.store_loyalty_settings
for insert
to authenticated
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_loyalty_settings_owner_ops_update
on public.store_loyalty_settings;
create policy store_loyalty_settings_owner_ops_update
on public.store_loyalty_settings
for update
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user())
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_loyalty_settings_owner_ops_delete
on public.store_loyalty_settings;
create policy store_loyalty_settings_owner_ops_delete
on public.store_loyalty_settings
for delete
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_tier_rules_member_select
on public.store_tier_rules;
create policy store_tier_rules_member_select
on public.store_tier_rules
for select
to authenticated
using (public.is_store_member(store_id) or public.is_ops_user());

drop policy if exists store_tier_rules_owner_ops_insert
on public.store_tier_rules;
create policy store_tier_rules_owner_ops_insert
on public.store_tier_rules
for insert
to authenticated
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_tier_rules_owner_ops_update
on public.store_tier_rules;
create policy store_tier_rules_owner_ops_update
on public.store_tier_rules
for update
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user())
with check (public.is_store_owner(store_id) or public.is_ops_user());

drop policy if exists store_tier_rules_owner_ops_delete
on public.store_tier_rules;
create policy store_tier_rules_owner_ops_delete
on public.store_tier_rules
for delete
to authenticated
using (public.is_store_owner(store_id) or public.is_ops_user());

revoke insert, update, delete on table public.customer_store_wallets
from anon, authenticated;
revoke insert, update, delete on table public.point_transactions
from anon, authenticated;
revoke insert, update, delete on table public.customer_coupons
from anon, authenticated;
revoke insert, update, delete on table public.store_coupon_templates
from anon;
revoke insert, update, delete on table public.store_loyalty_settings
from anon;
revoke insert, update, delete on table public.store_tier_rules
from anon;

-- Coupon issuance and cancellation mutate customer benefits. They are moved
-- behind Owner-only server routes; browser roles can no longer execute them.
revoke execute on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) from public, anon, authenticated;
grant execute on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) to service_role;

revoke execute on function public.admin_cancel_customer_coupon(text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_cancel_customer_coupon(text, uuid)
to service_role;

commit;
