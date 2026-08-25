import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20260825165137_p0_function_search_path_hardening.sql",
  ),
  "utf8",
);

const failures = [];
const normalized = migration.replace(/\s+/g, " ").trim().toLowerCase();
const expectText = (needle, label) => {
  if (!normalized.includes(needle)) failures.push(`${label}: ${needle}`);
};
const rejectText = (needle, label) => {
  if (normalized.includes(needle)) failures.push(`${label}: ${needle}`);
};

expectText("begin;", "트랜잭션 시작 누락");
expectText("commit;", "트랜잭션 완료 누락");

const functions = [
  "public.recompute_order_status_from_items(uuid)",
  "public.trg_recompute_order_status_from_items()",
  "public.get_store_point_rate_pct(text, text)",
  "public.calculate_coupon_discount(uuid, integer)",
  "public.set_updated_at()",
  "public.touch_store_qr_updated_at()",
];

for (const signature of functions) {
  expectText(
    `alter function ${signature} set search_path = '';`,
    `${signature} search_path 고정 누락`,
  );
}

rejectText(
  "create or replace function",
  "함수 본문을 교체하면 기존 속성·권한 보존 범위가 넓어짐",
);

const alterCount = normalized.match(/alter function /g)?.length ?? 0;
if (alterCount !== functions.length) {
  failures.push(
    `대상 함수 수 불일치: 예상 ${functions.length}개, 실제 ${alterCount}개`,
  );
}

if (failures.length) {
  console.error("P0-C 함수 search_path 보안 정적 검증 실패");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("P0-C 함수 search_path 보안 정적 검증 통과");
