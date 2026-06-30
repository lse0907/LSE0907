-- Store profile fields used by the admin store information page.
-- Run in Supabase SQL editor after the store lifecycle migration.

alter table public.stores
  add column if not exists store_desc text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists address_detail text,
  add column if not exists business_hours text,
  add column if not exists business_number text,
  add column if not exists industry text,
  add column if not exists sns_url text,
  add column if not exists main_image_overlay_strength integer not null default 55;

comment on column public.stores.store_desc is 'Store description shown on customer/admin preview screens.';
comment on column public.stores.phone is 'Store contact phone number.';
comment on column public.stores.address is 'Store base address.';
comment on column public.stores.address_detail is 'Store address detail.';
comment on column public.stores.business_hours is 'Human-readable business hours.';
comment on column public.stores.business_number is 'Business registration number.';
comment on column public.stores.industry is 'Business category or industry label.';
comment on column public.stores.sns_url is 'Store SNS or external profile URL.';
comment on column public.stores.main_image_overlay_strength is 'Customer hero image overlay strength from 0 to 100.';
