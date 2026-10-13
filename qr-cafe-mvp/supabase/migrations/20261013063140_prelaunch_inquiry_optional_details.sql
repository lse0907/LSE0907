-- Inquiry intake does not collect legacy application-only details.
-- Preserve all existing values, constraints, RLS and server-only access.
begin;
alter table public.beta_applications
  alter column operation_type drop not null,
  alter column region drop not null,
  alter column contact_name drop not null,
  alter column preferred_start drop not null;
commit;
