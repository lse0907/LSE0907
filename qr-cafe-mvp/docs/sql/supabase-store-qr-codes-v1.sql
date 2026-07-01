-- Store QR management schema for the admin QR page.
-- Run this entire file in the Supabase SQL Editor before using the QR management UI.

create extension if not exists pgcrypto;

create table if not exists public.store_qr_codes (
  id text primary key default gen_random_uuid()::text,
  store_id text not null references public.stores(store_id) on delete cascade,
  qr_type text not null default 'table',
  label text not null,
  table_no integer,
  target_url text not null,
  status text not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_qr_codes_type_check check (qr_type in ('counter', 'table', 'pickup', 'custom')),
  constraint store_qr_codes_status_check check (status in ('active', 'inactive', 'archived')),
  constraint store_qr_codes_table_no_check check (
    (qr_type = 'table' and table_no is not null and table_no > 0)
    or (qr_type <> 'table')
  )
);

create unique index if not exists store_qr_codes_one_counter_per_store
  on public.store_qr_codes(store_id)
  where qr_type = 'counter' and status <> 'archived';

create unique index if not exists store_qr_codes_one_table_per_store
  on public.store_qr_codes(store_id, table_no)
  where qr_type = 'table' and status <> 'archived';

create index if not exists idx_store_qr_codes_store_sort
  on public.store_qr_codes(store_id, sort_order, created_at);

create table if not exists public.store_qr_design_settings (
  store_id text primary key references public.stores(store_id) on delete cascade,
  template_key text not null default 'simple',
  accent_color text not null default '#111827',
  counter_title text not null default 'QR로 간편하게 주문하세요',
  counter_description text not null default 'QR로 간편하게 주문하고 기다리세요.\n주문 후 직원 안내에 따라 픽업/수령해 주세요.',
  table_title text not null default '테이블에서 바로 주문',
  table_description text not null default 'QR을 찍고 메뉴를 선택해 주세요.',
  show_logo boolean not null default true,
  show_main_image boolean not null default true,
  show_store_name boolean not null default true,
  show_target_url boolean not null default false,
  counter_print_preset text not null default 'a4_2up',
  table_print_preset text not null default 'a4_12',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_qr_design_template_check check (template_key in ('simple', 'cafe_poster', 'premium_dark', 'soft_round')),
  constraint store_qr_design_counter_preset_check check (counter_print_preset in ('a5_card', 'a4_poster', 'a3_poster', 'a4_2up')),
  constraint store_qr_design_table_preset_check check (table_print_preset in ('a4_12', 'a4_8', 'a4_4', 'individual_png'))
);

create or replace function public.touch_store_qr_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_store_qr_codes_updated_at on public.store_qr_codes;
create trigger touch_store_qr_codes_updated_at
before update on public.store_qr_codes
for each row execute function public.touch_store_qr_updated_at();

drop trigger if exists touch_store_qr_design_settings_updated_at on public.store_qr_design_settings;
create trigger touch_store_qr_design_settings_updated_at
before update on public.store_qr_design_settings
for each row execute function public.touch_store_qr_updated_at();

insert into public.store_qr_design_settings (store_id)
select s.store_id
from public.stores s
on conflict (store_id) do nothing;

alter table public.store_qr_codes enable row level security;
alter table public.store_qr_design_settings enable row level security;

drop policy if exists store_qr_codes_member_rw on public.store_qr_codes;
create policy store_qr_codes_member_rw
on public.store_qr_codes
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_qr_codes.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_qr_codes.store_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists store_qr_design_settings_member_rw on public.store_qr_design_settings;
create policy store_qr_design_settings_member_rw
on public.store_qr_design_settings
for all
using (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_qr_design_settings.store_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.store_members m
    where m.store_id = store_qr_design_settings.store_id
      and m.user_id = auth.uid()
  )
);
