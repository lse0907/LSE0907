-- =========================================================
-- 리온오더 Billing v2.3 구독 취소 상태 제약조건 복구 전체 SQL
-- 선행: supabase-billing-live-v2.sql ~ v2-2.sql
-- 실행: Supabase Dashboard > SQL Editor에서 이 파일 전체 실행
-- =========================================================
begin;

-- 과거 버전에서 이름이 다르게 남은 status 체크 제약조건까지 모두 정리합니다.
do $$
declare v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid='public.billing_payments'::regclass
      and c.contype='c'
      and pg_get_constraintdef(c.oid) ~* '(^|[^a-z_])status([^a-z_]|$)'
  loop
    execute format('alter table public.billing_payments drop constraint %I',v_constraint.conname);
  end loop;
end $$;

alter table public.billing_payments
  add constraint billing_payments_status_check
  check (status in ('paid','canceling','failed','canceled','cancelled','refunded'))
  not valid;
alter table public.billing_payments validate constraint billing_payments_status_check;

-- 취소 예약 RPC도 현재 테이블 구조 기준으로 다시 고정합니다.
create or replace function public.claim_store_billing_refund(p_payment_id bigint,p_store_id text)
returns public.billing_payments language plpgsql security definer set search_path=public
as $$
declare v public.billing_payments; v_until timestamptz;
begin
  select * into v from public.billing_payments where id=p_payment_id and store_id=p_store_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v.status<>'paid' then raise exception 'PAYMENT_NOT_CANCELABLE'; end if;
  if v.base_paid then
    select paid_until into v_until from public.store_billing where store_id=p_store_id for update;
    if v_until is distinct from v.after_paid_until then raise exception 'SUBSCRIPTION_CHANGED_AFTER_PAYMENT'; end if;
  end if;
  if v.addon_paid then
    select addon_paid_until into v_until from public.store_addons where store_id=p_store_id for update;
    if v_until is distinct from coalesce(v.after_addon_paid_until,v.after_paid_until) then raise exception 'SUBSCRIPTION_CHANGED_AFTER_PAYMENT'; end if;
  end if;
  update public.billing_payments set status='canceling',updated_at=now()
    where id=p_payment_id and store_id=p_store_id and status='paid' returning * into v;
  if not found then raise exception 'PAYMENT_CLAIM_RACE'; end if;
  return v;
end $$;

revoke all on function public.claim_store_billing_refund(bigint,text) from public,anon,authenticated;
grant execute on function public.claim_store_billing_refund(bigint,text) to service_role;

commit;
select pg_notify('pgrst','reload schema');

-- 정상 확인: 정의에 canceling이 반드시 포함되어야 합니다.
select c.conname,pg_get_constraintdef(c.oid) constraint_definition
from pg_constraint c
where c.conrelid='public.billing_payments'::regclass and c.contype='c'
order by c.conname;
