-- Public beta recruitment is controlled by OPS; only one round can receive applications.
create table public.beta_recruitment_rounds (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (char_length(title) between 2 and 80),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  public_message text not null default '' check (char_length(public_message) <= 500)
);

create unique index beta_recruitment_rounds_one_open_idx
  on public.beta_recruitment_rounds (status)
  where status = 'open';

alter table public.beta_recruitment_rounds enable row level security;
revoke all on table public.beta_recruitment_rounds from anon, authenticated;
grant all on table public.beta_recruitment_rounds to service_role;

insert into public.beta_recruitment_rounds (title, status, public_message)
values (
  '1차 베타 테스터 모집',
  'open',
  '이번 1차 모집은 한정된 매장을 선정해 진행합니다. 신청 내용을 검토한 뒤 선정된 매장에 이메일 또는 SMS로 안내드립니다.'
);

alter table public.beta_applications
  add column recruitment_round_id bigint references public.beta_recruitment_rounds(id);

alter table public.beta_applications
  add column preferred_start_date date;

update public.beta_applications
set recruitment_round_id = (select id from public.beta_recruitment_rounds where status = 'open')
where recruitment_round_id is null;

alter table public.beta_applications
  alter column recruitment_round_id set not null;

create index beta_applications_round_status_created_at_idx
  on public.beta_applications (recruitment_round_id, status, created_at desc);
