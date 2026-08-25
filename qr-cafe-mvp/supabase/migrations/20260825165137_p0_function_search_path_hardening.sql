begin;

alter function public.recompute_order_status_from_items(uuid)
set search_path = '';

alter function public.trg_recompute_order_status_from_items()
set search_path = '';

alter function public.get_store_point_rate_pct(text, text)
set search_path = '';

alter function public.calculate_coupon_discount(uuid, integer)
set search_path = '';

alter function public.set_updated_at()
set search_path = '';

alter function public.touch_store_qr_updated_at()
set search_path = '';

commit;
