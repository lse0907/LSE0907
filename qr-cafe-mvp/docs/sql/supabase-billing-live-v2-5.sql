-- =========================================================
-- 리온오더 Billing v2.5 OPS Toss 상태 확인 기록 전체 SQL
-- 선행: supabase-billing-live-v2.sql ~ v2-4.sql
-- 실행: Supabase Dashboard > SQL Editor에서 이 파일 전체 실행
-- =========================================================
begin;

alter table public.billing_refund_cases add column if not exists toss_checked_at timestamptz;
alter table public.billing_refund_cases add column if not exists toss_checked_by uuid;
alter table public.billing_refund_cases add column if not exists local_payment_status_snapshot text;
create index if not exists idx_billing_refund_cases_toss_checked
  on public.billing_refund_cases(toss_checked_at desc) where toss_checked_at is not null;

commit;
select pg_notify('pgrst','reload schema');

select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='billing_refund_cases'
  and column_name in ('toss_status','toss_checked_at','toss_checked_by','local_payment_status_snapshot')
order by column_name;
