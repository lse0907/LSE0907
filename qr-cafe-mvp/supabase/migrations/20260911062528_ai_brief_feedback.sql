begin;

create table public.ai_brief_feedback (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.ai_briefs(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  submitted_by_user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('helpful','neutral','unhelpful')),
  reason_code text check (reason_code is null or reason_code in ('need_evidence','not_actionable','not_relevant','inaccurate','other')),
  note text check (note is null or length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brief_id, submitted_by_user_id),
  check (rating <> 'unhelpful' or reason_code is not null)
);

create index idx_ai_brief_feedback_store_created
  on public.ai_brief_feedback(store_id, created_at desc);
create index idx_ai_brief_feedback_brief
  on public.ai_brief_feedback(brief_id, created_at desc);
create index idx_ai_brief_feedback_attention
  on public.ai_brief_feedback(rating, reason_code, created_at desc)
  where rating = 'unhelpful';

alter table public.ai_brief_feedback enable row level security;
revoke all on table public.ai_brief_feedback from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_brief_feedback to service_role;

comment on table public.ai_brief_feedback is
  'Server-only point-in-time quality feedback for an AI brief. Optional note must not contain account, payment, customer, or order-identifying personal data.';

commit;
