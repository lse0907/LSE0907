-- Add an admin RPC to cancel an unused issued customer coupon.
-- Run this whole file in Supabase SQL editor.

-- ---------------------------------------------------------
-- 9-1) RPC: cancel an unused issued coupon as store member
-- ---------------------------------------------------------
create or replace function public.admin_cancel_customer_coupon(
  p_store_id text,
  p_coupon_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.customer_coupons%rowtype;
begin
  if auth.uid() is null then
    raise exception 'login required';
  end if;

  if not exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
  ) then
    raise exception 'store member permission required';
  end if;

  select * into v_coupon
  from public.customer_coupons c
  where c.id = p_coupon_id
    and c.store_id = p_store_id
  for update;

  if not found then
    raise exception 'coupon not found';
  end if;

  if v_coupon.status <> 'issued'
     or v_coupon.used_at is not null
     or v_coupon.used_order_id is not null then
    raise exception 'only unused issued coupons can be cancelled';
  end if;

  update public.customer_coupons c
  set status = 'cancelled',
      updated_at = now()
  where c.id = p_coupon_id
    and c.store_id = p_store_id;

  return jsonb_build_object(
    'ok', true,
    'cancelled', true,
    'coupon_id', p_coupon_id
  );
end;
$$;

grant execute on function public.admin_cancel_customer_coupon(text, uuid) to authenticated;
