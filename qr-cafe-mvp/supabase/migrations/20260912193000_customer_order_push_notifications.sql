begin;

-- Server-only, per-order Web Push subscriptions. Customer browsers never
-- receive table access; each mutation is authorized by the order access token
-- in the corresponding Next.js server route.
create table public.customer_order_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.stores(store_id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  endpoint text not null check (endpoint like 'https://%'),
  p256dh text not null,
  auth_secret text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'sent')),
  subscribed_at timestamptz not null default now(),
  ready_notified_at timestamptz,
  revoked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, endpoint)
);

create index idx_customer_order_push_ready_queue
  on public.customer_order_push_subscriptions (order_id, status)
  where status = 'active' and ready_notified_at is null;

alter table public.customer_order_push_subscriptions enable row level security;
revoke all on table public.customer_order_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_order_push_subscriptions to service_role;

comment on table public.customer_order_push_subscriptions is
  'Server-only, per-order customer Web Push subscriptions. Each subscription ends after the order is completed or cancelled.';

create or replace function public.close_customer_order_push_subscriptions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('completed', 'cancelled') and old.status is distinct from new.status then
    update public.customer_order_push_subscriptions
      set status = 'revoked', revoked_at = now(), updated_at = now()
      where order_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.close_customer_order_push_subscriptions() from public, anon, authenticated;

create trigger close_customer_order_push_subscriptions_on_order_end
after update of status on public.orders
for each row execute function public.close_customer_order_push_subscriptions();

commit;
