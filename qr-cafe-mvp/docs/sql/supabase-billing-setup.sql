-- =========================================================
-- 선결재 파일럿용 Supabase 스키마/정책 전체 SQL (복붙 실행용)
-- 실행 위치: Supabase SQL Editor
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
  base_price_krw integer not null default 8900,
  price_version text not null default 'legacy' check (price_version in ('legacy', 'standard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) 선결재 옵션 상태 테이블
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

-- 5) updated_at 트리거

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

-- 6) RLS 활성화
alter table public.store_billing enable row level security;
alter table public.store_addons enable row level security;
alter table public.store_pg_config enable row level security;

-- 7) 기존 정책 삭제(재실행 안전)
drop policy if exists "store_billing_owner_select" on public.store_billing;
drop policy if exists "store_billing_owner_upsert" on public.store_billing;
drop policy if exists "store_addons_owner_select" on public.store_addons;
drop policy if exists "store_addons_owner_upsert" on public.store_addons;
drop policy if exists "store_pg_config_owner_select" on public.store_pg_config;
drop policy if exists "store_pg_config_owner_upsert" on public.store_pg_config;

-- 8) owner만 조회/수정 가능 정책
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

-- 9) 권한 부여
grant select, insert, update, delete on public.store_billing to authenticated;
grant select, insert, update, delete on public.store_addons to authenticated;
grant select, insert, update, delete on public.store_pg_config to authenticated;

commit;

-- =========================================================
-- 실행 후 확인 쿼리 (선택)
-- =========================================================
-- select * from public.store_billing limit 20;
-- select * from public.store_addons limit 20;
-- select * from public.store_pg_config limit 20;
