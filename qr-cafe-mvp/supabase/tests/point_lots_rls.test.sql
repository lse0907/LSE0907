begin;

select plan(12);

select has_table('public', 'point_lots', 'point_lots exists');
select has_table(
  'public',
  'point_lot_allocations',
  'point_lot_allocations exists'
);
select has_view(
  'public',
  'customer_point_summaries',
  'expiry-aware customer summary exists'
);

select ok(
  not has_table_privilege('anon', 'public.point_lots', 'select,insert,update,delete'),
  'anon has no point lot privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.point_lots', 'select')
    and not has_table_privilege(
      'authenticated',
      'public.point_lots',
      'insert,update,delete'
    ),
  'authenticated can only select point lots'
);
select ok(
  has_table_privilege('authenticated', 'public.point_lot_allocations', 'select')
    and not has_table_privilege(
      'authenticated',
      'public.point_lot_allocations',
      'insert,update,delete'
    ),
  'authenticated can only select point allocations'
);
select ok(
  has_table_privilege('authenticated', 'public.customer_point_summaries', 'select'),
  'authenticated can read the RLS-backed point summary'
);
select ok(
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'customer_point_summaries'
      and 'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
  ),
  'customer point summary uses security_invoker'
);
select is(
  (
    select count(*)::integer
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'point_lots'
      and p.cmd = 'SELECT'
  ),
  2,
  'point_lots has separate self and store-member SELECT policies'
);
select is(
  (
    select count(*)::integer
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'point_lot_allocations'
      and p.cmd = 'SELECT'
  ),
  2,
  'point_lot_allocations has separate self and store-member SELECT policies'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_loyalty_on_paid_order(uuid,text,uuid,integer,integer,uuid,text)',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'public.apply_loyalty_on_paid_order(uuid,text,uuid,integer,integer,uuid,text)',
      'execute'
    ),
  'loyalty mutation remains server-only'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.consume_point_lots(uuid,text,uuid,integer,text,timestamptz)',
    'execute'
  ),
  'private lot mutator is not directly callable by service_role'
);

select * from finish();
rollback;
