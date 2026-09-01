import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260901003605_p1_subscription_referral_benefits.sql");
const indexesMigration = read("supabase/migrations/20260901051111_p1_subscription_referral_indexes.sql");
const pricing = read("src/app/api/billing/_lib/pricing.ts");
const quote = read("src/app/api/billing/quote/route.ts");
const signup = read("src/app/api/auth/signup/route.ts");
const payPage = read("src/app/admin/billing/pay/page.tsx");
const zeroPayment = read("src/app/api/billing/apply-zero-payment/route.ts");
const referralCode = read("src/app/api/billing/referral-code/route.ts");
const cancel = read("src/app/api/payments/toss/cancel/route.ts");
const ops = read("src/app/ops/page.tsx");

for (const token of [
  "create table if not exists public.store_referral_codes",
  "create table if not exists public.billing_referrals",
  "create table if not exists public.billing_credit_ledger",
  "BILLING_CREDIT_LEDGER_IMMUTABLE",
  "credit_ready",
  "prepare_billing_payment_attempt_v2",
  "release_billing_payment_attempt_v2",
  "finalize_due_referral_rewards",
  "enable row level security",
  "from public,anon,authenticated",
  "to service_role",
]) assert.ok(migration.includes(token), `migration is missing: ${token}`);

assert.ok(migration.includes("p_founder_addon and not p_founder_base"), "옵션 베타는 기본 베타 승인과 함께 관리해야 합니다.");
assert.ok(migration.includes("a.addon_selected and v_addon_after > (case when"), "옵션 종료일이 기본 구독을 넘지 않도록 검증해야 합니다.");
assert.ok(migration.includes("timezone('Asia/Seoul'"), "구독 시작일은 한국시간 다음 자정을 사용해야 합니다.");
assert.ok(migration.includes("a.base_external_amount_krw>=1"), "추천인 보상은 실제 기본 구독 결제액이 있어야 합니다.");
assert.ok(migration.includes("'restore',-v_use.amount_krw"), "전액 취소 시 사용 크레딧 복원이 필요합니다.");
for (const token of [
  "idx_billing_credit_ledger_payment",
  "idx_billing_credit_ledger_referral",
  "idx_billing_payment_attempts_referral",
  "idx_billing_payments_referral",
  "idx_billing_referrals_discount_attempt",
  "idx_billing_referrals_code",
]) assert.ok(indexesMigration.includes(token), `foreign-key index migration is missing: ${token}`);

assert.ok(pricing.includes('labels.push("기본 구독 베타 테스터 40%")'), "기본 베타 할인이 견적에 표시되지 않습니다.");
assert.ok(pricing.includes('labels.push("선결제 옵션 베타 테스터 40%")'), "선결제 옵션 베타 할인이 견적에 표시되지 않습니다.");
assert.ok(pricing.indexOf("baseFinal - referralDiscountKrw") < pricing.indexOf("creditAppliedKrw = Math.min"), "추천 할인 후 크레딧을 사용해야 합니다.");
assert.ok(pricing.includes("addonEnd.getTime() > projectedBaseEndMs"), "견적에서도 옵션 기간 상한을 검증해야 합니다.");
assert.ok(quote.includes('rpc("prepare_billing_payment_attempt_v2"'), "결제 준비는 원자적 RPC를 사용해야 합니다.");
assert.ok(signup.includes("code_normalized") && signup.includes("billing_referrals"), "가입 추천코드 검증·등록이 없습니다.");
assert.ok(referralCode.includes('allowedRoles: ["owner"]'), "추천코드 발급은 점주로 제한해야 합니다.");
assert.ok(zeroPayment.includes('external_amount_krw') && zeroPayment.includes('rpc("apply_billing_payment_attempt"'), "0원 크레딧 결제 경로가 없습니다.");
assert.ok(payPage.includes("추천 크레딧") && payPage.includes("크레딧으로 결제"), "결제 화면에 크레딧 선택·0원 결제 안내가 없습니다.");
assert.ok(cancel.includes("creditOnly") && cancel.includes("CREDIT_REFUND_COMPLETED"), "0원 크레딧 결제 취소·복원 경로가 없습니다.");
assert.ok(ops.includes("온라인 선결제 베타 40%"), "OPS에 옵션 베타 승인 항목이 없습니다.");

console.log("P1 구독·추천·베타 혜택 정적 검증 통과");
