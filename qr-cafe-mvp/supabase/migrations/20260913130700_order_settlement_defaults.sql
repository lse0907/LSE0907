-- Every order-creation path must satisfy the immutable settlement projection.
-- The values are initialized before INSERT so a failed or retried paid-order
-- finalizer can never be blocked by a later NOT NULL column addition.
begin;

create or replace function public.default_order_adjusted_total()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.adjusted_total_price is null then
    new.adjusted_total_price := new.total_price;
  end if;

  if new.effective_used_points is null then
    new.effective_used_points := coalesce(new.used_points, 0);
  end if;

  if new.effective_coupon_discount is null then
    new.effective_coupon_discount := 0;
  end if;

  if new.effective_earned_points is null then
    new.effective_earned_points := coalesce(new.earned_points, 0);
  end if;

  return new;
end;
$$;

revoke all privileges on function public.default_order_adjusted_total()
from public, anon, authenticated;
grant execute on function public.default_order_adjusted_total()
to service_role;

-- Loyalty settlement happens after the row exists. Synchronize the immutable
-- projection at that point without touching partial-refund adjustments, which
-- update only the effective columns and therefore do not invoke this trigger.
create or replace function public.sync_order_effective_settlement_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.effective_used_points := coalesce(new.used_points, 0);
  new.effective_earned_points := coalesce(new.earned_points, 0);
  new.effective_coupon_discount := case
    when new.loyalty_snapshot is null then coalesce(new.effective_coupon_discount, 0)
    else coalesce(nullif(new.loyalty_snapshot ->> 'coupon_discount', '')::integer, 0)
  end;
  return new;
end;
$$;

revoke all privileges on function public.sync_order_effective_settlement_fields()
from public, anon, authenticated;
grant execute on function public.sync_order_effective_settlement_fields()
to service_role;

drop trigger if exists sync_order_effective_settlement_fields_before_update
on public.orders;
create trigger sync_order_effective_settlement_fields_before_update
before update of used_points, earned_points, loyalty_snapshot on public.orders
for each row
execute function public.sync_order_effective_settlement_fields();

commit;
