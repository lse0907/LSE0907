-- QR Cafe MVP - Staff workflow v1 migration
-- 목적:
-- 1) 주문 상태를 new/checked/making/ready_for_packing/completed/cancelled 로 완전 교체
-- 2) order_items 상태(waiting/making/done), batch, packing 체크 영구저장 도입
-- 3) stores.staff_view_mode(simple/station) 도입

begin;

-- 1) stores: 직원 화면 모드 컬럼
alter table if exists public.stores
  add column if not exists staff_view_mode text not null default 'simple';

alter table if exists public.stores
  drop constraint if exists stores_staff_view_mode_check;

alter table if exists public.stores
  add constraint stores_staff_view_mode_check
  check (staff_view_mode in ('simple', 'station'));

-- 2) orders: 상태 완전 교체
-- 기존 값 매핑
update public.orders set status = 'ready_for_packing' where status = 'ready';
update public.orders set status = 'completed' where status = 'done';
update public.orders set status = 'cancelled' where status = 'canceled';

-- 기본값 변경
alter table if exists public.orders
  alter column status set default 'new';

-- 기존 체크 제약 재정의
alter table if exists public.orders
  drop constraint if exists orders_status_check;

alter table if exists public.orders
  add constraint orders_status_check
  check (status in ('new', 'checked', 'making', 'ready_for_packing', 'completed', 'cancelled'));

-- 3) order_items: item 상태 + batch
alter table if exists public.order_items
  add column if not exists status text not null default 'waiting';

alter table if exists public.order_items
  add column if not exists batch integer not null default 0;

alter table if exists public.order_items
  drop constraint if exists order_items_status_check;

alter table if exists public.order_items
  add constraint order_items_status_check
  check (status in ('waiting', 'making', 'done'));

-- 4) 패킹 체크 영구저장 테이블
create table if not exists public.order_item_packing_checks (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  checked boolean not null default false,
  checked_at timestamptz,
  checked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_item_id)
);

-- updated_at 자동 갱신 함수(없으면 생성)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_order_item_packing_checks_updated_at on public.order_item_packing_checks;
create trigger trg_order_item_packing_checks_updated_at
before update on public.order_item_packing_checks
for each row execute function public.set_updated_at();

-- 5) 주문 상태 자동 계산 함수
create or replace function public.recompute_order_status_from_items(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_total int := 0;
  v_making int := 0;
  v_done int := 0;
  v_waiting int := 0;
  v_cancelled boolean := false;
begin
  select (o.status = 'cancelled') into v_cancelled
  from public.orders o
  where o.id = p_order_id;

  if v_cancelled then
    return;
  end if;

  select
    count(*),
    count(*) filter (where oi.status = 'making'),
    count(*) filter (where oi.status = 'done'),
    count(*) filter (where oi.status = 'waiting')
  into v_total, v_making, v_done, v_waiting
  from public.order_items oi
  where oi.order_id = p_order_id;

  if v_total = 0 then
    update public.orders set status = 'new' where id = p_order_id;
  elsif v_done = v_total then
    update public.orders set status = 'ready_for_packing' where id = p_order_id;
  elsif v_making > 0 then
    update public.orders set status = 'making' where id = p_order_id;
  elsif v_waiting = v_total then
    update public.orders set status = 'checked' where id = p_order_id;
  end if;
end;
$$;

create or replace function public.trg_recompute_order_status_from_items()
returns trigger
language plpgsql
as $$
begin
  perform public.recompute_order_status_from_items(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_items_recompute_order_status on public.order_items;
create trigger trg_order_items_recompute_order_status
after insert or update of status or delete on public.order_items
for each row execute function public.trg_recompute_order_status_from_items();

-- 6) RLS 정책(기존 정책이 충분하면 생략 가능하지만, 안전하게 upsert 보장)
alter table public.order_item_packing_checks enable row level security;

drop policy if exists "order_item_packing_checks_select" on public.order_item_packing_checks;
create policy "order_item_packing_checks_select"
on public.order_item_packing_checks
for select
using (true);

drop policy if exists "order_item_packing_checks_insert" on public.order_item_packing_checks;
create policy "order_item_packing_checks_insert"
on public.order_item_packing_checks
for insert
with check (true);

drop policy if exists "order_item_packing_checks_update" on public.order_item_packing_checks;
create policy "order_item_packing_checks_update"
on public.order_item_packing_checks
for update
using (true)
with check (true);

commit;
