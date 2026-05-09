-- Initial setup state columns for /admin/setup gating
alter table if exists public.stores
  add column if not exists setup_completed boolean not null default false,
  add column if not exists setup_last_step smallint not null default 0,
  add column if not exists setup_completed_at timestamptz null,
  add column if not exists setup_completed_by uuid null;

create index if not exists idx_stores_setup_completed on public.stores(setup_completed);
