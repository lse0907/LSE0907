begin;

-- PG credentials are server-managed. Store owners access them only through
-- authenticated server routes, so no browser role needs direct table access.
drop policy if exists public_select_store_pg_config on public.store_pg_config;

revoke all privileges on table public.store_pg_config
from public, anon, authenticated;
grant all privileges on table public.store_pg_config
to service_role;

-- One canonical, server-only policy projection keeps the customer UI and both
-- order APIs on the same checkout-mode decision. It returns booleans only and
-- never exposes billing or PG credential values.
create or replace function public.get_store_checkout_policy(p_store_id text)
returns table(is_orderable boolean, is_prepay boolean, source text)
language sql
stable
security definer
set search_path = ''
as $function$
  with state as (
    select
      coalesce(
        s.status = 'active'
        and s.deleted_at is null
        and s.setup_completed is true,
        false
      ) as store_operational,
      coalesce(
        (
          sb.base_plan_status = 'active'
          and sb.paid_until is not null
          and sb.paid_until > now()
        )
        or (
          sb.base_plan_status = 'trialing'
          and sb.trial_end_at is not null
          and sb.trial_end_at > now()
        ),
        false
      ) as base_orderable,
      coalesce(
        sb.base_plan_status = 'active'
        and sb.paid_until is not null
        and sb.paid_until > now(),
        false
      ) as paid_base_active,
      coalesce(
        sa.prepay_addon_status = 'active'
        and sa.addon_paid_until is not null
        and sa.addon_paid_until > now()
        and sa.prepay_enabled is true,
        false
      ) as prepay_addon_active,
      coalesce(
        nullif(btrim(pgc.mid), '') is not null
        and nullif(btrim(pgc.client_key), '') is not null
        and nullif(btrim(pgc.secret_key), '') is not null,
        false
      ) as pg_ready
    from (values (p_store_id)) as requested(store_id)
    left join public.stores s on s.store_id = requested.store_id
    left join public.store_billing sb on sb.store_id = requested.store_id
    left join public.store_addons sa on sa.store_id = requested.store_id
    left join public.store_pg_config pgc on pgc.store_id = requested.store_id
  )
  select
    state.store_operational and state.base_orderable as is_orderable,
    state.store_operational
      and state.paid_base_active
      and state.prepay_addon_active
      and state.pg_ready as is_prepay,
    'store_checkout_policy_v1'::text as source
  from state;
$function$;

revoke all privileges on function public.get_store_checkout_policy(text)
from public, anon, authenticated;
grant execute on function public.get_store_checkout_policy(text)
to service_role;

-- Preserve the existing public response shape used by the customer checkout.
-- The function delegates to the canonical policy instead of reimplementing it.
create or replace function public.get_store_checkout_mode(p_store_id text)
returns table(is_prepay boolean, source text)
language sql
stable
security definer
set search_path = ''
as $function$
  select policy.is_prepay, policy.source
  from public.get_store_checkout_policy(p_store_id) as policy;
$function$;

revoke all privileges on function public.get_store_checkout_mode(text)
from public, anon, authenticated;
grant execute on function public.get_store_checkout_mode(text)
to anon, authenticated, service_role;

-- Client Key and MID are public Toss checkout values, but they are returned
-- only while this store is effectively eligible for prepaid checkout.
create or replace function public.get_store_checkout_client_config(p_store_id text)
returns table(client_key text, mid text)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    coalesce(pgc.client_key, '')::text as client_key,
    coalesce(pgc.mid, '')::text as mid
  from public.get_store_checkout_policy(p_store_id) as policy
  join public.store_pg_config pgc on pgc.store_id = p_store_id
  where policy.is_prepay
  limit 1;
$function$;

revoke all privileges on function public.get_store_checkout_client_config(text)
from public, anon, authenticated;
grant execute on function public.get_store_checkout_client_config(text)
to anon, authenticated, service_role;

commit;
