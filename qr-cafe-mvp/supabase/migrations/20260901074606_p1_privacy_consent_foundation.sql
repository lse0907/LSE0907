begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.profiles alter column address drop not null;
comment on column public.profiles.address is
  'Legacy owner residence address. New owner signup stopped collecting this value in P1-3A.';

create table public.policy_documents (
  id bigint generated always as identity primary key,
  document_type text not null check (document_type in (
    'terms','privacy_notice','privacy_signup_notice','marketing',
    'subscription_billing','customer_benefits'
  )),
  audience text not null check (audience in ('customer','owner','all')),
  version text not null,
  title text not null,
  public_path text not null check (public_path like '/legal/%'),
  language text not null default 'ko-KR',
  required_at_signup boolean not null default false,
  confirmation_mode text not null default 'none' check (confirmation_mode in ('none','accept','acknowledge','optional')),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  announcement_at timestamptz,
  effective_at timestamptz,
  published_at timestamptz,
  change_summary text not null default 'Initial operational policy draft before legal review.',
  created_at timestamptz not null default now(),
  unique(document_type,audience,version),
  check (
    status <> 'published'
    or (effective_at is not null and published_at is not null)
  )
);

create unique index uq_policy_documents_current_published
  on public.policy_documents(document_type,audience)
  where status='published';

create table public.signup_policy_confirmations (
  user_id uuid primary key references auth.users(id) on delete restrict,
  audience text not null check (audience in ('customer','owner')),
  minimum_age_confirmed boolean not null,
  business_authority_confirmed boolean not null default false,
  policy_version text not null,
  source text not null default 'web_signup',
  confirmed_at timestamptz not null default now(),
  check (minimum_age_confirmed),
  check (audience <> 'owner' or business_authority_confirmed)
);

create table public.policy_acceptance_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  document_id bigint not null references public.policy_documents(id) on delete restrict,
  audience text not null check (audience in ('customer','owner')),
  action text not null check (action in ('accepted','acknowledged','declined','withdrawn')),
  source text not null default 'web_signup',
  entry_path text not null,
  language text not null default 'ko-KR',
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(metadata)='object')
);

create index idx_policy_acceptance_events_user_time
  on public.policy_acceptance_events(user_id,occurred_at desc,id desc);
create index idx_policy_acceptance_events_document
  on public.policy_acceptance_events(document_id,occurred_at desc,id desc);

create or replace function private.prevent_policy_acceptance_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  raise exception 'POLICY_ACCEPTANCE_EVENT_IMMUTABLE';
end;
$$;

create trigger trg_policy_acceptance_events_immutable
before update or delete on public.policy_acceptance_events
for each row execute function private.prevent_policy_acceptance_event_mutation();

insert into public.policy_documents(
  document_type,audience,version,title,public_path,required_at_signup,confirmation_mode,
  status,announcement_at,effective_at,published_at
) values
  ('terms','customer','policy-v5-2026-08-23','Rion Order 고객 이용정책 안내','/legal/terms?audience=customer',true,'accept','published',now(),now(),now()),
  ('terms','owner','policy-v5-2026-08-23','Rion Order 점주 B2B 이용정책 안내','/legal/terms?audience=owner',true,'accept','published',now(),now(),now()),
  ('privacy_notice','all','policy-v5-2026-08-23','Rion Order 개인정보 처리방침 검토본','/legal/privacy',false,'none','published',now(),now(),now()),
  ('privacy_signup_notice','customer','policy-v5-2026-08-23','고객 가입 개인정보 처리 안내','/legal/privacy?audience=customer',true,'acknowledge','published',now(),now(),now()),
  ('privacy_signup_notice','owner','policy-v5-2026-08-23','점주 가입 개인정보 처리 안내','/legal/privacy?audience=owner',true,'acknowledge','published',now(),now(),now()),
  ('marketing','customer','policy-v5-2026-08-23','고객 마케팅 정보 수신 안내','/legal/marketing?audience=customer',false,'optional','published',now(),now(),now()),
  ('marketing','owner','policy-v5-2026-08-23','점주 마케팅 정보 수신 안내','/legal/marketing?audience=owner',false,'optional','published',now(),now(),now()),
  ('subscription_billing','owner','policy-v5-2026-08-23','점주 구독·결제·취소·환불 정책','/legal/subscription-billing',false,'none','published',now(),now(),now()),
  ('customer_benefits','customer','policy-v5-2026-08-23','고객 주문·포인트·쿠폰 운영정책','/legal/customer-benefits',false,'none','published',now(),now(),now());

create or replace function public.record_signup_policy_acceptances(
  p_user_id uuid,
  p_audience text,
  p_minimum_age_confirmed boolean,
  p_business_authority_confirmed boolean,
  p_terms_version text,
  p_privacy_version text,
  p_marketing_version text,
  p_marketing_accepted boolean,
  p_source text default 'web_signup'
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_terms_id bigint;
  v_privacy_id bigint;
  v_marketing_id bigint;
begin
  if p_audience not in ('customer','owner') then
    raise exception 'INVALID_SIGNUP_AUDIENCE';
  end if;
  if p_minimum_age_confirmed is not true then
    raise exception 'MINIMUM_AGE_CONFIRMATION_REQUIRED';
  end if;
  if p_audience='owner' and p_business_authority_confirmed is not true then
    raise exception 'BUSINESS_AUTHORITY_CONFIRMATION_REQUIRED';
  end if;

  select id into v_terms_id
  from public.policy_documents
  where document_type='terms' and audience=p_audience and version=p_terms_version
    and status='published' and effective_at <= now();
  select id into v_privacy_id
  from public.policy_documents
  where document_type='privacy_signup_notice' and audience=p_audience and version=p_privacy_version
    and status='published' and effective_at <= now();
  select id into v_marketing_id
  from public.policy_documents
  where document_type='marketing' and audience=p_audience and version=p_marketing_version
    and status='published' and effective_at <= now();

  if v_terms_id is null or v_privacy_id is null or v_marketing_id is null then
    raise exception 'ACTIVE_POLICY_DOCUMENT_NOT_FOUND';
  end if;

  insert into public.signup_policy_confirmations(
    user_id,audience,minimum_age_confirmed,business_authority_confirmed,policy_version,source
  ) values (
    p_user_id,p_audience,true,
    case when p_audience='owner' then true else false end,
    p_terms_version,left(coalesce(nullif(trim(p_source),''),'web_signup'),64)
  );

  insert into public.policy_acceptance_events(
    user_id,document_id,audience,action,source,entry_path,language,idempotency_key,metadata
  ) values
    (p_user_id,v_terms_id,p_audience,'accepted',p_source,
      case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,
      'ko-KR','signup:'||p_user_id||':terms:'||p_terms_version,'{}'::jsonb),
    (p_user_id,v_privacy_id,p_audience,'acknowledged',p_source,
      case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,
      'ko-KR','signup:'||p_user_id||':privacy:'||p_privacy_version,'{}'::jsonb),
    (p_user_id,v_marketing_id,p_audience,
      case when p_marketing_accepted then 'accepted' else 'declined' end,
      p_source,case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,
      'ko-KR','signup:'||p_user_id||':marketing:'||p_marketing_version,
      jsonb_build_object('sender','rion_labs','channel_scope','all'));
end;
$$;

alter table public.policy_documents enable row level security;
alter table public.signup_policy_confirmations enable row level security;
alter table public.policy_acceptance_events enable row level security;

revoke all on table public.policy_documents from public, anon, authenticated;
revoke all on table public.signup_policy_confirmations from public, anon, authenticated;
revoke all on table public.policy_acceptance_events from public, anon, authenticated;
revoke all on sequence public.policy_documents_id_seq from public, anon, authenticated;
revoke all on sequence public.policy_acceptance_events_id_seq from public, anon, authenticated;

grant select on table public.policy_documents to service_role;
grant select,insert on table public.signup_policy_confirmations to service_role;
grant select,insert on table public.policy_acceptance_events to service_role;
grant usage,select on sequence public.policy_documents_id_seq to service_role;
grant usage,select on sequence public.policy_acceptance_events_id_seq to service_role;

revoke all on function public.record_signup_policy_acceptances(uuid,text,boolean,boolean,text,text,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.record_signup_policy_acceptances(uuid,text,boolean,boolean,text,text,text,boolean,text)
  to service_role;

commit;
