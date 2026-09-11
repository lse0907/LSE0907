begin;

-- Attachments are retained only while a case is active, plus the agreed
-- 90-day follow-up window after it is resolved or closed.
create or replace function private.set_support_evidence_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('resolved', 'closed') and old.status is distinct from new.status then
    update public.support_ticket_attachments
       set expires_at = coalesce(new.resolved_at, now()) + interval '90 days'
     where ticket_id = new.id
       and deleted_at is null
       and expires_at is null;
  elsif new.status in ('open', 'in_progress') and old.status is distinct from new.status then
    update public.support_ticket_attachments
       set expires_at = null
     where ticket_id = new.id
       and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_support_evidence_expiry on public.support_tickets;
create trigger trg_set_support_evidence_expiry
after update of status on public.support_tickets
for each row
execute function private.set_support_evidence_expiry();

revoke all privileges on function private.set_support_evidence_expiry() from public, anon, authenticated;
grant execute on function private.set_support_evidence_expiry() to service_role;

-- The protected application endpoint deletes the actual private Storage
-- object and marks its metadata row. Vault values are deliberately not
-- created here; a missing secret means the scheduled request is a no-op.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'rion-order-support-evidence-retention';

select cron.schedule(
  'rion-order-support-evidence-retention',
  '0 19 * * *',
  $job$
    select net.http_post(
      url := rtrim(app_url.decrypted_secret, '/') || '/api/internal/support-evidence-retention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || retention_secret.decrypted_secret
      ),
      body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now()),
      timeout_milliseconds := 10000
    )
    from vault.decrypted_secrets app_url
    cross join vault.decrypted_secrets retention_secret
    where app_url.name = 'rion_order_app_url'
      and retention_secret.name = 'rion_order_support_retention_secret'
      and nullif(btrim(app_url.decrypted_secret), '') is not null
      and nullif(btrim(retention_secret.decrypted_secret), '') is not null;
  $job$
);

commit;
