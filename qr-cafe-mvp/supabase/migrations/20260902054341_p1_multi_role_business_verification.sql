begin;

-- One Supabase Auth identity can hold both customer and owner roles.
alter table public.signup_policy_confirmations
  drop constraint signup_policy_confirmations_pkey;
alter table public.signup_policy_confirmations
  add constraint signup_policy_confirmations_pkey primary key (user_id,audience);

create table public.account_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience in ('customer','owner')),
  status text not null default 'active' check (status in (
    'active','verification_required','verification_pending','changes_requested','suspended','withdrawn'
  )),
  activated_at timestamptz,
  suspended_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,audience)
);

insert into public.account_roles(user_id,audience,status,activated_at)
select user_id,audience,'active',confirmed_at
from public.signup_policy_confirmations
on conflict (user_id,audience) do nothing;

insert into public.account_roles(user_id,audience,status,activated_at)
select user_id,'customer','active',created_at from public.customer_profiles
on conflict (user_id,audience) do update set status='active',activated_at=coalesce(public.account_roles.activated_at,excluded.activated_at),updated_at=now();

insert into public.account_roles(user_id,audience,status,activated_at)
select distinct user_id,'owner','active',created_at from public.profiles
on conflict (user_id,audience) do update set status='active',activated_at=coalesce(public.account_roles.activated_at,excluded.activated_at),updated_at=now();

create table public.business_entities (
  id uuid primary key default gen_random_uuid(),
  business_number text not null,
  business_number_normalized text not null unique check (business_number_normalized ~ '^[0-9]{10}$'),
  legal_name text not null,
  representative_name text not null,
  business_type text not null check (business_type in ('sole_proprietor','corporation','other')),
  opening_date date,
  registered_address text not null default '',
  business_status text not null default 'unknown' check (business_status in ('unknown','active','suspended','closed')),
  verification_status text not null default 'pending' check (verification_status in (
    'pending','submitted','changes_requested','approved','legacy_verified','rejected','suspended'
  )),
  verification_method text not null default 'ops_manual' check (verification_method in ('ops_manual','automatic','legacy_migration')),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_entity_members (
  business_entity_id uuid not null references public.business_entities(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('applicant','representative','authorized_manager')),
  status text not null default 'active' check (status in ('active','suspended','removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_entity_id,user_id)
);
create index idx_business_entity_members_user on public.business_entity_members(user_id,status);

create table public.business_verification_requests (
  id uuid primary key default gen_random_uuid(),
  business_entity_id uuid not null references public.business_entities(id) on delete restrict,
  applicant_user_id uuid references auth.users(id) on delete set null,
  applicant_role text not null check (applicant_role in ('representative','authorized_manager')),
  status text not null default 'draft' check (status in ('draft','submitted','changes_requested','approved','rejected','canceled')),
  business_phone text not null,
  phone_verified_at timestamptz,
  business_document_path text,
  delegation_document_path text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_business_verification_active
  on public.business_verification_requests(business_entity_id)
  where status in ('draft','submitted','changes_requested');
create index idx_business_verification_ops on public.business_verification_requests(status,submitted_at);

create table public.business_verification_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.business_verification_requests(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('submitted','changes_requested','approved','rejected','resubmitted','canceled')),
  note text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  occurred_at timestamptz not null default now()
);
create index idx_business_verification_events_request on public.business_verification_events(request_id,occurred_at desc);

alter table public.stores add column business_entity_id uuid references public.business_entities(id) on delete restrict;
create index idx_stores_business_entity on public.stores(business_entity_id);

-- Existing stores are kept operational and linked to a legacy-verified business.
insert into public.business_entities(
  business_number,business_number_normalized,legal_name,representative_name,business_type,
  registered_address,business_status,verification_status,verification_method,verified_at,created_by
)
select
  min(s.business_number),
  regexp_replace(s.business_number,'[^0-9]','','g'),
  coalesce(min(nullif(trim(s.store_name),'')),'기존 사업체'),
  coalesce(min(nullif(trim(p.name),'')),'기존 사업자'),
  'other',
  coalesce(min(nullif(trim(s.address),'')),''),
  'active','legacy_verified','legacy_migration',now(),min(s.owner_user_id::text)::uuid
from public.stores s
left join public.profiles p on p.user_id=s.owner_user_id
where length(regexp_replace(coalesce(s.business_number,''),'[^0-9]','','g'))=10
group by regexp_replace(s.business_number,'[^0-9]','','g')
on conflict (business_number_normalized) do nothing;

update public.stores s
set business_entity_id=b.id
from public.business_entities b
where b.business_number_normalized=regexp_replace(coalesce(s.business_number,''),'[^0-9]','','g')
  and s.business_entity_id is null;

insert into public.business_entity_members(business_entity_id,user_id,role,status)
select distinct s.business_entity_id,sm.user_id,'representative','active'
from public.stores s
join public.store_members sm on sm.store_id=s.store_id and sm.role='owner'
where s.business_entity_id is not null
on conflict (business_entity_id,user_id) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('business-verification','business-verification',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

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
  if p_audience not in ('customer','owner') then raise exception 'INVALID_SIGNUP_AUDIENCE'; end if;
  if p_minimum_age_confirmed is not true then raise exception 'MINIMUM_AGE_CONFIRMATION_REQUIRED'; end if;
  if p_audience='owner' and p_business_authority_confirmed is not true then raise exception 'BUSINESS_AUTHORITY_CONFIRMATION_REQUIRED'; end if;

  select id into v_terms_id from public.policy_documents
  where document_type='terms' and audience=p_audience and version=p_terms_version and status='published' and effective_at<=now();
  select id into v_privacy_id from public.policy_documents
  where document_type='privacy_signup_notice' and audience=p_audience and version=p_privacy_version and status='published' and effective_at<=now();
  select id into v_marketing_id from public.policy_documents
  where document_type='marketing' and audience=p_audience and version=p_marketing_version and status='published' and effective_at<=now();
  if v_terms_id is null or v_privacy_id is null or v_marketing_id is null then raise exception 'ACTIVE_POLICY_DOCUMENT_NOT_FOUND'; end if;

  insert into public.signup_policy_confirmations(user_id,audience,minimum_age_confirmed,business_authority_confirmed,policy_version,source)
  values (p_user_id,p_audience,true,p_audience='owner',p_terms_version,left(coalesce(nullif(trim(p_source),''),'web_signup'),64))
  on conflict (user_id,audience) do update set
    minimum_age_confirmed=true,
    business_authority_confirmed=excluded.business_authority_confirmed,
    policy_version=excluded.policy_version,
    source=excluded.source,
    confirmed_at=now();

  insert into public.account_roles(user_id,audience,status,activated_at)
  values (p_user_id,p_audience,case when p_audience='owner' then 'verification_required' else 'active' end,
    case when p_audience='customer' then now() else null end)
  on conflict (user_id,audience) do update set
    status=case when excluded.audience='customer' then 'active' when public.account_roles.status='withdrawn' then 'verification_required' else public.account_roles.status end,
    activated_at=case when excluded.audience='customer' then coalesce(public.account_roles.activated_at,now()) else public.account_roles.activated_at end,
    withdrawn_at=null,updated_at=now();

  insert into public.policy_acceptance_events(user_id,document_id,audience,action,source,entry_path,language,idempotency_key,metadata)
  values
    (p_user_id,v_terms_id,p_audience,'accepted',p_source,case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,'ko-KR','role:'||p_user_id||':'||p_audience||':terms:'||p_terms_version,'{}'::jsonb),
    (p_user_id,v_privacy_id,p_audience,'acknowledged',p_source,case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,'ko-KR','role:'||p_user_id||':'||p_audience||':privacy:'||p_privacy_version,'{}'::jsonb),
    (p_user_id,v_marketing_id,p_audience,case when p_marketing_accepted then 'accepted' else 'declined' end,p_source,case when p_audience='owner' then '/signup-owner' else '/signup-customer' end,'ko-KR','role:'||p_user_id||':'||p_audience||':marketing:'||p_marketing_version,jsonb_build_object('sender','rion_labs','channel_scope','all'))
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function private.enforce_verified_business_store_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.business_entity_id is null then raise exception 'VERIFIED_BUSINESS_REQUIRED'; end if;
  if not exists (
    select 1 from public.business_entities b
    join public.business_entity_members m on m.business_entity_id=b.id
    where b.id=new.business_entity_id
      and b.verification_status in ('approved','legacy_verified')
      and m.user_id=coalesce((select auth.uid()),new.owner_user_id)
      and m.status='active' and m.role in ('representative','authorized_manager')
  ) then raise exception 'VERIFIED_BUSINESS_ACCESS_REQUIRED'; end if;
  return new;
end;
$$;

create trigger trg_stores_verified_business
before insert on public.stores
for each row execute function private.enforce_verified_business_store_insert();

alter table public.account_roles enable row level security;
alter table public.business_entities enable row level security;
alter table public.business_entity_members enable row level security;
alter table public.business_verification_requests enable row level security;
alter table public.business_verification_events enable row level security;

revoke all on table public.account_roles,public.business_entities,public.business_entity_members,
  public.business_verification_requests,public.business_verification_events from public,anon,authenticated;
revoke all on sequence public.business_verification_events_id_seq from public,anon,authenticated;
grant select,insert,update on table public.account_roles,public.business_entities,public.business_entity_members,
  public.business_verification_requests,public.business_verification_events to service_role;
grant usage,select on sequence public.business_verification_events_id_seq to service_role;

revoke all on function private.enforce_verified_business_store_insert() from public,anon,authenticated;

commit;
