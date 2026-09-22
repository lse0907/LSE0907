-- Public beta-application intake is written only by the server route.
-- The table is deliberately not exposed to anon/authenticated Data API roles.
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
  feedback_available boolean not null default false,
  note text not null default '' check (char_length(note) <= 1000),
  source text not null default 'landing' check (source in ('landing')),
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'selected', 'not_selected', 'closed')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  check (
    (contact_method = 'email' and contact_email is not null)
    or (contact_method = 'phone' and contact_phone is not null)
  )
);

create index if not exists beta_applications_status_created_at_idx
  on public.beta_applications (status, created_at desc);

alter table public.beta_applications enable row level security;

-- Server routes use service_role after validation. No browser role can read or
-- write applicant details directly through the Data API.
revoke all on table public.beta_applications from anon, authenticated;
grant all on table public.beta_applications to service_role;
