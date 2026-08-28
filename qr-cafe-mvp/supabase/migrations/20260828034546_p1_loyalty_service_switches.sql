begin;

alter table public.store_loyalty_settings
  add column if not exists points_enabled boolean not null default true,
  add column if not exists coupons_enabled boolean not null default true;

comment on column public.store_loyalty_settings.points_enabled is
  'Controls new point accrual only. Existing points remain redeemable until expiry.';
comment on column public.store_loyalty_settings.coupons_enabled is
  'Controls new coupon issuance only. Existing issued coupons remain redeemable until expiry.';

create or replace function public.get_store_point_rate_pct(
  p_store_id text,
  p_tier text
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.store_loyalty_settings%rowtype;
begin
  select * into v
  from public.store_loyalty_settings
  where store_id = p_store_id;

  if not found then
    if p_tier = 'vip' then return 5.00; end if;
    if p_tier = 'regular' then return 3.00; end if;
    return 2.00;
  end if;

  if not coalesce(v.points_enabled, true) then
    return 0.00;
  end if;
  if p_tier = 'vip' then return v.tier_vip_rate_pct; end if;
  if p_tier = 'regular' then return v.tier_regular_rate_pct; end if;
  return v.tier_general_rate_pct;
end;
$$;

create or replace function public.issue_customer_coupon(
  p_store_id text,
  p_customer_user_id uuid,
  p_template_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.store_coupon_templates%rowtype;
  v_new_id uuid;
begin
  if not coalesce((
    select s.coupons_enabled
    from public.store_loyalty_settings s
    where s.store_id = p_store_id
  ), true) then
    raise exception 'COUPON_ISSUANCE_DISABLED';
  end if;

  select * into t
  from public.store_coupon_templates
  where id = p_template_id
    and store_id = p_store_id
    and is_active = true;

  if not found then
    raise exception 'Active coupon template not found for store';
  end if;

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
  ) values (
    p_customer_user_id,
    p_store_id,
    p_template_id,
    t.name,
    t.discount_type,
    t.discount_value,
    t.min_order_amount,
    t.max_discount_amount,
    'issued',
    now() + make_interval(days => t.valid_days)
  )
  returning id into v_new_id;

  return v_new_id;
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
set search_path = ''
as $$
declare
  t public.store_coupon_templates%rowtype;
  v_requested integer := 0;
  v_valid integer := 0;
  v_skipped_existing integer := 0;
  v_issued integer := 0;
begin
  -- Browser roles cannot execute this function. The Owner check is performed
  -- by the server route before its service-role client invokes this RPC.
  if not coalesce((
    select s.coupons_enabled
    from public.store_loyalty_settings s
    where s.store_id = p_store_id
  ), true) then
    raise exception 'COUPON_ISSUANCE_DISABLED';
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

create or replace function public.finalize_order_rewards(
  p_store_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_settings public.store_loyalty_settings%rowtype;
  v_completed_count integer := 0;
  v_first_tpl_id uuid;
  v_thank_tpl_id uuid;
  v_new_coupon_id uuid;
  v_thank_every integer := 10;
  v_loyalty_already_applied boolean := false;
  v_coupons_enabled boolean := true;
begin
  select * into v_order
  from public.orders o
  where o.store_id = p_store_id
    and o.id = p_order_id
  for update;

  if not found then
    raise exception 'order not found';
  end if;

  if v_order.customer_user_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest_order');
  end if;

  if v_order.status <> 'completed' then
    return jsonb_build_object('ok', true, 'skipped', 'order_not_completed');
  end if;

  v_loyalty_already_applied := coalesce(v_order.earned_points, 0) > 0
    or v_order.loyalty_snapshot is not null;

  if not v_loyalty_already_applied then
    perform public.apply_loyalty_on_paid_order(
      v_order.id,
      p_store_id,
      v_order.customer_user_id,
      coalesce(v_order.total_price, 0),
      coalesce(v_order.used_points, 0),
      v_order.used_coupon_id,
      v_order.id::text || ':loyalty'
    );
  end if;

  perform public.recalculate_customer_tier(p_store_id, v_order.customer_user_id);

  select * into v_settings
  from public.store_loyalty_settings s
  where s.store_id = p_store_id;
  v_thank_every := greatest(1, coalesce(v_settings.thank_you_every_n_orders, 10));
  v_coupons_enabled := coalesce(v_settings.coupons_enabled, true);

  select count(*)::integer into v_completed_count
  from public.orders o
  where o.store_id = p_store_id
    and o.customer_user_id = v_order.customer_user_id
    and o.status = 'completed'
    and o.payment_status in ('paid', 'not_required');

  if v_coupons_enabled and v_completed_count = 1 then
    select t.id into v_first_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'first_order'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_first_tpl_id is not null and not exists (
      select 1 from public.coupon_auto_issue_logs l
      where l.store_id = p_store_id
        and l.customer_user_id = v_order.customer_user_id
        and l.coupon_kind = 'first_order'
        and l.milestone = 1
    ) then
      v_new_coupon_id := public.issue_customer_coupon(
        p_store_id,
        v_order.customer_user_id,
        v_first_tpl_id
      );
      insert into public.coupon_auto_issue_logs(
        store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id
      ) values (
        p_store_id, v_order.customer_user_id, v_order.id,
        'first_order', 1, v_new_coupon_id
      )
      on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
    end if;
  end if;

  if v_coupons_enabled
    and v_completed_count >= v_thank_every
    and mod(v_completed_count, v_thank_every) = 0 then
    select t.id into v_thank_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'thank_you'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_thank_tpl_id is not null and not exists (
      select 1 from public.coupon_auto_issue_logs l
      where l.store_id = p_store_id
        and l.customer_user_id = v_order.customer_user_id
        and l.coupon_kind = 'thank_you'
        and l.milestone = (v_completed_count / v_thank_every)
    ) then
      v_new_coupon_id := public.issue_customer_coupon(
        p_store_id,
        v_order.customer_user_id,
        v_thank_tpl_id
      );
      insert into public.coupon_auto_issue_logs(
        store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id
      ) values (
        p_store_id, v_order.customer_user_id, v_order.id,
        'thank_you', (v_completed_count / v_thank_every), v_new_coupon_id
      )
      on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'finalized', not v_loyalty_already_applied,
    'loyalty_already_applied', v_loyalty_already_applied,
    'auto_coupon_checked', v_coupons_enabled,
    'auto_coupon_skipped', case when v_coupons_enabled then null else 'coupons_disabled' end,
    'completed_orders', v_completed_count
  );
end;
$$;

revoke all privileges on function public.issue_customer_coupon(text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.issue_customer_coupon(text, uuid, uuid)
to service_role;

revoke all privileges on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) from public, anon, authenticated;
grant execute on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) to service_role;

revoke all privileges on function public.finalize_order_rewards(text, uuid)
from public, anon, authenticated;
grant execute on function public.finalize_order_rewards(text, uuid)
to service_role;

commit;
