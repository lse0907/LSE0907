import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260901122800_p1_privacy_rights_retention.sql");
const api = read("src/app/api/account/privacy-center/route.ts");
const worker = read("src/app/api/internal/privacy-deletion-retry/route.ts");
const tossSnapshot = read("src/app/api/orders/_lib/tossCancellation.ts");
const orderConfirm = read("src/app/api/payments/toss/confirm/route.ts");
const billingConfirm = read("src/app/api/billing/confirm-subscription-payment/route.ts");
const authHelper = read("src/app/api/_lib/storeAuth.ts");
const loginApi = read("src/app/api/auth/login/route.ts");
const proxy = read("src/proxy.ts");
const page = read("src/app/account/privacy/page.tsx");

for (const table of [
  "account_lifecycle_states",
  "account_withdrawal_requests",
  "privacy_rights_requests",
  "privacy_retention_rules",
  "privacy_retention_holds",
  "privacy_deletion_jobs",
  "privacy_request_events",
  "retained_policy_evidence",
]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated`));
}

assert.match(migration, /subject_user_id uuid primary key/);
assert.match(migration, /Deliberately has no auth\.users FK/);
assert.match(migration, /now\(\) \+ interval '7 days'/);
assert.match(migration, /'assess_retention','scheduled'/);
assert.match(migration, /'delete_auth_user'/);
assert.match(migration, /legal_review_required boolean not null default true/);
assert.match(migration, /trg_privacy_request_events_immutable/);
assert.match(migration, /OPEN_CUSTOMER_ORDER/);
assert.match(migration, /PENDING_CUSTOMER_REFUND/);
assert.match(migration, /ACTIVE_STORE_OWNERSHIP/);
assert.match(migration, /PENDING_BILLING_SETTLEMENT/);
assert.match(migration, /STORAGE_OBJECT_REVIEW/);
assert.match(migration, /'policy_consent','동의·고지 증빙 보존기간 법률 검토 필요'/);
assert.match(migration, /'order_transaction','주문 거래기록 보존 범위·기간 법률 검토 필요'/);
assert.match(migration, /'payment_refund','결제·취소·환불 기록 보존 범위·기간 법률 검토 필요'/);
assert.match(migration, /'subscription_billing','사업자 회원 구독·결제 기록 보존 범위·기간 법률 검토 필요'/);
assert.doesNotMatch(migration, /auth\.admin|delete from auth\.users|deleteUser/);
assert.doesNotMatch(migration, /delete from storage\.objects/);
assert.match(migration, /retention_subject_id uuid default gen_random_uuid\(\) unique/);
assert.match(migration, /account_lifecycle_select_own/);
assert.match(migration, /to authenticated/);
assert.match(migration, /claim_due_privacy_deletion_jobs/);
assert.match(migration, /last_attempt_at <= now\(\)-interval '30 minutes'/);
assert.match(migration, /prepare_account_privacy_deletion/);
assert.match(migration, /finalize_account_privacy_deletion/);
assert.match(migration, /fail_account_privacy_deletion/);
assert.match(migration, /private\.minimize_payment_provider_response/);
assert.match(migration, /purge_expired_privacy_retention/);
assert.match(migration, /not r\.legal_review_required/);
assert.match(migration, /purge_attempt_count/);
assert.match(migration, /'security_audit','탈퇴·개인정보 권리 처리 감사기록 보존기간 법률 검토 필요'/);
assert.doesNotMatch(migration, /'cancelReason',c\.value->'cancelReason'/);
assert.match(migration, /app\.privacy_cleanup_user_id/);
assert.match(migration, /rion-order-privacy-deletion-retry/);
assert.match(migration, /rion_order_privacy_deletion_retry_secret/);

for (const fn of [
  "get_account_privacy_center",
  "create_privacy_rights_request",
  "withdraw_account_marketing_consent",
  "delete_customer_optional_phone",
  "request_account_withdrawal",
  "cancel_account_withdrawal",
  "claim_due_privacy_deletion_jobs",
  "prepare_account_privacy_deletion",
  "finalize_account_privacy_deletion",
  "fail_account_privacy_deletion",
  "purge_expired_privacy_retention",
]) {
  assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
}

assert.match(api, /getOptionalRequestUserId/);
assert.match(api, /assertSameOrigin/);
assert.match(api, /OWNER_PHONE_REVIEW_REQUIRED/);
assert.match(api, /request_account_withdrawal/);
assert.match(api, /cancel_account_withdrawal/);
assert.doesNotMatch(api, /deleteUser/);

assert.match(worker, /PRIVACY_DELETION_RETRY_SECRET/);
assert.match(worker, /timingSafeEqual/);
assert.match(worker, /claim_due_privacy_deletion_jobs/);
assert.match(worker, /prepare_account_privacy_deletion/);
assert.match(worker, /admin\.auth\.admin\.deleteUser/);
assert.match(worker, /finalize_account_privacy_deletion/);
assert.match(worker, /fail_account_privacy_deletion/);
assert.match(worker, /purge_expired_privacy_retention/);
assert.doesNotMatch(worker, /service_role|SUPABASE_SERVICE_ROLE_KEY/);

assert.match(tossSnapshot, /export function essentialPaymentSnapshot/);
assert.doesNotMatch(tossSnapshot, /cancelReason: row\.cancelReason/);
assert.match(orderConfirm, /toss_response: essentialPaymentSnapshot\(tossResult\)/);
assert.match(billingConfirm, /toss_response: essentialPaymentSnapshot\(parsed\)/);

assert.match(authHelper, /allowRestricted/);
assert.match(authHelper, /account_lifecycle_states/);
assert.match(loginApi, /accountLifecycleStatus/);
assert.match(proxy, /lifecycleStatus !== "active"/);
assert.match(proxy, /pathname !== "\/account\/privacy"/);

assert.match(page, /7일 복구 대기/);
assert.match(page, /전화번호 삭제/);
assert.match(page, /마케팅 철회/);
assert.match(page, /개인정보 권리 요청/);
assert.match(page, /자동 Auth 삭제/);
assert.match(page, /signOut\(\{ scope: "global" \}\)/);

console.log("P1-3B privacy rights and retention checks passed.");
