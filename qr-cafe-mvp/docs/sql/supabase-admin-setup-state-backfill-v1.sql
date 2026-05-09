-- Backfill legacy stores as setup completed when BOTH category/menu data exist.
-- Run once.
update public.stores s
set
  setup_completed = true,
  setup_last_step = 4,
  setup_completed_at = coalesce(setup_completed_at, now())
where coalesce(s.setup_completed, false) = false
  and exists (select 1 from public.menu_categories c where c.store_id = s.store_id)
  and exists (select 1 from public.menu_items m where m.store_id = s.store_id);
