-- Reconciles the beta intake tables that were previously created outside the
-- tracked migration history. Browser roles never access applicant data.
create table if not exists public.beta_recruitment_rounds (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (char_length(title) between 2 and 80),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  public_message text not null default '' check (char_length(public_message) <= 500)
);

create unique index if not exists beta_recruitment_rounds_one_open_idx
  on public.beta_recruitment_rounds (status)
  where status = 'open';

-- A clean environment needs one active round for the public application page.
-- Existing operations data is never overwritten.
insert into public.beta_recruitment_rounds (title, status, public_message)
select
  '1차 베타 테스터 모집',
  'open',
  '이번 1차 모집은 한정된 매장을 선정해 진행합니다. 신청 내용을 검토한 뒤 선정된 매장에 이메일 또는 SMS로 안내드립니다.'
where not exists (select 1 from public.beta_recruitment_rounds);

create table if not exists public.beta_applications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  store_name text not null check (char_length(store_name) between 2 and 80),
  business_type text not null check (business_type in ('cafe', 'restaurant', 'bar', 'food_truck', 'popup', 'other')),
  operation_type text not null check (operation_type in ('dine_in', 'takeout', 'both')),
  region text not null check (char_length(region) between 2 and 80),
  contact_name text not null check (char_length(contact_name) between 2 and 80),
  contact_method text not null check (contact_method in ('email', 'phone')),
  contact_email text check (char_length(contact_email) between 5 and 254),
  contact_phone text check (char_length(contact_phone) between 8 and 30),
  preferred_start text not null check (preferred_start in ('asap', 'within_month', 'later')),
  preferred_start_date date,
  recruitment_round_id bigint references public.beta_recruitment_rounds(id),
  feedback_available boolean not null default false,
  note text not null default '' check (char_length(note) <= 1000),
  source text not null default 'landing' check (source in ('landing')),
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'selected', 'not_selected', 'closed')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  privacy_consent_version text,
  privacy_consented_at timestamptz,
  check (
    (contact_method = 'email' and contact_email is not null)
    or (contact_method = 'phone' and contact_phone is not null)
  ),
  constraint beta_applications_privacy_consent_pair_check check (
    (privacy_consent_version is null and privacy_consented_at is null)
    or (privacy_consent_version is not null and privacy_consented_at is not null)
  )
);

alter table public.beta_applications
  add column if not exists recruitment_round_id bigint references public.beta_recruitment_rounds(id),
  add column if not exists preferred_start_date date;

-- Earlier applications remain available and are associated with the active
-- round when one exists. The server still requires an open round for new data.
update public.beta_applications
set recruitment_round_id = (
  select id from public.beta_recruitment_rounds where status = 'open' limit 1
)
where recruitment_round_id is null
  and exists (select 1 from public.beta_recruitment_rounds where status = 'open');

create index if not exists beta_applications_status_created_at_idx
  on public.beta_applications (status, created_at desc);
create index if not exists beta_applications_round_status_created_at_idx
  on public.beta_applications (recruitment_round_id, status, created_at desc);

alter table public.beta_recruitment_rounds enable row level security;
alter table public.beta_applications enable row level security;

revoke all on table public.beta_recruitment_rounds from anon, authenticated;
revoke all on table public.beta_applications from anon, authenticated;
grant all on table public.beta_recruitment_rounds to service_role;
grant all on table public.beta_applications to service_role;
