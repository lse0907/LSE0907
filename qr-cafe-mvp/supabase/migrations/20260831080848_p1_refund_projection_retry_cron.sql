begin;

-- Keep the immutable order quantities while projecting completed partial refunds
-- into fast, customer-safe snapshots.
alter table public.order_items
  add column if not exists refunded_qty integer not null default 0;

alter table public.orders
  add column if not exists refunded_count integer not null default 0;

with completed_refunds as (
  select
    ri.order_item_id,
    coalesce(sum(ri.cancelled_quantity), 0)::integer as refunded_qty
  from public.order_partial_refund_items ri
  join public.order_partial_refunds r on r.id = ri.partial_refund_id
  where r.status = 'completed'
  group by ri.order_item_id
)
update public.order_items i
set refunded_qty = least(greatest(0, coalesce(i.qty, 0)), greatest(0, c.refunded_qty))
from completed_refunds c
where i.id = c.order_item_id;

update public.orders o
set refunded_count = least(
  greatest(0, coalesce(o.total_count, 0)),
  greatest(0, coalesce((
    select sum(i.refunded_qty)::integer
    from public.order_items i
    where i.order_id = o.id
  ), 0))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_refunded_qty_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_refunded_qty_check
      check (refunded_qty >= 0 and refunded_qty <= greatest(0, coalesce(qty, 0)));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_refunded_count_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_refunded_count_check
      check (refunded_count >= 0 and refunded_count <= greatest(0, coalesce(total_count, 0)));
  end if;
end
$$;

create or replace function private.sync_completed_partial_refund_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  update public.order_items i
  set refunded_qty = least(
    greatest(0, coalesce(i.qty, 0)),
    greatest(0, coalesce(i.refunded_qty, 0) + ri.cancelled_quantity)
  )
  from public.order_partial_refund_items ri
  where ri.partial_refund_id = new.id
    and ri.order_item_id = i.id
    and ri.order_id = new.order_id;

  update public.orders o
  set refunded_count = least(
    greatest(0, coalesce(o.total_count, 0)),
    greatest(0, coalesce((
      select sum(i.refunded_qty)::integer
      from public.order_items i
      where i.order_id = new.order_id
    ), 0))
  )
  where o.id = new.order_id
    and o.store_id = new.store_id;

  return new;
end;
$$;

drop trigger if exists trg_sync_completed_partial_refund_projection
  on public.order_partial_refunds;
create trigger trg_sync_completed_partial_refund_projection
after update of status on public.order_partial_refunds
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function private.sync_completed_partial_refund_projection();

revoke all privileges on function private.sync_completed_partial_refund_projection()
  from public, anon, authenticated;
grant execute on function private.sync_completed_partial_refund_projection()
  to service_role;

-- Supabase Cron calls the existing protected Vercel route every five minutes.
-- Until both Vault secrets exist, the SELECT returns no rows and makes no request.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'rion-order-refund-retry';

select cron.schedule(
  'rion-order-refund-retry',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := rtrim(app_url.decrypted_secret, '/') || '/api/internal/order-refund-retry',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || retry_secret.decrypted_secret
      ),
      body := jsonb_build_object('source', 'supabase-cron', 'requestedAt', now()),
      timeout_milliseconds := 10000
    )
    from vault.decrypted_secrets app_url
    cross join vault.decrypted_secrets retry_secret
    where app_url.name = 'rion_order_app_url'
      and retry_secret.name = 'rion_order_refund_retry_secret'
      and nullif(btrim(app_url.decrypted_secret), '') is not null
      and nullif(btrim(retry_secret.decrypted_secret), '') is not null;
  $job$
);

commit;
