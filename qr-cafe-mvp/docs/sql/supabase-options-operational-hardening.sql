-- Operational hardening for menu/options management
-- 1) Add linked_menu_id to option_groups for exclusive option enforcement
-- 2) Backfill/normalize legacy rows so new constraint can be applied safely
-- 3) Add constraints/index/view for admin screens

begin;

alter table public.option_groups
  add column if not exists linked_menu_id text null;

-- Normalize legacy scope values first (null/unknown -> common).
update public.option_groups
set scope = case
  when lower(coalesce(scope, 'common')) = 'exclusive' then 'exclusive'
  else 'common'
end
where coalesce(scope, '') not in ('common', 'exclusive');

-- If linked_menu_id already exists, force scope to exclusive (consistent pair).
update public.option_groups
set scope = 'exclusive'
where linked_menu_id is not null
  and coalesce(scope, 'common') <> 'exclusive';

-- Backfill linked_menu_id for legacy exclusive groups by inferring from menu_items.option_group_ids.
-- Only auto-link when exactly one menu references that group.
with group_usage as (
  select
    g.store_id,
    g.id as group_id,
    min(m.id) as inferred_menu_id,
    count(distinct m.id) as menu_ref_count
  from public.option_groups g
  left join public.menu_items m
    on m.store_id = g.store_id
   and g.id = any(coalesce(m.option_group_ids, array[]::text[]))
  group by g.store_id, g.id
)
update public.option_groups og
set linked_menu_id = gu.inferred_menu_id
from group_usage gu
where og.store_id = gu.store_id
  and og.id = gu.group_id
  and coalesce(og.scope, 'common') = 'exclusive'
  and og.linked_menu_id is null
  and gu.menu_ref_count = 1;

-- Exclusive groups that still have no menu linkage cannot satisfy the new rule.
-- Convert those leftovers to common so migration does not fail.
update public.option_groups
set scope = 'common',
    linked_menu_id = null
where coalesce(scope, 'common') = 'exclusive'
  and linked_menu_id is null;

-- Common groups must not keep linked_menu_id.
update public.option_groups
set linked_menu_id = null
where coalesce(scope, 'common') = 'common'
  and linked_menu_id is not null;

-- linked_menu_id FK is created only when menu_items(id) is uniquely constrained.
-- Some projects use composite PK/UNIQUE (e.g. store_id + id), so forcing FK can fail with 42830.
do $$
declare
  has_unique_on_id boolean;
begin
  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.menu_items'::regclass
      and c.contype in ('p', 'u')
      and c.conkey = array[
        (select a.attnum
         from pg_attribute a
         where a.attrelid = 'public.menu_items'::regclass
           and a.attname = 'id'
           and a.attnum > 0
           and not a.attisdropped)
      ]
  )
  into has_unique_on_id;

  if has_unique_on_id then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'option_groups_linked_menu_fk'
        and conrelid = 'public.option_groups'::regclass
    ) then
      alter table public.option_groups
        add constraint option_groups_linked_menu_fk
        foreign key (linked_menu_id)
        references public.menu_items (id)
        on update cascade
        on delete set null;
    end if;
  else
    raise notice 'Skip FK option_groups_linked_menu_fk: public.menu_items(id) is not UNIQUE/PK in this schema.';
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
