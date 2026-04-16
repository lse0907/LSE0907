-- QR Cafe MVP - option_groups sort_order 도입 (safe rerun)
-- 목적:
-- 1) 옵션 그룹 노출 순서를 생성일(created_at)이 아니라 운영 우선순위(sort_order)로 제어
-- 2) 관리자 옵션 페이지와 주문 페이지의 표시 순서를 일치

begin;

-- 1) 컬럼 추가
alter table if exists public.option_groups
  add column if not exists sort_order integer;

-- 2) 기존 데이터 백필: 매장별 created_at 순으로 1..N 부여
with ranked as (
  select
    id,
    row_number() over (
      partition by store_id
      order by created_at asc nulls last, id asc
    ) as rn
  from public.option_groups
)
update public.option_groups og
set sort_order = ranked.rn
from ranked
where og.id = ranked.id
  and (og.sort_order is null or og.sort_order <= 0);

-- 3) 기본값/무결성
alter table if exists public.option_groups
  alter column sort_order set default 1;

update public.option_groups
set sort_order = 1
where sort_order is null or sort_order <= 0;

alter table if exists public.option_groups
  alter column sort_order set not null;

-- 4) 조회 성능 인덱스
create index if not exists idx_option_groups_store_sort_order
  on public.option_groups (store_id, sort_order);

commit;

