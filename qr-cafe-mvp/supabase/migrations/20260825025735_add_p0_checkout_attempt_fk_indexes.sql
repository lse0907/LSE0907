-- Cover nullable foreign keys used by customer and coupon recovery queries.
create index if not exists idx_order_checkout_attempts_customer_user
  on public.order_checkout_attempts(customer_user_id)
  where customer_user_id is not null;

create index if not exists idx_order_checkout_attempts_used_coupon
  on public.order_checkout_attempts(used_coupon_id)
  where used_coupon_id is not null;
