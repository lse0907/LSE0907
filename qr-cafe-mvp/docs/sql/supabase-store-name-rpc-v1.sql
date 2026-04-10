-- =========================================================
-- QR Cafe MVP - Store Name RPC for customer app
-- Date: 2026-04-10
-- Purpose:
--  1) Customer 앱에서 store_id 배열로 매장명 조회
--  2) RLS와 무관하게 필요한 최소 컬럼만 안전하게 반환
-- =========================================================

begin;

create or replace function public.get_store_names(p_store_ids text[])
returns table (store_id text, store_name text)
language sql
security definer
set search_path = public
as $$
  select s.store_id, s.store_name
  from public.stores s
  where s.store_id = any(coalesce(p_store_ids, array[]::text[]));
$$;

revoke all on function public.get_store_names(text[]) from public;
grant execute on function public.get_store_names(text[]) to authenticated;

commit;
