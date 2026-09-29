-- Platform announcements are delivered through server routes only. This keeps
-- operating messages scoped to the signed-in owner/staff audience.
create table if not exists public.platform_announcements (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 2 and 100),
  body text not null check (char_length(body) between 2 and 1000),
  kind text not null default 'system' check (kind in ('important', 'system', 'update')),
  audience text not null default 'all' check (audience in ('owner', 'staff', 'all')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  pinned boolean not null default false,
  link_path text null check (link_path is null or char_length(link_path) <= 300),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create index if not exists platform_announcements_delivery_idx
  on public.platform_announcements (status, starts_at desc, ends_at);

alter table public.platform_announcements enable row level security;
revoke all on table public.platform_announcements from anon, authenticated;

-- Published notices are returned only after the route validates the current
-- store role. OPS writes through the service-role server route.
