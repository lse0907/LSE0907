-- P0-A privacy and privileged RPC hardening.
--
-- Safe rollout order:
--   1. Deploy the server routes and clients in this change. They retain a
--      temporary, Owner/Manager-checked fallback for the legacy functions.
--   2. Apply this migration.
--   3. Verify authenticated direct RPC calls fail and server routes succeed.
--
-- No customer, order, coupon, point, menu, or member rows are changed here.

begin;

create or replace function public.admin_search_coupon_targets(
  p_store_id text,
  p_query text default '',
  p_tier text default 'all',
  p_min_points integer default 0,
  p_min_orders integer default 0,
  p_min_spent integer default 0,
  p_recent_days integer default null,
  p_inactive_days integer default null,
  p_registered_min_days integer default null,
  p_template_id uuid default null,
  p_exclude_existing boolean default true,
  p_limit integer default 100
)
returns table (
  customer_user_id uuid,
  name text,
  phone text,
  point_balance integer,
  tier text,
  lifetime_spent integer,
  lifetime_orders integer,
  last_order_at timestamptz,
  registered_at timestamptz,
  already_has_coupon boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_query text := trim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  -- Authorization is enforced by the Owner-only server route. Direct
  -- execution is restricted to service_role at the end of this transaction.
  return query
  with latest_orders as (
    select o.customer_user_id, max(o.created_at) as last_order_at
    from public.orders o
    where o.store_id = p_store_id
      and o.customer_user_id is not null
    group by o.customer_user_id
  ), target_rows as (
    select
      w.customer_user_id,
      cp.name,
      cp.phone,
      w.point_balance,
      w.tier,
      w.lifetime_spent,
      w.lifetime_orders,
      coalesce(w.last_order_at, lo.last_order_at) as last_order_at,
      w.created_at as registered_at,
      exists (
        select 1
        from public.customer_coupons cc
        where cc.store_id = p_store_id
          and cc.customer_user_id = w.customer_user_id
          and cc.template_id = p_template_id
          and cc.status <> 'cancelled'
      ) as already_has_coupon
    from public.customer_store_wallets w
    left join public.customer_profiles cp on cp.user_id = w.customer_user_id
    left join latest_orders lo on lo.customer_user_id = w.customer_user_id
    where w.store_id = p_store_id
      and (coalesce(p_tier, 'all') = 'all' or w.tier = p_tier)
      and w.point_balance >= greatest(coalesce(p_min_points, 0), 0)
      and w.lifetime_orders >= greatest(coalesce(p_min_orders, 0), 0)
      and w.lifetime_spent >= greatest(coalesce(p_min_spent, 0), 0)
      and (
        v_query = ''
        or coalesce(cp.name, '') ilike '%' || v_query || '%'
        or coalesce(cp.phone, '') ilike '%' || v_query || '%'
        or w.customer_user_id::text ilike '%' || v_query || '%'
      )
      and (
        p_recent_days is null
        or coalesce(w.last_order_at, lo.last_order_at) >= now() - make_interval(days => greatest(p_recent_days, 0))
      )
      and (
        p_inactive_days is null
        or coalesce(w.last_order_at, lo.last_order_at, 'epoch'::timestamptz) < now() - make_interval(days => greatest(p_inactive_days, 0))
      )
      and (
        p_registered_min_days is null
        or w.created_at <= now() - make_interval(days => greatest(p_registered_min_days, 0))
      )
  )
  select *
  from target_rows tr
  where not (coalesce(p_exclude_existing, true) and p_template_id is not null and tr.already_has_coupon)
  order by tr.tier desc, tr.lifetime_spent desc, tr.lifetime_orders desc, tr.registered_at desc
  limit v_limit;
end;
$$;

create or replace function public.admin_copy_categories_v1(
  p_source_store_id text,
  p_target_store_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_count integer;
  v_target_count integer;
begin
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;
  -- Both-store Owner/Manager authorization is enforced by the server route.
  select count(*) into v_source_count
  from public.menu_categories
  where store_id = p_source_store_id and coalesce(is_active, true) = true;
  if v_source_count = 0 then raise exception '원본 매장에 복사할 카테고리가 없습니다.'; end if;

  select count(*) into v_target_count from public.menu_categories where store_id = p_target_store_id;
  if v_target_count > 0 then raise exception '대상 매장에 기존 카테고리가 있어 복사를 중단했습니다.'; end if;

  insert into public.menu_categories (id, store_id, name, sort_order, is_active, created_at, updated_at)
  select
    'cat_' || substr(md5(random()::text || clock_timestamp()::text || mc.id), 1, 20),
    p_target_store_id,
    mc.name,
    mc.sort_order,
    coalesce(mc.is_active, true),
    now(),
    now()
  from public.menu_categories mc
  where mc.store_id = p_source_store_id and coalesce(mc.is_active, true) = true;

  return jsonb_build_object('ok', true, 'copied_categories', v_source_count);
end;
$$;

create or replace function public.admin_copy_options_v1(
  p_source_store_id text,
  p_target_store_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_group_count integer;
  v_target_group_count integer;
  v_target_item_count integer;
  v_downgraded_exclusive_count integer;
begin
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;
  -- Both-store Owner/Manager authorization is enforced by the server route.
  select count(*) into v_source_group_count from public.option_groups where store_id = p_source_store_id;
  if v_source_group_count = 0 then raise exception '원본 매장에 복사할 옵션이 없습니다.'; end if;

  select count(*) into v_target_group_count from public.option_groups where store_id = p_target_store_id;
  select count(*) into v_target_item_count from public.option_items where store_id = p_target_store_id;
  if v_target_group_count > 0 or v_target_item_count > 0 then
    raise exception '대상 매장에 기존 옵션 데이터가 있어 복사를 중단했습니다.';
  end if;

  create temporary table tmp_group_map(
    source_group_id text primary key,
    target_group_id text not null,
    source_scope text null
  ) on commit drop;

  insert into pg_temp.tmp_group_map(source_group_id, target_group_id, source_scope)
  select
    og.id,
    'group_' || substr(md5(random()::text || clock_timestamp()::text || og.id), 1, 20),
    coalesce(og.scope, 'common')
  from public.option_groups og
  where og.store_id = p_source_store_id;

  insert into public.option_groups (id, store_id, name, required, min, max, scope, linked_menu_id, created_at, updated_at)
  select
    gm.target_group_id,
    p_target_store_id,
    og.name,
    coalesce(og.required, false),
    coalesce(og.min, 0),
    coalesce(og.max, 1),
    case when coalesce(og.scope, 'common') = 'exclusive' then 'common' else coalesce(og.scope, 'common') end,
    null,
    now(),
    now()
  from public.option_groups og
  join pg_temp.tmp_group_map gm on gm.source_group_id = og.id
  where og.store_id = p_source_store_id;

  select count(*) into v_downgraded_exclusive_count
  from public.option_groups
  where store_id = p_source_store_id and coalesce(scope, 'common') = 'exclusive';

  insert into public.option_items (id, store_id, group_id, name, price_delta, created_at, updated_at)
  select
    'opt_' || substr(md5(random()::text || clock_timestamp()::text || oi.id), 1, 20),
    p_target_store_id,
    gm.target_group_id,
    oi.name,
    coalesce(oi.price_delta, 0),
    now(),
    now()
  from public.option_items oi
  join pg_temp.tmp_group_map gm on gm.source_group_id = oi.group_id
  where oi.store_id = p_source_store_id;

  return jsonb_build_object(
    'ok', true,
    'copied_groups', v_source_group_count,
    'downgraded_exclusive_groups', v_downgraded_exclusive_count
  );
end;
$$;

create or replace function public.admin_copy_menus_v1(
  p_source_store_id text,
  p_target_store_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_menu_count integer;
  v_target_menu_count integer;
begin
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;
  -- Both-store Owner/Manager authorization is enforced by the server route.
  if not exists (select 1 from public.menu_categories where store_id = p_target_store_id) then
    raise exception '카테고리 복사가 먼저 필요합니다.';
  end if;
  if not exists (select 1 from public.option_groups where store_id = p_target_store_id) then
    raise exception '옵션 복사가 먼저 필요합니다.';
  end if;

  select count(*) into v_source_menu_count from public.menu_items where store_id = p_source_store_id;
  if v_source_menu_count = 0 then raise exception '원본 매장에 복사할 메뉴가 없습니다.'; end if;

  select count(*) into v_target_menu_count from public.menu_items where store_id = p_target_store_id;
  if v_target_menu_count > 0 then raise exception '대상 매장에 기존 메뉴가 있어 복사를 중단했습니다.'; end if;

  create temporary table tmp_category_map(
    source_category_id text primary key,
    target_category_id text not null
  ) on commit drop;

  insert into pg_temp.tmp_category_map(source_category_id, target_category_id)
  select sc.id, tc.id
  from public.menu_categories sc
  join public.menu_categories tc
    on tc.store_id = p_target_store_id
   and lower(trim(tc.name)) = lower(trim(sc.name))
  where sc.store_id = p_source_store_id;

  create temporary table tmp_group_map(
    source_group_id text primary key,
    target_group_id text not null
  ) on commit drop;

  insert into pg_temp.tmp_group_map(source_group_id, target_group_id)
  select sg.id, tg.id
  from public.option_groups sg
  join public.option_groups tg
    on tg.store_id = p_target_store_id
   and lower(trim(tg.name)) = lower(trim(sg.name))
  where sg.store_id = p_source_store_id;

  create temporary table tmp_menu_map(
    source_menu_id text primary key,
    target_menu_id text not null
  ) on commit drop;

  insert into pg_temp.tmp_menu_map(source_menu_id, target_menu_id)
  select
    sm.id,
    'menu_' || substr(md5(random()::text || clock_timestamp()::text || sm.id), 1, 20)
  from public.menu_items sm
  where sm.store_id = p_source_store_id;

  insert into public.menu_items (id, store_id, name, price, image, is_sold_out, option_group_ids, sort_order, category_id, created_at, updated_at)
  select
    mm.target_menu_id,
    p_target_store_id,
    sm.name,
    coalesce(sm.price, 0),
    sm.image,
    coalesce(sm.is_sold_out, false),
    coalesce((
      select array_agg(gm.target_group_id)
      from unnest(coalesce(sm.option_group_ids, array[]::text[])) as src_gid
      join pg_temp.tmp_group_map gm on gm.source_group_id = src_gid
    ), array[]::text[]),
    sm.sort_order,
    cm.target_category_id,
    now(),
    now()
  from public.menu_items sm
  join pg_temp.tmp_menu_map mm on mm.source_menu_id = sm.id
  left join pg_temp.tmp_category_map cm on cm.source_category_id = sm.category_id
  where sm.store_id = p_source_store_id;

  create temporary table tmp_item_map(
    source_item_id text primary key,
    target_item_id text not null
  ) on commit drop;

  insert into pg_temp.tmp_item_map(source_item_id, target_item_id)
  select si.id, ti.id
  from public.option_items si
  join pg_temp.tmp_group_map gm on gm.source_group_id = si.group_id
  join public.option_items ti
    on ti.store_id = p_target_store_id
   and ti.group_id = gm.target_group_id
   and lower(trim(ti.name)) = lower(trim(si.name))
  where si.store_id = p_source_store_id;

  insert into public.menu_option_prices (store_id, menu_id, option_item_id, price_delta)
  select
    p_target_store_id,
    mm.target_menu_id,
    im.target_item_id,
    coalesce(mop.price_delta, 0)
  from public.menu_option_prices mop
  join pg_temp.tmp_menu_map mm on mm.source_menu_id = mop.menu_id
  join pg_temp.tmp_item_map im on im.source_item_id = mop.option_item_id
  where mop.store_id = p_source_store_id;

  return jsonb_build_object('ok', true, 'copied_menus', v_source_menu_count);
end;
$$;

revoke all privileges on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) from public, anon, authenticated;
grant execute on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) to service_role;

revoke all privileges on function public.admin_copy_categories_v1(text, text)
from public, anon, authenticated;
grant execute on function public.admin_copy_categories_v1(text, text)
to service_role;

revoke all privileges on function public.admin_copy_menus_v1(text, text)
from public, anon, authenticated;
grant execute on function public.admin_copy_menus_v1(text, text)
to service_role;

revoke all privileges on function public.admin_copy_options_v1(text, text)
from public, anon, authenticated;
grant execute on function public.admin_copy_options_v1(text, text)
to service_role;

commit;
