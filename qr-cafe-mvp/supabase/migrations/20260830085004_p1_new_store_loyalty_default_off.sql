begin;

-- Keep the legacy backfill and the new-store trigger installation atomic.
-- The lock is held only for this short migration transaction.
lock table public.stores in share row exclusive mode;

-- Preserve the behavior of every store that existed before this policy
-- migration. A missing settings row previously behaved as if both services
-- were enabled.
insert into public.store_loyalty_settings (
  store_id,
  points_enabled,
  coupons_enabled
)
select
  s.store_id,
  true,
  true
from public.stores s
where not exists (
  select 1
  from public.store_loyalty_settings ls
  where ls.store_id = s.store_id
)
on conflict (store_id) do nothing;

-- V5 policy: stores created after this migration start with both optional
-- loyalty services disabled. Existing rows are intentionally not updated.
alter table public.store_loyalty_settings
  alter column points_enabled set default false,
  alter column coupons_enabled set default false;

create or replace function private.initialize_store_loyalty_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.store_loyalty_settings (
    store_id,
    points_enabled,
    coupons_enabled
  ) values (
    new.store_id,
    false,
    false
  )
  on conflict (store_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_initialize_store_loyalty_defaults
on public.stores;

create trigger trg_initialize_store_loyalty_defaults
after insert on public.stores
for each row
execute function private.initialize_store_loyalty_defaults();

revoke all privileges on function private.initialize_store_loyalty_defaults()
from public, anon, authenticated;

comment on function private.initialize_store_loyalty_defaults() is
  'Creates an explicit OFF/OFF loyalty settings row for every newly created store.';

commit;
