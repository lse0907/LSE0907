begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Version aligned with the remote apply_migration history after CLI generation.
-- Extend only the existing capability list, preserving budget/locking logic.
do $migration$
declare
  v_definition text := pg_get_functiondef('public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric)'::regprocedure);
  v_old text := 'if p_feature not in (''daily_brief'',''weekly_brief'',''monthly_brief'',''manual_refresh'',''early_observation'',''full_analysis'',''evaluation'',''support_response'',''incident_analysis'',''provider_check'') then';
  v_new text := 'if p_feature not in (''daily_brief'',''weekly_brief'',''monthly_brief'',''manual_refresh'',''early_observation'',''full_analysis'',''evaluation'',''support_response'',''incident_analysis'',''provider_check'',''menu_setup'') then';
begin
  if strpos(v_definition, v_old) > 0 then
    execute replace(v_definition, v_old, v_new);
  elsif strpos(v_definition, v_new) = 0 then
    raise exception 'AI_MENU_SETUP_UNEXPECTED_RESERVATION_DEFINITION';
  end if;
end;
$migration$;

alter table public.ai_usage_events
  drop constraint ai_usage_events_feature_check,
  add constraint ai_usage_events_feature_check check (feature in (
    'daily_brief','weekly_brief','monthly_brief','manual_refresh','early_observation',
    'full_analysis','evaluation','support_response','incident_analysis','provider_check','menu_setup'
  ));

-- No new public access; browser clients still cannot reserve provider calls.
revoke all on function public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.ai_reserve_execution(uuid,text,uuid,text,text,text,numeric) to service_role;

-- Do not change store enrollment, call quotas, provider budgets or menu tables.
commit;
