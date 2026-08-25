import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20260825025143_p0_order_integrity.sql");
const finalizerFix = read("supabase/migrations/20260825025531_fix_p0_finalizer_counter_conflict.sql");
const checkoutIndexes = read("supabase/migrations/20260825025735_add_p0_checkout_attempt_fk_indexes.sql");
const checkoutAttempts = read("src/app/api/orders/_lib/checkoutAttempts.ts");
const createRoute = read("src/app/api/orders/create/route.ts");
const confirmRoute = read("src/app/api/payments/toss/confirm/route.ts");
const successPage = read("src/app/confirm/success/page.tsx");

const failures = [];
const expectText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: ${needle}`);
};
const rejectText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: ${needle}`);
};

expectText(migration, "create table if not exists public.order_checkout_attempts", "checkout attempt ledger missing");
expectText(migration, "create or replace function public.finalize_order_checkout_attempt", "transactional finalizer missing");
expectText(migration, "security invoker", "finalizer must be security invoker");
expectText(migration, "to service_role", "server-only function/table grants missing");
expectText(migration, "orders_payment_key_unique", "payment key uniqueness missing");
expectText(migration, "orders_toss_order_id_unique", "Toss order id uniqueness missing");
expectText(migration, "orders_store_client_request_unique", "postpaid idempotency index missing");
expectText(migration, "drop policy if exists customer_store_wallets_write_store_member", "wallet member writes not removed");
expectText(migration, "drop policy if exists point_transactions_write_store_member", "point ledger member writes not removed");
expectText(migration, "public.is_store_owner(store_id)", "owner-only loyalty policy missing");
expectText(
  finalizerFix,
  "on conflict on constraint store_daily_order_counters_pkey do update",
  "daily counter upsert still conflicts with the order_date output column",
);
expectText(
  checkoutIndexes,
  "idx_order_checkout_attempts_customer_user",
  "checkout customer foreign-key index missing",
);
expectText(
  checkoutIndexes,
  "idx_order_checkout_attempts_used_coupon",
  "checkout coupon foreign-key index missing",
);

expectText(createRoute, "PAID_ORDER_REQUIRES_APPROVED_ATTEMPT", "paid spoof rejection missing");
expectText(createRoute, "finalizeCheckoutAttempt", "postpaid transactional finalizer missing");
rejectText(createRoute, "findExistingPaidOrder", "application-only paid duplicate check remains");

expectText(checkoutAttempts, "const stableCartLines", "retry fingerprint still depends on volatile cart data");
expectText(checkoutAttempts, "cartLines: stableCartLines", "retry fingerprint does not use stable cart data");

expectText(confirmRoute, '"Idempotency-Key"', "Toss idempotency header missing");
expectText(confirmRoute, ".select(\"id\")", "PG confirm can start without locking in the attempt state");
expectText(confirmRoute, 'status: "approved_not_applied"', "approved payment recovery state missing");
expectText(confirmRoute, "finalizeCheckoutAttempt", "approved payment not bound to order finalizer");
rejectText(successPage, 'fetch("/api/orders/create"', "browser still creates paid order separately");

if (failures.length) {
  console.error("P0 주문 무결성 정적 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("P0 주문 무결성 정적 검증 통과");
