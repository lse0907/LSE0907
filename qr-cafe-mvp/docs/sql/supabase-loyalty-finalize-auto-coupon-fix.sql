-- Fix finalize_order_rewards so completed orders still check automatic coupon rewards
-- even when checkout already applied point/coupon loyalty before staff completion.
-- Run this whole file in Supabase SQL editor.

create or replace function public.finalize_order_rewards(
  p_store_id text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  v_loyalty_already_applied := coalesce(v_order.earned_points, 0) > 0 or v_order.loyalty_snapshot is not null;

  -- Older checkout flows may apply point/coupon loyalty before staff completion.
  -- Do not apply points twice, but still continue below so first-order/thank-you coupons can be issued on completion.
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
  from public.store_loyalty_settings
  where store_id = p_store_id;
  v_thank_every := greatest(1, coalesce(v_settings.thank_you_every_n_orders, 10));

  select count(*)::integer into v_completed_count
  from public.orders o
  where o.store_id = p_store_id
    and o.customer_user_id = v_order.customer_user_id
    and o.status = 'completed'
    and o.payment_status in ('paid', 'not_required');

  if v_completed_count = 1 then
    select t.id into v_first_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'first_order'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_first_tpl_id is not null then
      if not exists (
        select 1 from public.coupon_auto_issue_logs l
        where l.store_id = p_store_id
          and l.customer_user_id = v_order.customer_user_id
          and l.coupon_kind = 'first_order'
          and l.milestone = 1
      ) then
        v_new_coupon_id := public.issue_customer_coupon(p_store_id, v_order.customer_user_id, v_first_tpl_id);
        insert into public.coupon_auto_issue_logs(store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id)
        values (p_store_id, v_order.customer_user_id, v_order.id, 'first_order', 1, v_new_coupon_id)
        on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
      end if;
    end if;
  end if;

  if v_completed_count >= v_thank_every and mod(v_completed_count, v_thank_every) = 0 then
    select t.id into v_thank_tpl_id
    from public.store_coupon_templates t
    where t.store_id = p_store_id
      and t.coupon_kind = 'thank_you'
      and t.is_active = true
    order by t.created_at desc
    limit 1;

    if v_thank_tpl_id is not null then
      if not exists (
        select 1 from public.coupon_auto_issue_logs l
        where l.store_id = p_store_id
          and l.customer_user_id = v_order.customer_user_id
          and l.coupon_kind = 'thank_you'
          and l.milestone = (v_completed_count / v_thank_every)
      ) then
        v_new_coupon_id := public.issue_customer_coupon(p_store_id, v_order.customer_user_id, v_thank_tpl_id);
        insert into public.coupon_auto_issue_logs(store_id, customer_user_id, order_id, coupon_kind, milestone, coupon_id)
        values (p_store_id, v_order.customer_user_id, v_order.id, 'thank_you', (v_completed_count / v_thank_every), v_new_coupon_id)
        on conflict (store_id, customer_user_id, coupon_kind, milestone) do nothing;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'finalized', not v_loyalty_already_applied,
    'loyalty_already_applied', v_loyalty_already_applied,
    'auto_coupon_checked', true,
    'completed_orders', v_completed_count
  );
end;
$$;

grant execute on function public.finalize_order_rewards(text, uuid) to authenticated;
