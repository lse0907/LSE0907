-- menu categories v1
-- 1) menu_categories table
-- 2) menu_items.category_id

create table if not exists public.menu_categories (
  id text primary key,
  store_id text not null,
  name text not null,
  sort_order integer null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_menu_categories_store_id on public.menu_categories(store_id);
create index if not exists idx_menu_categories_store_active_sort on public.menu_categories(store_id, is_active, sort_order);

alter table if exists public.menu_items
  add column if not exists category_id text null;

create index if not exists idx_menu_items_store_category on public.menu_items(store_id, category_id);

-- fk (best-effort)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'menu_items_category_id_fkey'
  ) then
    alter table public.menu_items
      add constraint menu_items_category_id_fkey
      foreign key (category_id) references public.menu_categories(id)
      on update cascade on delete set null;
  end if;
exception when undefined_table then
  raise notice 'menu_items not found. skip fk';
end $$;
