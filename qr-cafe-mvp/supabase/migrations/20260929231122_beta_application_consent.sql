-- Preserve the exact consent version and timestamp for beta-application records.
-- Existing applications predate this consent record, so columns remain nullable.
alter table if exists public.beta_applications
  add column if not exists privacy_consent_version text,
  add column if not exists privacy_consented_at timestamptz;

alter table if exists public.beta_applications
  drop constraint if exists beta_applications_privacy_consent_pair_check;

alter table if exists public.beta_applications
  add constraint beta_applications_privacy_consent_pair_check
  check (
    (privacy_consent_version is null and privacy_consented_at is null)
    or (privacy_consent_version is not null and privacy_consented_at is not null)
  );

do $$
begin
  if to_regclass('public.beta_applications') is not null then
    comment on column public.beta_applications.privacy_consent_version is
      'Version of the beta application personal-information consent accepted at submission.';
    comment on column public.beta_applications.privacy_consented_at is
      'Timestamp when the applicant accepted the beta application consent.';
  end if;
end $$;
