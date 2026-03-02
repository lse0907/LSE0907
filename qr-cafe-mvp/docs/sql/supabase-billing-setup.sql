-- =========================================================
-- 선결제 + 구독(1/3/6/12개월) 파일럿용 Supabase 스키마/정책 전체 SQL
-- 실행 위치: Supabase SQL Editor
-- 특징:
--  - 남은 기간이 있어도 미리 결제 시 기간 누적(rollover)
--  - 기본 구독 + 선결제 옵션(addon) 별도 과금
--  - owner 전용 조회/수정 정책
-- =========================================================

begin;

-- A) orders 테이블에 payment_status 컬럼 추가 (이미 있으면 유지)
alter table public.orders
  add column if not exists payment_status text not null default 'not_required'
  check (payment_status in ('not_required', 'pending', 'paid'));

-- 0) 공통 타임스탬프 갱신 함수
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) 권한 확인 함수: 현재 로그인 유저가 해당 매장 owner인지 확인
create or replace function public.is_store_owner(p_store_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = auth.uid()
      and sm.role = 'owner'
  );
$$;

-- 2) 기본 구독 상태 테이블
create table if not exists public.store_billing (
  store_id text primary key references public.stores(store_id) on delete cascade,
  base_plan_status text not null default 'inactive' check (base_plan_status in ('inactive', 'trialing', 'active', 'past_due')),
  trial_end_at timestamptz,
  paid_until timestamptz,
  current_plan_months integer,
  base_price_krw integer not null default 8900,
  price_version text not null default 'legacy' check (price_version in ('legacy', 'standard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.store_billing add column if not exists paid_until timestamptz;
alter table public.store_billing add column if not exists current_plan_months integer;

-- 3) 선결제 옵션 상태 테이블
create table if not exists public.store_addons (
  store_id text primary key references public.stores(store_id) on delete cascade,
  prepay_addon_status text not null default 'inactive' check (prepay_addon_status in ('inactive', 'active', 'past_due')),
  prepay_addon_price_krw integer not null default 5000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) PG 연결 정보 테이블
-- 주의: 파일럿 단계에서는 client_key/secret_key를 평문 저장함.
-- 실서비스 전환 시 secret_key는 서버 암호화 저장으로 교체 권장.
create table if not exists public.store_pg_config (
  store_id text primary key references public.stores(store_id) on delete cascade,
  pg_provider text not null default 'tosspayments',
  mid text,
  client_key text,
  secret_key text,
  pg_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) 결제 이력 테이블(운영자/정산/감사로그용)
create table if not exists public.billing_payments (
  id bigint generated always as identity primary key,
  store_id text not null references public.stores(store_id) on delete cascade,
  payer_user_id uuid,
  plan_months integer not null check (plan_months in (1, 3, 6, 12)),
  base_paid boolean not null default true,
  addon_paid boolean not null default false,
  amount_krw integer,
  paid_at timestamptz not null default now(),
  before_paid_until timestamptz,
  after_paid_until timestamptz,
  payment_provider text not null default 'tosspayments',
  payment_key text,
  order_id text,
  status text not null default 'paid' check (status in ('paid', 'failed', 'canceled', 'refunded')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_payments_store_paid_at on public.billing_payments(store_id, paid_at desc);

-- 6) 결제 적용 함수: 남은 기간 누적(rollover)
-- 규칙:
--   anchor = max(now(), 기존 paid_until)
--   new_paid_until = anchor + N개월
-- 사용 예:
--   select * from public.apply_store_billing_payment('store-a', 3, true, true, 'pay_xxx', 'order_xxx', 45000, '3개월 선납');
create or replace function public.apply_store_billing_payment(
  p_store_id text,
  p_plan_months integer,
  p_base_paid boolean,
  p_addon_paid boolean,
  p_payment_key text,
  p_order_id text,
  p_amount_krw integer default null,
  p_note text default null
)
returns public.billing_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_before_paid_until timestamptz;
  v_anchor timestamptz;
  v_after_paid_until timestamptz;
  v_row public.billing_payments;
begin
  if not public.is_store_owner(p_store_id) then
    raise exception 'owner 권한이 필요합니다.';
  end if;

  if p_plan_months not in (1, 3, 6, 12) then
    raise exception 'plan_months는 1/3/6/12만 허용됩니다.';
  end if;

  if coalesce(p_base_paid, false) = false and coalesce(p_addon_paid, false) = false then
    raise exception 'base_paid 또는 addon_paid 중 하나는 true여야 합니다.';
  end if;

  select sb.paid_until
    into v_before_paid_until
  from public.store_billing sb
  where sb.store_id = p_store_id;

  v_anchor := greatest(coalesce(v_before_paid_until, v_now), v_now);
  v_after_paid_until := v_anchor + make_interval(months => p_plan_months);

  -- 기본 구독 결제가 포함되면 기본 플랜 활성화 + 기간 누적
  if coalesce(p_base_paid, false) then
    insert into public.store_billing (
      store_id,
      base_plan_status,
      paid_until,
      current_plan_months,
      updated_at
    ) values (
      p_store_id,
      'active',
      v_after_paid_until,
      p_plan_months,
      now()
    )
    on conflict (store_id)
    do update set
      base_plan_status = 'active',
      paid_until = excluded.paid_until,
      current_plan_months = excluded.current_plan_months,
      updated_at = now();
  end if;

  -- addon 결제가 포함되면 활성화
  if coalesce(p_addon_paid, false) then
    insert into public.store_addons (
      store_id,
      prepay_addon_status,
      updated_at
    ) values (
      p_store_id,
      'active',
      now()
    )
    on conflict (store_id)
    do update set
      prepay_addon_status = 'active',
      updated_at = now();
  end if;

  insert into public.billing_payments (
    store_id,
    payer_user_id,
    plan_months,
    base_paid,
    addon_paid,
    amount_krw,
    paid_at,
    before_paid_until,
    after_paid_until,
    payment_provider,
    payment_key,
    order_id,
    status,
    note
  ) values (
    p_store_id,
    auth.uid(),
    p_plan_months,
    coalesce(p_base_paid, false),
    coalesce(p_addon_paid, false),
    p_amount_krw,
    now(),
    v_before_paid_until,
    v_after_paid_until,
    'tosspayments',
    nullif(trim(coalesce(p_payment_key, '')), ''),
    nullif(trim(coalesce(p_order_id, '')), ''),
    'paid',
    p_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- 7) updated_at 트리거

drop trigger if exists trg_store_billing_updated_at on public.store_billing;
create trigger trg_store_billing_updated_at
before update on public.store_billing
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_store_addons_updated_at on public.store_addons;
create trigger trg_store_addons_updated_at
before update on public.store_addons
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_store_pg_config_updated_at on public.store_pg_config;
create trigger trg_store_pg_config_updated_at
before update on public.store_pg_config
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_billing_payments_updated_at on public.billing_payments;
create trigger trg_billing_payments_updated_at
before update on public.billing_payments
for each row execute procedure public.set_updated_at();

-- 8) RLS 활성화
alter table public.store_billing enable row level security;
alter table public.store_addons enable row level security;
alter table public.store_pg_config enable row level security;
alter table public.billing_payments enable row level security;

-- 9) 기존 정책 삭제(재실행 안전)
drop policy if exists "store_billing_owner_select" on public.store_billing;
drop policy if exists "store_billing_owner_upsert" on public.store_billing;
drop policy if exists "store_addons_owner_select" on public.store_addons;
drop policy if exists "store_addons_owner_upsert" on public.store_addons;
drop policy if exists "store_pg_config_owner_select" on public.store_pg_config;
drop policy if exists "store_pg_config_owner_upsert" on public.store_pg_config;
drop policy if exists "billing_payments_owner_select" on public.billing_payments;

-- 10) owner만 조회/수정 가능 정책
create policy "store_billing_owner_select"
on public.store_billing
for select
to authenticated
using (public.is_store_owner(store_id));

create policy "store_billing_owner_upsert"
on public.store_billing
for all
to authenticated
using (public.is_store_owner(store_id))
with check (public.is_store_owner(store_id));

create policy "store_addons_owner_select"
on public.store_addons
for select
to authenticated
using (public.is_store_owner(store_id));

create policy "store_addons_owner_upsert"
on public.store_addons
for all
to authenticated
using (public.is_store_owner(store_id))
with check (public.is_store_owner(store_id));

create policy "store_pg_config_owner_select"
on public.store_pg_config
for select
to authenticated
using (public.is_store_owner(store_id));

create policy "store_pg_config_owner_upsert"
on public.store_pg_config
for all
to authenticated
using (public.is_store_owner(store_id))
with check (public.is_store_owner(store_id));

create policy "billing_payments_owner_select"
on public.billing_payments
for select
to authenticated
using (public.is_store_owner(store_id));

-- 11) 권한 부여
grant select, insert, update, delete on public.store_billing to authenticated;
grant select, insert, update, delete on public.store_addons to authenticated;
grant select, insert, update, delete on public.store_pg_config to authenticated;
grant select on public.billing_payments to authenticated;
grant usage, select on sequence public.billing_payments_id_seq to authenticated;
grant execute on function public.apply_store_billing_payment(text, integer, boolean, boolean, text, text, integer, text) to authenticated;

commit;

-- =========================================================
-- 실행 후 확인 쿼리 (선택)
-- =========================================================
-- select store_id, base_plan_status, paid_until, current_plan_months from public.store_billing limit 20;
-- select store_id, prepay_addon_status from public.store_addons limit 20;
-- select id, store_id, plan_months, before_paid_until, after_paid_until, amount_krw, paid_at
--   from public.billing_payments
--  order by id desc
--  limit 20;
