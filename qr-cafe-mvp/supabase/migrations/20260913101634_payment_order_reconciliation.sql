begin;

-- This is platform-operated recovery, not a merchant webhook. The job has no
-- effect until the two Vault secrets are supplied by Rion Order operations.
-- It does not expose credentials or grant application users any new access.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'rion-order-payment-reconciliation';

select cron.schedule(
  'rion-order-payment-reconciliation',
  '* * * * *',
  $job$
    select net.http_post(
      url := rtrim(app_url.decrypted_secret, '/') || '/api/internal/order-payment-reconcile',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || cron_secret.decrypted_secret
      ),
      body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now()),
      timeout_milliseconds := 45000
    )
    from vault.decrypted_secrets app_url
    cross join vault.decrypted_secrets cron_secret
    where app_url.name = 'rion_order_app_url'
      and cron_secret.name = 'rion_order_cron_secret'
      and nullif(btrim(app_url.decrypted_secret), '') is not null
      and nullif(btrim(cron_secret.decrypted_secret), '') is not null;
  $job$
);

commit;
