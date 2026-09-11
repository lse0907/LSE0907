begin;

-- AI-4: An experiment records a store owner's decision about a single AI
-- recommendation. It intentionally stores only operational aggregates and
-- never changes menu, pricing, order, payment, or store settings by itself.
create table public.ai_experiments (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete cascade,
  source_brief_id uuid not null references public.ai_briefs(id) on delete restrict,
  experiment_key text not null check (char_length(experiment_key) between 1 and 100),
  title text not null check (char_length(title) between 1 and 200),
  change_summary text not null check (char_length(change_summary) between 1 and 1000),
  change_scope text not null check (change_scope in ('manual_copy')),
  duration_days integer not null check (duration_days between 1 and 31),
  success_metric text not null check (char_length(success_metric) between 1 and 200),
  success_threshold text not null check (char_length(success_threshold) between 1 and 200),
  guardrail_metric text not null check (char_length(guardrail_metric) between 1 and 200),
  status text not null default 'proposal' check (status in ('proposal','active','stopped','completed','stable','rejected')),
  result_status text check (result_status is null or result_status in ('success','failed','inconclusive')),
  result_summary text check (result_summary is null or char_length(result_summary) between 1 and 1000),
  approved_by_user_id uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  ended_at timestamptz,
  rollback_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'proposal' and approved_at is null and started_at is null) or status <> 'proposal'),
  check ((approved_at is null and approved_by_user_id is null) or (approved_at is not null and approved_by_user_id is not null)),
  check ((status <> 'stable') or result_status = 'success'),
  unique (source_brief_id)
);

create unique index uq_ai_experiments_store_stable_key
  on public.ai_experiments(store_id, experiment_key)
  where status = 'stable';
create index idx_ai_experiments_store_status_updated
  on public.ai_experiments(store_id, status, updated_at desc);

create table public.ai_experiment_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.ai_experiments(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('proposal_created','approved_and_started','stopped_and_rolled_back','completed','marked_stable','rejected')),
  event_summary text not null check (char_length(event_summary) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index idx_ai_experiment_events_experiment_created
  on public.ai_experiment_events(experiment_id, created_at asc);

-- A decision log must remain evidence, rather than an editable note. The
-- application can append a new event, but cannot rewrite or remove history.
create function public.prevent_ai_experiment_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'AI experiment audit events are append-only';
end;
$$;

create trigger prevent_ai_experiment_event_mutation
before update or delete on public.ai_experiment_events
for each row execute function public.prevent_ai_experiment_event_mutation();

revoke all on function public.prevent_ai_experiment_event_mutation() from public, anon, authenticated;

alter table public.ai_experiments enable row level security;
alter table public.ai_experiment_events enable row level security;
revoke all on table public.ai_experiments from public, anon, authenticated;
revoke all on table public.ai_experiment_events from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_experiments to service_role;
grant select, insert, update, delete on table public.ai_experiment_events to service_role;

comment on table public.ai_experiments is
  'Server-only approval record for a limited, store-owner-approved AI experiment. Initial scope is manual copy only; this table never executes a store mutation.';
comment on table public.ai_experiment_events is
  'Append-only audit events for AI experiment decisions and safety actions. Do not store customer, order, payment, or account-identifying data.';

commit;
