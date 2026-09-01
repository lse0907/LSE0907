begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.billing_price_policies
  add column if not exists referrals_enabled boolean not null default true,
  add column if not exists referral_discount_krw integer not null default 3000 check (referral_discount_krw between 0 and 100000),
  add column if not exists referral_reward_krw integer not null default 3000 check (referral_reward_krw between 0 and 100000),
  add column if not exists referral_hold_days integer not null default 14 check (referral_hold_days between 1 and 90),
  add column if not exists credit_adjustment_limit_krw integer not null default 30000 check (credit_adjustment_limit_krw between 0 and 1000000);

update public.billing_price_policies
set referrals_enabled=true, referral_discount_krw=3000, referral_reward_krw=3000,
    referral_hold_days=14, credit_adjustment_limit_krw=30000,
    version='live-v3-referral', updated_at=now()
where id=1;

create table if not exists public.store_referral_codes (
  id bigint generated always as identity primary key,
  store_id text not null references public.stores(store_id) on delete restrict,
  code text not null,
  code_normalized text generated always as (upper(trim(code))) stored,
  is_active boolean not null default true,
  issued_by uuid,
  issued_reason text,
  deactivated_at timestamptz,
  deactivated_by uuid,
  deactivated_reason text,
  created_at timestamptz not null default now(),
  unique(code_normalized),
  check (code_normalized ~ '^[A-Z0-9]{6,16}$')
);
create unique index if not exists uq_store_referral_codes_active_store
  on public.store_referral_codes(store_id) where is_active;

create table if not exists public.billing_referrals (
  id bigint generated always as identity primary key,
  referred_user_id uuid not null unique references auth.users(id) on delete restrict,
  referral_code_id bigint not null references public.store_referral_codes(id) on delete restrict,
  referring_store_id text not null references public.stores(store_id) on delete restrict,
  referred_store_id text references public.stores(store_id) on delete restrict,
  status text not null default 'registered' check (status in (
    'registered','eligible','reward_pending','rewarded','discount_used_no_reward','disqualified','canceled'
  )),
  discount_attempt_id bigint,
  discount_reserved_at timestamptz,
  first_payment_id bigint,
  hold_until timestamptz,
  rewarded_at timestamptz,
  disqualified_at timestamptz,
  disqualified_by uuid,
  disqualify_reason text,
  ops_updated_by uuid,
  ops_reason text,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(referred_store_id),
  unique(first_payment_id)
);
create index if not exists idx_billing_referrals_pending
  on public.billing_referrals(status,hold_until) where status='reward_pending';
create index if not exists idx_billing_referrals_referring_store
  on public.billing_referrals(referring_store_id,registered_at desc);

create table if not exists public.billing_credit_ledger (
  id bigint generated always as identity primary key,
  billing_account_id bigint not null references public.billing_accounts(id) on delete restrict,
  root_entry_id bigint references public.billing_credit_ledger(id) on delete restrict,
  entry_type text not null check (entry_type in (
    'earn','reserve','release','use','restore','revoke','expire','admin_adjust'
  )),
  amount_krw integer not null check (amount_krw <> 0),
  referral_id bigint references public.billing_referrals(id) on delete restrict,
  payment_attempt_id bigint references public.billing_payment_attempts(id) on delete restrict,
  billing_payment_id bigint references public.billing_payments(id) on delete restrict,
  actor_user_id uuid,
  idempotency_key text not null unique,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (entry_type in ('earn','release','restore') and amount_krw > 0)
    or (entry_type in ('reserve','use','revoke','expire') and amount_krw < 0)
    or entry_type='admin_adjust'
  )
);
create index if not exists idx_billing_credit_ledger_account_created
  on public.billing_credit_ledger(billing_account_id,created_at,id);
create index if not exists idx_billing_credit_ledger_root
  on public.billing_credit_ledger(root_entry_id) where root_entry_id is not null;
create index if not exists idx_billing_credit_ledger_attempt
  on public.billing_credit_ledger(payment_attempt_id) where payment_attempt_id is not null;

create or replace function private.prevent_billing_credit_ledger_mutation()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  raise exception 'BILLING_CREDIT_LEDGER_IMMUTABLE';
end;
$$;
drop trigger if exists trg_billing_credit_ledger_immutable on public.billing_credit_ledger;
create trigger trg_billing_credit_ledger_immutable
before update or delete on public.billing_credit_ledger
for each row execute function private.prevent_billing_credit_ledger_mutation();

alter table public.billing_payment_attempts
  add column if not exists referral_id bigint references public.billing_referrals(id) on delete restrict,
  add column if not exists referral_discount_krw integer not null default 0,
  add column if not exists credit_requested_krw integer not null default 0,
  add column if not exists credit_applied_krw integer not null default 0,
  add column if not exists base_final_before_credit_krw integer not null default 0,
  add column if not exists base_external_amount_krw integer not null default 0,
  add column if not exists addon_external_amount_krw integer not null default 0,
  add column if not exists external_amount_krw integer not null default 0;

update public.billing_payment_attempts
set external_amount_krw=final_amount_krw,
    base_external_amount_krw=greatest(0,final_amount_krw-coalesce(addon_monthly_krw,0)*case when addon_selected then plan_months else 0 end),
    addon_external_amount_krw=least(final_amount_krw,coalesce(addon_monthly_krw,0)*case when addon_selected then plan_months else 0 end),
    base_final_before_credit_krw=greatest(0,final_amount_krw-coalesce(addon_monthly_krw,0)*case when addon_selected then plan_months else 0 end)
where external_amount_krw=0 and final_amount_krw>0;

alter table public.billing_payment_attempts
  drop constraint if exists billing_payment_attempts_final_amount_krw_check;
alter table public.billing_payment_attempts
  drop constraint if exists billing_payment_attempts_status_check;
alter table public.billing_payment_attempts
  add constraint billing_payment_attempts_final_amount_krw_check check (final_amount_krw >= 0),
  add constraint billing_payment_attempts_status_check check (status in (
    'ready','payment_requested','credit_ready','approved','applied','approved_not_applied','failed','canceled','expired'
  )),
  add constraint billing_payment_attempts_credit_amounts_check check (
    referral_discount_krw>=0 and credit_requested_krw>=0 and credit_applied_krw>=0
    and base_final_before_credit_krw>=0 and base_external_amount_krw>=0
    and addon_external_amount_krw>=0 and external_amount_krw>=0
    and final_amount_krw=external_amount_krw
    and external_amount_krw=base_external_amount_krw+addon_external_amount_krw
  );

alter table public.billing_payments
  add column if not exists referral_id bigint references public.billing_referrals(id) on delete restrict,
  add column if not exists referral_discount_krw integer not null default 0,
  add column if not exists credit_used_krw integer not null default 0,
  add column if not exists external_amount_krw integer not null default 0,
  add column if not exists base_external_amount_krw integer not null default 0,
  add column if not exists addon_external_amount_krw integer not null default 0,
  add column if not exists base_period_start_at timestamptz,
  add column if not exists base_period_end_at timestamptz,
  add column if not exists addon_period_start_at timestamptz,
  add column if not exists addon_period_end_at timestamptz;

update public.billing_payments
set external_amount_krw=coalesce(amount_krw,0),
    base_external_amount_krw=case when base_paid then coalesce(amount_krw,0) else 0 end,
    addon_external_amount_krw=case when not base_paid and addon_paid then coalesce(amount_krw,0) else 0 end,
    base_period_start_at=case when base_paid then coalesce(before_paid_until,paid_at) end,
    base_period_end_at=case when base_paid then after_paid_until end,
    addon_period_start_at=case when addon_paid then coalesce(before_addon_paid_until,before_paid_until,paid_at) end,
    addon_period_end_at=case when addon_paid then coalesce(after_addon_paid_until,after_paid_until) end
where external_amount_krw=0 and coalesce(amount_krw,0)>0;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='billing_referrals_discount_attempt_id_fkey') then
    alter table public.billing_referrals add constraint billing_referrals_discount_attempt_id_fkey
      foreign key(discount_attempt_id) references public.billing_payment_attempts(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='billing_referrals_first_payment_id_fkey') then
    alter table public.billing_referrals add constraint billing_referrals_first_payment_id_fkey
      foreign key(first_payment_id) references public.billing_payments(id) on delete restrict;
  end if;
end $$;

create or replace function public.set_store_founder_benefit(
  p_store_id text,p_actor_user_id uuid,p_founder_member boolean,
  p_founder_base boolean,p_founder_addon boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_link public.billing_account_stores; v_before jsonb; v_after jsonb;
begin
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_link from public.billing_account_stores where store_id=p_store_id for update;
  if not found then raise exception 'BILLING_ACCOUNT_STORE_MISSING'; end if;
  if p_founder_member and v_link.store_sequence<>1 then raise exception 'BETA_BENEFIT_FIRST_STORE_ONLY'; end if;
  if p_founder_addon and not p_founder_base then raise exception 'BETA_ADDON_REQUIRES_BASE_BETA'; end if;
  select jsonb_build_object(
    'beta_member',ba.founder_member,'beta_base',v_link.founder_base_discount,
    'beta_addon',v_link.founder_addon_discount,'reason',coalesce(v_link.founder_discount_reason,ba.founder_reason)
  ) into v_before from public.billing_accounts ba where ba.id=v_link.billing_account_id for update;
  if v_before is null then raise exception 'BILLING_ACCOUNT_MISSING'; end if;
  update public.billing_accounts set founder_member=p_founder_member,
    founder_designated_at=case when p_founder_member then coalesce(founder_designated_at,now()) else founder_designated_at end,
    founder_designated_by=p_actor_user_id,founder_reason=trim(p_reason),updated_at=now()
  where id=v_link.billing_account_id;
  update public.billing_account_stores set
    founder_base_discount=p_founder_member and p_founder_base,
    founder_addon_discount=p_founder_member and p_founder_addon,
    founder_discount_started_at=case when p_founder_member then coalesce(founder_discount_started_at,now()) else founder_discount_started_at end,
    founder_discount_reason=trim(p_reason),updated_at=now()
  where store_id=p_store_id;
  v_after=jsonb_build_object('beta_member',p_founder_member,'beta_base',p_founder_member and p_founder_base,
    'beta_addon',p_founder_member and p_founder_addon,'reason',trim(p_reason));
  insert into public.billing_admin_audit_logs(actor_user_id,action,store_id,billing_account_id,before_data,after_data,reason)
  values(p_actor_user_id,'beta_benefit_updated',p_store_id,v_link.billing_account_id,v_before,v_after,trim(p_reason));
  return v_after;
end $$;

create or replace function public.get_billing_credit_summary(p_user_id uuid,p_store_id text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_account_id bigint; v_balance bigint; v_reserved bigint;
begin
  select ba.id into v_account_id
  from public.billing_accounts ba join public.billing_account_stores bas on bas.billing_account_id=ba.id
  where ba.owner_user_id=p_user_id and bas.store_id=p_store_id;
  if v_account_id is null then raise exception 'BILLING_ACCOUNT_STORE_MISMATCH'; end if;
  select coalesce(sum(amount_krw),0),
    coalesce(-sum(amount_krw) filter(where entry_type in ('reserve','release')),0)
    into v_balance,v_reserved from public.billing_credit_ledger where billing_account_id=v_account_id;
  return jsonb_build_object('billingAccountId',v_account_id,'availableKrw',greatest(0,v_balance),'reservedKrw',greatest(0,v_reserved));
end $$;

create or replace function public.prepare_billing_payment_attempt_v2(
  p_order_id text,p_store_id text,p_user_id uuid,p_quote jsonb
) returns public.billing_payment_attempts language plpgsql security definer set search_path=''
as $$
declare
  v_account_id bigint; v_attempt public.billing_payment_attempts; v_ref public.billing_referrals;
  v_root public.billing_credit_ledger; v_remaining bigint; v_take integer; v_needed integer;
  v_external integer:=coalesce((p_quote->>'externalAmountKrw')::integer,0);
  v_base_external integer:=coalesce((p_quote->>'baseExternalAmountKrw')::integer,0);
  v_addon_external integer:=coalesce((p_quote->>'addonExternalAmountKrw')::integer,0);
  v_credit integer:=coalesce((p_quote->>'creditAppliedKrw')::integer,0);
  v_referral_discount integer:=coalesce((p_quote->>'referralDiscountKrw')::integer,0);
  v_referral_id bigint:=nullif(p_quote->>'referralId','')::bigint;
begin
  if nullif(trim(coalesce(p_order_id,'')),'') is null then raise exception 'ORDER_ID_REQUIRED'; end if;
  select ba.id into v_account_id
  from public.billing_accounts ba join public.billing_account_stores bas on bas.billing_account_id=ba.id
  where ba.owner_user_id=p_user_id and bas.store_id=p_store_id for update of ba;
  if v_account_id is null then raise exception 'BILLING_ACCOUNT_STORE_MISMATCH'; end if;
  if v_external<0 or v_base_external<0 or v_addon_external<0 or v_credit<0 or v_referral_discount<0
     or v_external<>v_base_external+v_addon_external then raise exception 'INVALID_QUOTE_TOTALS'; end if;

  insert into public.billing_payment_attempts(
    order_id,store_id,payer_user_id,plan_months,base_selected,addon_selected,
    base_monthly_krw,addon_monthly_krw,base_discount_bps,addon_discount_bps,term_discount_bps,
    discount_reason,list_amount_krw,discount_amount_krw,final_amount_krw,price_policy_version,
    quote_snapshot,status,referral_id,referral_discount_krw,credit_requested_krw,credit_applied_krw,
    base_final_before_credit_krw,base_external_amount_krw,addon_external_amount_krw,external_amount_krw
  ) values(
    p_order_id,p_store_id,p_user_id,(p_quote->>'planMonths')::integer,
    coalesce((p_quote->>'payBase')::boolean,false),coalesce((p_quote->>'payAddon')::boolean,false),
    (p_quote->>'baseMonthlyKrw')::integer,(p_quote->>'addonMonthlyKrw')::integer,
    (p_quote->>'baseDiscountBps')::integer,(p_quote->>'addonDiscountBps')::integer,(p_quote->>'termDiscountBps')::integer,
    nullif(p_quote->>'discountReason',''),(p_quote->>'listAmountKrw')::integer,(p_quote->>'discountAmountKrw')::integer,
    v_external,p_quote->>'pricePolicyVersion',p_quote,
    case when v_external=0 then 'credit_ready' else 'payment_requested' end,
    v_referral_id,v_referral_discount,coalesce((p_quote->>'creditRequestedKrw')::integer,0),v_credit,
    coalesce((p_quote->>'baseFinalBeforeCreditKrw')::integer,0),v_base_external,v_addon_external,v_external
  ) returning * into v_attempt;

  if v_referral_id is not null and v_referral_discount>0 then
    select * into v_ref from public.billing_referrals where id=v_referral_id and referred_user_id=p_user_id for update;
    if not found or v_ref.first_payment_id is not null or v_ref.status not in ('registered','eligible') then
      raise exception 'REFERRAL_DISCOUNT_NOT_AVAILABLE';
    end if;
    if v_ref.discount_attempt_id is not null and v_ref.discount_attempt_id<>v_attempt.id then
      raise exception 'REFERRAL_DISCOUNT_ALREADY_RESERVED';
    end if;
    update public.billing_referrals set referred_store_id=coalesce(referred_store_id,p_store_id),
      discount_attempt_id=v_attempt.id,discount_reserved_at=now(),status='eligible',updated_at=now()
    where id=v_referral_id and (referred_store_id is null or referred_store_id=p_store_id);
    if not found then raise exception 'REFERRAL_FIRST_STORE_MISMATCH'; end if;
  end if;

  v_needed:=v_credit;
  if v_needed>0 then
    for v_root in
      select * from public.billing_credit_ledger
      where billing_account_id=v_account_id and root_entry_id is null and amount_krw>0
      order by created_at,id for update
    loop
      select v_root.amount_krw+coalesce(sum(amount_krw),0) into v_remaining
      from public.billing_credit_ledger where root_entry_id=v_root.id;
      v_take:=least(v_needed,greatest(0,v_remaining)::integer);
      if v_take>0 then
        insert into public.billing_credit_ledger(
          billing_account_id,root_entry_id,entry_type,amount_krw,payment_attempt_id,idempotency_key,reason
        ) values(v_account_id,v_root.id,'reserve',-v_take,v_attempt.id,
          'attempt:'||v_attempt.id||':reserve:'||v_root.id,'구독 결제 크레딧 예약');
        v_needed:=v_needed-v_take;
      end if;
      exit when v_needed=0;
    end loop;
    if v_needed<>0 then raise exception 'CREDIT_BALANCE_CHANGED'; end if;
  end if;
  return v_attempt;
end $$;

create or replace function public.release_billing_payment_attempt_v2(p_attempt_id bigint,p_reason text)
returns public.billing_payment_attempts language plpgsql security definer set search_path=''
as $$
declare v_attempt public.billing_payment_attempts; v_res public.billing_credit_ledger;
begin
  select * into v_attempt from public.billing_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status='applied' then return v_attempt; end if;
  for v_res in select * from public.billing_credit_ledger
    where payment_attempt_id=p_attempt_id and entry_type='reserve' order by id
  loop
    insert into public.billing_credit_ledger(
      billing_account_id,root_entry_id,entry_type,amount_krw,payment_attempt_id,idempotency_key,reason
    ) values(v_res.billing_account_id,v_res.root_entry_id,'release',-v_res.amount_krw,p_attempt_id,
      'attempt:'||p_attempt_id||':release:'||v_res.root_entry_id,left(coalesce(p_reason,'결제 미완료 예약 해제'),240))
    on conflict(idempotency_key) do nothing;
  end loop;
  update public.billing_referrals set discount_attempt_id=null,discount_reserved_at=null,updated_at=now()
    where discount_attempt_id=p_attempt_id and first_payment_id is null;
  update public.billing_payment_attempts set status=case when status='failed' then status else 'canceled' end,updated_at=now()
    where id=p_attempt_id returning * into v_attempt;
  return v_attempt;
end $$;

create or replace function public.apply_billing_payment_attempt(p_attempt_id bigint)
returns public.billing_payments language plpgsql security definer set search_path=''
as $$
declare
  a public.billing_payment_attempts; v_base_before timestamptz; v_addon_before timestamptz;
  v_base_start timestamptz; v_addon_start timestamptz; v_base_after timestamptz; v_addon_after timestamptz;
  v_next_kst timestamptz; v_row public.billing_payments; v_res public.billing_credit_ledger;
  v_ref public.billing_referrals; v_hold_days integer:=14;
begin
  select * into a from public.billing_payment_attempts where id=p_attempt_id for update;
  if not found then raise exception 'PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  if a.status='applied' then select * into v_row from public.billing_payments where payment_attempt_id=a.id; return v_row; end if;
  if a.external_amount_krw>0 and a.status not in ('approved','approved_not_applied') then raise exception 'PAYMENT_NOT_APPROVED'; end if;
  if a.external_amount_krw=0 and a.status<>'credit_ready' then raise exception 'ZERO_PAYMENT_NOT_READY'; end if;
  if a.external_amount_krw>0 and a.payment_key is null then raise exception 'PAYMENT_KEY_REQUIRED'; end if;

  select paid_until into v_base_before from public.store_billing where store_id=a.store_id for update;
  select addon_paid_until into v_addon_before from public.store_addons where store_id=a.store_id for update;
  v_next_kst:=((timezone('Asia/Seoul',now())::date+1)::timestamp at time zone 'Asia/Seoul');
  v_base_start:=greatest(coalesce(v_base_before,v_next_kst),v_next_kst);
  v_addon_start:=greatest(coalesce(v_addon_before,v_next_kst),v_next_kst);
  v_base_after:=(timezone('Asia/Seoul',v_base_start)+make_interval(months=>a.plan_months)) at time zone 'Asia/Seoul';
  v_addon_after:=(timezone('Asia/Seoul',v_addon_start)+make_interval(months=>a.plan_months)) at time zone 'Asia/Seoul';
  if a.addon_selected and v_addon_after > (case when a.base_selected then v_base_after else coalesce(v_base_before,'-infinity'::timestamptz) end) then
    raise exception 'ADDON_PERIOD_EXCEEDS_BASE';
  end if;

  if a.base_selected then
    insert into public.store_billing(store_id,base_plan_status,paid_until,current_plan_months,base_price_krw,price_version)
    values(a.store_id,'active',v_base_after,a.plan_months,a.base_monthly_krw,'standard')
    on conflict(store_id) do update set base_plan_status='active',paid_until=v_base_after,
      current_plan_months=a.plan_months,base_price_krw=a.base_monthly_krw,price_version='standard',updated_at=now();
  end if;
  if a.addon_selected then
    insert into public.store_addons(store_id,prepay_addon_status,addon_paid_until,current_plan_months,prepay_addon_price_krw)
    values(a.store_id,'active',v_addon_after,a.plan_months,a.addon_monthly_krw)
    on conflict(store_id) do update set prepay_addon_status='active',addon_paid_until=v_addon_after,
      current_plan_months=a.plan_months,prepay_addon_price_krw=a.addon_monthly_krw,updated_at=now();
  end if;

  insert into public.billing_payments(
    store_id,payer_user_id,plan_months,base_paid,addon_paid,amount_krw,paid_at,
    before_paid_until,after_paid_until,payment_provider,payment_key,order_id,status,note,
    payment_attempt_id,list_amount_krw,discount_amount_krw,base_monthly_snapshot,addon_monthly_snapshot,
    base_discount_bps,addon_discount_bps,term_discount_bps,before_addon_paid_until,after_addon_paid_until,
    price_policy_version,pricing_snapshot,referral_id,referral_discount_krw,credit_used_krw,
    external_amount_krw,base_external_amount_krw,addon_external_amount_krw,
    base_period_start_at,base_period_end_at,addon_period_start_at,addon_period_end_at
  ) values(
    a.store_id,a.payer_user_id,a.plan_months,a.base_selected,a.addon_selected,a.external_amount_krw,coalesce(a.approved_at,now()),
    case when a.base_selected then v_base_before else v_addon_before end,
    case when a.base_selected then v_base_after else v_addon_after end,
    case when a.external_amount_krw=0 then 'service_credit' else 'tosspayments' end,a.payment_key,a.order_id,'paid','서버 검증 구독 결제',
    a.id,a.list_amount_krw,a.discount_amount_krw,a.base_monthly_krw,a.addon_monthly_krw,
    a.base_discount_bps,a.addon_discount_bps,a.term_discount_bps,v_addon_before,v_addon_after,
    a.price_policy_version,a.quote_snapshot,a.referral_id,a.referral_discount_krw,a.credit_applied_krw,
    a.external_amount_krw,a.base_external_amount_krw,a.addon_external_amount_krw,
    case when a.base_selected then v_base_start end,case when a.base_selected then v_base_after end,
    case when a.addon_selected then v_addon_start end,case when a.addon_selected then v_addon_after end
  ) returning * into v_row;

  for v_res in select * from public.billing_credit_ledger where payment_attempt_id=a.id and entry_type='reserve' order by id
  loop
    insert into public.billing_credit_ledger(billing_account_id,root_entry_id,entry_type,amount_krw,payment_attempt_id,billing_payment_id,idempotency_key,reason)
    values(v_res.billing_account_id,v_res.root_entry_id,'release',-v_res.amount_krw,a.id,v_row.id,
      'attempt:'||a.id||':consume-release:'||v_res.root_entry_id,'결제 적용을 위한 예약 종료') on conflict(idempotency_key) do nothing;
    insert into public.billing_credit_ledger(billing_account_id,root_entry_id,entry_type,amount_krw,payment_attempt_id,billing_payment_id,idempotency_key,reason)
    values(v_res.billing_account_id,v_res.root_entry_id,'use',v_res.amount_krw,a.id,v_row.id,
      'payment:'||v_row.id||':use:'||v_res.root_entry_id,'기본 구독 크레딧 사용') on conflict(idempotency_key) do nothing;
  end loop;

  if a.referral_id is not null and a.base_selected then
    select coalesce(referral_hold_days,14) into v_hold_days from public.billing_price_policies where id=1;
    select * into v_ref from public.billing_referrals where id=a.referral_id for update;
    update public.billing_referrals set first_payment_id=v_row.id,discount_attempt_id=null,discount_reserved_at=null,
      status=case when a.base_external_amount_krw>=1 then 'reward_pending' else 'discount_used_no_reward' end,
      hold_until=case when a.base_external_amount_krw>=1 then now()+make_interval(days=>v_hold_days) else null end,
      updated_at=now() where id=a.referral_id and first_payment_id is null;
  end if;
  update public.billing_payment_attempts set status='applied',applied_at=now(),updated_at=now() where id=a.id;
  return v_row;
exception when others then
  if a.id is not null and a.external_amount_krw>0 then
    update public.billing_payment_attempts set status='approved_not_applied',public_error_code='SUBSCRIPTION_APPLY_FAILED',updated_at=now() where id=a.id;
  end if;
  raise;
end $$;

create or replace function public.finalize_store_billing_refund(p_payment_id bigint,p_store_id text,p_cancel_reason text)
returns public.billing_payments language plpgsql security definer set search_path=''
as $$
declare v public.billing_payments; n integer; v_use public.billing_credit_ledger;
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
  for v_use in select * from public.billing_credit_ledger where billing_payment_id=p_payment_id and entry_type='use' order by id
  loop
    insert into public.billing_credit_ledger(billing_account_id,root_entry_id,entry_type,amount_krw,billing_payment_id,idempotency_key,reason)
    values(v_use.billing_account_id,v_use.root_entry_id,'restore',-v_use.amount_krw,p_payment_id,
      'payment:'||p_payment_id||':restore:'||v_use.root_entry_id,'구독 결제 전체 취소 크레딧 복원') on conflict(idempotency_key) do nothing;
  end loop;
  update public.billing_referrals set status='canceled',updated_at=now(),ops_reason='첫 기본 구독 전액 취소'
    where first_payment_id=p_payment_id and status='reward_pending';
  update public.billing_payments set status='refunded',canceled_at=now(),cancel_reason=left(trim(coalesce(p_cancel_reason,'사유 미입력')),120),
    note=trim(concat_ws(' ',nullif(trim(coalesce(note,'')),''),'[결제취소] '||left(trim(coalesce(p_cancel_reason,'사유 미입력')),120))),updated_at=now()
  where id=p_payment_id and status='canceling' returning * into v;
  return v;
end $$;

create or replace function public.finalize_due_referral_rewards()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_ref public.billing_referrals; v_account_id bigint; v_reward integer:=3000; v_done integer:=0; v_canceled integer:=0;
begin
  select coalesce(referral_reward_krw,3000) into v_reward from public.billing_price_policies where id=1;
  for v_ref in select * from public.billing_referrals where status='reward_pending' and hold_until<=now() order by id for update skip locked
  loop
    if not exists(
      select 1 from public.billing_payments bp join public.store_billing sb on sb.store_id=bp.store_id
      where bp.id=v_ref.first_payment_id and bp.status='paid' and bp.base_paid and bp.base_external_amount_krw>=1
        and sb.base_plan_status='active' and sb.paid_until>now()
    ) then
      update public.billing_referrals set status='canceled',updated_at=now(),ops_reason='14일 확정 요건 미충족' where id=v_ref.id;
      v_canceled:=v_canceled+1; continue;
    end if;
    select billing_account_id into v_account_id from public.billing_account_stores where store_id=v_ref.referring_store_id;
    if v_account_id is null then
      update public.billing_referrals set status='disqualified',disqualified_at=now(),disqualify_reason='추천 매장 결제계정 없음',updated_at=now() where id=v_ref.id;
      v_canceled:=v_canceled+1; continue;
    end if;
    insert into public.billing_credit_ledger(
      billing_account_id,entry_type,amount_krw,referral_id,idempotency_key,reason
    ) values(v_account_id,'earn',v_reward,v_ref.id,'referral:'||v_ref.id||':reward','추천 기본 구독 14일 확정 보상')
    on conflict(idempotency_key) do nothing;
    update public.billing_referrals set status='rewarded',rewarded_at=coalesce(rewarded_at,now()),updated_at=now() where id=v_ref.id;
    v_done:=v_done+1;
  end loop;
  return jsonb_build_object('rewarded',v_done,'canceled',v_canceled);
end $$;

create or replace function public.expire_billing_payment_attempts_v2()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_attempt public.billing_payment_attempts; v_count integer:=0;
begin
  for v_attempt in select * from public.billing_payment_attempts
    where expires_at<=now() and status in ('ready','payment_requested','credit_ready','failed','canceled')
    order by id for update skip locked
  loop
    perform public.release_billing_payment_attempt_v2(v_attempt.id,'결제 준비 시간 만료');
    update public.billing_payment_attempts set status='expired',updated_at=now() where id=v_attempt.id and status<>'applied';
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('expired',v_count);
end $$;

alter table public.store_referral_codes enable row level security;
alter table public.billing_referrals enable row level security;
alter table public.billing_credit_ledger enable row level security;
revoke all on public.store_referral_codes,public.billing_referrals,public.billing_credit_ledger from public,anon,authenticated;
grant select,insert,update on public.store_referral_codes,public.billing_referrals to service_role;
grant select,insert on public.billing_credit_ledger to service_role;
grant usage,select on sequence public.store_referral_codes_id_seq,public.billing_referrals_id_seq,public.billing_credit_ledger_id_seq to service_role;

revoke all on function public.set_store_founder_benefit(text,uuid,boolean,boolean,boolean,text) from public,anon,authenticated;
revoke all on function public.get_billing_credit_summary(uuid,text) from public,anon,authenticated;
revoke all on function public.prepare_billing_payment_attempt_v2(text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.release_billing_payment_attempt_v2(bigint,text) from public,anon,authenticated;
revoke all on function public.apply_billing_payment_attempt(bigint) from public,anon,authenticated;
revoke all on function public.finalize_store_billing_refund(bigint,text,text) from public,anon,authenticated;
revoke all on function public.finalize_due_referral_rewards() from public,anon,authenticated;
revoke all on function public.expire_billing_payment_attempts_v2() from public,anon,authenticated;
grant execute on function public.set_store_founder_benefit(text,uuid,boolean,boolean,boolean,text) to service_role;
grant execute on function public.get_billing_credit_summary(uuid,text) to service_role;
grant execute on function public.prepare_billing_payment_attempt_v2(text,text,uuid,jsonb) to service_role;
grant execute on function public.release_billing_payment_attempt_v2(bigint,text) to service_role;
grant execute on function public.apply_billing_payment_attempt(bigint) to service_role;
grant execute on function public.finalize_store_billing_refund(bigint,text,text) to service_role;
grant execute on function public.finalize_due_referral_rewards() to service_role;
grant execute on function public.expire_billing_payment_attempts_v2() to service_role;

do $$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job_id from cron.job where jobname='rion-order-billing-attempt-expiry';
    if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
    perform cron.schedule('rion-order-billing-attempt-expiry','*/5 * * * *','select public.expire_billing_payment_attempts_v2()');
    select jobid into v_job_id from cron.job where jobname='rion-order-referral-reward-finalize';
    if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
    perform cron.schedule('rion-order-referral-reward-finalize','17 * * * *','select public.finalize_due_referral_rewards()');
  end if;
end $$;

commit;
select pg_notify('pgrst','reload schema');
