-- Operational hardening for menu/options management
-- 1) Add linked_menu_id to option_groups for exclusive option enforcement
-- 2) Add constraints to keep exclusive/common rules consistent
-- 3) Add indexes and helper view for admin screens

begin;

alter table public.option_groups
  add column if not exists linked_menu_id text null;

-- FK to menu_items by linked_menu_id.
-- NOTE: Some projects have menu_items PK/UNIQUE only on (id), not (store_id, id).
-- Using single-column FK avoids the 42830 error in those schemas.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'option_groups_linked_menu_fk'
  ) then
    alter table public.option_groups
      add constraint option_groups_linked_menu_fk
      foreign key (linked_menu_id)
      references public.menu_items (id)
      on update cascade
      on delete set null;
  end if;
end $$;

-- scope consistency
alter table public.option_groups
  drop constraint if exists option_groups_scope_link_chk;

alter table public.option_groups
  add constraint option_groups_scope_link_chk
  check (
    (coalesce(scope, 'common') = 'common' and linked_menu_id is null)
    or
    (scope = 'exclusive' and linked_menu_id is not null)
  );

create index if not exists idx_option_groups_store_scope_menu
  on public.option_groups (store_id, scope, linked_menu_id);

-- Optional helper view for admin debugging/ops
create or replace view public.admin_option_groups_overview as
select
  og.store_id,
  og.id as option_group_id,
  og.name as option_group_name,
  coalesce(og.scope, 'common') as scope,
  og.linked_menu_id,
  mi.name as linked_menu_name,
  og.required,
  og.min,
  og.max,
  (
    select count(*)
    from public.option_items oi
    where oi.store_id = og.store_id and oi.group_id = og.id
  ) as option_item_count
from public.option_groups og
left join public.menu_items mi
  on mi.store_id = og.store_id
 and mi.id = og.linked_menu_id;

commit;
