begin;

-- A referral belongs to the owner account, not to every individual store the
-- owner operates. store_id remains the representative store for the existing
-- billing reward ledger and for compatibility with already shared links.
alter table public.store_referral_codes
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

-- Keep historical codes usable. For each owner, promote only the oldest active
-- code to the account-level code; other historical store codes intentionally
-- remain active without owner_user_id so an already shared link is not broken.
with candidates as (
  select
    src.id,
    coalesce(src.issued_by, s.owner_user_id, owner_member.user_id) as resolved_owner_user_id,
    row_number() over (
      partition by coalesce(src.issued_by, s.owner_user_id, owner_member.user_id)
      order by src.created_at asc, src.id asc
    ) as owner_rank
  from public.store_referral_codes src
  join public.stores s on s.store_id = src.store_id
  left join lateral (
    select sm.user_id
    from public.store_members sm
    where sm.store_id = src.store_id and sm.role = 'owner'
    order by sm.user_id asc
    limit 1
  ) owner_member on true
  where src.is_active
)
update public.store_referral_codes code
set owner_user_id = candidates.resolved_owner_user_id
from candidates
where code.id = candidates.id
  and candidates.resolved_owner_user_id is not null
  and candidates.owner_rank = 1;

create unique index if not exists uq_store_referral_codes_active_owner
  on public.store_referral_codes(owner_user_id)
  where is_active and owner_user_id is not null;

create index if not exists idx_store_referral_codes_owner
  on public.store_referral_codes(owner_user_id, created_at desc)
  where owner_user_id is not null;

comment on column public.store_referral_codes.owner_user_id is
  'The owner account that owns the canonical referral code. Legacy store codes keep this null so already issued links remain usable.';

commit;
