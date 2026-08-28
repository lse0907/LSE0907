import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260828034546_p1_loyalty_service_switches.sql");

for (const token of [
  "points_enabled boolean not null default true",
  "coupons_enabled boolean not null default true",
  "COUPON_ISSUANCE_DISABLED",
  "not coalesce(v.points_enabled, true)",
  "v_coupons_enabled and v_completed_count = 1",
  "set search_path = ''",
]) {
  assert.ok(migration.includes(token), `migration is missing: ${token}`);
}

const validation = read("src/app/api/orders/_lib/orderValidation.ts");
assert.ok(validation.includes("customer_coupons"), "existing coupon validation must remain");
assert.ok(validation.includes("customer_point_summaries"), "existing point redemption must remain");

const issueRoute = read("src/app/api/admin/loyalty/coupons/issue/route.ts");
assert.ok(issueRoute.includes("COUPON_ISSUANCE_DISABLED"), "manual issuance must enforce the master switch");

const previewRoute = read("src/app/api/orders/loyalty-preview/route.ts");
assert.ok(previewRoute.includes("validateOrderPayload"), "preview must use server-validated totals");
assert.ok(previewRoute.includes("estimatedEarnedPoints"), "preview must return estimated points");

const customerView = read("src/app/api/orders/customer-view/route.ts");
assert.ok(customerView.includes("earned_points"), "customer order view must expose earned points");

console.log("P1 loyalty switch checks passed.");
