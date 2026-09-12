begin;

-- AI-S2: this is an approval ledger, not an execution queue. Every record
-- describes a proposed operational action and remains manual-only until a
-- later, separately reviewed executor is introduced.
create table public.ai_ops_approval_requests (
  id uuid primary key default gen_random_uuid(),
  store_id text references public.stores(store_id) on delete set null,
  request_type text not null check (request_type in ('support_action', 'refund_review', 'subscription_review', 'business_verification', 'incident_analysis')),
  source_kind text not null check (char_length(source_kind) between 1 and 80),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  title text not null check (char_length(title) between 1 and 200),
  change_summary text not null check (char_length(change_summary) between 1 and 1000),
  proposed_action text not null check (char_length(proposed_action) between 1 and 1000),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  execution_kind text not null default 'manual_only' check (execution_kind = 'manual_only'),
  status text not null default 'pending' check (status in ('pending', 'on_hold', 'approved', 'rejected', 'cancelled', 'completed')),
  created_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((reviewed_at is null and reviewed_by_user_id is null) or (reviewed_at is not null and reviewed_by_user_id is not null)),
  check ((status = 'pending' and reviewed_at is null and reviewed_by_user_id is null) or status <> 'pending')
);

create index idx_ai_ops_approval_requests_status_created
  on public.ai_ops_approval_requests(status, created_at desc);
create index idx_ai_ops_approval_requests_store_created
  on public.ai_ops_approval_requests(store_id, created_at desc);
create unique index uq_ai_ops_approval_requests_open_source
  on public.ai_ops_approval_requests(source_kind, source_reference)
  where status in ('pending', 'on_hold', 'approved');

create table public.ai_ops_approval_events (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.ai_ops_approval_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('proposal_created', 'held', 'approved', 'rejected', 'cancelled')),
  event_summary text not null check (char_length(event_summary) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index idx_ai_ops_approval_events_request_created
  on public.ai_ops_approval_events(approval_request_id, created_at asc);

create function public.prevent_ai_ops_approval_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'AI OPS approval audit events are append-only';
end;
$$;

create trigger prevent_ai_ops_approval_event_mutation
before update or delete on public.ai_ops_approval_events
for each row execute function public.prevent_ai_ops_approval_event_mutation();

-- The proposal and its first audit event must either both be recorded or both
-- roll back. This avoids a partially-created approval request without evidence.
create function public.log_ai_ops_approval_proposal()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  insert into public.ai_ops_approval_events (approval_request_id, actor_user_id, event_type, event_summary)
  values (new.id, new.created_by_user_id, 'proposal_created', 'AI 보조 제안을 승인함에 등록했습니다. 자동 실행은 허용되지 않습니다.');
  return new;
end;
$$;

create trigger log_ai_ops_approval_proposal
after insert on public.ai_ops_approval_requests
for each row execute function public.log_ai_ops_approval_proposal();

-- A single RPC keeps the decision and immutable audit event in one database
-- transaction. It intentionally cannot execute a refund, code change, DB
-- mutation, or permission change.
create function public.decide_ai_ops_approval_request(
  p_request_id uuid,
  p_decision text,
  p_actor_user_id uuid,
  p_decision_note text
)
returns public.ai_ops_approval_requests
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  target public.ai_ops_approval_requests;
  next_event text;
begin
  if p_decision not in ('on_hold', 'approved', 'rejected') then
    raise exception 'Unsupported approval decision';
  end if;
  if nullif(btrim(p_decision_note), '') is null then
    raise exception 'Decision note is required';
  end if;

  select * into target
  from public.ai_ops_approval_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Approval request not found';
  end if;
  if target.status not in ('pending', 'on_hold') then
    raise exception 'This approval request can no longer be decided';
  end if;

  next_event := case p_decision
    when 'on_hold' then 'held'
    when 'approved' then 'approved'
    else 'rejected'
  end;

  update public.ai_ops_approval_requests
  set status = p_decision,
      reviewed_by_user_id = p_actor_user_id,
      reviewed_at = now(),
      decision_note = nullif(btrim(p_decision_note), ''),
      updated_at = now()
  where id = p_request_id
  returning * into target;

  insert into public.ai_ops_approval_events (approval_request_id, actor_user_id, event_type, event_summary)
  values (target.id, p_actor_user_id, next_event, coalesce(nullif(btrim(p_decision_note), ''), '승인함에서 상태를 변경했습니다.'));

  return target;
end;
$$;

alter table public.ai_ops_approval_requests enable row level security;
alter table public.ai_ops_approval_events enable row level security;

revoke all on table public.ai_ops_approval_requests from public, anon, authenticated;
revoke all on table public.ai_ops_approval_events from public, anon, authenticated;
revoke all on function public.prevent_ai_ops_approval_event_mutation() from public, anon, authenticated;
revoke all on function public.log_ai_ops_approval_proposal() from public, anon, authenticated;
revoke all on function public.decide_ai_ops_approval_request(uuid, text, uuid, text) from public, anon, authenticated;

grant select, insert, update, delete on table public.ai_ops_approval_requests to service_role;
grant select, insert, update, delete on table public.ai_ops_approval_events to service_role;
grant execute on function public.decide_ai_ops_approval_request(uuid, text, uuid, text) to service_role;

comment on table public.ai_ops_approval_requests is
  'Server-only, manual-only approval ledger for proposed AI-assisted OPS actions. It does not execute refunds, code, database changes, subscriptions, or permissions.';
comment on table public.ai_ops_approval_events is
  'Append-only audit history for AI OPS approval decisions. Do not store customer, payment, account, or diagnostic secrets.';
comment on function public.decide_ai_ops_approval_request(uuid, text, uuid, text) is
  'Atomically records a master-authorized decision and audit event; no operational action is executed.';

commit;
