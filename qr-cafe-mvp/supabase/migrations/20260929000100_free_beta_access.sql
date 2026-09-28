begin;

-- Free beta is a separate entitlement, not a discount flag.  A selected
-- owner may have one active beta store until the product release is declared.
create table if not exists public.store_beta_access (
  store_id text primary key references public.stores(store_id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','ended','revoked')),
  prepay_included boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  post_beta_discount_bps integer not null default 4000 check (post_beta_discount_bps between 0 and 10000),
  reason text not null,
  assigned_by uuid references auth.users(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists store_beta_access_one_active_store_per_owner
  on public.store_beta_access(owner_user_id)
  where status = 'active';

alter table public.store_beta_access enable row level security;
revoke all on table public.store_beta_access from public, anon, authenticated;
grant all on table public.store_beta_access to service_role;

-- Beta access is valid through the declared end date, or until release when
-- no date is set.  Prepay still requires a verified PG configuration.
create or replace function public.get_store_checkout_policy(p_store_id text)
returns table(is_orderable boolean, is_prepay boolean, source text)
language sql
stable
security definer
set search_path = ''
as $function$
  with state as (
    select
      coalesce(s.status = 'active' and s.deleted_at is null and s.setup_completed is true, false) as store_operational,
      coalesce((sb.base_plan_status = 'active' and sb.paid_until is not null and sb.paid_until > now()) or (sb.base_plan_status = 'trialing' and sb.trial_end_at is not null and sb.trial_end_at > now()), false) as paid_or_trial_base,
      coalesce(sb.base_plan_status = 'active' and sb.paid_until is not null and sb.paid_until > now(), false) as paid_base_active,
      coalesce(sa.prepay_addon_status = 'active' and sa.addon_paid_until is not null and sa.addon_paid_until > now() and sa.prepay_enabled is true, false) as paid_prepay_active,
      coalesce(beta.status = 'active' and (beta.ends_at is null or beta.ends_at > now()), false) as beta_active,
      coalesce(beta.prepay_included = true and beta.status = 'active' and (beta.ends_at is null or beta.ends_at > now()), false) as beta_prepay_active,
      coalesce(nullif(btrim(pgc.mid), '') is not null and nullif(btrim(pgc.client_key), '') is not null and nullif(btrim(pgc.secret_key), '') is not null, false) as pg_ready
    from (values (p_store_id)) as requested(store_id)
    left join public.stores s on s.store_id = requested.store_id
    left join public.store_billing sb on sb.store_id = requested.store_id
    left join public.store_addons sa on sa.store_id = requested.store_id
    left join public.store_pg_config pgc on pgc.store_id = requested.store_id
    left join public.store_beta_access beta on beta.store_id = requested.store_id
  )
  select
    state.store_operational and (state.paid_or_trial_base or state.beta_active) as is_orderable,
    state.store_operational and (state.paid_base_active or state.beta_active) and (state.paid_prepay_active or state.beta_prepay_active) and state.pg_ready as is_prepay,
    'store_checkout_policy_v2'::text as source
  from state;
$function$;

revoke all privileges on function public.get_store_checkout_policy(text) from public, anon, authenticated;
grant execute on function public.get_store_checkout_policy(text) to service_role;

commit;
