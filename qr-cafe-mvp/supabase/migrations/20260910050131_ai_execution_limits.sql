begin;

-- AI-1: one server-only ledger is shared by briefs, support and incidents.
-- No prompt, answer body, customer information or screenshot is stored here.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_feature_check,
  add constraint ai_usage_events_feature_check check (feature in (
    'daily_brief','weekly_brief','monthly_brief','manual_refresh','early_observation',
    'full_analysis','evaluation','support_response','incident_analysis'
  )),
  drop constraint if exists ai_usage_events_status_check,
  add constraint ai_usage_events_status_check check (status in ('pending','succeeded','failed','blocked')),
  add column if not exists request_id uuid,
  add column if not exists estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  add column if not exists actual_cost_usd numeric(12,6) check (actual_cost_usd is null or actual_cost_usd >= 0);

create unique index if not exists uq_ai_usage_events_request_id
  on public.ai_usage_events(request_id) where request_id is not null;
create index if not exists idx_ai_usage_events_feature_time
  on public.ai_usage_events(feature, occurred_at desc);

-- Dollar limits are stored separately from existing KRW display limits so the
-- provider invoice and the stop rule are never dependent on a guessed FX rate.
create table public.ai_provider_budget_controls (
  provider text primary key check (provider in ('openai')),
  ai_enabled boolean not null default false,
  monthly_stop_usd numeric(12,2) not null default 40 check (monthly_stop_usd between 0 and 100000),
  monthly_hard_limit_usd numeric(12,2) not null default 50 check (monthly_hard_limit_usd between 0 and 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (monthly_stop_usd <= monthly_hard_limit_usd)
);
alter table public.ai_provider_budget_controls enable row level security;
revoke all on table public.ai_provider_budget_controls from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_provider_budget_controls to service_role;
insert into public.ai_provider_budget_controls(provider, ai_enabled, monthly_stop_usd, monthly_hard_limit_usd)
values ('openai', false, 40, 50)
on conflict (provider) do nothing;

-- A reservation is made before an external request. Transaction locks prevent
-- simultaneous server requests from passing the same monthly budget check.
create or replace function public.ai_reserve_execution(
  p_request_id uuid,
  p_store_id text,
  p_requested_by_user_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_estimated_cost_usd numeric
)
returns table(event_id bigint, allowed boolean, block_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.ai_provider_budget_controls%rowtype;
  v_setting public.ai_store_settings%rowtype;
  v_month_cost numeric := 0;
  v_day_calls integer := 0;
  v_month_calls integer := 0;
  v_limit record;
  v_existing record;
  v_code text := null;
  v_event_id bigint;
  v_kst_day date := (now() at time zone 'Asia/Seoul')::date;
  v_kst_month date := date_trunc('month', now() at time zone 'Asia/Seoul')::date;
begin
  if p_request_id is null or nullif(btrim(p_store_id),'') is null or nullif(btrim(p_feature),'') is null
    or nullif(btrim(p_provider),'') is null or nullif(btrim(p_model),'') is null or coalesce(p_estimated_cost_usd, -1) < 0 then
    raise exception 'AI_EXECUTION_ARGUMENT_INVALID';
  end if;
  if p_feature not in ('daily_brief','weekly_brief','monthly_brief','manual_refresh','early_observation','full_analysis','evaluation','support_response','incident_analysis') then
    raise exception 'AI_FEATURE_INVALID';
  end if;

  select id, status, error_code into v_existing from public.ai_usage_events
    where request_id = p_request_id for update;
  if found then
    return query select v_existing.id, v_existing.status in ('pending','succeeded'), v_existing.error_code;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rion-ai:' || p_provider, 0));
  select * into v_budget from public.ai_provider_budget_controls where provider = p_provider for update;
  if not found or not v_budget.ai_enabled then v_code := 'AI_PROVIDER_DISABLED'; end if;
  select * into v_setting from public.ai_store_settings where store_id = p_store_id for update;
  if v_code is null and (not found or not v_setting.ai_enabled or v_setting.beta_status <> 'enrolled') then v_code := 'AI_STORE_DISABLED'; end if;

  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0) into v_month_cost
  from public.ai_usage_events
  where provider = p_provider and status in ('pending','succeeded')
    and (occurred_at at time zone 'Asia/Seoul')::date >= v_kst_month;
  if v_code is null and v_month_cost + p_estimated_cost_usd >= v_budget.monthly_stop_usd then v_code := 'AI_PLATFORM_BUDGET_STOP'; end if;
  if v_code is null and v_month_cost + p_estimated_cost_usd > v_budget.monthly_hard_limit_usd then v_code := 'AI_PLATFORM_BUDGET_LIMIT'; end if;

  for v_limit in select * from public.ai_usage_limits
    where (target_scope = 'platform')
       or (target_scope = 'store' and target_store_id = p_store_id)
       or (target_scope = 'user' and target_user_id = p_requested_by_user_id)
       or (target_scope = 'feature' and target_feature = p_feature)
  loop
    if v_code is null and not v_limit.ai_enabled then v_code := 'AI_SCOPE_DISABLED'; end if;
    select count(*) into v_day_calls from public.ai_usage_events
      where store_id=p_store_id and feature=p_feature and status in ('pending','succeeded')
        and (occurred_at at time zone 'Asia/Seoul')::date = v_kst_day;
    select count(*) into v_month_calls from public.ai_usage_events
      where store_id=p_store_id and feature=p_feature and status in ('pending','succeeded')
        and (occurred_at at time zone 'Asia/Seoul')::date >= v_kst_month;
    if v_code is null and v_limit.daily_analysis_limit is not null and v_day_calls >= v_limit.daily_analysis_limit then v_code := 'AI_DAILY_CALL_LIMIT'; end if;
    if v_code is null and v_limit.monthly_analysis_limit is not null and v_month_calls >= v_limit.monthly_analysis_limit then v_code := 'AI_MONTHLY_CALL_LIMIT'; end if;
  end loop;

  insert into public.ai_usage_events(store_id, requested_by_user_id, feature, provider, model, request_id, estimated_cost_usd, status, error_code)
  values (p_store_id, p_requested_by_user_id, p_feature, p_provider, p_model, p_request_id, p_estimated_cost_usd,
    case when v_code is null then 'pending' else 'blocked' end, v_code)
  returning id into v_event_id;
  return query select v_event_id, v_code is null, v_code;
end;
$$;

create or replace function public.ai_finalize_execution(
  p_request_id uuid,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_actual_cost_usd numeric,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_id is null or p_status not in ('succeeded','failed') or coalesce(p_input_tokens,-1) < 0
    or coalesce(p_output_tokens,-1) < 0 or coalesce(p_cached_input_tokens,-1) < 0 or coalesce(p_actual_cost_usd,-1) < 0
    or length(coalesce(p_error_code,'')) > 100 then raise exception 'AI_FINALIZE_ARGUMENT_INVALID'; end if;
  update public.ai_usage_events set status=p_status, input_tokens=p_input_tokens, output_tokens=p_output_tokens,
    cached_input_tokens=p_cached_input_tokens, actual_cost_usd=p_actual_cost_usd,
    error_code=case when p_status='failed' then nullif(left(p_error_code,100),'') else null end
  where request_id=p_request_id and status='pending';
  return found;
end;
$$;

revoke all on function public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric) from public, anon, authenticated;
revoke all on function public.ai_finalize_execution(uuid,text,integer,integer,integer,numeric,text) from public, anon, authenticated;
grant execute on function public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric) to service_role;
grant execute on function public.ai_finalize_execution(uuid,text,integer,integer,integer,numeric,text) to service_role;

comment on table public.ai_provider_budget_controls is
  'Server-only OpenAI budget kill switch. Forty USD stops new calls; fifty USD is the invoice safety ceiling.';
comment on function public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric) is
  'Server-only, idempotent AI reservation. Records blocked attempts without retaining prompts or outputs.';

commit;
