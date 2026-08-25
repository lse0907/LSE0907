import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read("supabase/migrations/20260825061101_p0_privacy_rpc_hardening.sql");
const customerSearchRoute = read("src/app/api/admin/loyalty/customers/search/route.ts");
const setupCopyRoute = read("src/app/api/admin/store/setup-copy/route.ts");
const loyaltyPage = read("src/app/admin/loyalty/page.tsx");
const copyPages = [
  read("src/app/admin/categories/page.tsx"),
  read("src/app/admin/menu/page.tsx"),
  read("src/app/admin/options/page.tsx"),
];

for (const functionName of [
  "admin_search_coupon_targets",
  "admin_copy_categories_v1",
  "admin_copy_menus_v1",
  "admin_copy_options_v1",
]) {
  const revokePattern = new RegExp(
    `revoke all privileges on function public\\.${functionName}\\([\\s\\S]*?\\)\\s+from public, anon, authenticated;`,
    "i",
  );
  const grantPattern = new RegExp(
    `grant execute on function public\\.${functionName}\\([\\s\\S]*?\\)\\s+to service_role;`,
    "i",
  );
  assert(revokePattern.test(migration), `${functionName}의 브라우저 실행권을 회수해야 합니다.`);
  assert(grantPattern.test(migration), `${functionName}은 service_role 전용이어야 합니다.`);
}

assert(
  migration.match(/set search_path = ''/g)?.length >= 4,
  "민감 SECURITY DEFINER 함수는 빈 search_path를 사용해야 합니다.",
);
assert(
  customerSearchRoute.includes('allowedRoles: ["owner"]') &&
    customerSearchRoute.includes("phoneMasked: maskPhone(row.phone)") &&
    customerSearchRoute.includes("nameMasked: maskCustomerName(row.name)") &&
    customerSearchRoute.includes('eventType: "customer_target_search"') &&
    !customerSearchRoute.includes("query,\n        resultCount"),
  "고객 검색 API는 Owner 전용·마스킹 응답·비식별 감사로그를 사용해야 합니다.",
);
assert(
  loyaltyPage.includes('fetch("/api/admin/loyalty/customers/search"') &&
    !loyaltyPage.includes('supabase.rpc("admin_search_coupon_targets"') &&
    loyaltyPage.includes("row.phoneMasked") &&
    loyaltyPage.includes("row.nameMasked"),
  "고객 검색 화면은 서버 API의 마스킹 응답만 사용해야 합니다.",
);
assert(
  setupCopyRoute.match(/allowedRoles: \["owner", "manager"\]/g)?.length === 2 &&
    setupCopyRoute.includes('eventType: "store_setup_copied"'),
  "설정 복사는 원본·대상 매장 모두 Owner/Manager 권한과 감사로그가 필요합니다.",
);

for (const page of copyPages) {
  assert(
    page.includes('fetch("/api/admin/store/setup-copy"') &&
      !/supabase\.rpc\("admin_copy_(categories|menus|options)_v1"/.test(page),
    "설정 복사 화면은 RPC를 직접 호출하지 않아야 합니다.",
  );
}

console.log("P0 개인정보·권한 정적 검증 통과");
