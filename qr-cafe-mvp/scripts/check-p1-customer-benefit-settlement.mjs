import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260830170333_p1_customer_benefit_settlement.sql");
const settingsRoute = read("src/app/api/admin/loyalty/settings/route.ts");
const partialRoute = read("src/app/api/orders/partial-refund/route.ts");
const retryRoute = read("src/app/api/internal/order-refund-retry/route.ts");
const toss = read("src/app/api/orders/_lib/tossCancellation.ts");
const loyaltyPage = read("src/app/admin/loyalty/page.tsx");

const expect = (source, value, message) => {
  if (!source.includes(value)) throw new Error(message);
};

expect(migration, "points_program_status", "포인트 종료 상태가 없습니다.");
expect(migration, "points_redemption_ends_at", "포인트 종료 사용기한이 없습니다.");
expect(migration, "v_notice + interval '30 days'", "종료 공지 후 30일 보호가 없습니다.");
expect(migration, "greatest(l.expires_at, v_redemption_end)", "기존/종료 유효기간 중 유리한 기준이 없습니다.");
expect(migration, "create table public.store_loyalty_program_events", "혜택 종료 이력 원장이 없습니다.");
expect(migration, "create table public.order_partial_refunds", "부분 환불 원장이 없습니다.");
expect(migration, "previous_refunded_amount", "누적 부분 환불 검증 기준이 없습니다.");
expect(migration, "create table public.order_partial_refund_items", "부분 환불 항목 원장이 없습니다.");
expect(migration, "'partial_refund_pending'", "부분 환불 대기 상태가 없습니다.");
expect(migration, "'partially_refunded'", "부분 환불 완료 상태가 없습니다.");
expect(migration, "claim_order_partial_refund", "부분 환불 원자적 claim 함수가 없습니다.");
expect(migration, "finalize_order_partial_refund", "부분 환불 정산 함수가 없습니다.");
expect(migration, "enable row level security", "신규 원장 RLS가 없습니다.");
expect(migration, "from public, anon, authenticated", "신규 원장/RPC 공개 권한 회수가 없습니다.");
expect(settingsRoute, 'allowedRoles: ["owner"]', "혜택 종료가 Owner로 제한되지 않았습니다.");
expect(settingsRoute, 'rpc("set_store_loyalty_program_state"', "혜택 종료 API가 원자적 RPC를 사용하지 않습니다.");
expect(partialRoute, 'allowedRoles: ["owner", "manager"]', "부분 환불 권한 제한이 없습니다.");
expect(partialRoute, 'rpc("claim_order_partial_refund"', "부분 환불 claim 호출이 없습니다.");
expect(partialRoute, 'rpc("finalize_order_partial_refund"', "부분 환불 finalize 호출이 없습니다.");
expect(toss, "cancelAmount", "PG 부분 취소 금액 전달이 없습니다.");
expect(toss, "PARTIAL_CANCELED", "PG 부분 취소 상태 검증이 없습니다.");
expect(retryRoute, "AUTO_RETRY_LIMIT_REACHED", "자동 재시도 한도/OPS 이관이 없습니다.");
expect(retryRoute, "previous_refunded_amount", "재시도 시 누적 환불액 검증이 없습니다.");
expect(retryRoute, "timingSafeEqual", "자동 재시도 엔드포인트 비밀 검증이 없습니다.");
expect(loyaltyPage, "/api/admin/loyalty/settings", "점주 설정이 서버 보호 경로를 사용하지 않습니다.");

console.log("P1 고객혜택·부분환불 정적 검증 통과");
