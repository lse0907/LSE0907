import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20260825025143_p0_order_integrity.sql");
const finalizerFix = read("supabase/migrations/20260825025531_fix_p0_finalizer_counter_conflict.sql");
const checkoutIndexes = read("supabase/migrations/20260825025735_add_p0_checkout_attempt_fk_indexes.sql");
const adjustedTotalSafetyNet = read("supabase/migrations/20260913173000_default_order_adjusted_total.sql");
const settlementDefaults = read("supabase/migrations/20260913130700_order_settlement_defaults.sql");
const checkoutAttempts = read("src/app/api/orders/_lib/checkoutAttempts.ts");
const createRoute = read("src/app/api/orders/create/route.ts");
const confirmRoute = read("src/app/api/payments/toss/confirm/route.ts");
const webhookRoute = read("src/app/api/payments/toss/webhook/route.ts");
const reconciliationRoute = read("src/app/api/internal/order-payment-reconcile/route.ts");
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
  adjustedTotalSafetyNet,
  "default_order_adjusted_total_before_insert",
  "order settlement total safety-net trigger missing",
);
expectText(
  adjustedTotalSafetyNet,
  "new.adjusted_total_price := new.total_price",
  "order settlement total safety-net does not initialize the amount",
);
expectText(
  settlementDefaults,
  "new.effective_used_points := coalesce(new.used_points, 0)",
  "order settlement defaults do not initialize used points",
);
expectText(
  settlementDefaults,
  "new.effective_coupon_discount := 0",
  "order settlement defaults do not initialize coupon discount",
);
expectText(
  settlementDefaults,
  "new.effective_earned_points := coalesce(new.earned_points, 0)",
  "order settlement defaults do not initialize earned points",
);
expectText(
  settlementDefaults,
  "sync_order_effective_settlement_fields_before_update",
  "loyalty settlement projection sync trigger missing",
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
expectText(confirmRoute, "recordApprovedCheckoutRecoveryFailure", "approved payment recovery failures are not recorded");
expectText(confirmRoute, 'state: "recovery_pending"', "customer recovery-pending state missing");
expectText(webhookRoute, 'eventType || "").trim() !== "PAYMENT_STATUS_CHANGED"', "payment webhook event gate missing");
expectText(webhookRoute, 'data.status || "").trim() !== "DONE"', "webhook must not approve an in-progress payment");
expectText(webhookRoute, "sameSecret", "webhook secret verification missing");
expectText(webhookRoute, "timingSafeEqual", "webhook secret comparison must be timing safe");
expectText(webhookRoute, "paymentWebhookSecretHash", "webhook stores or compares a raw verification secret");
expectText(webhookRoute, "https://api.tosspayments.com/v1/payments/", "webhook does not independently verify Toss payment state");
expectText(webhookRoute, "finalizeCheckoutAttempt", "payment webhook does not finalize the order");
expectText(reconciliationRoute, "v1/payments/orders/", "webhook-independent orderId payment lookup missing");
expectText(reconciliationRoute, "verifiedDone", "reconciliation does not verify PG DONE state");
expectText(reconciliationRoute, "finalizeCheckoutAttempt", "reconciliation does not use the idempotent order finalizer");
rejectText(reconciliationRoute, "/cancel", "reconciliation must never cancel a payment");
rejectText(successPage, 'fetch("/api/orders/create"', "browser still creates paid order separately");
expectText(successPage, 'status === "pending"', "customer payment-pending state missing");
rejectText(successPage, "완료될 때까지 이 화면을 닫거나 뒤로 이동하지 마세요.", "customer is incorrectly told that closing the page loses recovery");

if (failures.length) {
  console.error("P0 주문 무결성 정적 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("P0 주문 무결성 정적 검증 통과");
