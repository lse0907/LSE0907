begin;

-- Retained business transaction rows must not keep Auth deletion blocked.
-- The operational account link is nullable after the business relationship is safely closed.
alter table public.billing_accounts add column if not exists retention_subject_id uuid;
alter table public.billing_accounts alter column owner_user_id drop not null;
alter table public.billing_accounts drop constraint if exists billing_accounts_owner_user_id_fkey;
alter table public.billing_accounts add constraint billing_accounts_owner_user_id_fkey
  foreign key (owner_user_id) references auth.users(id) on delete set null;

alter table public.billing_referrals add column if not exists retention_subject_id uuid;
alter table public.billing_referrals alter column referred_user_id drop not null;
alter table public.billing_referrals drop constraint if exists billing_referrals_referred_user_id_fkey;
alter table public.billing_referrals add constraint billing_referrals_referred_user_id_fkey
  foreign key (referred_user_id) references auth.users(id) on delete set null;

alter table public.billing_payment_attempts alter column payer_user_id drop not null;
alter table public.billing_refund_cases alter column requested_by drop not null;

-- Pseudonymous links are used only while an approved retention rule is active.
alter table public.orders add column if not exists retention_subject_id uuid;
alter table public.order_checkout_attempts add column if not exists retention_subject_id uuid;
alter table public.billing_payment_attempts add column if not exists retention_subject_id uuid;
alter table public.billing_payments add column if not exists retention_subject_id uuid;

create index if not exists idx_orders_retention_subject
  on public.orders(retention_subject_id) where retention_subject_id is not null;
create index if not exists idx_order_checkout_retention_subject
  on public.order_checkout_attempts(retention_subject_id) where retention_subject_id is not null;
create index if not exists idx_billing_attempts_retention_subject
  on public.billing_payment_attempts(retention_subject_id) where retention_subject_id is not null;
create index if not exists idx_billing_payments_retention_subject
  on public.billing_payments(retention_subject_id) where retention_subject_id is not null;

create table public.account_lifecycle_states (
  subject_user_id uuid primary key,
  audience text not null check (audience in ('customer','owner')),
  status text not null default 'active' check (status in (
    'active','recovery_pending','review_required','processing','retention_only','closed'
  )),
  recovery_until timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'recovery_pending' or recovery_until is not null)
);

comment on table public.account_lifecycle_states is
  'P1-3B account state. Deliberately has no auth.users FK so retention/audit state can survive Auth deletion.';

create table public.account_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  retention_subject_id uuid default gen_random_uuid() unique,
  subject_user_id uuid,
  audience text not null check (audience in ('customer','owner')),
  status text not null default 'recovery_pending' check (status in (
    'recovery_pending','review_required','processing','retention_hold','completed','failed','canceled'
  )),
  reason text,
  blocker_codes jsonb not null default '[]'::jsonb,
  recovery_until timestamptz not null,
  requested_at timestamptz not null default now(),
  canceled_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(blocker_codes)='array')
);

create unique index uq_account_withdrawal_active
  on public.account_withdrawal_requests(subject_user_id)
  where status in ('recovery_pending','review_required','processing','retention_hold');
create index idx_account_withdrawal_due
  on public.account_withdrawal_requests(status,recovery_until);

create table public.privacy_rights_requests (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid,
  audience text not null check (audience in ('customer','owner')),
  request_type text not null check (request_type in (
    'access','correction','deletion','restriction','marketing_withdrawal','phone_deletion','withdrawal'
  )),
  status text not null default 'received' check (status in (
    'received','identity_verification_required','in_review','approved','partially_completed',
    'completed','rejected','canceled'
  )),
  request_detail jsonb not null default '{}'::jsonb,
  decision_summary text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(request_detail)='object')
);

create index idx_privacy_rights_subject_time
  on public.privacy_rights_requests(subject_user_id,requested_at desc);
create index idx_privacy_rights_queue
  on public.privacy_rights_requests(status,requested_at)
  where status in ('received','identity_verification_required','in_review','approved','partially_completed');

create table public.privacy_retention_rules (
  category text primary key check (category in (
    'account_profile','order_transaction','payment_refund','subscription_billing',
    'policy_consent','security_audit'
  )),
  default_duration_days integer check (default_duration_days is null or default_duration_days >= 0),
  legal_basis_note text not null,
  legal_review_required boolean not null default true,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.privacy_retention_rules(category,default_duration_days,legal_basis_note)
values
  ('account_profile',0,'목적 달성 후 불필요 개인정보 삭제 기준'),
  ('order_transaction',null,'전자상거래 거래기록 적용 범위와 기간 법률 검토 필요'),
  ('payment_refund',null,'결제·취소·환불 기록 적용 범위와 기간 법률 검토 필요'),
  ('subscription_billing',null,'사업자 회원의 B2B 구독·정산 기록 적용 범위와 기간 법률 검토 필요'),
  ('policy_consent',null,'약관·개인정보 고지 및 동의 증빙 보존기간 법률 검토 필요'),
  ('security_audit',null,'부정이용 방지·보안 감사기록 보존기간 법률 검토 필요');

create table public.privacy_retention_holds (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid,
  withdrawal_request_id uuid references public.account_withdrawal_requests(id) on delete restrict,
  category text not null references public.privacy_retention_rules(category) on delete restrict,
  status text not null default 'active' check (status in ('active','released','expired')),
  reason text not null,
  retain_until timestamptz,
  purge_attempt_count integer not null default 0 check (purge_attempt_count >= 0),
  last_purge_attempt_at timestamptz,
  purge_failure_detail text,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create unique index uq_privacy_retention_active_category
  on public.privacy_retention_holds(subject_user_id,category)
  where status='active';
create index idx_privacy_retention_release
  on public.privacy_retention_holds(status,retain_until);

create table public.privacy_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid,
  withdrawal_request_id uuid references public.account_withdrawal_requests(id) on delete restrict,
  job_type text not null check (job_type in (
    'assess_retention','anonymize_profile','anonymize_nonretained','delete_auth_user'
  )),
  status text not null default 'scheduled' check (status in (
    'scheduled','running','retention_hold','manual_review','succeeded','failed','canceled'
  )),
  scheduled_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  failure_code text,
  failure_detail text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(withdrawal_request_id,job_type)
);

create index idx_privacy_deletion_due
  on public.privacy_deletion_jobs(status,coalesce(next_retry_at,scheduled_at))
  where status in ('scheduled','failed');

create table public.privacy_request_events (
  id bigint generated always as identity primary key,
  subject_user_id uuid,
  withdrawal_request_id uuid references public.account_withdrawal_requests(id) on delete restrict,
  rights_request_id uuid references public.privacy_rights_requests(id) on delete restrict,
  event_type text not null,
  actor_type text not null check (actor_type in ('subject','ops','system')),
  actor_user_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (jsonb_typeof(metadata)='object'),
  check (withdrawal_request_id is not null or rights_request_id is not null)
);

create index idx_privacy_request_events_subject_time
  on public.privacy_request_events(subject_user_id,occurred_at desc,id desc);

create table public.retained_policy_evidence (
  id bigint generated always as identity primary key,
  retention_subject_id uuid not null,
  withdrawal_request_id uuid not null references public.account_withdrawal_requests(id) on delete restrict,
  evidence_type text not null check (evidence_type in ('signup_confirmation','policy_acceptance')),
  audience text not null check (audience in ('customer','owner')),
  document_type text,
  document_version text,
  action text,
  source text,
  occurred_at timestamptz not null,
  retained_at timestamptz not null default now(),
  unique(withdrawal_request_id,evidence_type,document_type,document_version,action,occurred_at)
);

create index idx_retained_policy_evidence_subject
  on public.retained_policy_evidence(retention_subject_id,occurred_at desc);

create trigger trg_privacy_request_events_immutable
before update or delete on public.privacy_request_events
for each row execute function private.prevent_policy_acceptance_event_mutation();

create or replace function private.prevent_policy_acceptance_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if tg_table_name='privacy_request_events'
    and tg_op='UPDATE'
    and (
      current_setting('app.privacy_retention_purge',true)='on'
      or current_setting('app.privacy_cleanup_user_id',true)=to_jsonb(old)->>'subject_user_id'
    )
  then
    return new;
  end if;
  if tg_table_name='policy_acceptance_events'
    and tg_op='DELETE'
    and current_setting('app.privacy_cleanup_user_id',true)=to_jsonb(old)->>'user_id'
  then
    return old;
  end if;
  raise exception 'POLICY_ACCEPTANCE_EVENT_IMMUTABLE';
end;
$$;

create or replace function private.minimize_payment_provider_response(p_value jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path=''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'paymentKey',p_value->'paymentKey',
      'orderId',p_value->'orderId',
      'status',p_value->'status',
      'totalAmount',coalesce(p_value->'totalAmount',p_value->'amount'),
      'balanceAmount',p_value->'balanceAmount',
      'method',p_value->'method',
      'requestedAt',p_value->'requestedAt',
      'approvedAt',p_value->'approvedAt',
      'lastTransactionKey',p_value->'lastTransactionKey',
      'cancels',coalesce((
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'cancelAmount',c.value->'cancelAmount',
          'canceledAt',c.value->'canceledAt',
          'cancelStatus',c.value->'cancelStatus',
          'transactionKey',c.value->'transactionKey'
        )))
        from jsonb_array_elements(
          case when jsonb_typeof(p_value->'cancels')='array' then p_value->'cancels' else '[]'::jsonb end
        ) c(value)
      ),'[]'::jsonb)
    ))
  end;
$$;

create or replace function public.get_account_privacy_center(p_user_id uuid)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select jsonb_build_object(
    'lifecycle',(
      select to_jsonb(s) - 'subject_user_id'
      from public.account_lifecycle_states s
      where s.subject_user_id=p_user_id
    ),
    'withdrawal',(
      select (to_jsonb(w) - 'subject_user_id' - 'retention_subject_id' - 'reason' - 'failure_code')
        || jsonb_build_object('can_cancel',w.status='recovery_pending' and w.recovery_until > now())
      from public.account_withdrawal_requests w
      where w.subject_user_id=p_user_id
      order by w.requested_at desc limit 1
    ),
    'requests',coalesce((
      select jsonb_agg(to_jsonb(r) - 'subject_user_id' - 'request_detail' order by r.requested_at desc)
      from (
        select * from public.privacy_rights_requests
        where subject_user_id=p_user_id
        order by requested_at desc limit 20
      ) r
    ),'[]'::jsonb)
  );
$$;

create or replace function public.create_privacy_rights_request(
  p_user_id uuid,
  p_audience text,
  p_request_type text,
  p_request_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
begin
  if p_audience not in ('customer','owner') then raise exception 'INVALID_AUDIENCE'; end if;
  if p_request_type not in ('access','correction','deletion','restriction') then
    raise exception 'INVALID_RIGHTS_REQUEST_TYPE';
  end if;
  if jsonb_typeof(coalesce(p_request_detail,'{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_REQUEST_DETAIL';
  end if;

  insert into public.privacy_rights_requests(subject_user_id,audience,request_type,request_detail)
  values (p_user_id,p_audience,p_request_type,coalesce(p_request_detail,'{}'::jsonb))
  returning id into v_id;

  insert into public.privacy_request_events(
    subject_user_id,rights_request_id,event_type,actor_type,actor_user_id
  ) values (p_user_id,v_id,'rights_request_received','subject',p_user_id);
  return v_id;
end;
$$;

create or replace function public.withdraw_account_marketing_consent(
  p_user_id uuid,
  p_audience text,
  p_source text default 'privacy_center'
)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_request_id uuid;
  v_document_id bigint;
begin
  if p_audience not in ('customer','owner') then raise exception 'INVALID_AUDIENCE'; end if;

  select id into v_document_id
  from public.policy_documents
  where document_type='marketing' and audience=p_audience and status='published'
    and effective_at <= now()
  order by effective_at desc,id desc limit 1;
  if v_document_id is null then raise exception 'ACTIVE_MARKETING_DOCUMENT_NOT_FOUND'; end if;

  if p_audience='customer' then
    update public.customer_profiles
    set marketing_consent=false,updated_at=now()
    where user_id=p_user_id;
  end if;

  insert into public.policy_acceptance_events(
    user_id,document_id,audience,action,source,entry_path,language,idempotency_key,metadata
  ) values (
    p_user_id,v_document_id,p_audience,'withdrawn',left(coalesce(nullif(trim(p_source),''),'privacy_center'),64),
    '/account/privacy','ko-KR','marketing-withdrawal:'||p_user_id||':'||v_document_id,
    jsonb_build_object('channel_scope','all')
  ) on conflict (idempotency_key) do nothing;

  insert into public.privacy_rights_requests(
    subject_user_id,audience,request_type,status,decision_summary,responded_at,completed_at
  ) values (
    p_user_id,p_audience,'marketing_withdrawal','completed','전체 마케팅 수신 동의를 철회했습니다.',now(),now()
  ) returning id into v_request_id;

  insert into public.privacy_request_events(
    subject_user_id,rights_request_id,event_type,actor_type,actor_user_id
  ) values (p_user_id,v_request_id,'marketing_withdrawal_completed','subject',p_user_id);
  return v_request_id;
end;
$$;

create or replace function public.delete_customer_optional_phone(p_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_request_id uuid;
begin
  update public.customer_profiles
  set phone=null,updated_at=now()
  where user_id=p_user_id;

  insert into public.privacy_rights_requests(
    subject_user_id,audience,request_type,status,decision_summary,responded_at,completed_at
  ) values (
    p_user_id,'customer','phone_deletion','completed','선택 전화번호를 삭제했습니다.',now(),now()
  ) returning id into v_request_id;

  insert into public.privacy_request_events(
    subject_user_id,rights_request_id,event_type,actor_type,actor_user_id
  ) values (p_user_id,v_request_id,'optional_phone_deleted','subject',p_user_id);
  return v_request_id;
end;
$$;

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
  v_id uuid;
  v_recovery_until timestamptz := now() + interval '7 days';
  v_blockers jsonb := '[]'::jsonb;
  v_rights_id uuid;
begin
  if p_audience not in ('customer','owner') then raise exception 'INVALID_AUDIENCE'; end if;
  if exists (
    select 1 from public.account_withdrawal_requests
    where subject_user_id=p_user_id
      and status in ('recovery_pending','review_required','processing','retention_hold')
  ) then raise exception 'ACTIVE_WITHDRAWAL_REQUEST_EXISTS'; end if;

  if p_audience='customer' then
    if exists (
      select 1 from public.orders
      where customer_user_id=p_user_id
        and (status not in ('completed','cancelled') or payment_status in ('pending','cancel_pending'))
    ) then v_blockers := v_blockers || jsonb_build_array('OPEN_CUSTOMER_ORDER'); end if;
    if exists (
      select 1 from public.order_partial_refunds r
      join public.orders o on o.id=r.order_id
      where o.customer_user_id=p_user_id and r.status not in ('completed','failed','cancelled')
    ) then v_blockers := v_blockers || jsonb_build_array('PENDING_CUSTOMER_REFUND'); end if;
  else
    if exists (
      select 1 from public.store_members sm
      join public.stores s on s.store_id=sm.store_id
      where sm.user_id=p_user_id and sm.role='owner' and s.deleted_at is null
    ) then v_blockers := v_blockers || jsonb_build_array('ACTIVE_STORE_OWNERSHIP'); end if;
    if exists (
      select 1
      from public.billing_accounts ba
      join public.billing_account_stores bas on bas.billing_account_id=ba.id
      left join public.billing_refund_attempts ra on ra.store_id=bas.store_id
      left join public.billing_refund_cases rc on rc.store_id=bas.store_id
      where ba.owner_user_id=p_user_id
        and (
          (ra.id is not null and ra.status not in ('completed','failed','rejected','cancelled','canceled'))
          or (rc.id is not null and rc.status not in ('completed','failed','rejected','cancelled','canceled'))
        )
    ) then
      v_blockers := v_blockers || jsonb_build_array('PENDING_BILLING_SETTLEMENT');
    end if;
  end if;

  insert into public.account_withdrawal_requests(
    subject_user_id,audience,reason,blocker_codes,recovery_until
  ) values (
    p_user_id,p_audience,left(nullif(trim(coalesce(p_reason,'')),''),500),v_blockers,v_recovery_until
  ) returning id into v_id;

  insert into public.account_lifecycle_states(subject_user_id,audience,status,recovery_until)
  values (p_user_id,p_audience,'recovery_pending',v_recovery_until)
  on conflict (subject_user_id) do update set
    audience=excluded.audience,status='recovery_pending',recovery_until=excluded.recovery_until,
    closed_at=null,updated_at=now();

  insert into public.privacy_rights_requests(
    subject_user_id,audience,request_type,status,request_detail
  ) values (
    p_user_id,p_audience,'withdrawal','received',jsonb_build_object('withdrawal_request_id',v_id)
  ) returning id into v_rights_id;

  insert into public.privacy_deletion_jobs(
    subject_user_id,withdrawal_request_id,job_type,status,scheduled_at
  ) values (p_user_id,v_id,'assess_retention','scheduled',v_recovery_until);

  insert into public.privacy_retention_holds(
    subject_user_id,withdrawal_request_id,category,reason
  ) values (
    p_user_id,v_id,'policy_consent','동의·고지 증빙 보존기간 법률 검토 필요'
  ) on conflict (subject_user_id,category) where status='active' do nothing;

  insert into public.privacy_retention_holds(
    subject_user_id,withdrawal_request_id,category,reason
  ) values (
    p_user_id,v_id,'security_audit','탈퇴·개인정보 권리 처리 감사기록 보존기간 법률 검토 필요'
  ) on conflict (subject_user_id,category) where status='active' do nothing;

  if p_audience='customer' and exists (
    select 1 from public.orders where customer_user_id=p_user_id
  ) then
    insert into public.privacy_retention_holds(
      subject_user_id,withdrawal_request_id,category,reason
    ) values (
      p_user_id,v_id,'order_transaction','주문 거래기록 보존 범위·기간 법률 검토 필요'
    ) on conflict (subject_user_id,category) where status='active' do nothing;
  end if;

  if p_audience='customer' and exists (
    select 1 from public.orders
    where customer_user_id=p_user_id and payment_status <> 'not_required'
  ) then
    insert into public.privacy_retention_holds(
      subject_user_id,withdrawal_request_id,category,reason
    ) values (
      p_user_id,v_id,'payment_refund','결제·취소·환불 기록 보존 범위·기간 법률 검토 필요'
    ) on conflict (subject_user_id,category) where status='active' do nothing;
  end if;

  if p_audience='owner' and exists (
    select 1 from public.billing_accounts where owner_user_id=p_user_id
  ) then
    insert into public.privacy_retention_holds(
      subject_user_id,withdrawal_request_id,category,reason
    ) values (
      p_user_id,v_id,'subscription_billing','사업자 회원 구독·결제 기록 보존 범위·기간 법률 검토 필요'
    ) on conflict (subject_user_id,category) where status='active' do nothing;
  end if;

  insert into public.privacy_request_events(
    subject_user_id,withdrawal_request_id,rights_request_id,event_type,actor_type,actor_user_id,
    metadata
  ) values (
    p_user_id,v_id,v_rights_id,'withdrawal_requested','subject',p_user_id,
    jsonb_build_object('recovery_until',v_recovery_until,'blocker_codes',v_blockers)
  );

  return jsonb_build_object('id',v_id,'status','recovery_pending','recovery_until',v_recovery_until,'blocker_codes',v_blockers);
end;
$$;

create or replace function public.cancel_account_withdrawal(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.account_withdrawal_requests
  where subject_user_id=p_user_id and status='recovery_pending' and recovery_until > now()
  order by requested_at desc limit 1 for update;
  if v_id is null then raise exception 'RECOVERABLE_WITHDRAWAL_NOT_FOUND'; end if;

  update public.account_withdrawal_requests
  set status='canceled',canceled_at=now(),updated_at=now()
  where id=v_id;
  update public.account_lifecycle_states
  set status='active',recovery_until=null,updated_at=now()
  where subject_user_id=p_user_id;
  update public.privacy_deletion_jobs
  set status='canceled',updated_at=now()
  where withdrawal_request_id=v_id and status='scheduled';
  update public.privacy_retention_holds
  set status='released',released_at=now()
  where withdrawal_request_id=v_id and status='active';
  update public.privacy_rights_requests
  set status='canceled',responded_at=now(),updated_at=now()
  where subject_user_id=p_user_id and request_type='withdrawal'
    and request_detail->>'withdrawal_request_id'=v_id::text and status='received';

  insert into public.privacy_request_events(
    subject_user_id,withdrawal_request_id,event_type,actor_type,actor_user_id
  ) values (p_user_id,v_id,'withdrawal_canceled','subject',p_user_id);
end;
$$;

create or replace function public.claim_due_privacy_deletion_jobs(p_limit integer default 10)
returns table(
  job_id uuid,
  withdrawal_request_id uuid,
  subject_user_id uuid,
  audience text,
  job_type text,
  attempt_count integer
)
language sql
security invoker
set search_path=''
as $$
  with due as (
    select j.id
    from public.privacy_deletion_jobs j
    join public.account_withdrawal_requests w on w.id=j.withdrawal_request_id
    where j.job_type in ('assess_retention','delete_auth_user')
      and (
        (j.status in ('scheduled','failed') and coalesce(j.next_retry_at,j.scheduled_at) <= now())
        or (j.status='running' and j.last_attempt_at <= now()-interval '30 minutes')
      )
      and (j.attempt_count < j.max_attempts or j.status='running')
      and w.status in ('recovery_pending','review_required','processing')
      and w.recovery_until <= now()
    order by coalesce(j.next_retry_at,j.last_attempt_at,j.scheduled_at),j.created_at
    for update of j skip locked
    limit least(greatest(coalesce(p_limit,10),1),50)
  ), claimed as (
    update public.privacy_deletion_jobs j
    set status='running',attempt_count=j.attempt_count+1,last_attempt_at=now(),
      next_retry_at=null,failure_code=null,failure_detail=null,updated_at=now()
    from due
    where j.id=due.id
    returning j.id,j.withdrawal_request_id,j.subject_user_id,j.job_type,j.attempt_count
  )
  select c.id,c.withdrawal_request_id,c.subject_user_id,w.audience,c.job_type,c.attempt_count
  from claimed c
  join public.account_withdrawal_requests w on w.id=c.withdrawal_request_id;
$$;

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
    update public.privacy_deletion_jobs
    set status='scheduled',scheduled_at=v_recovery_until,updated_at=now()
    where id=p_job_id;
    return jsonb_build_object('ready',false,'reason','RECOVERY_PERIOD_ACTIVE');
  end if;

  if v_audience='customer' then
    if exists (
      select 1 from public.orders
      where customer_user_id=v_user_id
        and (status not in ('completed','cancelled') or payment_status in ('pending','cancel_pending'))
    ) then v_blockers := v_blockers || jsonb_build_array('OPEN_CUSTOMER_ORDER'); end if;
    if exists (
      select 1 from public.order_partial_refunds r
      join public.orders o on o.id=r.order_id
      where o.customer_user_id=v_user_id and r.status not in ('completed','failed','rejected','cancelled','canceled')
    ) then v_blockers := v_blockers || jsonb_build_array('PENDING_CUSTOMER_REFUND'); end if;
  else
    if exists (
      select 1 from public.store_members sm
      join public.stores s on s.store_id=sm.store_id
      where sm.user_id=v_user_id and sm.role='owner' and s.deleted_at is null and s.status='active'
    ) then
      v_blockers := v_blockers || jsonb_build_array('ACTIVE_STORE_OWNERSHIP');
      v_hard_blocker := true;
    end if;
    if exists (
      select 1
      from public.billing_accounts ba
      join public.billing_account_stores bas on bas.billing_account_id=ba.id
      left join public.billing_refund_attempts ra on ra.store_id=bas.store_id
      left join public.billing_refund_cases rc on rc.store_id=bas.store_id
      where ba.owner_user_id=v_user_id
        and (
          (ra.id is not null and ra.status not in ('completed','failed','rejected','cancelled','canceled'))
          or (rc.id is not null and rc.status not in ('completed','failed','rejected','cancelled','canceled'))
        )
    ) then v_blockers := v_blockers || jsonb_build_array('PENDING_BILLING_SETTLEMENT'); end if;
  end if;

  if exists (
    select 1 from storage.objects
    where owner=v_user_id or owner_id=v_user_id::text
  ) then
    v_blockers := v_blockers || jsonb_build_array('STORAGE_OBJECT_REVIEW');
    v_hard_blocker := true;
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    update public.privacy_deletion_jobs
    set status=case when v_hard_blocker then 'manual_review' else 'scheduled' end,
      next_retry_at=case when v_hard_blocker then null else now()+interval '24 hours' end,
      failure_code='WITHDRAWAL_BLOCKED',failure_detail=v_blockers::text,updated_at=now()
    where id=p_job_id;
    update public.account_withdrawal_requests
    set status='review_required',blocker_codes=v_blockers,updated_at=now()
    where id=v_withdrawal_id;
    update public.account_lifecycle_states
    set status='review_required',updated_at=now()
    where subject_user_id=v_user_id;
    insert into public.privacy_request_events(
      subject_user_id,withdrawal_request_id,event_type,actor_type,metadata
    ) values (
      v_user_id,v_withdrawal_id,'withdrawal_processing_blocked','system',
      jsonb_build_object('blocker_codes',v_blockers,'manual_review',v_hard_blocker)
    );
    return jsonb_build_object('ready',false,'blocker_codes',v_blockers,'manual_review',v_hard_blocker);
  end if;

  perform set_config('app.privacy_cleanup_user_id',v_user_id::text,true);

  insert into public.retained_policy_evidence(
    retention_subject_id,withdrawal_request_id,evidence_type,audience,document_version,
    action,source,occurred_at
  )
  select v_retention_subject_id,v_withdrawal_id,'signup_confirmation',s.audience,s.policy_version,
    'confirmed',s.source,s.confirmed_at
  from public.signup_policy_confirmations s
  where s.user_id=v_user_id;

  insert into public.retained_policy_evidence(
    retention_subject_id,withdrawal_request_id,evidence_type,audience,document_type,
    document_version,action,source,occurred_at
  )
  select v_retention_subject_id,v_withdrawal_id,'policy_acceptance',e.audience,d.document_type,
    d.version,e.action,e.source,e.occurred_at
  from public.policy_acceptance_events e
  join public.policy_documents d on d.id=e.document_id
  where e.user_id=v_user_id;

  delete from public.policy_acceptance_events where user_id=v_user_id;
  delete from public.signup_policy_confirmations where user_id=v_user_id;

  if v_audience='customer' then
    update public.orders
    set retention_subject_id=v_retention_subject_id,customer_user_id=null,
      request_note='',buzzer_no=null,access_token=gen_random_uuid()::text
    where customer_user_id=v_user_id;
    update public.order_checkout_attempts
    set retention_subject_id=v_retention_subject_id,customer_user_id=null,
      client_request_id=gen_random_uuid(),request_fingerprint=gen_random_uuid()::text,
      request_note='',recovery_token_hash=gen_random_uuid()::text,
      toss_response=private.minimize_payment_provider_response(toss_response),
      failure_detail=null,updated_at=now()
    where customer_user_id=v_user_id;
    update public.order_payment_cancel_attempts a
    set cancel_reason='계정 탈퇴 후 거래 증빙 보존',
      pg_response=private.minimize_payment_provider_response(a.pg_response),failure_detail=null,updated_at=now()
    from public.orders o
    where o.id=a.order_id and o.retention_subject_id=v_retention_subject_id;
    update public.order_partial_refunds r
    set reason='계정 탈퇴 후 거래 증빙 보존',
      pg_response=private.minimize_payment_provider_response(r.pg_response),failure_detail=null,updated_at=now()
    from public.orders o
    where o.id=r.order_id and o.retention_subject_id=v_retention_subject_id;
  else
    update public.billing_accounts
    set retention_subject_id=v_retention_subject_id,owner_user_id=null,updated_at=now()
    where owner_user_id=v_user_id;
    update public.billing_referrals
    set retention_subject_id=v_retention_subject_id,referred_user_id=null,updated_at=now()
    where referred_user_id=v_user_id;
    update public.billing_payment_attempts
    set retention_subject_id=v_retention_subject_id,payer_user_id=null,
      toss_response=private.minimize_payment_provider_response(toss_response),updated_at=now()
    where payer_user_id=v_user_id;
    update public.billing_payments
    set retention_subject_id=v_retention_subject_id,payer_user_id=null,updated_at=now()
    where payer_user_id=v_user_id;
    update public.billing_refund_attempts
    set requested_by=null,reason='계정 탈퇴 후 거래 증빙 보존',internal_error=null,updated_at=now()
    where requested_by=v_user_id;
    update public.billing_refund_cases
    set requested_by=null,reason='계정 탈퇴 후 거래 증빙 보존',ops_note=null,updated_at=now()
    where requested_by=v_user_id;
    update public.stores
    set owner_user_id=null,updated_at=now()
    where owner_user_id=v_user_id and (deleted_at is not null or status <> 'active');
    delete from public.store_members where user_id=v_user_id;
  end if;

  update public.account_withdrawal_requests
  set status='processing',blocker_codes='[]'::jsonb,processing_started_at=coalesce(processing_started_at,now()),updated_at=now()
  where id=v_withdrawal_id;
  update public.account_lifecycle_states
  set status='processing',updated_at=now()
  where subject_user_id=v_user_id;
  update public.privacy_deletion_jobs
  set job_type='delete_auth_user',updated_at=now()
  where id=p_job_id;
  insert into public.privacy_request_events(
    subject_user_id,withdrawal_request_id,event_type,actor_type,metadata
  ) values (
    v_user_id,v_withdrawal_id,'account_data_prepared_for_auth_deletion','system',
    jsonb_build_object('retention_subject_id',v_retention_subject_id)
  );
  update public.privacy_request_events
  set actor_user_id=null
  where subject_user_id=v_user_id;
  return jsonb_build_object('ready',true,'subject_user_id',v_user_id,'withdrawal_request_id',v_withdrawal_id);
end;
$$;

create or replace function public.finalize_account_privacy_deletion(p_job_id uuid)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_user_id uuid;
  v_withdrawal_id uuid;
begin
  select subject_user_id,withdrawal_request_id into v_user_id,v_withdrawal_id
  from public.privacy_deletion_jobs
  where id=p_job_id and status='running' and job_type='delete_auth_user'
  for update;
  if v_user_id is null then raise exception 'AUTH_DELETION_JOB_NOT_FOUND'; end if;

  update public.privacy_deletion_jobs
  set status='succeeded',completed_at=now(),failure_code=null,failure_detail=null,updated_at=now()
  where id=p_job_id;
  update public.account_withdrawal_requests
  set status='completed',completed_at=now(),updated_at=now()
  where id=v_withdrawal_id;
  update public.account_lifecycle_states
  set status='closed',recovery_until=null,closed_at=now(),updated_at=now()
  where subject_user_id=v_user_id;
  update public.privacy_rights_requests
  set status='completed',decision_summary='계정 종료 및 불필요 개인정보 파기 완료',
    responded_at=now(),completed_at=now(),updated_at=now()
  where subject_user_id=v_user_id and request_type='withdrawal'
    and request_detail->>'withdrawal_request_id'=v_withdrawal_id::text;
  insert into public.privacy_request_events(
    subject_user_id,withdrawal_request_id,event_type,actor_type
  ) values (v_user_id,v_withdrawal_id,'account_privacy_deletion_completed','system');
end;
$$;

create or replace function public.fail_account_privacy_deletion(
  p_job_id uuid,
  p_failure_code text,
  p_failure_detail text
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_user_id uuid;
  v_withdrawal_id uuid;
  v_attempt_count integer;
  v_max_attempts integer;
  v_manual boolean;
begin
  select subject_user_id,withdrawal_request_id,attempt_count,max_attempts
  into v_user_id,v_withdrawal_id,v_attempt_count,v_max_attempts
  from public.privacy_deletion_jobs
  where id=p_job_id and status='running'
  for update;
  if v_user_id is null then return; end if;
  v_manual := v_attempt_count >= v_max_attempts;

  update public.privacy_deletion_jobs
  set status=case when v_manual then 'manual_review' else 'failed' end,
    next_retry_at=case when v_manual then null else now()+make_interval(mins => least(1440,15*power(2,greatest(v_attempt_count-1,0))::integer)) end,
    failure_code=left(coalesce(nullif(trim(p_failure_code),''),'AUTH_DELETE_FAILED'),100),
    failure_detail=left(coalesce(p_failure_detail,''),1000),updated_at=now()
  where id=p_job_id;
  update public.account_withdrawal_requests
  set status=case when v_manual then 'failed' else 'processing' end,
    failure_code=left(coalesce(nullif(trim(p_failure_code),''),'AUTH_DELETE_FAILED'),100),updated_at=now()
  where id=v_withdrawal_id;
  update public.account_lifecycle_states
  set status=case when v_manual then 'review_required' else 'processing' end,updated_at=now()
  where subject_user_id=v_user_id;
  insert into public.privacy_request_events(
    subject_user_id,withdrawal_request_id,event_type,actor_type,metadata
  ) values (
    v_user_id,v_withdrawal_id,'account_privacy_deletion_failed','system',
    jsonb_build_object('failure_code',left(coalesce(p_failure_code,'AUTH_DELETE_FAILED'),100),'manual_review',v_manual)
  );
end;
$$;

create or replace function public.purge_expired_privacy_retention(p_limit integer default 20)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_hold record;
  v_processed integer := 0;
  v_detached integer := 0;
  v_failed integer := 0;
begin
  for v_hold in
    select h.id,h.withdrawal_request_id,h.category,h.subject_user_id,
      w.retention_subject_id,
      coalesce(h.retain_until,a.anchor_at+make_interval(days => r.default_duration_days)) as due_at
    from public.privacy_retention_holds h
    join public.privacy_retention_rules r on r.category=h.category
    join public.account_withdrawal_requests w on w.id=h.withdrawal_request_id
    cross join lateral (
      select coalesce(case h.category
        when 'order_transaction' then (
          select max(o.created_at) from public.orders o
          where o.retention_subject_id=w.retention_subject_id
        )
        when 'payment_refund' then greatest(
          (select max(o.created_at) from public.orders o where o.retention_subject_id=w.retention_subject_id),
          (select max(a.pg_approved_at) from public.order_checkout_attempts a where a.retention_subject_id=w.retention_subject_id),
          (select max(coalesce(c.completed_at,c.requested_at))
            from public.order_payment_cancel_attempts c join public.orders o on o.id=c.order_id
            where o.retention_subject_id=w.retention_subject_id),
          (select max(coalesce(p.completed_at,p.requested_at))
            from public.order_partial_refunds p join public.orders o on o.id=p.order_id
            where o.retention_subject_id=w.retention_subject_id)
        )
        when 'subscription_billing' then greatest(
          (select max(p.paid_at) from public.billing_payments p where p.retention_subject_id=w.retention_subject_id),
          (select max(a.approved_at) from public.billing_payment_attempts a where a.retention_subject_id=w.retention_subject_id),
          (select max(coalesce(r.completed_at,r.requested_at))
            from public.billing_refund_attempts r join public.billing_payments p on p.id=r.billing_payment_id
            where p.retention_subject_id=w.retention_subject_id),
          (select max(coalesce(r.completed_at,r.requested_at))
            from public.billing_refund_cases r join public.billing_payments p on p.id=r.billing_payment_id
            where p.retention_subject_id=w.retention_subject_id)
        )
        when 'policy_consent' then (
          select max(e.occurred_at) from public.retained_policy_evidence e
          where e.withdrawal_request_id=w.id
        )
        when 'security_audit' then (
          select max(e.occurred_at) from public.privacy_request_events e
          where e.withdrawal_request_id=w.id
        )
        else w.completed_at
      end,w.completed_at) as anchor_at
    ) a
    where h.status='active' and r.enabled and not r.legal_review_required
      and r.default_duration_days is not null and w.completed_at is not null
      and coalesce(h.retain_until,a.anchor_at+make_interval(days => r.default_duration_days)) <= now()
    order by coalesce(h.retain_until,a.anchor_at+make_interval(days => r.default_duration_days)),h.id
    for update of h skip locked
    limit least(greatest(coalesce(p_limit,20),1),100)
  loop
    begin
      update public.privacy_retention_holds
      set purge_attempt_count=purge_attempt_count+1,last_purge_attempt_at=now(),
        purge_failure_detail=null,retain_until=v_hold.due_at
      where id=v_hold.id;

      if v_hold.category='policy_consent' then
        delete from public.retained_policy_evidence
        where withdrawal_request_id=v_hold.withdrawal_request_id;
      elsif v_hold.category='payment_refund' then
        update public.order_payment_cancel_attempts a
        set payment_key=null,toss_order_id=null,pg_cancel_transaction_key=null,pg_response=null,
          failure_detail=null,updated_at=now()
        from public.orders o
        where o.id=a.order_id and o.retention_subject_id=v_hold.retention_subject_id;
        update public.order_partial_refunds r
        set payment_key=null,toss_order_id=null,pg_cancel_transaction_key=null,pg_response=null,
          failure_detail=null,updated_at=now()
        from public.orders o
        where o.id=r.order_id and o.retention_subject_id=v_hold.retention_subject_id;
        update public.order_checkout_attempts
        set payment_key=null,toss_order_id=null,confirm_idempotency_key=null,toss_response=null,
          failure_detail=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.orders
        set payment_key=null,toss_order_id=null
        where retention_subject_id=v_hold.retention_subject_id;
      elsif v_hold.category='subscription_billing' then
        update public.billing_refund_attempts r
        set reason='법정 보존기간 종료',internal_error=null,pg_cancel_transaction_key=null,updated_at=now()
        from public.billing_payments p
        where p.id=r.billing_payment_id and p.retention_subject_id=v_hold.retention_subject_id;
        update public.billing_refund_cases r
        set reason='법정 보존기간 종료',ops_note=null,updated_at=now()
        from public.billing_payments p
        where p.id=r.billing_payment_id and p.retention_subject_id=v_hold.retention_subject_id;
        update public.billing_payment_attempts
        set payment_key=null,toss_response=null,quote_snapshot='{}'::jsonb,
          retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_payments
        set payment_key=null,order_id=null,pricing_snapshot='{}'::jsonb,note=null,cancel_reason=null,
          retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_accounts
        set retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_referrals
        set retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
      end if;

      update public.privacy_retention_holds
      set status='expired',released_at=now(),purge_failure_detail=null
      where id=v_hold.id;
      v_processed := v_processed+1;

      if not exists (
        select 1 from public.privacy_retention_holds
        where withdrawal_request_id=v_hold.withdrawal_request_id and status='active'
      ) then
        perform set_config('app.privacy_retention_purge','on',true);
        update public.orders set retention_subject_id=null
        where retention_subject_id=v_hold.retention_subject_id;
        update public.order_checkout_attempts set retention_subject_id=null
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_payment_attempts set retention_subject_id=null
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_payments set retention_subject_id=null
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_accounts set retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.billing_referrals set retention_subject_id=null,updated_at=now()
        where retention_subject_id=v_hold.retention_subject_id;
        update public.privacy_request_events
        set subject_user_id=null,actor_user_id=null,metadata='{}'::jsonb
        where subject_user_id=v_hold.subject_user_id;
        update public.privacy_rights_requests
        set subject_user_id=null,request_detail='{}'::jsonb,
          decision_summary=case when decision_summary is null then null else '처리 완료' end,
          updated_at=now()
        where subject_user_id=v_hold.subject_user_id;
        update public.privacy_deletion_jobs
        set subject_user_id=null,failure_detail=null,updated_at=now()
        where withdrawal_request_id=v_hold.withdrawal_request_id;
        update public.privacy_retention_holds
        set subject_user_id=null,reason='보존기간 종료 및 식별정보 파기'
        where withdrawal_request_id=v_hold.withdrawal_request_id;
        update public.account_withdrawal_requests
        set subject_user_id=null,retention_subject_id=null,reason=null,blocker_codes='[]'::jsonb,
          failure_code=null,updated_at=now()
        where id=v_hold.withdrawal_request_id;
        delete from public.account_lifecycle_states
        where subject_user_id=v_hold.subject_user_id;
        v_detached := v_detached+1;
      end if;
    exception when others then
      update public.privacy_retention_holds
      set purge_attempt_count=purge_attempt_count+1,last_purge_attempt_at=now(),
        purge_failure_detail=left(sqlerrm,1000)
      where id=v_hold.id;
      v_failed := v_failed+1;
    end;
  end loop;

  return jsonb_build_object('processed',v_processed,'detached',v_detached,'failed',v_failed);
end;
$$;

alter table public.account_lifecycle_states enable row level security;
alter table public.account_withdrawal_requests enable row level security;
alter table public.privacy_rights_requests enable row level security;
alter table public.privacy_retention_rules enable row level security;
alter table public.privacy_retention_holds enable row level security;
alter table public.privacy_deletion_jobs enable row level security;
alter table public.privacy_request_events enable row level security;
alter table public.retained_policy_evidence enable row level security;

create policy account_lifecycle_select_own
  on public.account_lifecycle_states for select
  to authenticated
  using ((select auth.uid())=subject_user_id);

revoke all on table public.account_lifecycle_states from public,anon,authenticated;
revoke all on table public.account_withdrawal_requests from public,anon,authenticated;
revoke all on table public.privacy_rights_requests from public,anon,authenticated;
revoke all on table public.privacy_retention_rules from public,anon,authenticated;
revoke all on table public.privacy_retention_holds from public,anon,authenticated;
revoke all on table public.privacy_deletion_jobs from public,anon,authenticated;
revoke all on table public.privacy_request_events from public,anon,authenticated;
revoke all on table public.retained_policy_evidence from public,anon,authenticated;
revoke all on sequence public.privacy_request_events_id_seq from public,anon,authenticated;
revoke all on sequence public.retained_policy_evidence_id_seq from public,anon,authenticated;

grant select on table public.account_lifecycle_states to authenticated;

grant select,insert,update,delete on table public.account_lifecycle_states to service_role;
grant select,insert,update on table public.account_withdrawal_requests to service_role;
grant select,insert,update on table public.privacy_rights_requests to service_role;
grant select,insert,update on table public.privacy_retention_rules to service_role;
grant select,insert,update on table public.privacy_retention_holds to service_role;
grant select,insert,update on table public.privacy_deletion_jobs to service_role;
grant select,insert,update on table public.privacy_request_events to service_role;
grant select,insert,delete on table public.retained_policy_evidence to service_role;
grant delete on table public.signup_policy_confirmations to service_role;
grant delete on table public.policy_acceptance_events to service_role;
grant usage,select on sequence public.privacy_request_events_id_seq to service_role;
grant usage,select on sequence public.retained_policy_evidence_id_seq to service_role;

revoke all on function public.get_account_privacy_center(uuid) from public,anon,authenticated;
revoke all on function public.create_privacy_rights_request(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.withdraw_account_marketing_consent(uuid,text,text) from public,anon,authenticated;
revoke all on function public.delete_customer_optional_phone(uuid) from public,anon,authenticated;
revoke all on function public.request_account_withdrawal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.cancel_account_withdrawal(uuid) from public,anon,authenticated;
revoke all on function public.claim_due_privacy_deletion_jobs(integer) from public,anon,authenticated;
revoke all on function public.prepare_account_privacy_deletion(uuid) from public,anon,authenticated;
revoke all on function public.finalize_account_privacy_deletion(uuid) from public,anon,authenticated;
revoke all on function public.fail_account_privacy_deletion(uuid,text,text) from public,anon,authenticated;
revoke all on function public.purge_expired_privacy_retention(integer) from public,anon,authenticated;
revoke all on function private.minimize_payment_provider_response(jsonb) from public,anon,authenticated;
grant execute on function public.get_account_privacy_center(uuid) to service_role;
grant execute on function public.create_privacy_rights_request(uuid,text,text,jsonb) to service_role;
grant execute on function public.withdraw_account_marketing_consent(uuid,text,text) to service_role;
grant execute on function public.delete_customer_optional_phone(uuid) to service_role;
grant execute on function public.request_account_withdrawal(uuid,text,text) to service_role;
grant execute on function public.cancel_account_withdrawal(uuid) to service_role;
grant execute on function public.claim_due_privacy_deletion_jobs(integer) to service_role;
grant execute on function public.prepare_account_privacy_deletion(uuid) to service_role;
grant execute on function public.finalize_account_privacy_deletion(uuid) to service_role;
grant execute on function public.fail_account_privacy_deletion(uuid,text,text) to service_role;
grant execute on function public.purge_expired_privacy_retention(integer) to service_role;
grant execute on function private.minimize_payment_provider_response(jsonb) to service_role;

-- Hourly deletion processing. No request is sent until both Vault values exist.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname='rion-order-privacy-deletion-retry';

select cron.schedule(
  'rion-order-privacy-deletion-retry',
  '17 * * * *',
  $job$
    select net.http_post(
      url := rtrim(app_url.decrypted_secret,'/') || '/api/internal/privacy-deletion-retry',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || retry_secret.decrypted_secret
      ),
      body := jsonb_build_object('source','supabase-cron','requestedAt',now()),
      timeout_milliseconds := 15000
    )
    from vault.decrypted_secrets app_url
    cross join vault.decrypted_secrets retry_secret
    where app_url.name='rion_order_app_url'
      and retry_secret.name='rion_order_privacy_deletion_retry_secret'
      and nullif(btrim(app_url.decrypted_secret),'') is not null
      and nullif(btrim(retry_secret.decrypted_secret),'') is not null;
  $job$
);

commit;
