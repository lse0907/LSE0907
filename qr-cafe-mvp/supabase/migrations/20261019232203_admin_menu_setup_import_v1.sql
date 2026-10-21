-- Initial, empty-store import only. Nothing here rewrites existing menus or QR codes.
create table public.menu_setup_imports (
  store_id text primary key references public.stores(store_id) on delete cascade,
  request_id uuid not null,
  draft_hash text not null check (draft_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.menu_setup_imports enable row level security;
revoke all on public.menu_setup_imports from public, anon, authenticated;
grant select, insert on public.menu_setup_imports to service_role;

create function public.admin_import_menu_setup_v1(
  p_store_id text, p_actor_id uuid, p_request_id uuid, p_draft_hash text, p_plan jsonb
) returns jsonb
language plpgsql security invoker
set search_path = ''
set lock_timeout = '2s'
as $function$
declare
  v_store public.stores%rowtype;
  v_previous public.menu_setup_imports%rowtype;
  v_result jsonb;
  v_categories jsonb := p_plan->'categoryRows';
  v_menus jsonb := p_plan->'menuRows';
  v_groups jsonb := p_plan->'groupRows';
  v_items jsonb := p_plan->'optionRows';
  v_prices jsonb := p_plan->'priceRows';
begin
  if current_user <> 'service_role' then raise exception 'MENU_SETUP_SERVER_ONLY' using errcode = '42501'; end if;
  if p_store_id is null or btrim(p_store_id) = '' or p_actor_id is null or p_request_id is null
    or p_draft_hash is null or p_draft_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'MENU_SETUP_INVALID_REQUEST' using errcode = '22023';
  end if;
  -- Serialize imports for a store, including replay after a lost HTTP response.
  select * into v_store from public.stores where store_id = p_store_id for update;
  if not found or v_store.status <> 'active' then raise exception 'MENU_SETUP_STORE_UNAVAILABLE'; end if;
  perform 1 from public.store_members where store_id = p_store_id and user_id = p_actor_id and role = 'owner' for share;
  if not found then raise exception 'MENU_SETUP_OWNER_REQUIRED' using errcode = '42501'; end if;
  select * into v_previous from public.menu_setup_imports where store_id = p_store_id;
  if found then
    if v_previous.request_id = p_request_id and v_previous.draft_hash = p_draft_hash and v_previous.actor_id = p_actor_id then
      return v_previous.result || jsonb_build_object('replayed', true);
    end if;
    raise exception 'MENU_SETUP_ALREADY_IMPORTED';
  end if;
  if v_store.setup_completed then raise exception 'MENU_SETUP_TARGET_NOT_EMPTY'; end if;
  if jsonb_typeof(v_categories) is distinct from 'array' or jsonb_typeof(v_menus) is distinct from 'array'
    or jsonb_typeof(v_groups) is distinct from 'array' or jsonb_typeof(v_items) is distinct from 'array'
    or jsonb_typeof(v_prices) is distinct from 'array' then raise exception 'MENU_SETUP_INVALID_PLAN'; end if;
  if jsonb_array_length(v_categories) not between 1 and 100 or jsonb_array_length(v_menus) not between 1 and 500
    or jsonb_array_length(v_groups) > 200 or jsonb_array_length(v_items) > 4000 or jsonb_array_length(v_prices) > 20000 then
    raise exception 'MENU_SETUP_INVALID_PLAN';
  end if;
  -- Legacy admin writers do not take our store lock. A short, bounded table lock also
  -- closes the empty-check race with those writers; no triggers/legacy routes change.
  -- Lock order is fixed. On contention, fail/retry manually, never wait indefinitely.
  lock table public.menu_categories, public.menu_items, public.option_groups,
    public.option_items, public.menu_option_prices, public.menu_option_item_exclusions in share row exclusive mode;
  if exists(select 1 from public.menu_categories where store_id=p_store_id)
    or exists(select 1 from public.menu_items where store_id=p_store_id)
    or exists(select 1 from public.option_groups where store_id=p_store_id)
    or exists(select 1 from public.option_items where store_id=p_store_id)
    or exists(select 1 from public.menu_option_prices where store_id=p_store_id)
    or exists(select 1 from public.menu_option_item_exclusions where store_id=p_store_id) then
    raise exception 'MENU_SETUP_TARGET_NOT_EMPTY';
  end if;
  if exists(select 1 from jsonb_array_elements(v_categories || v_menus || v_groups || v_items) r
    where r->>'store_id' is distinct from p_store_id or coalesce(r->>'id','') !~ '^[a-zA-Z0-9_]{1,40}$'
      or btrim(coalesce(r->>'name','')) = '')
    or exists(select 1 from jsonb_array_elements(v_prices) r where r->>'store_id' is distinct from p_store_id) then
    raise exception 'MENU_SETUP_INVALID_PLAN';
  end if;
  insert into public.menu_categories(id,store_id,name,sort_order,is_active)
    select id,store_id,name,sort_order,true from jsonb_to_recordset(v_categories) as r(id text,store_id text,name text,sort_order integer);
  -- Exclusive groups reference menus, so menus must be inserted before groups.
  insert into public.menu_items(id,store_id,name,price,image,is_sold_out,category_id,option_group_ids,option_not_required,sort_order)
    select id,store_id,name,price,'',false,category_id,option_group_ids,option_not_required,sort_order
    from jsonb_to_recordset(v_menus) as r(id text,store_id text,name text,price integer,category_id text,option_group_ids text[],option_not_required boolean,sort_order integer);
  insert into public.option_groups(id,store_id,name,scope,linked_menu_id,required,min,max,sort_order)
    select id,store_id,name,scope,linked_menu_id,required,min,max,sort_order from jsonb_to_recordset(v_groups)
    as r(id text,store_id text,name text,scope text,linked_menu_id text,required boolean,min integer,max integer,sort_order integer);
  insert into public.option_items(id,store_id,group_id,name,price_delta)
    select id,store_id,group_id,name,price_delta from jsonb_to_recordset(v_items) as r(id text,store_id text,group_id text,name text,price_delta integer);
  insert into public.menu_option_prices(store_id,menu_id,option_item_id,price_delta)
    select store_id,menu_id,option_item_id,price_delta from jsonb_to_recordset(v_prices) as r(store_id text,menu_id text,option_item_id text,price_delta integer);
  -- Cross-store references are not protected by every legacy FK. Check all links
  -- inside this transaction; any error rolls back categories, menus, options AND receipt.
  if exists(select 1 from public.menu_items m left join public.menu_categories c on c.id=m.category_id
    where m.store_id=p_store_id and (c.store_id is distinct from p_store_id or m.price<0
      or m.option_not_required is distinct from (cardinality(m.option_group_ids)=0)
      or cardinality(m.option_group_ids) <> (select count(distinct x) from unnest(m.option_group_ids) x)))
    or exists(select 1 from public.menu_items m cross join lateral unnest(m.option_group_ids) as connected(group_id)
      left join public.option_groups g on g.id=connected.group_id where m.store_id=p_store_id
      and (g.store_id is distinct from p_store_id or (g.scope='exclusive' and g.linked_menu_id<>m.id)))
    or exists(select 1 from public.option_groups g left join public.menu_items m on m.id=g.linked_menu_id
      where g.store_id=p_store_id and (g.min is distinct from case when g.required then 1 else 0 end or g.max<1
        or g.max>(select count(*) from public.option_items i where i.group_id=g.id and i.store_id=p_store_id)
        or (g.scope='exclusive' and (m.store_id is distinct from p_store_id or not(g.id=any(m.option_group_ids))))
        or not exists(select 1 from public.menu_items linked where linked.store_id=p_store_id and g.id=any(linked.option_group_ids))))
    or exists(select 1 from public.option_items i left join public.option_groups g on g.id=i.group_id
      where i.store_id=p_store_id and (g.store_id is distinct from p_store_id or i.price_delta<0))
    or exists(select 1 from public.menu_option_prices p left join public.menu_items m on m.id=p.menu_id
      left join public.option_items i on i.id=p.option_item_id where p.store_id=p_store_id
      and (m.store_id is distinct from p_store_id or i.store_id is distinct from p_store_id or p.price_delta<0 or not(i.group_id=any(m.option_group_ids))))
    or exists(select 1 from public.menu_items m join public.option_items i on i.group_id=any(m.option_group_ids) and i.store_id=p_store_id
      left join public.menu_option_prices p on p.store_id=p_store_id and p.menu_id=m.id and p.option_item_id=i.id
      where m.store_id=p_store_id and p.menu_id is null) then
    raise exception 'MENU_SETUP_INVALID_LINKS';
  end if;
  update public.stores set setup_step1_confirmed=true,setup_step2_confirmed=true,setup_step3_confirmed=true,
    setup_last_step=4 where store_id=p_store_id;
  -- setup_completed remains false. QR records are untouched; step 5 requires explicit review.
  v_result := jsonb_build_object('storeId',p_store_id,'categories',jsonb_array_length(v_categories),'menus',jsonb_array_length(v_menus),
    'groups',jsonb_array_length(v_groups),'optionItems',jsonb_array_length(v_items),'priceOverrides',jsonb_array_length(v_prices),'replayed',false);
  insert into public.menu_setup_imports(store_id,request_id,draft_hash,actor_id,result) values(p_store_id,p_request_id,p_draft_hash,p_actor_id,v_result);
  return v_result;
end;
$function$;
revoke all on function public.admin_import_menu_setup_v1(text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_import_menu_setup_v1(text,uuid,uuid,text,jsonb) to service_role;
