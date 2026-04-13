-- =========================================================
-- QR Cafe MVP - Customer Favorite Stores v1
-- Date: 2026-04-10
-- Purpose:
--  1) Member-level favorite store persistence (cross-device)
--  2) Secure RLS policies for owner-only CRUD
-- =========================================================

begin;

create extension if not exists pgcrypto;

create table if not exists public.customer_favorite_stores (
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_user_id, store_id)
);

create index if not exists idx_customer_favorite_stores_customer
  on public.customer_favorite_stores(customer_user_id, created_at desc);

create index if not exists idx_customer_favorite_stores_store
  on public.customer_favorite_stores(store_id);

alter table public.customer_favorite_stores enable row level security;

-- 로그인한 사용자 본인 즐겨찾기만 조회
drop policy if exists "favorites_select_own" on public.customer_favorite_stores;
create policy "favorites_select_own"
  on public.customer_favorite_stores
  for select
  using (auth.uid() = customer_user_id);

-- 로그인한 사용자 본인 즐겨찾기만 추가
drop policy if exists "favorites_insert_own" on public.customer_favorite_stores;
create policy "favorites_insert_own"
  on public.customer_favorite_stores
  for insert
  with check (auth.uid() = customer_user_id);

-- 로그인한 사용자 본인 즐겨찾기만 삭제
drop policy if exists "favorites_delete_own" on public.customer_favorite_stores;
create policy "favorites_delete_own"
  on public.customer_favorite_stores
  for delete
  using (auth.uid() = customer_user_id);

commit;
