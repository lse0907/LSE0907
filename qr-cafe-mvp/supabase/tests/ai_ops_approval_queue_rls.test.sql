begin;

select plan(12);

select has_table('public', 'ai_ops_approval_requests', 'AI OPS approval request table exists');
select has_table('public', 'ai_ops_approval_events', 'AI OPS approval audit table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_ops_approval_requests'::regclass),
  'approval requests enforce row level security'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_ops_approval_events'::regclass),
  'approval events enforce row level security'
);
select ok(
  not has_table_privilege('anon', 'public.ai_ops_approval_requests', 'select,insert,update,delete'),
  'anon cannot access approval requests'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_ops_approval_requests', 'select,insert,update,delete'),
  'authenticated users cannot access approval requests directly'
);
select ok(
  not has_table_privilege('anon', 'public.ai_ops_approval_events', 'select,insert,update,delete'),
  'anon cannot access approval audit events'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_ops_approval_events', 'select,insert,update,delete'),
  'authenticated users cannot access approval audit events directly'
);
select ok(
  has_table_privilege('service_role', 'public.ai_ops_approval_requests', 'select,insert,update,delete'),
  'server service role can manage approval requests'
);
select ok(
  has_function('public', 'decide_ai_ops_approval_request', array['uuid', 'text', 'uuid', 'text'], 'decision RPC exists');
select ok(
  not has_function_privilege('anon', 'public.decide_ai_ops_approval_request(uuid, text, uuid, text)', 'execute'),
  'anon cannot execute the approval decision RPC'
);
select ok(
  has_function_privilege('service_role', 'public.decide_ai_ops_approval_request(uuid, text, uuid, text)', 'execute'),
  'server service role can execute the approval decision RPC'
);

select * from finish();
rollback;
