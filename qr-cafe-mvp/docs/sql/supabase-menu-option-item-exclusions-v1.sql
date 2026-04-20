-- menu option item exclusions v1
-- 목적: 메뉴별로 공통옵션 항목 일부를 숨김(제외) 처리하기 위한 테이블
-- 사용 예: 사이즈 그룹(라지/점보/킹) 중 특정 메뉴에서 킹만 제외

create table if not exists public.menu_option_item_exclusions (
  store_id text not null,
  menu_id text not null,
  option_item_id text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, menu_id, option_item_id)
);

create index if not exists idx_menu_opt_exclusions_store_menu
  on public.menu_option_item_exclusions(store_id, menu_id);

create index if not exists idx_menu_opt_exclusions_store_item
  on public.menu_option_item_exclusions(store_id, option_item_id);

-- menu_items FK (best-effort)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_option_item_exclusions_menu_fkey'
  ) then
    alter table public.menu_option_item_exclusions
      add constraint menu_option_item_exclusions_menu_fkey
      foreign key (menu_id)
      references public.menu_items(id)
      on update cascade
      on delete cascade;
  end if;
exception when undefined_table then
  raise notice 'menu_items not found. skip fk(menu_id)';
end $$;

-- option_items FK (best-effort)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_option_item_exclusions_item_fkey'
  ) then
    alter table public.menu_option_item_exclusions
      add constraint menu_option_item_exclusions_item_fkey
      foreign key (option_item_id)
      references public.option_items(id)
      on update cascade
      on delete cascade;
  end if;
exception when undefined_table then
  raise notice 'option_items not found. skip fk(option_item_id)';
end $$;

