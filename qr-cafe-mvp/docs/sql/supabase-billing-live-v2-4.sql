-- =========================================================
-- 리온오더 Billing v2.4 기간 경과 환불 요청·운영 처리 기반 전체 SQL
-- 선행: supabase-billing-live-v2.sql ~ v2-3.sql
-- 실행: Supabase Dashboard > SQL Editor에서 이 파일 전체 실행
-- =========================================================
begin;

alter table public.support_tickets
  add column if not exists billing_payment_id bigint references public.billing_payments(id) on delete set null;

create table if not exists public.billing_refund_cases(
  id bigint generated always as identity primary key,
  billing_payment_id bigint not null references public.billing_payments(id) on delete restrict,
  store_id text not null references public.stores(store_id) on delete cascade,
  support_ticket_id bigint references public.support_tickets(id) on delete set null,
  requested_by uuid not null,
  reason text not null,
  status text not null default 'requested' check(status in ('requested','reviewing','approved','rejected','processing','completed','reconcile_required')),
  toss_status text,
  ops_note text,
  handled_by uuid,
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_billing_refund_cases_open_payment
  on public.billing_refund_cases(billing_payment_id)
  where status in ('requested','reviewing','approved','processing','reconcile_required');
create index if not exists idx_billing_refund_cases_status_requested
  on public.billing_refund_cases(status,requested_at desc);
create index if not exists idx_support_tickets_billing_payment
  on public.support_tickets(billing_payment_id) where billing_payment_id is not null;

-- 구독 기간 증감은 결제 원본을 덮어쓰지 않고 별도 원장으로 남깁니다.
create table if not exists public.billing_entitlement_adjustments(
  id bigint generated always as identity primary key,
  store_id text not null references public.stores(store_id) on delete cascade,
  billing_payment_id bigint references public.billing_payments(id) on delete set null,
  refund_case_id bigint references public.billing_refund_cases(id) on delete set null,
  adjustment_kind text not null check(adjustment_kind in ('base','addon')),
  seconds_delta bigint not null,
  before_paid_until timestamptz,
  after_paid_until timestamptz,
  actor_user_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Toss에서 취소 완료가 검증된 오래된 결제의 기간만 현재 만료일에서 차감합니다.
create or replace function public.sync_verified_historical_billing_refund(
  p_payment_id bigint,p_store_id text,p_actor_user_id uuid,p_reason text
) returns public.billing_payments language plpgsql security definer set search_path=public
as $$
declare v public.billing_payments; v_before timestamptz; v_after timestamptz; v_seconds bigint;
begin
  select * into v from public.billing_payments where id=p_payment_id and store_id=p_store_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v.status='refunded' then return v; end if;
  if v.status not in ('paid','canceling') then raise exception 'PAYMENT_NOT_SYNCABLE'; end if;
  if v.base_paid then
    v_seconds:=greatest(0,extract(epoch from (v.after_paid_until-greatest(coalesce(v.before_paid_until,v.paid_at),v.paid_at)))::bigint);
    select paid_until into v_before from public.store_billing where store_id=p_store_id for update;
    v_after:=case when v_before is null then null else v_before-make_interval(secs=>v_seconds) end;
    update public.store_billing set paid_until=v_after,base_plan_status=case when v_after>now() then 'active' else 'inactive' end,updated_at=now() where store_id=p_store_id;
    insert into public.billing_entitlement_adjustments(store_id,billing_payment_id,adjustment_kind,seconds_delta,before_paid_until,after_paid_until,actor_user_id,reason)
      values(p_store_id,p_payment_id,'base',-v_seconds,v_before,v_after,p_actor_user_id,p_reason);
  end if;
  if v.addon_paid then
    v_seconds:=greatest(0,extract(epoch from (coalesce(v.after_addon_paid_until,v.after_paid_until)-greatest(coalesce(v.before_addon_paid_until,v.before_paid_until,v.paid_at),v.paid_at)))::bigint);
    select addon_paid_until into v_before from public.store_addons where store_id=p_store_id for update;
    v_after:=case when v_before is null then null else v_before-make_interval(secs=>v_seconds) end;
    update public.store_addons set addon_paid_until=v_after,prepay_addon_status=case when v_after>now() then 'active' else 'inactive' end,updated_at=now() where store_id=p_store_id;
    insert into public.billing_entitlement_adjustments(store_id,billing_payment_id,adjustment_kind,seconds_delta,before_paid_until,after_paid_until,actor_user_id,reason)
      values(p_store_id,p_payment_id,'addon',-v_seconds,v_before,v_after,p_actor_user_id,p_reason);
  end if;
  update public.billing_payments set status='refunded',canceled_at=coalesce(canceled_at,now()),cancel_reason=left(p_reason,120),updated_at=now() where id=p_payment_id returning * into v;
  return v;
end $$;

alter table public.billing_refund_cases enable row level security;
alter table public.billing_entitlement_adjustments enable row level security;
revoke all on public.billing_refund_cases from anon,authenticated;
revoke all on public.billing_entitlement_adjustments from anon,authenticated;
revoke all on function public.sync_verified_historical_billing_refund(bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.sync_verified_historical_billing_refund(bigint,text,uuid,text) to service_role;

commit;
select pg_notify('pgrst','reload schema');

-- 확인 쿼리
select to_regclass('public.billing_refund_cases') refund_cases,
  to_regclass('public.billing_entitlement_adjustments') entitlement_adjustments;
