-- 2.5단계 직원/권한 관리 보안 테이블
-- Supabase SQL Editor에서 전체 실행하세요.

create table if not exists public.store_staff_pins (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  display_name text not null,
  pin_role text not null default 'staff' check (pin_role in ('staff', 'manager')),
  pin_hash text not null,
  is_active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz null,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz null
);

create index if not exists idx_store_staff_pins_store_id on public.store_staff_pins(store_id);
create index if not exists idx_store_staff_pins_role on public.store_staff_pins(store_id, pin_role, is_active);

create table if not exists public.store_devices (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  user_id uuid null,
  device_name text not null default '새 기기',
  device_fingerprint_hash text not null,
  device_type text null,
  browser text null,
  os text null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'disabled')),
  approved_by uuid null,
  approved_at timestamptz null,
  last_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz null,
  unique(store_id, user_id, device_fingerprint_hash)
);

create index if not exists idx_store_devices_store_id on public.store_devices(store_id);
create index if not exists idx_store_devices_status on public.store_devices(store_id, status);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  order_id uuid null,
  event_type text not null,
  before_status text null,
  after_status text null,
  actor_user_id uuid null,
  actor_pin_id uuid null references public.store_staff_pins(id) on delete set null,
  approved_by_pin_id uuid null references public.store_staff_pins(id) on delete set null,
  reason_code text null,
  reason_text text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_events_store_order on public.order_events(store_id, order_id, created_at desc);
create index if not exists idx_order_events_store_type on public.order_events(store_id, event_type, created_at desc);

create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  user_id uuid null,
  event_type text not null,
  device_id uuid null references public.store_devices(id) on delete set null,
  ip_address text null,
  user_agent text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_store_type on public.security_events(store_id, event_type, created_at desc);
create index if not exists idx_security_events_user on public.security_events(user_id, created_at desc);

alter table public.store_staff_pins enable row level security;
alter table public.store_devices enable row level security;
alter table public.order_events enable row level security;
alter table public.security_events enable row level security;

-- 서비스 역할 API가 관리합니다. 클라이언트 직접 접근은 기본적으로 막습니다.
