import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260828034546_p1_loyalty_service_switches.sql");
const defaultOffMigration = read("supabase/migrations/20260830085004_p1_new_store_loyalty_default_off.sql");

for (const token of [
  "COUPON_ISSUANCE_DISABLED",
  "not coalesce(v.points_enabled, true)",
  "v_coupons_enabled and v_completed_count = 1",
  "set search_path = ''",
]) {
  assert.ok(migration.includes(token), `migration is missing: ${token}`);
}

for (const token of [
  "lock table public.stores in share row exclusive mode",
  "alter column points_enabled set default false",
  "alter column coupons_enabled set default false",
  "select\n  s.store_id,\n  true,\n  true",
  "create trigger trg_initialize_store_loyalty_defaults",
  "new.store_id,\n    false,\n    false",
  "security definer",
  "from public, anon, authenticated",
]) {
  assert.ok(defaultOffMigration.includes(token), `default-off migration is missing: ${token}`);
}

const validation = read("src/app/api/orders/_lib/orderValidation.ts");
assert.ok(validation.includes("customer_coupons"), "existing coupon validation must remain");
assert.ok(validation.includes("customer_point_summaries"), "existing point redemption must remain");

const issueRoute = read("src/app/api/admin/loyalty/coupons/issue/route.ts");
assert.ok(issueRoute.includes("COUPON_ISSUANCE_DISABLED"), "manual issuance must enforce the master switch");
assert.ok(
  issueRoute.includes("?.coupons_enabled !== true"),
  "manual issuance must treat a missing settings row as disabled",
);

const previewRoute = read("src/app/api/orders/loyalty-preview/route.ts");
assert.ok(previewRoute.includes("validateOrderPayload"), "preview must use server-validated totals");
assert.ok(previewRoute.includes("estimatedEarnedPoints"), "preview must return estimated points");
assert.ok(
  previewRoute.includes("settings?.points_enabled === true") &&
    previewRoute.includes("settings?.coupons_enabled === true"),
  "checkout preview must treat a missing settings row as disabled",
);

const loyaltyPage = read("src/app/admin/loyalty/page.tsx");
assert.ok(
  loyaltyPage.includes("points_enabled: false") && loyaltyPage.includes("coupons_enabled: false"),
  "the owner settings page must initialize a new store with both services disabled",
);

const customerStatusRoute = read("src/app/api/customer/loyalty-status/route.ts");
assert.ok(
  customerStatusRoute.includes("row?.points_enabled === true") &&
    customerStatusRoute.includes("row?.coupons_enabled === true"),
  "customer loyalty status must treat a missing settings row as disabled",
);

const confirmPage = read("src/app/confirm/page.tsx");
assert.ok(
  confirmPage.includes("serverPayableAmount !== payableAmount"),
  "checkout must ignore a preview response for an outdated payable amount",
);
assert.ok(
  confirmPage.includes("(payableAmount * loyaltyPreview.ratePct) / 100"),
  "checkout must update the visible point estimate from the current payable amount",
);
assert.ok(
  confirmPage.includes('loyaltyPreviewStatus === "loading"') &&
    confirmPage.includes('"적립 혜택 확인 중"'),
  "checkout must not show a temporary 0P estimate while the preview is loading",
);
assert.ok(
  confirmPage.includes('requestKey: loyaltyPreviewRequestKey') &&
    confirmPage.includes('status: "ready"'),
  "checkout must show the earned-point estimate only after a valid preview response",
);

const storeAuth = read("src/app/api/_lib/storeAuth.ts");
assert.ok(
  storeAuth.includes("return req.cookies.getAll()"),
  "server auth must read every chunk of the Supabase session cookie",
);
for (const routePath of [
  "src/app/api/orders/loyalty-preview/route.ts",
  "src/app/api/orders/create/route.ts",
  "src/app/api/orders/quote/route.ts",
]) {
  assert.ok(
    read(routePath).includes("getOptionalRequestUserId"),
    `${routePath} must use the shared cookie-safe request auth helper`,
  );
}

const customerView = read("src/app/api/orders/customer-view/route.ts");
assert.ok(customerView.includes("earned_points"), "customer order view must expose earned points");

console.log("P1 loyalty switch checks passed.");
