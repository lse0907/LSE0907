-- =========================================================
-- 리온오더 라이브 구독 결제 v2 전체 업데이트 SQL
-- 실행 위치: Supabase Dashboard > SQL Editor
-- 이 파일 전체를 한 번에 실행하세요.
-- =========================================================

begin;

-- 1) OPS 권한은 서버가 관리하는 app_metadata만 신뢰합니다.
create or replace function public.is_ops_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'ops', false);
$$;

-- 2) 정상 가격과 할인 정책. 소비자 표시 가격은 부가세 포함입니다.
create table if not exists public.billing_price_policies (
  id integer primary key default 1 check (id = 1),
  base_monthly_krw integer not null default 14900 check (base_monthly_krw >= 0),
  addon_monthly_krw integer not null default 5000 check (addon_monthly_krw >= 0),
  three_month_discount_bps integer not null default 500 check (three_month_discount_bps between 0 and 10000),
  six_month_discount_bps integer not null default 1000 check (six_month_discount_bps between 0 and 10000),
  twelve_month_discount_bps integer not null default 1500 check (twelve_month_discount_bps between 0 and 10000),
  founder_discount_bps integer not null default 4000 check (founder_discount_bps between 0 and 10000),
  multi_store_discount_bps integer not null default 1500 check (multi_store_discount_bps between 0 and 10000),
  multi_store_total_cap_bps integer not null default 2500 check (multi_store_total_cap_bps between 0 and 10000),
  vat_included boolean not null default true,
  version text not null default 'live-v2',
  updated_at timestamptz not null default now()
);

insert into public.billing_price_policies (id) values (1)
on conflict (id) do update set
  base_monthly_krw = 14900,
  addon_monthly_krw = 5000,
  three_month_discount_bps = 500,
  six_month_discount_bps = 1000,
  twelve_month_discount_bps = 1500,
  founder_discount_bps = 4000,
  multi_store_discount_bps = 1500,
  multi_store_total_cap_bps = 2500,
  vat_included = true,
  version = 'live-v2',
  updated_at = now();

-- 기존 매장의 정상 기본 가격도 라이브 가격으로 통일합니다.
update public.store_billing set base_price_krw = 14900, price_version = 'standard', updated_at = now()
where base_price_krw is distinct from 14900 or price_version is distinct from 'standard';
update public.store_addons set prepay_addon_price_krw = 5000, updated_at = now()
where prepay_addon_price_krw is distinct from 5000;

-- 3) 점주 결제 계정과 매장 연결
create table if not exists public.billing_accounts (
  id bigint generated always as identity primary key,
  owner_user_id uuid not null unique references auth.users(id) on delete restrict,
  founder_member boolean not null default false,
  founder_designated_at timestamptz,
  founder_designated_by uuid,
  founder_reason text,
  trial_used_at timestamptz,
  trial_store_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_account_stores (
  billing_account_id bigint not null references public.billing_accounts(id) on delete cascade,
  store_id text primary key references public.stores(store_id) on delete cascade,
  store_sequence integer not null check (store_sequence > 0),
  founder_base_discount boolean not null default false,
  founder_addon_discount boolean not null default false,
  founder_discount_started_at timestamptz,
  founder_discount_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_account_id, store_sequence)
);

-- 기존 owner와 매장을 결제 계정에 안전하게 연결합니다.
insert into public.billing_accounts (owner_user_id, created_at, updated_at)
select distinct sm.user_id, now(), now()
from public.store_members sm
where sm.role = 'owner' and sm.user_id is not null
on conflict (owner_user_id) do nothing;

with ranked as (
  select ba.id as billing_account_id, sm.store_id,
         row_number() over (partition by ba.id order by coalesce(s.created_at, now()), sm.store_id)::integer as store_sequence
  from public.billing_accounts ba
  join public.store_members sm on sm.user_id = ba.owner_user_id and sm.role = 'owner'
  join public.stores s on s.store_id = sm.store_id
), deduped as (
  select distinct on (store_id) billing_account_id, store_id, store_sequence
  from ranked order by store_id, store_sequence
)
insert into public.billing_account_stores (billing_account_id, store_id, store_sequence)
select billing_account_id, store_id, store_sequence from deduped
on conflict (store_id) do nothing;

-- 4) 매장 생성 후 첫 매장에만 30일 체험을 부여합니다.
create or replace function public.initialize_store_billing_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id bigint;
  v_sequence integer;
  v_trial_used timestamptz;
begin
  if new.role <> 'owner' then return new; end if;

  insert into public.billing_accounts (owner_user_id)
  values (new.user_id)
  on conflict (owner_user_id) do update set updated_at = now()
  returning id, trial_used_at into v_account_id, v_trial_used;

  select coalesce(max(store_sequence), 0) + 1 into v_sequence
  from public.billing_account_stores where billing_account_id = v_account_id;

  insert into public.billing_account_stores (billing_account_id, store_id, store_sequence)
  values (v_account_id, new.store_id, v_sequence)
  on conflict (store_id) do nothing;

  if v_sequence = 1 and v_trial_used is null then
    insert into public.store_billing (store_id, base_plan_status, trial_end_at, base_price_krw, price_version)
    values (new.store_id, 'trialing', now() + interval '30 days', 14900, 'standard')
    on conflict (store_id) do update set
      base_plan_status = case when store_billing.base_plan_status = 'active' then 'active' else 'trialing' end,
      trial_end_at = coalesce(store_billing.trial_end_at, now() + interval '30 days'),
      base_price_krw = 14900,
      price_version = 'standard',
      updated_at = now();
    update public.billing_accounts
      set trial_used_at = now(), trial_store_id = new.store_id, updated_at = now()
      where id = v_account_id;
  else
    insert into public.store_billing (store_id, base_plan_status, base_price_krw, price_version)
    values (new.store_id, 'inactive', 14900, 'standard')
    on conflict (store_id) do update set base_price_krw = 14900, price_version = 'standard', updated_at = now();
  end if;

  insert into public.store_addons (store_id, prepay_addon_price_krw)
  values (new.store_id, 5000)
  on conflict (store_id) do update set prepay_addon_price_krw = 5000, updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_initialize_store_billing_account on public.store_members;
create trigger trg_initialize_store_billing_account
after insert on public.store_members
for each row execute function public.initialize_store_billing_account();

-- 5) 서버 발급 결제 견적/시도. 할인 근거를 결제 당시 값으로 보존합니다.
create table if not exists public.billing_payment_attempts (
  id bigint generated always as identity primary key,
  order_id text not null unique,
  store_id text not null references public.stores(store_id) on delete restrict,
  payer_user_id uuid not null,
  plan_months integer not null check (plan_months in (1,3,6,12)),
  base_selected boolean not null,
  addon_selected boolean not null,
  base_monthly_krw integer not null,
  addon_monthly_krw integer not null,
  base_discount_bps integer not null default 0,
  addon_discount_bps integer not null default 0,
  term_discount_bps integer not null default 0,
  discount_reason text,
  list_amount_krw integer not null,
  discount_amount_krw integer not null,
  final_amount_krw integer not null check (final_amount_krw > 0),
  price_policy_version text not null,
  quote_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'ready' check (status in ('ready','payment_requested','approved','applied','approved_not_applied','failed','canceled','expired')),
  payment_key text unique,
  toss_response jsonb,
  public_error_code text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_billing_attempts_store_created on public.billing_payment_attempts(store_id, created_at desc);
create index if not exists idx_billing_attempts_recovery on public.billing_payment_attempts(status, updated_at)
where status in ('approved','approved_not_applied');

-- 결제 이력에 당시 가격/할인 스냅샷을 추가합니다.
alter table public.billing_payments add column if not exists payment_attempt_id bigint references public.billing_payment_attempts(id);
alter table public.billing_payments add column if not exists list_amount_krw integer;
alter table public.billing_payments add column if not exists discount_amount_krw integer not null default 0;
alter table public.billing_payments add column if not exists base_monthly_snapshot integer;
alter table public.billing_payments add column if not exists addon_monthly_snapshot integer;
alter table public.billing_payments add column if not exists base_discount_bps integer not null default 0;
alter table public.billing_payments add column if not exists addon_discount_bps integer not null default 0;
alter table public.billing_payments add column if not exists term_discount_bps integer not null default 0;
alter table public.billing_payments add column if not exists price_policy_version text;
alter table public.billing_payments add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb;
alter table public.billing_payments add column if not exists before_addon_paid_until timestamptz;
alter table public.billing_payments add column if not exists after_addon_paid_until timestamptz;

-- 6) OPS 변경 감사 로그
create table if not exists public.billing_admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  action text not null,
  store_id text,
  billing_account_id bigint,
  before_data jsonb,
  after_data jsonb,
  reason text not null,
  created_at timestamptz not null default now()
);

-- 7) 검증된 결제 시도만 구독에 반영하는 service_role 전용 함수
create or replace function public.apply_billing_payment_attempt(p_attempt_id bigint)
returns public.billing_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.billing_payment_attempts;
  v_base_before timestamptz;
  v_addon_before timestamptz;
  v_base_after timestamptz;
  v_addon_after timestamptz;
  v_row public.billing_payments;
begin
  select * into a from public.billing_payment_attempts where id = p_attempt_id for update;
  if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  if a.status = 'applied' then
    select * into v_row from public.billing_payments where payment_attempt_id = a.id;
    return v_row;
  end if;
  if a.status not in ('approved','approved_not_applied') then raise exception 'PAYMENT_NOT_APPROVED'; end if;
  if a.payment_key is null then raise exception 'PAYMENT_KEY_REQUIRED'; end if;

  select paid_until into v_base_before from public.store_billing where store_id = a.store_id for update;
  select addon_paid_until into v_addon_before from public.store_addons where store_id = a.store_id for update;
  v_base_after := greatest(coalesce(v_base_before, now()), now()) + make_interval(months => a.plan_months);
  v_addon_after := greatest(coalesce(v_addon_before, now()), now()) + make_interval(months => a.plan_months);

  if a.base_selected then
    insert into public.store_billing (store_id, base_plan_status, paid_until, current_plan_months, base_price_krw, price_version)
    values (a.store_id, 'active', v_base_after, a.plan_months, a.base_monthly_krw, 'standard')
    on conflict (store_id) do update set base_plan_status='active', paid_until=v_base_after,
      current_plan_months=a.plan_months, base_price_krw=a.base_monthly_krw, price_version='standard', updated_at=now();
  end if;
  if a.addon_selected then
    insert into public.store_addons (store_id, prepay_addon_status, addon_paid_until, current_plan_months, prepay_addon_price_krw)
    values (a.store_id, 'active', v_addon_after, a.plan_months, a.addon_monthly_krw)
    on conflict (store_id) do update set prepay_addon_status='active', addon_paid_until=v_addon_after,
      current_plan_months=a.plan_months, prepay_addon_price_krw=a.addon_monthly_krw, updated_at=now();
  end if;

  insert into public.billing_payments (
    store_id,payer_user_id,plan_months,base_paid,addon_paid,amount_krw,paid_at,
    before_paid_until,after_paid_until,payment_provider,payment_key,order_id,status,note,
    payment_attempt_id,list_amount_krw,discount_amount_krw,base_monthly_snapshot,
    addon_monthly_snapshot,base_discount_bps,addon_discount_bps,term_discount_bps,before_addon_paid_until,after_addon_paid_until,
    price_policy_version,pricing_snapshot
  ) values (
    a.store_id,a.payer_user_id,a.plan_months,a.base_selected,a.addon_selected,a.final_amount_krw,coalesce(a.approved_at,now()),
    case when a.base_selected then v_base_before else v_addon_before end,
    case when a.base_selected then v_base_after else v_addon_after end,
    'tosspayments',a.payment_key,a.order_id,'paid','서버 검증 구독 결제',
    a.id,a.list_amount_krw,a.discount_amount_krw,a.base_monthly_krw,a.addon_monthly_krw,
    a.base_discount_bps,a.addon_discount_bps,a.term_discount_bps,v_addon_before,v_addon_after,a.price_policy_version,a.quote_snapshot
  ) returning * into v_row;

  update public.billing_payment_attempts set status='applied', applied_at=now(), updated_at=now() where id=a.id;
  return v_row;
exception when others then
  if a.id is not null then
    update public.billing_payment_attempts set status='approved_not_applied', public_error_code='SUBSCRIPTION_APPLY_FAILED', updated_at=now() where id=a.id;
  end if;
  raise;
end;
$$;
revoke all on function public.apply_billing_payment_attempt(bigint) from public, anon, authenticated;
grant execute on function public.apply_billing_payment_attempt(bigint) to service_role;

-- 기본 구독과 옵션의 기존 만료일이 서로 달라도 안전하게 환불합니다.
create or replace function public.claim_store_billing_refund(p_payment_id bigint, p_store_id text)
returns public.billing_payments
language plpgsql security definer set search_path = public
as $$
declare v public.billing_payments; v_until timestamptz;
begin
  select * into v from public.billing_payments where id=p_payment_id and store_id=p_store_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v.status <> 'paid' then raise exception 'PAYMENT_NOT_CANCELABLE'; end if;
  if v.base_paid then
    select paid_until into v_until from public.store_billing where store_id=p_store_id for update;
    if v_until is distinct from v.after_paid_until then raise exception 'SUBSCRIPTION_CHANGED_AFTER_PAYMENT'; end if;
  end if;
  if v.addon_paid then
    select addon_paid_until into v_until from public.store_addons where store_id=p_store_id for update;
    if v_until is distinct from coalesce(v.after_addon_paid_until,v.after_paid_until) then raise exception 'SUBSCRIPTION_CHANGED_AFTER_PAYMENT'; end if;
  end if;
  update public.billing_payments set status='canceling',updated_at=now() where id=p_payment_id returning * into v;
  return v;
end; $$;

create or replace function public.finalize_store_billing_refund(p_payment_id bigint,p_store_id text,p_cancel_reason text)
returns public.billing_payments
language plpgsql security definer set search_path = public
as $$
declare v public.billing_payments; n integer;
begin
  select * into v from public.billing_payments where id=p_payment_id and store_id=p_store_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v.status <> 'canceling' then raise exception 'REFUND_NOT_CLAIMED'; end if;
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
  update public.billing_payments set status='refunded',note=trim(concat_ws(' ',nullif(trim(coalesce(note,'')),''),'[결제취소] '||left(trim(coalesce(p_cancel_reason,'사유 미입력')),120))),updated_at=now()
    where id=p_payment_id and status='canceling' returning * into v;
  return v;
end; $$;
revoke all on function public.claim_store_billing_refund(bigint,text) from public,anon,authenticated;
revoke all on function public.finalize_store_billing_refund(bigint,text,text) from public,anon,authenticated;
grant execute on function public.claim_store_billing_refund(bigint,text) to service_role;
grant execute on function public.finalize_store_billing_refund(bigint,text,text) to service_role;

-- 8) RLS: 민감한 결제/OPS 테이블은 브라우저 직접 접근을 허용하지 않습니다.
alter table public.billing_price_policies enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_account_stores enable row level security;
alter table public.billing_payment_attempts enable row level security;
alter table public.billing_admin_audit_logs enable row level security;

revoke all on public.billing_price_policies from anon, authenticated;
revoke all on public.billing_accounts from anon, authenticated;
revoke all on public.billing_account_stores from anon, authenticated;
revoke all on public.billing_payment_attempts from anon, authenticated;
revoke all on public.billing_admin_audit_logs from anon, authenticated;
revoke select, insert, update, delete on public.platform_pg_config from authenticated;

-- OPS 대시보드의 비밀정보가 아닌 운영 데이터는 app_metadata 기반 OPS만 조회할 수 있습니다.
drop policy if exists "store_billing_ops_select_v2" on public.store_billing;
create policy "store_billing_ops_select_v2" on public.store_billing for select to authenticated using (public.is_ops_user());
drop policy if exists "store_addons_ops_select_v2" on public.store_addons;
create policy "store_addons_ops_select_v2" on public.store_addons for select to authenticated using (public.is_ops_user());
drop policy if exists "billing_payments_ops_select_v2" on public.billing_payments;
create policy "billing_payments_ops_select_v2" on public.billing_payments for select to authenticated using (public.is_ops_user());
drop policy if exists "support_tickets_ops_select_v2" on public.support_tickets;
create policy "support_tickets_ops_select_v2" on public.support_tickets for select to authenticated using (public.is_ops_user());

commit;

-- 실행 후 선택 확인 쿼리
-- select * from public.billing_price_policies;
-- select ba.owner_user_id, bas.store_id, bas.store_sequence, bas.founder_base_discount, bas.founder_addon_discount
-- from public.billing_accounts ba join public.billing_account_stores bas on bas.billing_account_id=ba.id order by ba.id, bas.store_sequence;
-- select store_id, base_plan_status, trial_end_at, base_price_krw from public.store_billing order by store_id;
