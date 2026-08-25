-- Resolve PL/pgSQL output-column ambiguity in the daily counter upsert.
-- The named primary-key constraint is unambiguous inside a RETURNS TABLE function.

create or replace function public.finalize_order_checkout_attempt(p_attempt_id uuid)
returns table (
  order_id uuid,
  access_token text,
  order_date text,
  display_no text,
  total_count integer,
  total_price integer,
  payable_amount integer,
  payment_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.order_checkout_attempts%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_access_token text := gen_random_uuid()::text;
  v_order_date text := (timezone('Asia/Seoul', now()))::date::text;
  v_display_no text;
  v_next_no integer;
  v_payment_status text;
  v_line jsonb;
  v_group jsonb;
  v_option jsonb;
  v_order_item_id uuid;
begin
  select * into v_attempt
  from public.order_checkout_attempts a
  where a.id = p_attempt_id
  for update;

  if not found then
    raise exception 'CHECKOUT_ATTEMPT_NOT_FOUND';
  end if;

  if v_attempt.status = 'completed' and v_attempt.order_id is not null then
    return query
    select
      o.id,
      o.access_token,
      o.order_date,
      o.display_no,
      o.total_count,
      o.total_price,
      v_attempt.payable_amount,
      o.payment_status
    from public.orders o
    where o.id = v_attempt.order_id;
    return;
  end if;

  if v_attempt.expires_at <= now() and v_attempt.status = 'quoted' then
    update public.order_checkout_attempts
    set status = 'expired', failure_code = 'CHECKOUT_ATTEMPT_EXPIRED'
    where id = v_attempt.id;
    raise exception 'CHECKOUT_ATTEMPT_EXPIRED';
  end if;

  if v_attempt.checkout_type = 'prepaid' then
    if v_attempt.status <> 'approved_not_applied'
      or v_attempt.pg_status <> 'DONE'
      or v_attempt.payment_key is null
      or v_attempt.toss_order_id is null
      or v_attempt.pg_approved_at is null then
      raise exception 'PAYMENT_ATTEMPT_NOT_APPROVED';
    end if;
    v_payment_status := 'paid';
  else
    if v_attempt.status <> 'quoted' then
      raise exception 'POSTPAID_ATTEMPT_NOT_READY';
    end if;
    v_payment_status := 'not_required';
  end if;

  insert into public.store_daily_order_counters(store_id, order_date, last_no)
  values (v_attempt.store_id, v_order_date, 1)
  on conflict on constraint store_daily_order_counters_pkey do update
  set last_no = public.store_daily_order_counters.last_no + 1,
      updated_at = now()
  returning last_no into v_next_no;

  if v_next_no > 9999 then
    raise exception 'DAILY_ORDER_NUMBER_EXHAUSTED';
  end if;
  v_display_no := lpad(v_next_no::text, 4, '0');

  insert into public.orders (
    id,
    access_token,
    created_at,
    order_date,
    display_no,
    mode,
    table_no,
    request_note,
    total_count,
    total_price,
    status,
    payment_status,
    payment_key,
    toss_order_id,
    customer_user_id,
    used_points,
    used_coupon_id,
    applied_discount_type,
    store_id,
    client_request_id,
    checkout_attempt_id
  ) values (
    v_order_id,
    v_access_token,
    now(),
    v_order_date,
    v_display_no,
    v_attempt.mode,
    case when v_attempt.mode = 'dine-in' then nullif(btrim(v_attempt.table_no), '') else null end,
    v_attempt.request_note,
    v_attempt.total_count,
    v_attempt.total_price,
    'new',
    v_payment_status,
    case when v_attempt.checkout_type = 'prepaid' then v_attempt.payment_key else null end,
    case when v_attempt.checkout_type = 'prepaid' then v_attempt.toss_order_id else null end,
    v_attempt.customer_user_id,
    v_attempt.used_points,
    v_attempt.used_coupon_id,
    case
      when v_attempt.used_points > 0 then 'point'
      when v_attempt.used_coupon_id is not null then 'coupon'
      else null
    end,
    v_attempt.store_id,
    v_attempt.client_request_id,
    v_attempt.id
  );

  for v_line in
    select value from jsonb_array_elements(v_attempt.cart_snapshot)
  loop
    v_order_item_id := gen_random_uuid();
    insert into public.order_items (
      id, order_id, menu_id, name, price, qty, store_id
    ) values (
      v_order_item_id,
      v_order_id,
      v_line->>'menuId',
      v_line->>'name',
      (v_line->>'basePrice')::integer,
      (v_line->>'qty')::integer,
      v_attempt.store_id
    );

    for v_group in
      select value from jsonb_array_elements(coalesce(v_line->'options', '[]'::jsonb))
    loop
      for v_option in
        select value from jsonb_array_elements(coalesce(v_group->'items', '[]'::jsonb))
      loop
        insert into public.order_item_options (
          id, order_item_id, group_id, option_id, name, price_delta, qty, store_id
        ) values (
          gen_random_uuid(),
          v_order_item_id,
          v_group->>'groupId',
          v_option->>'id',
          v_option->>'name',
          (v_option->>'priceDelta')::integer,
          (v_option->>'qty')::integer,
          v_attempt.store_id
        );
      end loop;
    end loop;
  end loop;

  if v_attempt.customer_user_id is not null then
    perform public.apply_loyalty_on_paid_order(
      v_order_id,
      v_attempt.store_id,
      v_attempt.customer_user_id,
      v_attempt.total_price,
      v_attempt.used_points,
      v_attempt.used_coupon_id,
      v_order_id::text || ':loyalty'
    );
  end if;

  update public.order_checkout_attempts
  set order_id = v_order_id,
      status = 'completed',
      failure_code = null,
      failure_detail = null
  where id = v_attempt.id;

  return query
  select
    o.id,
    o.access_token,
    o.order_date,
    o.display_no,
    o.total_count,
    o.total_price,
    v_attempt.payable_amount,
    o.payment_status
  from public.orders o
  where o.id = v_order_id;
end;
$$;

revoke all privileges on function public.finalize_order_checkout_attempt(uuid)
from public, anon, authenticated;
grant execute on function public.finalize_order_checkout_attempt(uuid)
to service_role;
