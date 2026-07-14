-- Loyalty coupon target search and selected-customer issue RPCs
-- Run this in Supabase SQL Editor after the base loyalty coupon schema.

create or replace function public.admin_search_coupon_targets(
  p_store_id text,
  p_query text default '',
  p_tier text default 'all',
  p_min_points integer default 0,
  p_min_orders integer default 0,
  p_min_spent integer default 0,
  p_recent_days integer default null,
  p_inactive_days integer default null,
  p_registered_min_days integer default null,
  p_template_id uuid default null,
  p_exclude_existing boolean default true,
  p_limit integer default 100
)
returns table (
  customer_user_id uuid,
  name text,
  phone text,
  point_balance integer,
  tier text,
  lifetime_spent integer,
  lifetime_orders integer,
  last_order_at timestamptz,
  registered_at timestamptz,
  already_has_coupon boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = v_uid
  ) then
    raise exception 'Store member permission required';
  end if;

  return query
  with latest_orders as (
    select o.customer_user_id, max(o.created_at) as last_order_at
    from public.orders o
    where o.store_id = p_store_id
      and o.customer_user_id is not null
    group by o.customer_user_id
  ), target_rows as (
    select
      w.customer_user_id,
      cp.name,
      cp.phone,
      w.point_balance,
      w.tier,
      w.lifetime_spent,
      w.lifetime_orders,
      coalesce(w.last_order_at, lo.last_order_at) as last_order_at,
      w.created_at as registered_at,
      exists (
        select 1
        from public.customer_coupons cc
        where cc.store_id = p_store_id
          and cc.customer_user_id = w.customer_user_id
          and cc.template_id = p_template_id
          and cc.status <> 'cancelled'
      ) as already_has_coupon
    from public.customer_store_wallets w
    left join public.customer_profiles cp on cp.user_id = w.customer_user_id
    left join latest_orders lo on lo.customer_user_id = w.customer_user_id
    where w.store_id = p_store_id
      and (coalesce(p_tier, 'all') = 'all' or w.tier = p_tier)
      and w.point_balance >= greatest(coalesce(p_min_points, 0), 0)
      and w.lifetime_orders >= greatest(coalesce(p_min_orders, 0), 0)
      and w.lifetime_spent >= greatest(coalesce(p_min_spent, 0), 0)
      and (
        v_query = ''
        or coalesce(cp.name, '') ilike '%' || v_query || '%'
        or coalesce(cp.phone, '') ilike '%' || v_query || '%'
        or w.customer_user_id::text ilike '%' || v_query || '%'
      )
      and (
        p_recent_days is null
        or coalesce(w.last_order_at, lo.last_order_at) >= now() - make_interval(days => greatest(p_recent_days, 0))
      )
      and (
        p_inactive_days is null
        or coalesce(w.last_order_at, lo.last_order_at, 'epoch'::timestamptz) < now() - make_interval(days => greatest(p_inactive_days, 0))
      )
      and (
        p_registered_min_days is null
        or w.created_at <= now() - make_interval(days => greatest(p_registered_min_days, 0))
      )
  )
  select *
  from target_rows tr
  where not (coalesce(p_exclude_existing, true) and p_template_id is not null and tr.already_has_coupon)
  order by tr.tier desc, tr.lifetime_spent desc, tr.lifetime_orders desc, tr.registered_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_issue_coupon_to_selected_customers(
  p_store_id text,
  p_template_id uuid,
  p_customer_user_ids uuid[],
  p_exclude_existing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  t public.store_coupon_templates%rowtype;
  v_requested integer := 0;
  v_valid integer := 0;
  v_skipped_existing integer := 0;
  v_issued integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = v_uid
  ) then
    raise exception 'Store member permission required';
  end if;

  select * into t
  from public.store_coupon_templates
  where id = p_template_id
    and store_id = p_store_id
    and is_active = true;

  if not found then
    raise exception 'Active coupon template not found for store';
  end if;

  with input_ids as (
    select distinct unnest(coalesce(p_customer_user_ids, array[]::uuid[])) as customer_user_id
  )
  select count(*) into v_requested from input_ids;

  with input_ids as (
    select distinct unnest(coalesce(p_customer_user_ids, array[]::uuid[])) as customer_user_id
  ), valid_ids as (
    select i.customer_user_id
    from input_ids i
    join public.customer_store_wallets w
      on w.customer_user_id = i.customer_user_id
     and w.store_id = p_store_id
  )
  select count(*) into v_valid from valid_ids;

  with input_ids as (
    select distinct unnest(coalesce(p_customer_user_ids, array[]::uuid[])) as customer_user_id
  ), valid_ids as (
    select i.customer_user_id
    from input_ids i
    join public.customer_store_wallets w
      on w.customer_user_id = i.customer_user_id
     and w.store_id = p_store_id
  )
  select count(*) into v_skipped_existing
  from valid_ids v
  where coalesce(p_exclude_existing, true)
    and exists (
      select 1
      from public.customer_coupons cc
      where cc.store_id = p_store_id
        and cc.customer_user_id = v.customer_user_id
        and cc.template_id = p_template_id
        and cc.status <> 'cancelled'
    );

  insert into public.customer_coupons (
    customer_user_id,
    store_id,
    template_id,
    coupon_name_snapshot,
    discount_type_snapshot,
    discount_value_snapshot,
    min_order_amount_snapshot,
    max_discount_amount_snapshot,
    status,
    expires_at
  )
  select
    v.customer_user_id,
    p_store_id,
    p_template_id,
    t.name,
    t.discount_type,
    t.discount_value,
    t.min_order_amount,
    t.max_discount_amount,
    'issued',
    now() + make_interval(days => t.valid_days)
  from (
    select distinct unnest(coalesce(p_customer_user_ids, array[]::uuid[])) as customer_user_id
  ) i
  join public.customer_store_wallets v
    on v.customer_user_id = i.customer_user_id
   and v.store_id = p_store_id
  where not (
    coalesce(p_exclude_existing, true)
    and exists (
      select 1
      from public.customer_coupons cc
      where cc.store_id = p_store_id
        and cc.customer_user_id = v.customer_user_id
        and cc.template_id = p_template_id
        and cc.status <> 'cancelled'
    )
  );

  get diagnostics v_issued = row_count;

  return jsonb_build_object(
    'requested_count', v_requested,
    'valid_count', v_valid,
    'issued_count', v_issued,
    'skipped_existing_count', v_skipped_existing,
    'invalid_customer_count', greatest(v_requested - v_valid, 0)
  );
end;
$$;

grant execute on function public.admin_search_coupon_targets(text, text, text, integer, integer, integer, integer, integer, integer, uuid, boolean, integer) to authenticated;
grant execute on function public.admin_issue_coupon_to_selected_customers(text, uuid, uuid[], boolean) to authenticated;
