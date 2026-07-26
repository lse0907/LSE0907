-- =========================================================
-- 리온오더 Billing v2.1 후속 보완 전체 SQL
-- 선행: supabase-billing-live-v2.sql
-- 실행: Supabase Dashboard > SQL Editor에서 이 파일 전체 실행
-- =========================================================
begin;

-- 구독 자격과 실제 고객 선결제 사용 여부를 분리합니다.
alter table public.store_addons
  add column if not exists prepay_enabled boolean not null default false;
alter table public.store_addons
  add column if not exists prepay_enabled_at timestamptz;
alter table public.store_addons
  add column if not exists prepay_enabled_by uuid;

-- OPS 세부 역할. master는 모든 OPS 변경 권한을 가집니다.
create or replace function public.current_ops_role()
returns text language sql stable security definer set search_path = public
as $$
  select case
    when coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'ops', false)
      then coalesce(nullif(auth.jwt() -> 'app_metadata' ->> 'ops_role', ''), 'viewer')
    else null
  end;
$$;

-- 창립 멤버 계정/매장/감사로그를 하나의 트랜잭션으로 저장합니다.
create or replace function public.set_store_founder_benefit(
  p_store_id text,
  p_actor_user_id uuid,
  p_founder_member boolean,
  p_founder_base boolean,
  p_founder_addon boolean,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_link public.billing_account_stores;
  v_before jsonb;
  v_after jsonb;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_link from public.billing_account_stores where store_id=p_store_id for update;
  if not found then raise exception 'BILLING_ACCOUNT_STORE_MISSING'; end if;
  select jsonb_build_object(
    'founder_member',ba.founder_member,'founder_base',v_link.founder_base_discount,
    'founder_addon',v_link.founder_addon_discount,'reason',coalesce(v_link.founder_discount_reason,ba.founder_reason)
  ) into v_before from public.billing_accounts ba where ba.id=v_link.billing_account_id for update;
  if v_before is null then raise exception 'BILLING_ACCOUNT_MISSING'; end if;

  update public.billing_accounts set
    founder_member=p_founder_member,
    founder_designated_at=case when p_founder_member then coalesce(founder_designated_at,now()) else null end,
    founder_designated_by=p_actor_user_id,founder_reason=trim(p_reason),updated_at=now()
    where id=v_link.billing_account_id;
  if not found then raise exception 'BILLING_ACCOUNT_UPDATE_FAILED'; end if;

  update public.billing_account_stores set
    founder_base_discount=p_founder_member and p_founder_base,
    founder_addon_discount=p_founder_member and p_founder_addon,
    founder_discount_started_at=case when p_founder_member then coalesce(founder_discount_started_at,now()) else null end,
    founder_discount_reason=trim(p_reason),updated_at=now()
    where store_id=p_store_id;
  if not found then raise exception 'FOUNDER_STORE_UPDATE_FAILED'; end if;

  v_after=jsonb_build_object('founder_member',p_founder_member,'founder_base',p_founder_member and p_founder_base,
    'founder_addon',p_founder_member and p_founder_addon,'reason',trim(p_reason));
  insert into public.billing_admin_audit_logs(actor_user_id,action,store_id,billing_account_id,before_data,after_data,reason)
  values(p_actor_user_id,'founder_benefit_updated',p_store_id,v_link.billing_account_id,v_before,v_after,trim(p_reason));
  return v_after;
end; $$;
revoke all on function public.set_store_founder_benefit(text,uuid,boolean,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.set_store_founder_benefit(text,uuid,boolean,boolean,boolean,text) to service_role;

-- 선결제 기능 변경 이력
create table if not exists public.store_prepay_setting_logs(
  id bigint generated always as identity primary key,
  store_id text not null references public.stores(store_id) on delete cascade,
  actor_user_id uuid not null,
  before_enabled boolean not null,
  after_enabled boolean not null,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.store_prepay_setting_logs enable row level security;
revoke all on public.store_prepay_setting_logs from anon,authenticated;

-- 고객 주문 화면은 구독, 만료일, 운영 토글, PG 키를 모두 만족할 때만 선결제를 사용합니다.
create or replace function public.get_store_checkout_mode(p_store_id text)
returns table(is_prepay boolean,source text)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select (
    coalesce(sa.prepay_addon_status,'inactive')='active'
    and sa.addon_paid_until is not null and sa.addon_paid_until>now()
    and coalesce(sa.prepay_enabled,false)=true
    and nullif(trim(coalesce(pg.client_key,'')),'') is not null
    and nullif(trim(coalesce(pg.secret_key,'')),'') is not null
  ),'store_addons_v2_1'::text
  from public.store_addons sa left join public.store_pg_config pg on pg.store_id=sa.store_id
  where sa.store_id=p_store_id;
  if not found then return query select false,'store_addons_v2_1'::text; end if;
end; $$;
grant execute on function public.get_store_checkout_mode(text) to anon,authenticated;

-- 기존 owner/매장 중 누락된 결제 계정 연결을 복구합니다.
insert into public.billing_accounts(owner_user_id)
select distinct sm.user_id from public.store_members sm
where sm.role='owner' and sm.user_id is not null
on conflict(owner_user_id) do nothing;

with candidates as (
  select distinct on (sm.store_id) ba.id billing_account_id,sm.store_id
  from public.store_members sm join public.billing_accounts ba on ba.owner_user_id=sm.user_id
  where sm.role='owner' order by sm.store_id,sm.user_id
), numbered as (
  select c.*,coalesce((select max(x.store_sequence) from public.billing_account_stores x where x.billing_account_id=c.billing_account_id),0)
    + row_number() over(partition by c.billing_account_id order by c.store_id) as sequence_no
  from candidates c left join public.billing_account_stores existing on existing.store_id=c.store_id
  where existing.store_id is null
)
insert into public.billing_account_stores(billing_account_id,store_id,store_sequence)
select billing_account_id,store_id,sequence_no::integer from numbered
on conflict(store_id) do nothing;

commit;

-- 확인 쿼리
-- select store_id,prepay_addon_status,addon_paid_until,prepay_enabled from public.store_addons order by store_id;
-- select s.store_id from public.stores s left join public.billing_account_stores b on b.store_id=s.store_id where b.store_id is null;
