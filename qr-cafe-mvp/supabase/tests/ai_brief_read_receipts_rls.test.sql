begin;

select plan(5);

select has_table('public', 'ai_brief_read_receipts', 'AI brief read receipt table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_brief_read_receipts'::regclass),
  'read receipts enforce row level security'
);
select ok(
  not has_table_privilege('anon', 'public.ai_brief_read_receipts', 'select,insert,update,delete'),
  'anon has no read receipt privileges'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_brief_read_receipts', 'select,insert,update,delete'),
  'authenticated users have no direct read receipt privileges'
);
select ok(
  has_table_privilege('service_role', 'public.ai_brief_read_receipts', 'select,insert,update,delete'),
  'server service role can manage read receipts'
);

select * from finish();
rollback;
