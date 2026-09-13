-- Safety net for every order-creation path. Explicit settlement values win;
-- only a missing value is initialized from the validated order total.

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
  return new;
end;
$$;

revoke all privileges on function public.default_order_adjusted_total()
from public, anon, authenticated;
grant execute on function public.default_order_adjusted_total()
to service_role;

drop trigger if exists default_order_adjusted_total_before_insert on public.orders;
create trigger default_order_adjusted_total_before_insert
before insert on public.orders
for each row
execute function public.default_order_adjusted_total();
