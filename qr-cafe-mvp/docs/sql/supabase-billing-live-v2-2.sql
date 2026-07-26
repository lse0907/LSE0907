-- =========================================================
-- 리온오더 Billing v2.2 환불 안정화 전체 SQL
-- 선행: supabase-billing-live-v2.sql, supabase-billing-live-v2-1.sql
-- 실행: Supabase Dashboard > SQL Editor에서 이 파일 전체 실행
-- =========================================================
begin;

alter table public.billing_payments add column if not exists canceled_at timestamptz;
alter table public.billing_payments add column if not exists cancel_reason text;

create table if not exists public.billing_refund_attempts (
  id bigint generated always as identity primary key,
  billing_payment_id bigint not null references public.billing_payments(id) on delete cascade,
  store_id text not null references public.stores(store_id) on delete cascade,
  requested_by uuid,
  amount_krw integer not null check (amount_krw >= 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','processing','completed','failed','reconcile_required')),
  public_error_code text,
  internal_error text,
  pg_status text,
  pg_cancel_transaction_key text,
  requested_at timestamptz not null default now(),
  pg_responded_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_billing_refunds_store_requested on public.billing_refund_attempts(store_id, requested_at desc);
create index if not exists idx_billing_refunds_status_updated on public.billing_refund_attempts(status, updated_at desc);
create unique index if not exists uq_billing_refunds_open_payment on public.billing_refund_attempts(billing_payment_id)
  where status in ('requested','processing','reconcile_required');

-- 업데이트 전에 이미 canceling에 멈춘 결제는 임의로 환불 완료 처리하지 않고 OPS 확인 목록에 올립니다.
insert into public.billing_refund_attempts(
  billing_payment_id,store_id,requested_by,amount_krw,reason,status,public_error_code,internal_error,requested_at
)
select bp.id,bp.store_id,bp.payer_user_id,greatest(0,coalesce(bp.amount_krw,0)),'기존 취소 처리 중 결제 점검',
  'reconcile_required','LEGACY_CANCELING_REQUIRES_CHECK','Billing v2.2 적용 전에 canceling 상태로 남은 결제',coalesce(bp.updated_at,bp.paid_at,now())
from public.billing_payments bp
where bp.status='canceling'
on conflict do nothing;

-- 모든 환경에서 취소 실패 후 paid 상태 복구 RPC가 존재하도록 다시 정의합니다.
create or replace function public.release_store_billing_refund(p_payment_id bigint,p_store_id text)
returns public.billing_payments language plpgsql security definer set search_path=public
as $$
declare v public.billing_payments;
begin
  update public.billing_payments set status='paid',updated_at=now()
  where id=p_payment_id and store_id=p_store_id and status='canceling' returning * into v;
  return v;
end; $$;

-- PG 취소 완료 후 구독과 결제 상태를 한 트랜잭션에서 복원합니다.
create or replace function public.finalize_store_billing_refund(p_payment_id bigint,p_store_id text,p_cancel_reason text)
returns public.billing_payments language plpgsql security definer set search_path=public
as $$
declare v public.billing_payments; n integer;
begin
  select * into v from public.billing_payments where id=p_payment_id and store_id=p_store_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v.status='refunded' then return v; end if;
  if v.status<>'canceling' then raise exception 'REFUND_NOT_CLAIMED'; end if;
  if v.base_paid then
    update public.store_billing set paid_until=v.before_paid_until,
      base_plan_status=case when v.before_paid_until>now() then 'active' else 'inactive' end,updated_at=now()
      where store_id=p_store_id and paid_until=v.after_paid_until;
    get diagnostics n=row_count; if n<>1 then raise exception 'BASE_SUBSCRIPTION_ROLLBACK_FAILED'; end if;
  end if;
  if v.addon_paid then
    update public.store_addons set addon_paid_until=coalesce(v.before_addon_paid_until,v.before_paid_until),
      prepay_addon_status=case when coalesce(v.before_addon_paid_until,v.before_paid_until)>now() then 'active' else 'inactive' end,updated_at=now()
      where store_id=p_store_id and addon_paid_until=coalesce(v.after_addon_paid_until,v.after_paid_until);
    get diagnostics n=row_count; if n<>1 then raise exception 'ADDON_SUBSCRIPTION_ROLLBACK_FAILED'; end if;
  end if;
  update public.billing_payments set status='refunded',canceled_at=now(),cancel_reason=left(trim(coalesce(p_cancel_reason,'사유 미입력')),120),
    note=trim(concat_ws(' ',nullif(trim(coalesce(note,'')),''),'[결제취소] '||left(trim(coalesce(p_cancel_reason,'사유 미입력')),120))),updated_at=now()
    where id=p_payment_id and status='canceling' returning * into v;
  return v;
end; $$;

alter table public.billing_refund_attempts enable row level security;
revoke all on public.billing_refund_attempts from anon,authenticated;
revoke all on function public.release_store_billing_refund(bigint,text) from public,anon,authenticated;
revoke all on function public.finalize_store_billing_refund(bigint,text,text) from public,anon,authenticated;
grant execute on function public.release_store_billing_refund(bigint,text) to service_role;
grant execute on function public.finalize_store_billing_refund(bigint,text,text) to service_role;

commit;

-- 확인 쿼리
-- select id,billing_payment_id,store_id,status,public_error_code,requested_at,completed_at from public.billing_refund_attempts order by id desc;
-- select id,store_id,status,paid_at,canceled_at,cancel_reason from public.billing_payments order by id desc;
