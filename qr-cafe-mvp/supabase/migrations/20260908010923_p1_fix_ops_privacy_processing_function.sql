begin;

-- This RPC is intentionally SECURITY INVOKER and executable only by service_role.
-- The Next.js route verifies the signed-in OPS user's app_metadata before it calls
-- the RPC. Do not query auth.users here: the service role can invoke the function
-- but does not receive table privileges for that internal schema in this context.
-- Keeping the authorization boundary in the server route avoids a public
-- SECURITY DEFINER function while preserving the existing service-only grant.
create or replace function public.ops_process_privacy_request(
  p_actor_id uuid, p_request_id uuid, p_expected_version timestamptz,
  p_action text, p_summary text, p_value text default null,
  p_resolves_request boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_request public.privacy_rights_requests%rowtype;
  v_status text;
  v_result text;
  v_document_id bigint;
  v_changed integer;
begin
  if p_summary is null or length(trim(p_summary)) not between 5 and 1000 then
    raise exception 'PRIVACY_SUMMARY_REQUIRED';
  end if;
  if p_action is null or p_action not in (
    'review','identity_required','reject','provide_profile_access',
    'correct_customer_name','correct_customer_phone','delete_customer_phone','restrict_marketing'
  ) then
    raise exception 'INVALID_PRIVACY_ACTION';
  end if;

  select * into v_request from public.privacy_rights_requests where id=p_request_id for update;
  if not found then raise exception 'PRIVACY_REQUEST_NOT_FOUND'; end if;
  if p_expected_version is null or v_request.updated_at <> p_expected_version then
    raise exception 'PRIVACY_REQUEST_CONFLICT';
  end if;
  if v_request.request_type not in ('access','correction','deletion','restriction')
    or v_request.status not in ('received','identity_verification_required','in_review','partially_completed') then
    raise exception 'PRIVACY_REQUEST_CLOSED';
  end if;

  if p_action in ('review','identity_required','reject') then
    v_status := case p_action when 'review' then 'in_review'
      when 'identity_required' then 'identity_verification_required' else 'rejected' end;
    v_result := case p_action when 'review' then '요청을 검토하고 있습니다.'
      when 'identity_required' then '추가 확인이 필요합니다.' else '요청 처리가 제한되었습니다.' end;
  else
    if v_request.status not in ('in_review','partially_completed') then
      raise exception 'PRIVACY_REVIEW_REQUIRED';
    end if;
    if v_request.subject_user_id is null or not exists (
      select 1 from public.account_roles where user_id=v_request.subject_user_id
        and audience=v_request.audience and status not in ('withdrawn','suspended')
    ) or exists (
      select 1 from public.account_lifecycle_states where subject_user_id=v_request.subject_user_id and status <> 'active'
    ) or exists (
      select 1 from public.account_withdrawal_requests where subject_user_id=v_request.subject_user_id
        and audience in (v_request.audience,'all') and status not in ('completed','canceled','failed')
    ) then raise exception 'PRIVACY_SUBJECT_UNAVAILABLE'; end if;

    if p_action='provide_profile_access' then
      if v_request.request_type <> 'access' then raise exception 'PRIVACY_ACTION_TYPE_MISMATCH'; end if;
      if (v_request.audience='customer' and not exists(select 1 from public.customer_profiles where user_id=v_request.subject_user_id))
        or (v_request.audience='owner' and not exists(select 1 from public.profiles where user_id=v_request.subject_user_id)) then
        raise exception 'PRIVACY_PROFILE_NOT_FOUND';
      end if;
      v_result := '계정 기본정보(이름·등록 연락처)를 회원 화면에서 열람할 수 있습니다. 주문·결제·증빙자료는 이 제공 범위에 포함되지 않습니다.';
    elsif p_action in ('correct_customer_name','correct_customer_phone','delete_customer_phone') then
      if v_request.audience <> 'customer' or
        (p_action='delete_customer_phone' and v_request.request_type <> 'deletion') or
        (p_action <> 'delete_customer_phone' and v_request.request_type <> 'correction') then
        raise exception 'PRIVACY_ACTION_TYPE_MISMATCH';
      end if;
      if p_action='correct_customer_name' then
        if p_value is null or length(trim(p_value)) not between 1 and 80 or p_value ~ '[[:cntrl:]]' then
          raise exception 'INVALID_PRIVACY_VALUE';
        end if;
        update public.customer_profiles set name=trim(p_value),updated_at=now() where user_id=v_request.subject_user_id;
        v_result := '고객 서비스의 프로필 이름을 정정했습니다. 사업자 정보와 과거 거래자료는 변경하지 않았습니다.';
      elsif p_action='correct_customer_phone' then
        if p_value is null or p_value !~ '^[0-9+ ()-]{8,24}$' then raise exception 'INVALID_PRIVACY_VALUE'; end if;
        update public.customer_profiles set phone=trim(p_value),updated_at=now() where user_id=v_request.subject_user_id;
        v_result := '고객 서비스의 선택 전화번호를 정정했습니다. 로그인 인증번호나 주문별 연락처는 변경하지 않습니다.';
      else
        update public.customer_profiles set phone=null,updated_at=now() where user_id=v_request.subject_user_id;
        v_result := '고객 서비스의 선택 전화번호를 삭제했습니다. 로그인 계정·주문별 연락처·법정 보존자료는 삭제하지 않았습니다.';
      end if;
      get diagnostics v_changed = row_count;
      if v_changed <> 1 then raise exception 'PRIVACY_PROFILE_NOT_FOUND'; end if;
    elsif p_action='restrict_marketing' then
      if v_request.request_type <> 'restriction' then raise exception 'PRIVACY_ACTION_TYPE_MISMATCH'; end if;
      select id into v_document_id from public.policy_documents
        where document_type='marketing' and audience=v_request.audience and status='published' and effective_at<=now()
        order by effective_at desc,id desc limit 1;
      if v_document_id is null then raise exception 'ACTIVE_MARKETING_DOCUMENT_NOT_FOUND'; end if;
      if v_request.audience='customer' then
        update public.customer_profiles set marketing_consent=false,updated_at=now() where user_id=v_request.subject_user_id;
        if not found then raise exception 'PRIVACY_PROFILE_NOT_FOUND'; end if;
      end if;
      insert into public.policy_acceptance_events(user_id,document_id,audience,action,source,entry_path,language,idempotency_key,metadata)
        values(v_request.subject_user_id,v_document_id,v_request.audience,'withdrawn','ops_privacy_review',
          '/account/privacy','ko-KR','ops-privacy:'||p_request_id||':'||v_request.updated_at,
          jsonb_build_object('channel_scope','all','rights_request_id',p_request_id));
      v_result := '선택한 서비스의 마케팅 수신 동의를 철회했습니다. 주문·결제·보안 등 필수 처리는 중단하지 않았습니다.';
    end if;
    v_status := case when p_resolves_request is true then 'completed' else 'partially_completed' end;
  end if;

  update public.privacy_rights_requests set status=v_status,
    decision_summary=v_result||E'\n운영자 안내: '||trim(p_summary),
    profile_access_granted=profile_access_granted or p_action='provide_profile_access',
    responded_at=now(),completed_at=case when v_status='completed' then now() else null end,
    updated_at=clock_timestamp() where id=p_request_id;
  insert into public.privacy_request_events(subject_user_id,rights_request_id,event_type,actor_type,actor_user_id,metadata)
    values(v_request.subject_user_id,p_request_id,'ops_privacy_'||p_action,'ops',p_actor_id,
      jsonb_build_object('from_status',v_request.status,'to_status',v_status,'action',p_action,'resolves_request',p_resolves_request));
  return jsonb_build_object('status',v_status,'action',p_action);
end;
$$;

revoke all on function public.ops_process_privacy_request(uuid,uuid,timestamptz,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.ops_process_privacy_request(uuid,uuid,timestamptz,text,text,text,boolean) to service_role;

commit;
