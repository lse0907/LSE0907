-- Deployment draft: no contact or advertising source data.
create table public.beta_page_visits (
  session_id uuid not null,
  recruitment_round_id bigint not null references public.beta_recruitment_rounds(id),
  created_at timestamptz not null default now(),
  primary key (session_id, recruitment_round_id)
);
create index beta_page_visits_round_idx on public.beta_page_visits(recruitment_round_id);
alter table public.beta_page_visits enable row level security;
revoke all on table public.beta_page_visits from public, anon, authenticated;
grant select, insert on table public.beta_page_visits to service_role;
