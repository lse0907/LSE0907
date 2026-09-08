begin;

alter table public.account_lifecycle_states drop constraint if exists account_lifecycle_states_audience_check;
alter table public.account_lifecycle_states add constraint account_lifecycle_states_audience_check
  check (audience in ('customer','owner','all'));
alter table public.account_withdrawal_requests drop constraint if exists account_withdrawal_requests_audience_check;
alter table public.account_withdrawal_requests add constraint account_withdrawal_requests_audience_check
  check (audience in ('customer','owner','all'));
alter table public.privacy_rights_requests drop constraint if exists privacy_rights_requests_audience_check;
alter table public.privacy_rights_requests add constraint privacy_rights_requests_audience_check
  check (audience in ('customer','owner','all'));

alter function public.request_account_withdrawal(uuid,text,text)
  rename to request_single_account_withdrawal;

create or replace function public.request_account_withdrawal(
  p_user_id uuid,
  p_audience text,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_result jsonb;
  v_id uuid;
  v_customer_blockers jsonb := '[]'::jsonb;
begin
  if p_audience not in ('customer','owner','all') then raise exception 'INVALID_AUDIENCE'; end if;
  if p_audience in ('customer','owner') and not exists (
    select 1 from public.account_roles
    where user_id=p_user_id and audience=p_audience and status <> 'withdrawn'
  ) then raise exception 'ACCOUNT_ROLE_NOT_FOUND'; end if;
  if p_audience='all' and not exists (
    select 1 from public.account_roles where user_id=p_user_id and status <> 'withdrawn'
  ) then raise exception 'ACCOUNT_ROLE_NOT_FOUND'; end if;

  if p_audience <> 'all' then
    v_result := public.request_single_account_withdrawal(p_user_id,p_audience,p_reason);
    if exists (
      select 1 from public.account_roles
      where user_id=p_user_id and audience<>p_audience and status not in ('withdrawn','suspended')
    ) then
      update public.account_lifecycle_states
      set audience=(select audience from public.account_roles where user_id=p_user_id and audience<>p_audience and status not in ('withdrawn','suspended') limit 1),
        status='active',recovery_until=null,updated_at=now()
      where subject_user_id=p_user_id;
    end if;
    return v_result || jsonb_build_object('audience',p_audience);
  end if;

  -- Reuse the proven owner/full-account request path, then add the customer scope.
  v_result := public.request_single_account_withdrawal(p_user_id,'owner',p_reason);
  v_id := (v_result->>'id')::uuid;

  if exists (
    select 1 from public.orders
    where customer_user_id=p_user_id
      and (status not in ('completed','cancelled') or payment_status in ('pending','cancel_pending'))
  ) then v_customer_blockers := v_customer_blockers || jsonb_build_array('OPEN_CUSTOMER_ORDER'); end if;
  if exists (
    select 1 from public.order_partial_refunds r
    join public.orders o on o.id=r.order_id
    where o.customer_user_id=p_user_id and r.status not in ('completed','failed','rejected','cancelled','canceled')
  ) then v_customer_blockers := v_customer_blockers || jsonb_build_array('PENDING_CUSTOMER_REFUND'); end if;

  update public.account_withdrawal_requests
  set audience='all',blocker_codes=blocker_codes || v_customer_blockers,updated_at=now()
  where id=v_id;
  update public.account_lifecycle_states set audience='all',updated_at=now() where subject_user_id=p_user_id;
  update public.privacy_rights_requests set audience='all',updated_at=now()
  where subject_user_id=p_user_id and request_type='withdrawal'
    and request_detail->>'withdrawal_request_id'=v_id::text;

  if exists (select 1 from public.orders where customer_user_id=p_user_id) then
    insert into public.privacy_retention_holds(subject_user_id,withdrawal_request_id,category,reason)
    values (p_user_id,v_id,'order_transaction','주문 거래기록 보존 범위·기간 법률 검토 필요')
    on conflict (subject_user_id,category) where status='active' do nothing;
  end if;
  if exists (select 1 from public.orders where customer_user_id=p_user_id and payment_status <> 'not_required') then
    insert into public.privacy_retention_holds(subject_user_id,withdrawal_request_id,category,reason)
    values (p_user_id,v_id,'payment_refund','결제·취소·환불 기록 보존 범위·기간 법률 검토 필요')
    on conflict (subject_user_id,category) where status='active' do nothing;
  end if;

  return v_result || jsonb_build_object('audience','all','blocker_codes',
    (select blocker_codes from public.account_withdrawal_requests where id=v_id));
end;
$$;

alter function public.prepare_account_privacy_deletion(uuid)
  rename to prepare_full_account_privacy_deletion;

create or replace function public.prepare_account_privacy_deletion(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_user_id uuid;
  v_withdrawal_id uuid;
  v_retention_subject_id uuid;
  v_audience text;
  v_recovery_until timestamptz;
  v_has_other_role boolean := false;
  v_blockers jsonb := '[]'::jsonb;
  v_hard_blocker boolean := false;
begin
  select j.subject_user_id,j.withdrawal_request_id,w.retention_subject_id,w.audience,w.recovery_until
  into v_user_id,v_withdrawal_id,v_retention_subject_id,v_audience,v_recovery_until
  from public.privacy_deletion_jobs j
  join public.account_withdrawal_requests w on w.id=j.withdrawal_request_id
  where j.id=p_job_id and j.status='running' and j.job_type='assess_retention'
  for update of j,w;
  if v_user_id is null then raise exception 'RUNNING_PRIVACY_JOB_NOT_FOUND'; end if;
  if v_recovery_until > now() then
    update public.privacy_deletion_jobs set status='scheduled',scheduled_at=v_recovery_until,updated_at=now() where id=p_job_id;
    return jsonb_build_object('ready',false,'reason','RECOVERY_PERIOD_ACTIVE');
  end if;

  if v_audience in ('customer','owner') then
    select exists (
      select 1 from public.account_roles
      where user_id=v_user_id and audience<>v_audience and status not in ('withdrawn','suspended')
    ) into v_has_other_role;
  end if;

  -- Role-only withdrawal: remove only that service surface and keep the shared Auth identity.
  if v_has_other_role then
    if v_audience='customer' then
      if exists (
        select 1 from public.orders where customer_user_id=v_user_id
          and (status not in ('completed','cancelled') or payment_status in ('pending','cancel_pending'))
      ) then v_blockers := v_blockers || jsonb_build_array('OPEN_CUSTOMER_ORDER'); end if;
      if exists (
        select 1 from public.order_partial_refunds r join public.orders o on o.id=r.order_id
        where o.customer_user_id=v_user_id and r.status not in ('completed','failed','rejected','cancelled','canceled')
      ) then v_blockers := v_blockers || jsonb_build_array('PENDING_CUSTOMER_REFUND'); end if;
    else
      if exists (
        select 1 from public.store_members sm join public.stores s on s.store_id=sm.store_id
        where sm.user_id=v_user_id and sm.role='owner' and s.deleted_at is null and s.status='active'
      ) then v_blockers := v_blockers || jsonb_build_array('ACTIVE_STORE_OWNERSHIP'); v_hard_blocker := true; end if;
      if exists (
        select 1 from public.billing_accounts ba
        join public.billing_account_stores bas on bas.billing_account_id=ba.id
        left join public.billing_refund_attempts ra on ra.store_id=bas.store_id
        left join public.billing_refund_cases rc on rc.store_id=bas.store_id
        where ba.owner_user_id=v_user_id and (
          (ra.id is not null and ra.status not in ('completed','failed','rejected','cancelled','canceled')) or
          (rc.id is not null and rc.status not in ('completed','failed','rejected','cancelled','canceled'))
        )
      ) then v_blockers := v_blockers || jsonb_build_array('PENDING_BILLING_SETTLEMENT'); end if;
    end if;

    if jsonb_array_length(v_blockers)>0 then
      update public.privacy_deletion_jobs
      set status=case when v_hard_blocker then 'manual_review' else 'scheduled' end,
        next_retry_at=case when v_hard_blocker then null else now()+interval '24 hours' end,
        failure_code='WITHDRAWAL_BLOCKED',failure_detail=v_blockers::text,updated_at=now()
      where id=p_job_id;
      update public.account_withdrawal_requests set status='review_required',blocker_codes=v_blockers,updated_at=now() where id=v_withdrawal_id;
      return jsonb_build_object('ready',false,'blocker_codes',v_blockers,'manual_review',v_hard_blocker);
    end if;

    perform set_config('app.privacy_cleanup_user_id',v_user_id::text,true);
    insert into public.retained_policy_evidence(
      retention_subject_id,withdrawal_request_id,evidence_type,audience,document_version,action,source,occurred_at
    ) select v_retention_subject_id,v_withdrawal_id,'signup_confirmation',s.audience,s.policy_version,
      'confirmed',s.source,s.confirmed_at
      from public.signup_policy_confirmations s where s.user_id=v_user_id and s.audience=v_audience;
    insert into public.retained_policy_evidence(
      retention_subject_id,withdrawal_request_id,evidence_type,audience,document_type,document_version,action,source,occurred_at
    ) select v_retention_subject_id,v_withdrawal_id,'policy_acceptance',e.audience,d.document_type,d.version,e.action,e.source,e.occurred_at
      from public.policy_acceptance_events e join public.policy_documents d on d.id=e.document_id
      where e.user_id=v_user_id and e.audience=v_audience;
    delete from public.policy_acceptance_events where user_id=v_user_id and audience=v_audience;
    delete from public.signup_policy_confirmations where user_id=v_user_id and audience=v_audience;

    if v_audience='customer' then
      update public.orders set retention_subject_id=v_retention_subject_id,customer_user_id=null,
        request_note='',buzzer_no=null,access_token=gen_random_uuid()::text where customer_user_id=v_user_id;
      update public.order_checkout_attempts set retention_subject_id=v_retention_subject_id,customer_user_id=null,
        client_request_id=gen_random_uuid(),request_fingerprint=gen_random_uuid()::text,request_note='',
        recovery_token_hash=gen_random_uuid()::text,toss_response=private.minimize_payment_provider_response(toss_response),
        failure_detail=null,updated_at=now() where customer_user_id=v_user_id;
      delete from public.customer_profiles where user_id=v_user_id;
    else
      update public.billing_accounts set retention_subject_id=v_retention_subject_id,owner_user_id=null,updated_at=now() where owner_user_id=v_user_id;
      update public.billing_referrals set retention_subject_id=v_retention_subject_id,referred_user_id=null,updated_at=now() where referred_user_id=v_user_id;
      update public.billing_payment_attempts set retention_subject_id=v_retention_subject_id,payer_user_id=null,
        toss_response=private.minimize_payment_provider_response(toss_response),updated_at=now() where payer_user_id=v_user_id;
      update public.billing_payments set retention_subject_id=v_retention_subject_id,payer_user_id=null,updated_at=now() where payer_user_id=v_user_id;
      update public.stores set owner_user_id=null,updated_at=now()
        where owner_user_id=v_user_id and (deleted_at is not null or status <> 'active');
      delete from public.store_members where user_id=v_user_id;
      delete from public.business_entity_members where user_id=v_user_id;
      delete from public.profiles where user_id=v_user_id;
    end if;

    update public.account_roles set status='withdrawn',withdrawn_at=now(),updated_at=now()
      where user_id=v_user_id and audience=v_audience;
    update public.account_withdrawal_requests set status='completed',blocker_codes='[]'::jsonb,
      processing_started_at=coalesce(processing_started_at,now()),completed_at=now(),updated_at=now() where id=v_withdrawal_id;
    update public.account_lifecycle_states set audience=(
      select audience from public.account_roles where user_id=v_user_id and status not in ('withdrawn','suspended') limit 1
    ),status='active',recovery_until=null,updated_at=now() where subject_user_id=v_user_id;
    update public.privacy_deletion_jobs set status='succeeded',completed_at=now(),failure_code=null,failure_detail=null,updated_at=now() where id=p_job_id;
    update public.privacy_rights_requests set status='completed',
      decision_summary=case when v_audience='customer' then '고객 기능 탈퇴 및 불필요 개인정보 파기 완료' else '사업자 기능 탈퇴 및 불필요 개인정보 파기 완료' end,
      responded_at=now(),completed_at=now(),updated_at=now()
      where subject_user_id=v_user_id and request_type='withdrawal' and request_detail->>'withdrawal_request_id'=v_withdrawal_id::text;
    insert into public.privacy_request_events(subject_user_id,withdrawal_request_id,event_type,actor_type,metadata)
      values (v_user_id,v_withdrawal_id,'account_role_privacy_deletion_completed','system',jsonb_build_object('audience',v_audience));
    return jsonb_build_object('ready',false,'reason','ROLE_WITHDRAWAL_COMPLETED','audience',v_audience);
  end if;

  -- Full withdrawal with both roles: prepare customer data first; the proven full path handles owner data and Auth deletion.
  if v_audience='all' then
    if exists (
      select 1 from public.orders where customer_user_id=v_user_id
        and (status not in ('completed','cancelled') or payment_status in ('pending','cancel_pending'))
    ) then v_blockers := v_blockers || jsonb_build_array('OPEN_CUSTOMER_ORDER'); end if;
    if exists (
      select 1 from public.order_partial_refunds r join public.orders o on o.id=r.order_id
      where o.customer_user_id=v_user_id and r.status not in ('completed','failed','rejected','cancelled','canceled')
    ) then v_blockers := v_blockers || jsonb_build_array('PENDING_CUSTOMER_REFUND'); end if;
    if jsonb_array_length(v_blockers)>0 then
      update public.privacy_deletion_jobs set status='scheduled',next_retry_at=now()+interval '24 hours',
        failure_code='WITHDRAWAL_BLOCKED',failure_detail=v_blockers::text,updated_at=now() where id=p_job_id;
      update public.account_withdrawal_requests set status='review_required',blocker_codes=v_blockers,updated_at=now() where id=v_withdrawal_id;
      update public.account_lifecycle_states set status='review_required',updated_at=now() where subject_user_id=v_user_id;
      return jsonb_build_object('ready',false,'blocker_codes',v_blockers,'manual_review',false);
    end if;
    perform set_config('app.privacy_cleanup_user_id',v_user_id::text,true);
    update public.orders set retention_subject_id=v_retention_subject_id,customer_user_id=null,
      request_note='',buzzer_no=null,access_token=gen_random_uuid()::text where customer_user_id=v_user_id;
    update public.order_checkout_attempts set retention_subject_id=v_retention_subject_id,customer_user_id=null,
      client_request_id=gen_random_uuid(),request_fingerprint=gen_random_uuid()::text,request_note='',
      recovery_token_hash=gen_random_uuid()::text,toss_response=private.minimize_payment_provider_response(toss_response),
      failure_detail=null,updated_at=now() where customer_user_id=v_user_id;
  end if;

  return public.prepare_full_account_privacy_deletion(p_job_id);
end;
$$;

revoke all on function public.request_single_account_withdrawal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.prepare_full_account_privacy_deletion(uuid) from public,anon,authenticated;
revoke all on function public.request_account_withdrawal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.prepare_account_privacy_deletion(uuid) from public,anon,authenticated;
grant execute on function public.request_account_withdrawal(uuid,text,text) to service_role;
grant execute on function public.prepare_account_privacy_deletion(uuid) to service_role;
grant execute on function public.request_single_account_withdrawal(uuid,text,text) to service_role;
grant execute on function public.prepare_full_account_privacy_deletion(uuid) to service_role;

commit;
