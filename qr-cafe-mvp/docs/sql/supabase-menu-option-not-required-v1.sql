-- 2.5차 옵션 없음 상태 저장 컬럼
-- 목적: 옵션 그룹이 비어 있는 메뉴를 "확인 필요"와 "옵션 없음"으로 구분합니다.

alter table public.menu_items
add column if not exists option_not_required boolean not null default false;

comment on column public.menu_items.option_not_required
is 'True when the menu item intentionally has no option groups.';
