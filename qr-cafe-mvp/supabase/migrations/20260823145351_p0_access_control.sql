-- P0 access-control hardening for customer orders and menu categories.
--
-- Deployment order:
--   1. Deploy the customer order-view API and clients first.
--   2. Apply this migration.
--   3. Run the verification queries in docs/security/p0-access-control-runbook.md.
--
-- This migration deliberately removes direct anonymous order access. New orders,
-- customer lookups, status changes, cancellations, and loyalty operations must go
-- through server routes using the service role.

begin;

-- ---------------------------------------------------------------------------
-- 1. Orders: remove public read/write policies and table-wide grants.
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;

drop policy if exists public_select_orders on public.orders;
drop policy if exists public_insert_orders on public.orders;
drop policy if exists member_update_orders_status on public.orders;

drop policy if exists public_select_order_items on public.order_items;
drop policy if exists public_insert_order_items on public.order_items;

drop policy if exists public_select_order_item_options on public.order_item_options;
drop policy if exists public_insert_order_item_options on public.order_item_options;

drop policy if exists orders_select_store_member_or_ops on public.orders;
create policy orders_select_store_member_or_ops
on public.orders
for select
to authenticated
using (
  public.is_store_member(store_id)
  or public.is_ops_user()
);

drop policy if exists order_items_select_store_member_or_ops on public.order_items;
create policy order_items_select_store_member_or_ops
on public.order_items
for select
to authenticated
using (
  public.is_store_member(store_id)
  or public.is_ops_user()
);

drop policy if exists order_item_options_select_store_member_or_ops on public.order_item_options;
create policy order_item_options_select_store_member_or_ops
on public.order_item_options
for select
to authenticated
using (
  public.is_store_member(store_id)
  or public.is_ops_user()
);

revoke all privileges on table public.orders from anon, authenticated;
revoke all privileges on table public.order_items from anon, authenticated;
revoke all privileges on table public.order_item_options from anon, authenticated;

-- Authenticated store members and OPS only receive the columns used by the
-- staff/admin/OPS clients. Customer tokens, payment identifiers, customer IDs,
-- and loyalty snapshots remain server-only.
grant select (
  id,
  created_at,
  order_date,
  display_no,
  mode,
  table_no,
  buzzer_no,
  request_note,
  total_count,
  total_price,
  status,
  store_id,
  payment_status
) on table public.orders to authenticated;

grant select on table public.order_items to authenticated;
grant select on table public.order_item_options to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Menu categories: public active reads, owner/OPS management only.
-- ---------------------------------------------------------------------------

alter table public.menu_categories enable row level security;

drop policy if exists menu_categories_public_select_active on public.menu_categories;
create policy menu_categories_public_select_active
on public.menu_categories
for select
to anon, authenticated
using (coalesce(is_active, true));

drop policy if exists menu_categories_owner_ops_select_all on public.menu_categories;
create policy menu_categories_owner_ops_select_all
on public.menu_categories
for select
to authenticated
using (
  public.is_store_owner(store_id)
  or public.is_ops_user()
);

drop policy if exists menu_categories_owner_ops_insert on public.menu_categories;
create policy menu_categories_owner_ops_insert
on public.menu_categories
for insert
to authenticated
with check (
  public.is_store_owner(store_id)
  or public.is_ops_user()
);

drop policy if exists menu_categories_owner_ops_update on public.menu_categories;
create policy menu_categories_owner_ops_update
on public.menu_categories
for update
to authenticated
using (
  public.is_store_owner(store_id)
  or public.is_ops_user()
)
with check (
  public.is_store_owner(store_id)
  or public.is_ops_user()
);

drop policy if exists menu_categories_owner_ops_delete on public.menu_categories;
create policy menu_categories_owner_ops_delete
on public.menu_categories
for delete
to authenticated
using (
  public.is_store_owner(store_id)
  or public.is_ops_user()
);

revoke all privileges on table public.menu_categories from anon, authenticated;
grant select on table public.menu_categories to anon, authenticated;
grant insert, update, delete on table public.menu_categories to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Privileged functions: server-only execution.
-- ---------------------------------------------------------------------------

revoke all privileges on function public.apply_loyalty_on_paid_order(
  uuid, text, uuid, integer, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.apply_loyalty_on_paid_order(
  uuid, text, uuid, integer, integer, uuid, text
) to service_role;

revoke all privileges on function public.finalize_order_rewards(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.finalize_order_rewards(
  text, uuid
) to service_role;

revoke all privileges on function public.rollback_order_rewards(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.rollback_order_rewards(
  text, uuid
) to service_role;

revoke all privileges on function public.apply_store_billing_payment(
  text, integer, boolean, boolean, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.apply_store_billing_payment(
  text, integer, boolean, boolean, text, text, integer, text
) to service_role;

-- RLS helper functions remain available only to signed-in users and the server.
-- They return authorization booleans and are intentionally used by the policies
-- above; anonymous callers do not need direct execution rights.
revoke execute on function public.is_store_member(text) from public, anon;
grant execute on function public.is_store_member(text) to authenticated, service_role;

revoke execute on function public.is_store_owner(text) from public, anon;
grant execute on function public.is_store_owner(text) to authenticated, service_role;

revoke execute on function public.is_ops_user() from public, anon;
grant execute on function public.is_ops_user() to authenticated, service_role;

commit;
