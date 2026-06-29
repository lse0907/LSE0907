-- 3차 매장 생명주기 상태 컬럼
-- 목적: 운영중/비활성/삭제 처리된 매장을 구분하여 관리자 홈과 매장 관리 흐름에서 안전하게 다룹니다.

alter table public.stores
add column if not exists status text not null default 'active',
add column if not exists deactivated_at timestamptz null,
add column if not exists deactivated_by uuid null,
add column if not exists deleted_at timestamptz null,
add column if not exists deleted_by uuid null;

alter table public.stores
drop constraint if exists stores_status_check;

alter table public.stores
add constraint stores_status_check
check (status in ('active', 'inactive', 'deleted'));

create index if not exists idx_stores_status on public.stores(status);

comment on column public.stores.status
is 'Store lifecycle status: active, inactive, or deleted.';
comment on column public.stores.deactivated_at
is 'Timestamp when the store was deactivated.';
comment on column public.stores.deactivated_by
is 'User id that deactivated the store.';
comment on column public.stores.deleted_at
is 'Timestamp when the store was soft-deleted.';
comment on column public.stores.deleted_by
is 'User id that soft-deleted the store.';
