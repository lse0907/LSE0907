import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read(
  "supabase/migrations/20260825152028_p0_checkout_mode_security.sql",
);
const policy = read("src/app/api/orders/_lib/checkoutPolicy.ts");
const quoteRoute = read("src/app/api/orders/quote/route.ts");
const createRoute = read("src/app/api/orders/create/route.ts");
const confirmPage = read("src/app/confirm/page.tsx");

const failures = [];
const expectText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: ${needle}`);
};

expectText(
  migration,
  "drop policy if exists public_select_store_pg_config",
  "PG 공개 조회 정책 제거 누락",
);
expectText(
  migration,
  "revoke all privileges on table public.store_pg_config",
  "PG 테이블 브라우저 권한 회수 누락",
);
expectText(
  migration,
  "create or replace function public.get_store_checkout_policy",
  "통합 결제 정책 함수 누락",
);
expectText(migration, "set search_path = ''", "보안 함수 search_path 고정 누락");
expectText(migration, "s.setup_completed is true", "매장 설정 완료 조건 누락");
expectText(migration, "sb.trial_end_at > now()", "기본 체험 주문 조건 누락");
expectText(migration, "sb.paid_until > now()", "유료 기본 구독 조건 누락");
expectText(migration, "sa.addon_paid_until > now()", "선결제 옵션 만료 조건 누락");
expectText(migration, "sa.prepay_enabled is true", "선결제 기능 ON 조건 누락");
expectText(migration, "nullif(btrim(pgc.mid), '')", "PG MID 조건 누락");
expectText(
  migration,
  "where policy.is_prepay",
  "비활성 매장 PG 공개값 차단 누락",
);
expectText(
  migration,
  "to service_role;",
  "서버 전용 정책 함수 권한 누락",
);

expectText(policy, 'checkoutType: "prepaid" | "postpaid"', "서버 결제 모드 구분 누락");
expectText(policy, '"STORE_ORDERING_UNAVAILABLE"', "신규 주문 중단 코드 누락");
expectText(policy, '"PREPAID_CHECKOUT_NOT_AVAILABLE"', "선결제 비활성 차단 코드 누락");
expectText(policy, '"PREPAID_CHECKOUT_REQUIRED"', "선결제 매장 후불 우회 차단 코드 누락");

expectText(quoteRoute, "requireStoreCheckoutMode({", "선결제 견적 정책 검사 누락");
expectText(quoteRoute, 'checkoutType: "prepaid"', "선결제 견적 모드 검사 누락");
expectText(createRoute, "requireStoreCheckoutMode({", "후불 주문 정책 검사 누락");
expectText(createRoute, 'checkoutType: "postpaid"', "후불 주문 모드 검사 누락");
expectText(confirmPage, 'rpc("get_store_checkout_mode"', "고객 결제 모드 RPC 연결 누락");
expectText(
  confirmPage,
  '"get_store_checkout_client_config"',
  "고객 PG 공개 설정 RPC 연결 누락",
);

if (failures.length) {
  console.error("P0 결제 모드·PG 보안 정적 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("P0 결제 모드·PG 보안 정적 검증 통과");
