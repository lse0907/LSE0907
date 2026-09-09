begin;

-- Rion AI Manager foundation. AI calls are made only by server routes; these
-- tables never grant direct browser access to sensitive inputs or audit rows.

create table public.ai_store_settings (
  store_id text primary key references public.stores(store_id) on delete cascade,
  beta_status text not null default 'not_enrolled' check (beta_status in ('not_enrolled','enrolled','suspended','ended')),
  ai_enabled boolean not null default false,
  daily_analysis_limit integer not null default 1 check (daily_analysis_limit between 0 and 20),
  monthly_analysis_limit integer not null default 31 check (monthly_analysis_limit between 0 and 500),
  daily_cost_limit_won numeric(12,2) not null default 0 check (daily_cost_limit_won >= 0),
  monthly_cost_limit_won numeric(12,2) not null default 0 check (monthly_cost_limit_won >= 0),
  beta_enrolled_at timestamptz,
  beta_ended_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (beta_status <> 'enrolled' or beta_enrolled_at is not null)
);

create table public.ai_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete cascade,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  analysis_type text not null check (analysis_type in ('daily_brief','manual_refresh','early_observation','full_analysis')),
  data_stage text not null check (data_stage in ('collection','early_observation','watch','full_analysis')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','blocked')),
  source_period_start date,
  source_period_end date,
  source_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(source_summary) = 'object'),
  source_fingerprint text,
  output_schema_version text,
  failure_code text,
  failure_detail text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_period_start is null or source_period_end is null or source_period_start <= source_period_end),
  check (failure_detail is null or length(failure_detail) <= 500)
);
create index idx_ai_analysis_runs_store_created
  on public.ai_analysis_runs(store_id,created_at desc);
create index idx_ai_analysis_runs_pending
  on public.ai_analysis_runs(status,created_at)
  where status in ('queued','running');

create table public.ai_briefs (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null unique references public.ai_analysis_runs(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  brief_status text not null check (brief_status in ('data_collection','early_observation','watch','normal','recommendation_ready','failed')),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  hypotheses jsonb not null default '[]'::jsonb check (jsonb_typeof(hypotheses) = 'array'),
  recommendation jsonb check (recommendation is null or jsonb_typeof(recommendation) = 'object'),
  data_confidence text not null check (data_confidence in ('insufficient','low','medium','high')),
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  check ((brief_status = 'recommendation_ready') = (recommendation is not null))
);
create index idx_ai_briefs_store_generated
  on public.ai_briefs(store_id,generated_at desc);

create table public.ai_recommendation_decisions (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.ai_briefs(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  decision text not null check (decision in ('approved','deferred','rejected','expired')),
  decided_by_user_id uuid references auth.users(id) on delete set null,
  note text,
  decided_at timestamptz not null default now(),
  check (note is null or length(note) <= 500)
);
create index idx_ai_recommendation_decisions_brief_time
  on public.ai_recommendation_decisions(brief_id,decided_at desc);
create index idx_ai_recommendation_decisions_store_time
  on public.ai_recommendation_decisions(store_id,decided_at desc);

-- Limits are layered: platform default -> store -> user -> feature. A missing
-- row means that scope does not add a restriction; the server resolves the
-- strictest applicable limit before every AI call.
create table public.ai_usage_limits (
  id uuid primary key default gen_random_uuid(),
  target_scope text not null check (target_scope in ('platform','store','user','feature')),
  target_store_id text references public.stores(store_id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  target_feature text,
  ai_enabled boolean not null default true,
  daily_analysis_limit integer check (daily_analysis_limit between 0 and 20),
  monthly_analysis_limit integer check (monthly_analysis_limit between 0 and 500),
  daily_cost_limit_won numeric(12,2) check (daily_cost_limit_won >= 0),
  monthly_cost_limit_won numeric(12,2) check (monthly_cost_limit_won >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (target_scope = 'platform' and target_store_id is null and target_user_id is null and target_feature is null)
    or (target_scope = 'store' and target_store_id is not null and target_user_id is null and target_feature is null)
    or (target_scope = 'user' and target_store_id is null and target_user_id is not null and target_feature is null)
    or (target_scope = 'feature' and target_store_id is null and target_user_id is null and target_feature is not null)
  )
);
create unique index uq_ai_usage_limits_platform
  on public.ai_usage_limits(target_scope) where target_scope = 'platform';
create unique index uq_ai_usage_limits_store
  on public.ai_usage_limits(target_store_id) where target_scope = 'store';
create unique index uq_ai_usage_limits_user
  on public.ai_usage_limits(target_user_id) where target_scope = 'user';
create unique index uq_ai_usage_limits_feature
  on public.ai_usage_limits(target_feature) where target_scope = 'feature';

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  store_id text not null references public.stores(store_id) on delete cascade,
  analysis_run_id uuid references public.ai_analysis_runs(id) on delete set null,
  requested_by_user_id uuid references auth.users(id) on delete set null,
  feature text not null check (feature in ('daily_brief','manual_refresh','early_observation','full_analysis','evaluation')),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  estimated_cost_won numeric(12,4) not null default 0 check (estimated_cost_won >= 0),
  status text not null check (status in ('succeeded','failed','blocked')),
  error_code text,
  occurred_at timestamptz not null default now(),
  check (error_code is null or length(error_code) <= 100)
);
create index idx_ai_usage_events_store_time
  on public.ai_usage_events(store_id,occurred_at desc);
create index idx_ai_usage_events_requester_time
  on public.ai_usage_events(requested_by_user_id,occurred_at desc)
  where requested_by_user_id is not null;
create index idx_ai_usage_events_daily_cost
  on public.ai_usage_events(occurred_at,store_id)
  where status = 'succeeded';

create table public.ai_ops_control_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_scope text not null check (target_scope in ('platform','store','user','feature')),
  target_store_id text references public.stores(store_id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  target_feature text,
  action text not null check (action in ('enable','disable','set_limit','enroll_beta','end_beta','retry_allowed')),
  reason text not null,
  previous_value jsonb not null default '{}'::jsonb check (jsonb_typeof(previous_value) = 'object'),
  next_value jsonb not null default '{}'::jsonb check (jsonb_typeof(next_value) = 'object'),
  occurred_at timestamptz not null default now(),
  check (length(reason) between 1 and 500)
);
create index idx_ai_ops_control_events_time
  on public.ai_ops_control_events(occurred_at desc);
create index idx_ai_ops_control_events_store_time
  on public.ai_ops_control_events(target_store_id,occurred_at desc)
  where target_store_id is not null;

-- Service routes are the only mutation path. RLS remains enabled as defense in
-- depth, and no Data API grants are given to anon/authenticated roles.
alter table public.ai_store_settings enable row level security;
alter table public.ai_analysis_runs enable row level security;
alter table public.ai_briefs enable row level security;
alter table public.ai_recommendation_decisions enable row level security;
alter table public.ai_usage_limits enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_ops_control_events enable row level security;

revoke all on table public.ai_store_settings,public.ai_analysis_runs,public.ai_briefs,
  public.ai_recommendation_decisions,public.ai_usage_limits,public.ai_usage_events,public.ai_ops_control_events
  from public,anon,authenticated;
revoke all on sequence public.ai_usage_events_id_seq,public.ai_ops_control_events_id_seq
  from public,anon,authenticated;

grant select,insert,update,delete on table public.ai_store_settings,public.ai_analysis_runs,
  public.ai_briefs,public.ai_recommendation_decisions,public.ai_usage_limits,public.ai_usage_events,public.ai_ops_control_events
  to service_role;
grant usage,select on sequence public.ai_usage_events_id_seq,public.ai_ops_control_events_id_seq
  to service_role;

comment on table public.ai_analysis_runs is
  'Server-only AI execution ledger. source_summary must contain aggregate business metrics only, never customer or payment data.';
comment on table public.ai_usage_events is
  'Server-only AI cost and failure ledger. Raw prompts and provider responses are intentionally not retained.';
comment on table public.ai_ops_control_events is
  'Append-only operational audit event; direct browser access is prohibited.';

commit;
