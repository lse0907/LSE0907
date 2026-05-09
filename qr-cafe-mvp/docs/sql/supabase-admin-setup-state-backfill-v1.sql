-- Backfill legacy stores as setup completed when setup-like data already exists.
update public.stores s
set
  setup_completed = true,
  setup_last_step = 4,
  setup_completed_at = coalesce(setup_completed_at, now())
where coalesce(s.setup_completed, false) = false
  and (
    exists (select 1 from public.menu_categories c where c.store_id = s.store_id)
    or exists (select 1 from public.menu_items m where m.store_id = s.store_id)
    or exists (select 1 from public.option_groups g where g.store_id = s.store_id)
    or exists (select 1 from public.option_items i where i.store_id = s.store_id)
  );
