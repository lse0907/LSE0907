begin;

-- Public settlement RPCs run as service_role with SECURITY INVOKER.
-- Grant only the private helpers required to recalculate the wallet balance.
grant usage on schema private to service_role;

grant execute on function private.current_available_points(
  uuid, text, timestamptz
) to service_role;

grant execute on function private.refresh_wallet_point_balance(
  uuid, text, timestamptz
) to service_role;

commit;
