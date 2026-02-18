-- 주문 옵션 수량 저장을 위한 컬럼 추가
-- 안전하게 여러 번 실행 가능하도록 작성

alter table public.order_item_options
  add column if not exists qty integer;

update public.order_item_options
set qty = 1
where qty is null or qty < 1;

alter table public.order_item_options
  alter column qty set default 1;

alter table public.order_item_options
  alter column qty set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_item_options_qty_positive'
      and conrelid = 'public.order_item_options'::regclass
  ) then
    alter table public.order_item_options
      add constraint order_item_options_qty_positive check (qty > 0);
  end if;
end$$;
