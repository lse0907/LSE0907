begin;

-- A single transaction prevents a partially-applied AI control change: the
-- store state, its applicable limit and the OPS audit event succeed or fail together.
create or replace function public.ops_apply_ai_store_control(
  p_actor_user_id uuid,
  p_store_id text,
  p_action text,
  p_reason text,
  p_daily_analysis_limit integer default null,
  p_monthly_analysis_limit integer default null,
  p_daily_cost_limit_won numeric default null,
  p_monthly_cost_limit_won numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_previous_setting jsonb := null;
  v_previous_limit jsonb := null;
  v_setting_id text;
  v_beta_status text;
  v_beta_enrolled_at timestamptz;
  v_beta_ended_at timestamptz;
  v_setting_enabled boolean;
  v_limit_id uuid;
  v_limit_enabled boolean;
  v_daily_analysis_limit integer;
  v_monthly_analysis_limit integer;
  v_daily_cost_limit_won numeric;
  v_monthly_cost_limit_won numeric;
  v_next_setting jsonb;
  v_next_limit jsonb;
begin
  if p_actor_user_id is null then raise exception 'AI_OPS_ACTOR_REQUIRED'; end if;
  if nullif(btrim(p_store_id),'') is null then raise exception 'AI_STORE_REQUIRED'; end if;
  if p_action not in ('enable','disable','set_limit') then raise exception 'AI_ACTION_INVALID'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'AI_REASON_REQUIRED'; end if;
  if p_daily_analysis_limit is not null and p_daily_analysis_limit not between 0 and 20 then raise exception 'AI_DAILY_LIMIT_INVALID'; end if;
  if p_monthly_analysis_limit is not null and p_monthly_analysis_limit not between 0 and 500 then raise exception 'AI_MONTHLY_LIMIT_INVALID'; end if;
  if p_daily_cost_limit_won is not null and (p_daily_cost_limit_won < 0 or p_daily_cost_limit_won > 100000000) then raise exception 'AI_DAILY_COST_LIMIT_INVALID'; end if;
  if p_monthly_cost_limit_won is not null and (p_monthly_cost_limit_won < 0 or p_monthly_cost_limit_won > 100000000) then raise exception 'AI_MONTHLY_COST_LIMIT_INVALID'; end if;
  if p_action='set_limit' and p_daily_analysis_limit is null and p_monthly_analysis_limit is null
    and p_daily_cost_limit_won is null and p_monthly_cost_limit_won is null then raise exception 'AI_LIMIT_REQUIRED'; end if;
  if not exists (select 1 from public.stores where store_id=p_store_id and deleted_at is null) then raise exception 'AI_STORE_NOT_FOUND'; end if;

  select to_jsonb(s),s.store_id,s.beta_status,s.beta_enrolled_at,s.beta_ended_at,s.ai_enabled
  into v_previous_setting,v_setting_id,v_beta_status,v_beta_enrolled_at,v_beta_ended_at,v_setting_enabled
  from public.ai_store_settings s where s.store_id=p_store_id for update;

  select to_jsonb(l),l.id,l.ai_enabled,l.daily_analysis_limit,l.monthly_analysis_limit,l.daily_cost_limit_won,l.monthly_cost_limit_won
  into v_previous_limit,v_limit_id,v_limit_enabled,v_daily_analysis_limit,v_monthly_analysis_limit,v_daily_cost_limit_won,v_monthly_cost_limit_won
  from public.ai_usage_limits l where l.target_scope='store' and l.target_store_id=p_store_id for update;

  v_beta_status := case when p_action='enable' then 'enrolled' when p_action='disable' then 'suspended' else coalesce(v_beta_status,'not_enrolled') end;
  v_setting_enabled := case when p_action='enable' then true when p_action='disable' then false else coalesce(v_setting_enabled,true) end;
  v_beta_enrolled_at := case when v_beta_status='enrolled' then coalesce(v_beta_enrolled_at,now()) else v_beta_enrolled_at end;
  v_daily_analysis_limit := coalesce(p_daily_analysis_limit,v_daily_analysis_limit,1);
  v_monthly_analysis_limit := coalesce(p_monthly_analysis_limit,v_monthly_analysis_limit,31);
  v_daily_cost_limit_won := coalesce(p_daily_cost_limit_won,v_daily_cost_limit_won,0);
  v_monthly_cost_limit_won := coalesce(p_monthly_cost_limit_won,v_monthly_cost_limit_won,0);
  v_limit_enabled := case when p_action='enable' then true when p_action='disable' then false else coalesce(v_limit_enabled,true) end;

  insert into public.ai_store_settings(
    store_id,beta_status,ai_enabled,daily_analysis_limit,monthly_analysis_limit,daily_cost_limit_won,monthly_cost_limit_won,
    beta_enrolled_at,beta_ended_at,updated_by,updated_at
  ) values (
    p_store_id,v_beta_status,v_setting_enabled,v_daily_analysis_limit,v_monthly_analysis_limit,v_daily_cost_limit_won,v_monthly_cost_limit_won,
    v_beta_enrolled_at,v_beta_ended_at,p_actor_user_id,now()
  ) on conflict (store_id) do update set
    beta_status=excluded.beta_status,ai_enabled=excluded.ai_enabled,daily_analysis_limit=excluded.daily_analysis_limit,
    monthly_analysis_limit=excluded.monthly_analysis_limit,daily_cost_limit_won=excluded.daily_cost_limit_won,
    monthly_cost_limit_won=excluded.monthly_cost_limit_won,beta_enrolled_at=excluded.beta_enrolled_at,
    beta_ended_at=excluded.beta_ended_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  if v_limit_id is null then
    insert into public.ai_usage_limits(
      target_scope,target_store_id,ai_enabled,daily_analysis_limit,monthly_analysis_limit,daily_cost_limit_won,monthly_cost_limit_won,updated_by,updated_at
    ) values ('store',p_store_id,v_limit_enabled,v_daily_analysis_limit,v_monthly_analysis_limit,v_daily_cost_limit_won,v_monthly_cost_limit_won,p_actor_user_id,now());
  else
    update public.ai_usage_limits set ai_enabled=v_limit_enabled,daily_analysis_limit=v_daily_analysis_limit,
      monthly_analysis_limit=v_monthly_analysis_limit,daily_cost_limit_won=v_daily_cost_limit_won,
      monthly_cost_limit_won=v_monthly_cost_limit_won,updated_by=p_actor_user_id,updated_at=now()
    where id=v_limit_id;
  end if;

  select to_jsonb(s) into v_next_setting from public.ai_store_settings s where s.store_id=p_store_id;
  select to_jsonb(l) into v_next_limit from public.ai_usage_limits l where l.target_scope='store' and l.target_store_id=p_store_id;
  insert into public.ai_ops_control_events(actor_user_id,target_scope,target_store_id,action,reason,previous_value,next_value)
  values (
    p_actor_user_id,'store',p_store_id,p_action,left(btrim(p_reason),500),
    jsonb_build_object('setting',v_previous_setting,'limit',v_previous_limit),
    jsonb_build_object('setting',v_next_setting,'limit',v_next_limit)
  );
  return jsonb_build_object('ok',true,'store_id',p_store_id,'action',p_action);
end;
$$;

revoke all on function public.ops_apply_ai_store_control(uuid,text,text,text,integer,integer,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.ops_apply_ai_store_control(uuid,text,text,text,integer,integer,numeric,numeric)
  to service_role;

comment on function public.ops_apply_ai_store_control(uuid,text,text,text,integer,integer,numeric,numeric) is
  'Server-only atomic AI OPS control. Persists setting, limit and audit event in one transaction.';

commit;
