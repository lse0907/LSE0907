-- Step-copy v1 for admin pages
-- 1) categories copy
-- 2) options copy
-- 3) menus copy
-- Execute the whole script once in Supabase SQL editor.

begin;

create or replace function public.admin_copy_categories_v1(
  p_source_store_id text,
  p_target_store_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_source_count integer;
  v_target_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;

  if not exists (select 1 from public.store_members where store_id = p_source_store_id and user_id = v_uid) then
    raise exception '원본 매장 접근 권한이 없습니다.';
  end if;
  if not exists (select 1 from public.store_members where store_id = p_target_store_id and user_id = v_uid) then
    raise exception '대상 매장 접근 권한이 없습니다.';
  end if;

  select count(*) into v_source_count from public.menu_categories where store_id = p_source_store_id and coalesce(is_active, true) = true;
  if v_source_count = 0 then
    raise exception '원본 매장에 복사할 카테고리가 없습니다.';
  end if;

  select count(*) into v_target_count from public.menu_categories where store_id = p_target_store_id;
  if v_target_count > 0 then
    raise exception '대상 매장에 기존 카테고리가 있어 복사를 중단했습니다.';
  end if;

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
  where mc.store_id = p_source_store_id
    and coalesce(mc.is_active, true) = true;

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
set search_path = public
as $$
declare
  v_uid uuid;
  v_source_group_count integer;
  v_target_group_count integer;
  v_target_item_count integer;
  v_downgraded_exclusive_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;

  if not exists (select 1 from public.store_members where store_id = p_source_store_id and user_id = v_uid) then
    raise exception '원본 매장 접근 권한이 없습니다.';
  end if;
  if not exists (select 1 from public.store_members where store_id = p_target_store_id and user_id = v_uid) then
    raise exception '대상 매장 접근 권한이 없습니다.';
  end if;

  select count(*) into v_source_group_count from public.option_groups where store_id = p_source_store_id;
  if v_source_group_count = 0 then
    raise exception '원본 매장에 복사할 옵션이 없습니다.';
  end if;

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

  insert into tmp_group_map(source_group_id, target_group_id, source_scope)
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
  join tmp_group_map gm on gm.source_group_id = og.id
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
  join tmp_group_map gm on gm.source_group_id = oi.group_id
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
set search_path = public
as $$
declare
  v_uid uuid;
  v_source_menu_count integer;
  v_target_menu_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(trim(p_source_store_id), '') = '' or coalesce(trim(p_target_store_id), '') = '' then
    raise exception '원본/대상 매장 ID가 필요합니다.';
  end if;
  if p_source_store_id = p_target_store_id then
    raise exception '원본/대상 매장은 동일할 수 없습니다.';
  end if;

  if not exists (select 1 from public.store_members where store_id = p_source_store_id and user_id = v_uid) then
    raise exception '원본 매장 접근 권한이 없습니다.';
  end if;
  if not exists (select 1 from public.store_members where store_id = p_target_store_id and user_id = v_uid) then
    raise exception '대상 매장 접근 권한이 없습니다.';
  end if;

  if not exists (select 1 from public.menu_categories where store_id = p_target_store_id) then
    raise exception '카테고리 복사가 먼저 필요합니다.';
  end if;
  if not exists (select 1 from public.option_groups where store_id = p_target_store_id) then
    raise exception '옵션 복사가 먼저 필요합니다.';
  end if;

  select count(*) into v_source_menu_count from public.menu_items where store_id = p_source_store_id;
  if v_source_menu_count = 0 then
    raise exception '원본 매장에 복사할 메뉴가 없습니다.';
  end if;

  select count(*) into v_target_menu_count from public.menu_items where store_id = p_target_store_id;
  if v_target_menu_count > 0 then
    raise exception '대상 매장에 기존 메뉴가 있어 복사를 중단했습니다.';
  end if;

  create temporary table tmp_category_map(
    source_category_id text primary key,
    target_category_id text not null
  ) on commit drop;

  insert into tmp_category_map(source_category_id, target_category_id)
  select
    sc.id,
    tc.id
  from public.menu_categories sc
  join public.menu_categories tc
    on tc.store_id = p_target_store_id
   and lower(trim(tc.name)) = lower(trim(sc.name))
  where sc.store_id = p_source_store_id;

  create temporary table tmp_group_map(
    source_group_id text primary key,
    target_group_id text not null
  ) on commit drop;

  insert into tmp_group_map(source_group_id, target_group_id)
  select
    sg.id,
    tg.id
  from public.option_groups sg
  join public.option_groups tg
    on tg.store_id = p_target_store_id
   and lower(trim(tg.name)) = lower(trim(sg.name))
  where sg.store_id = p_source_store_id;

  create temporary table tmp_menu_map(
    source_menu_id text primary key,
    target_menu_id text not null
  ) on commit drop;

  insert into tmp_menu_map(source_menu_id, target_menu_id)
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
      join tmp_group_map gm on gm.source_group_id = src_gid
    ), array[]::text[]),
    sm.sort_order,
    cm.target_category_id,
    now(),
    now()
  from public.menu_items sm
  join tmp_menu_map mm on mm.source_menu_id = sm.id
  left join tmp_category_map cm on cm.source_category_id = sm.category_id
  where sm.store_id = p_source_store_id;

  create temporary table tmp_item_map(
    source_item_id text primary key,
    target_item_id text not null
  ) on commit drop;

  insert into tmp_item_map(source_item_id, target_item_id)
  select
    si.id,
    ti.id
  from public.option_items si
  join tmp_group_map gm on gm.source_group_id = si.group_id
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
  join tmp_menu_map mm on mm.source_menu_id = mop.menu_id
  join tmp_item_map im on im.source_item_id = mop.option_item_id
  where mop.store_id = p_source_store_id;

  return jsonb_build_object('ok', true, 'copied_menus', v_source_menu_count);
end;
$$;

commit;
