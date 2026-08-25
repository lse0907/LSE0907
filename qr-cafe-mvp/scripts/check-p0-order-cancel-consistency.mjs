import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20260825101217_p0_order_cancel_consistency.sql");
const cancelRoute = read("src/app/api/orders/cancel/route.ts");
const tossCancellation = read("src/app/api/orders/_lib/tossCancellation.ts");
const statusRoute = read("src/app/api/orders/status/route.ts");
const customerView = read("src/app/api/orders/customer-view/route.ts");
const statusPage = read("src/app/status/page.tsx");
const staffPage = read("src/app/staff/page.tsx");
const opsRoute = read("src/app/api/ops/order-cancel-reconcile/route.ts");

const failures = [];
const expectText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: ${needle}`);
};
const rejectText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: ${needle}`);
};

expectText(migration, "create table public.order_payment_cancel_attempts", "cancel ledger missing");
expectText(migration, "'cancel_pending'", "cancel pending payment status missing");
expectText(migration, "'refunded'", "refunded payment status missing");
expectText(migration, "create or replace function public.claim_order_cancellation", "atomic cancellation claim missing");
expectText(migration, "create or replace function public.finalize_order_payment_cancellation", "atomic cancellation finalizer missing");
expectText(migration, "perform public.rollback_order_rewards", "reward rollback not in cancellation transaction");
expectText(migration, "enable row level security", "cancel ledger RLS missing");
expectText(migration, "from public, anon, authenticated", "client RPC/table privilege revocation missing");
expectText(migration, "to service_role", "server-only grants missing");

expectText(tossCancellation, '"Idempotency-Key": params.idempotencyKey', "Toss cancellation idempotency key missing");
expectText(tossCancellation, 'pgStatus !== "CANCELED"', "verified CANCELED state check missing");
expectText(cancelRoute, 'state: "cancel_pending"', "honest pending response missing");
expectText(cancelRoute, 'rpc("claim_order_cancellation"', "cancel route does not claim atomically");
expectText(cancelRoute, 'rpc("finalize_order_payment_cancellation"', "cancel route does not finalize atomically");
rejectText(cancelRoute, '.update({ status: "cancelled" })', "legacy non-atomic order cancellation remains");

expectText(statusRoute, "PAYMENT_STATUS_SERVER_MANAGED", "manual payment status mutation is not blocked");
rejectText(staffPage, 'paymentStatus: "paid"', "staff can still mark online payment paid manually");
expectText(customerView, '"payment_status"', "customer order view omits payment status");
expectText(statusPage, "결제 취소 처리 중", "customer pending cancellation copy missing");
expectText(opsRoute, "inspectTossOrderPayment", "OPS PG inspection missing");
expectText(opsRoute, "cancelTossOrderPayment", "OPS idempotent retry missing");

if (failures.length) {
  console.error("P0-B 주문 결제취소 일관성 정적 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("P0-B 주문 결제취소 일관성 정적 검증 통과");
