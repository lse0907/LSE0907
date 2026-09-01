import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

const migration = read("supabase/migrations/20260901074606_p1_privacy_consent_foundation.sql");
const signupApi = read("src/app/api/auth/signup/route.ts");
const customer = read("src/app/signup-customer/page.tsx");
const owner = read("src/app/signup-owner/page.tsx");
const consent = read("src/app/_components/SignupPolicyConsent.tsx");

for (const table of ["policy_documents", "signup_policy_confirmations", "policy_acceptance_events"]) {
  assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
}

assert.match(migration, /POLICY_ACCEPTANCE_EVENT_IMMUTABLE/);
assert.match(migration, /record_signup_policy_acceptances/);
assert.match(migration, /alter table public\.profiles alter column address drop not null/);
assert.match(migration, /privacy_signup_notice/);
assert.match(migration, /subscription_billing/);
assert.match(migration, /customer_benefits/);
assert.match(migration, /entry_path text not null/);
assert.match(migration, /language text not null default 'ko-KR'/);
assert.match(signupApi, /minimumAgeConfirmed !== true/);
assert.match(signupApi, /businessAuthorityConfirmed !== true/);
assert.match(signupApi, /record_signup_policy_acceptances/);
assert.match(signupApi, /admin\.auth\.admin\.deleteUser/);
assert.match(customer, /phone: phone\.trim\(\) \|\| null/);
assert.doesNotMatch(customer, /if \(!phone\.trim\(\)\)/);
assert.doesNotMatch(owner, /react-daum-postcode|address_detail|address: address/);
assert.match(consent, /\[선택\].*마케팅 정보 수신/s);
assert.match(consent, /동의하지 않아도 가입할 수 있습니다/);

for (const path of [
  "src/app/legal/terms/page.tsx",
  "src/app/legal/privacy/page.tsx",
  "src/app/legal/marketing/page.tsx",
  "src/app/legal/subscription-billing/page.tsx",
  "src/app/legal/customer-benefits/page.tsx",
]) {
  assert.match(read(path), /LegalPolicyPage/);
}

assert.match(read("src/app/legal/terms/page.tsx"), /subscription-billing/);
assert.match(read("src/app/legal/terms/page.tsx"), /customer-benefits/);

console.log("P1-3A privacy and consent checks passed.");
