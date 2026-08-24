import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [fullPath] : [];
  });
}

const donePage = read("src/app/done/page.tsx");
const statusPage = read("src/app/status/page.tsx");
const customerViewRoute = read("src/app/api/orders/customer-view/route.ts");
const nextConfig = read("next.config.ts");
const migration = read(
  "supabase/migrations/20260824142631_p0_access_control.sql",
);

function assertServerOnlyFunction(functionName) {
  const revokePattern = new RegExp(
    `revoke all privileges on function public\\.${functionName}\\([\\s\\S]*?\\)\\s+from public, anon, authenticated;`,
    "i",
  );
  const grantPattern = new RegExp(
    `grant execute on function public\\.${functionName}\\([\\s\\S]*?\\)\\s+to service_role;`,
    "i",
  );
  assert(
    revokePattern.test(migration) && grantPattern.test(migration),
    `${functionName}은 service_role 전용이어야 합니다.`,
  );
}

assert(
  donePage.includes("fetchCustomerOrder") && !donePage.includes('.from("orders")'),
  "done 화면이 orders 테이블을 직접 조회하지 않아야 합니다.",
);
assert(
  statusPage.includes("fetchCustomerOrder") &&
    !statusPage.includes('.from("orders")'),
  "status 화면이 orders 테이블을 직접 조회하지 않아야 합니다.",
);
assert(
  customerViewRoute.includes("secureTokenMatches") &&
    customerViewRoute.includes("access_token: _accessToken"),
  "고객 주문 API가 토큰을 검증하고 응답에서 제거해야 합니다.",
);
assert(
  statusPage.includes("}, 3000);") &&
    statusPage.includes('order?.status === "completed"') &&
    statusPage.includes('order?.status === "cancelled"') &&
    statusPage.includes('document.visibilityState === "visible"'),
  "상태 조회는 3초 간격으로 실행하고 종료·백그라운드 상태에서 중지해야 합니다.",
);
assert(
  nextConfig.includes('source: "/done"') &&
    nextConfig.includes('source: "/status"') &&
    nextConfig.match(/Referrer-Policy/g)?.length >= 2 &&
    nextConfig.match(/value: "no-referrer"/g)?.length >= 2,
  "done/status 문서 응답은 Referrer-Policy: no-referrer를 사용해야 합니다.",
);

for (const policy of [
  "public_select_orders",
  "public_insert_orders",
  "public_select_order_items",
  "public_insert_order_items",
  "public_select_order_item_options",
  "public_insert_order_item_options",
]) {
  assert(
    migration.includes(`drop policy if exists ${policy}`),
    `${policy} 제거 구문이 필요합니다.`,
  );
}

for (const functionName of [
  "apply_loyalty_on_paid_order",
  "finalize_order_rewards",
  "rollback_order_rewards",
  "apply_store_billing_payment",
  "staff_update_order_items_status",
  "issue_customer_coupon",
  "recalculate_customer_tier",
  "initialize_store_billing_account",
]) {
  assertServerOnlyFunction(functionName);
}

assert(
  migration.includes("drop policy if exists order_item_packing_checks_insert") &&
    migration.includes("drop policy if exists order_item_packing_checks_update") &&
    migration.includes("order_item_packing_checks_select_store_member_or_ops") &&
    migration.includes(
      "revoke all privileges on table public.order_item_packing_checks from anon, authenticated;",
    ),
  "패킹 체크의 공개 쓰기 정책·권한을 제거해야 합니다.",
);

for (const functionName of [
  "admin_cancel_customer_coupon",
  "admin_check_store_delete_eligibility",
  "admin_copy_categories_v1",
  "admin_copy_menus_v1",
  "admin_copy_options_v1",
  "admin_issue_coupon_to_selected_customers",
  "admin_search_coupon_targets",
  "admin_soft_delete_store_if_unused",
  "current_ops_role",
  "get_store_names",
]) {
  const revokePattern = new RegExp(
    `revoke all privileges on function public\\.${functionName}\\([\\s\\S]*?\\)\\s+from public, anon;`,
    "i",
  );
  assert(
    revokePattern.test(migration),
    `${functionName}의 익명 실행권을 제거해야 합니다.`,
  );
}

assert(
  migration.includes("alter view public.admin_option_groups_overview") &&
    migration.includes("set (security_invoker = true);") &&
    migration.includes(
      "revoke all privileges on table public.admin_option_groups_overview",
    ),
  "공개 관리 뷰는 security_invoker로 RLS를 따라야 합니다.",
);

const leakedTokenUrls = sourceFiles(join(root, "src")).filter((file) =>
  readFileSync(file, "utf8").includes("accessToken="),
);
assert(
  leakedTokenUrls.length === 0,
  `접근 토큰이 URL에 포함된 파일: ${leakedTokenUrls.join(", ")}`,
);

console.log("P0 접근통제 정적 검증 통과");
