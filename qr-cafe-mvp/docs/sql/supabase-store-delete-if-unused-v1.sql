-- QR Cafe - Store delete if unused v1
-- 목적: 운영 이력이 없는 매장만 관리자 화면에서 즉시 숨김(soft delete) 처리합니다.
-- 실행 위치: Supabase SQL Editor에서 전체 실행

create or replace function public.admin_check_store_delete_eligibility(p_store_id text)
returns table (
  can_delete boolean,
  message text,
  order_count integer,
  billing_payment_count integer,
  has_billing_history boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean := false;
  v_store_status text;
  v_order_count integer := 0;
  v_billing_payment_count integer := 0;
  v_has_billing_history boolean := false;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다.', 0, 0, false;
    return;
  end if;

  select exists (
    select 1
    from public.store_members sm
    where sm.store_id = p_store_id
      and sm.user_id = v_uid
      and sm.role = 'owner'
  ) into v_is_owner;

  if not v_is_owner then
    return query select false, '삭제 권한이 없습니다.', 0, 0, false;
    return;
  end if;

  select s.status
    into v_store_status
  from public.stores s
  where s.store_id = p_store_id;

  if not found then
    return query select false, '매장 정보를 찾을 수 없습니다.', 0, 0, false;
    return;
  end if;

  if coalesce(v_store_status, 'active') = 'deleted' then
    return query select false, '이미 삭제된 매장입니다.', 0, 0, false;
    return;
  end if;

  select count(*)::integer
    into v_order_count
  from public.orders o
  where o.store_id = p_store_id;

  select count(*)::integer
    into v_billing_payment_count
  from public.billing_payments bp
  where bp.store_id = p_store_id;

  select exists (
    select 1
    from public.store_billing sb
    where sb.store_id = p_store_id
      and (
        sb.base_plan_status in ('trialing', 'active', 'past_due')
        or sb.paid_until is not null
        or sb.current_plan_months is not null
      )
  ) or exists (
    select 1
    from public.store_addons sa
    where sa.store_id = p_store_id
      and (
        sa.prepay_addon_status in ('active', 'past_due')
        or sa.addon_paid_until is not null
        or sa.current_plan_months is not null
      )
  ) into v_has_billing_history;

  if v_order_count > 0 or v_billing_payment_count > 0 or v_has_billing_history then
    return query select false, '운영 이력이 있어 삭제할 수 없습니다.', v_order_count, v_billing_payment_count, v_has_billing_history;
    return;
  end if;

  return query select true, '운영 이력이 없어 삭제할 수 있습니다.', v_order_count, v_billing_payment_count, v_has_billing_history;
end;
$$;

create or replace function public.admin_soft_delete_store_if_unused(p_store_id text)
returns table (
  deleted boolean,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_check record;
begin
  select *
    into v_check
  from public.admin_check_store_delete_eligibility(p_store_id)
  limit 1;

  if not coalesce(v_check.can_delete, false) then
    return query select false, coalesce(v_check.message, '운영 이력이 있어 삭제할 수 없습니다.');
    return;
  end if;

  update public.stores
  set
    status = 'deleted',
    deleted_at = now(),
    deleted_by = v_uid,
    deactivated_at = null,
    deactivated_by = null,
    updated_at = now()
  where store_id = p_store_id
    and coalesce(status, 'active') <> 'deleted';

  if not found then
    return query select false, '매장 정보를 찾을 수 없습니다.';
    return;
  end if;

  return query select true, '매장이 삭제되었습니다.';
end;
$$;

revoke all on function public.admin_check_store_delete_eligibility(text) from public;
revoke all on function public.admin_soft_delete_store_if_unused(text) from public;

grant execute on function public.admin_check_store_delete_eligibility(text) to authenticated;
grant execute on function public.admin_soft_delete_store_if_unused(text) to authenticated;
