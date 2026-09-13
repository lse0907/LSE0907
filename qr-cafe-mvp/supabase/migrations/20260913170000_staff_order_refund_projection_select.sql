-- Staff order screen: permit the three safe refund projections it renders.
--
-- Row access remains constrained by the existing
-- orders_select_store_member_or_ops RLS policy. This does not grant access to
-- payment identifiers, customer details, or any other order columns.

grant select (
  refunded_count,
  adjusted_total_price,
  refunded_amount
) on table public.orders to authenticated;
