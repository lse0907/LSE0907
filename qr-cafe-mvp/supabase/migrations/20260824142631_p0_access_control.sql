-- P0 access-control hardening for customer orders, staff packing checks,
-- menu categories, privileged functions, and exposed views.
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
-- 2. Packing checks: authenticated store members/OPS read, server-only write.
-- ---------------------------------------------------------------------------

alter table public.order_item_packing_checks enable row level security;

drop policy if exists order_item_packing_checks_select on public.order_item_packing_checks;
drop policy if exists order_item_packing_checks_insert on public.order_item_packing_checks;
drop policy if exists order_item_packing_checks_update on public.order_item_packing_checks;

drop policy if exists order_item_packing_checks_select_store_member_or_ops
on public.order_item_packing_checks;
create policy order_item_packing_checks_select_store_member_or_ops
on public.order_item_packing_checks
for select
to authenticated
using (
  public.is_store_member(store_id)
  or public.is_ops_user()
);

revoke all privileges on table public.order_item_packing_checks from anon, authenticated;
grant select (order_item_id, checked)
on table public.order_item_packing_checks
to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Menu categories: public active reads, owner/OPS management only.
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
-- 4. Privileged mutation functions: server-only execution.
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

-- Legacy staff RPC and loyalty helpers are no longer called directly by the
-- browser. Their SECURITY DEFINER privileges must not remain public APIs.
revoke all privileges on function public.staff_update_order_items_status(
  text, uuid[], text, integer
) from public, anon, authenticated;
grant execute on function public.staff_update_order_items_status(
  text, uuid[], text, integer
) to service_role;

revoke all privileges on function public.issue_customer_coupon(
  text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.issue_customer_coupon(
  text, uuid, uuid
) to service_role;

revoke all privileges on function public.recalculate_customer_tier(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.recalculate_customer_tier(
  text, uuid
) to service_role;

-- Trigger functions do not need to be directly callable through the Data API.
revoke all privileges on function public.initialize_store_billing_account()
from public, anon, authenticated;
grant execute on function public.initialize_store_billing_account()
to service_role;

-- ---------------------------------------------------------------------------
-- 5. Authenticated admin helpers: remove unnecessary anonymous execution.
-- ---------------------------------------------------------------------------

revoke all privileges on function public.admin_cancel_customer_coupon(
  text, uuid
) from public, anon;
grant execute on function public.admin_cancel_customer_coupon(
  text, uuid
) to authenticated, service_role;

revoke all privileges on function public.admin_check_store_delete_eligibility(
  text
) from public, anon;
grant execute on function public.admin_check_store_delete_eligibility(
  text
) to authenticated, service_role;

revoke all privileges on function public.admin_copy_categories_v1(
  text, text
) from public, anon;
grant execute on function public.admin_copy_categories_v1(
  text, text
) to authenticated, service_role;

revoke all privileges on function public.admin_copy_menus_v1(
  text, text
) from public, anon;
grant execute on function public.admin_copy_menus_v1(
  text, text
) to authenticated, service_role;

revoke all privileges on function public.admin_copy_options_v1(
  text, text
) from public, anon;
grant execute on function public.admin_copy_options_v1(
  text, text
) to authenticated, service_role;

revoke all privileges on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) from public, anon;
grant execute on function public.admin_issue_coupon_to_selected_customers(
  text, uuid, uuid[], boolean
) to authenticated, service_role;

revoke all privileges on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) from public, anon;
grant execute on function public.admin_search_coupon_targets(
  text, text, text, integer, integer, integer, integer, integer, integer,
  uuid, boolean, integer
) to authenticated, service_role;

revoke all privileges on function public.admin_soft_delete_store_if_unused(
  text
) from public, anon;
grant execute on function public.admin_soft_delete_store_if_unused(
  text
) to authenticated, service_role;

revoke all privileges on function public.current_ops_role()
from public, anon;
grant execute on function public.current_ops_role()
to authenticated, service_role;

revoke all privileges on function public.get_store_names(text[])
from public, anon;
grant execute on function public.get_store_names(text[])
to authenticated, service_role;

-- RLS helper functions remain available only to signed-in users and the server.
-- They return authorization booleans and are intentionally used by the policies
-- above; anonymous callers do not need direct execution rights.
revoke execute on function public.is_store_member(text) from public, anon;
grant execute on function public.is_store_member(text) to authenticated, service_role;

revoke execute on function public.is_store_owner(text) from public, anon;
grant execute on function public.is_store_owner(text) to authenticated, service_role;

revoke execute on function public.is_ops_user() from public, anon;
grant execute on function public.is_ops_user() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Intentional public projections and RLS-respecting view.
-- ---------------------------------------------------------------------------

-- Checkout clients need these two safe projections before authentication.
-- They return only the public PG client key/MID or a checkout-mode boolean;
-- the store secret key is never returned.
revoke all privileges on function public.get_store_checkout_client_config(text)
from public, anon, authenticated;
grant execute on function public.get_store_checkout_client_config(text)
to anon, authenticated, service_role;

revoke all privileges on function public.get_store_checkout_mode(text)
from public, anon, authenticated;
grant execute on function public.get_store_checkout_mode(text)
to anon, authenticated, service_role;

-- Postgres 17 supports security_invoker views. Preserve the existing public
-- projection while making the underlying option/menu RLS policies effective.
alter view public.admin_option_groups_overview
set (security_invoker = true);

revoke all privileges on table public.admin_option_groups_overview
from public, anon, authenticated;
grant select on table public.admin_option_groups_overview
to anon, authenticated;

commit;
