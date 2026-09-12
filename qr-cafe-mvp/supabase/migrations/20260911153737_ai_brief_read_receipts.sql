begin;

-- A read receipt belongs to one signed-in owner and one store-scoped brief.
-- It is deliberately server-only: the browser never receives direct table
-- access, and the route verifies store membership before every operation.
create table public.ai_brief_read_receipts (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.ai_briefs(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  reader_user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (brief_id, reader_user_id)
);

create index idx_ai_brief_read_receipts_store_reader_read
  on public.ai_brief_read_receipts(store_id, reader_user_id, read_at desc);

alter table public.ai_brief_read_receipts enable row level security;
revoke all on table public.ai_brief_read_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_brief_read_receipts to service_role;

comment on table public.ai_brief_read_receipts is
  'Server-only, per-owner read receipts for store-scoped AI briefs. It records only a brief identifier and timestamp; no customer or order details are stored.';

commit;
