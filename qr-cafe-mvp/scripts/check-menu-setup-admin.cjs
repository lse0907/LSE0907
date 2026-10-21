/* eslint-disable @typescript-eslint/no-require-imports -- Offline compatibility tests; no live DB. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, imports = {}, extra = {}) {
  const context = { exports: {}, Buffer, Response, URL, process: { env: {} }, require: (name) => {
    if (name === "../menuSetupAccess") return load("src/app/api/_lib/menuSetupAccess.ts", imports, extra);
    if (name.startsWith("@/app/api/_lib/menuSetupRoutes/")) return load("src/app/api/_lib/menuSetupRoutes/" + name.split("/").pop() + ".ts", imports, extra);
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  }, ...extra };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const root = "src/app/preview/menu-setup/";
const model = load(root + "draftModel.ts");
const storage = load(root + "draftStorage.ts");
const adapter = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
let id = 0;
const planFor = (draft) => adapter.buildAdminPlan(draft, "store-a", () => String(++id));
const draft = { categories: [{ id: "coffee", name: "커피" }],
  groups: [{ id: "size", name: "크기", scope: "common", menuId: "", required: "yes", max: "1", items: [{ id: "base", name: "기본", price: "0" }, { id: "large", name: "큰 컵", price: "1000" }] },
    { id: "cream", name: "크림", scope: "exclusive", menuId: "a", required: "no", max: "1", items: [{ id: "extra", name: "추가", price: "500" }] },
    { id: "unused", name: "연결 전 옵션", scope: "common", menuId: "", required: "", max: "", items: [] }],
  menus: [{ id: "a", name: "라떼", price: "3500", selected: true, categoryId: "coffee", groupIds: ["size", "cream"], prices: { large: "0" } },
    { id: "b", name: "커피", price: "3000", selected: true, categoryId: "coffee", groupIds: ["size"], prices: { large: "1200" } },
    { id: "c", name: "디저트", price: "0", selected: true, categoryId: "coffee", groupIds: [], prices: { large: "1000" } },
    { id: "hold", name: "보류", price: "", selected: false, categoryId: "coffee", groupIds: [], prices: {} }] };
const before = JSON.stringify(draft);
const plan = planFor(draft);
assert.equal(JSON.stringify(draft), before, "conversion must not mutate owner's draft");
assert.equal(plan.menuRows.length, 3); assert.equal(plan.heldMenus, 1);
assert.equal(plan.groupRows.length, 2); assert.equal(plan.deferredGroups[0], "연결 전 옵션");
assert.equal(plan.menuRows[2].option_not_required, true); assert.equal(plan.menuRows[0].option_not_required, false);
assert.equal(plan.groupRows[0].min, 1); assert.equal(plan.groupRows[1].min, 0);
assert.equal(plan.groupRows[1].linked_menu_id, plan.menuRows[0].id);
assert.equal(plan.groupRows[0].linked_menu_id, null);
assert.equal(plan.priceRows[1].price_delta, 0, "explicit zero must not fall back to 1000");
assert.equal(plan.priceRows[4].price_delta, 1200, "per-menu override must remain separate");
assert.equal(plan.priceRows[2].price_delta, 500, "default extra retained");
assert.equal(plan.priceRows.length, 5, "no stale overrides copied for unlinked groups");
for (const rows of [plan.menuRows, plan.categoryRows, plan.groupRows, plan.optionRows, plan.priceRows]) for (const row of rows) assert.equal(row.store_id, "store-a");
for (const row of plan.menuRows) { assert.equal(row.image, ""); assert.ok(row.id.length <= 40); assert.notEqual(row.id, "a"); }
assert.equal("setup_completed" in plan, false); assert.equal("qr_codes" in plan, false);
function invalid(change) { const copy = structuredClone(draft); change(copy); assert.throws(() => planFor(copy)); }
invalid((d) => d.menus[0].price = "2147483648");
invalid((d) => d.groups[0].items[0].price = "2147483648");
invalid((d) => d.menus[0].prices.large = "2147483648");
invalid((d) => d.menus[0].groupIds.push("missing"));
invalid((d) => d.menus[0].groupIds.push("size"));
invalid((d) => d.menus[1].groupIds.push("cream"));
invalid((d) => d.groups[1].items[0].id = "base");
invalid((d) => d.menus[0].prices.unknown = "0");
invalid((d) => { d.categories.push({ id: "other", name: " 커피 " }); d.menus[2].categoryId = "other"; });
assert.throws(() => adapter.buildAdminPlan(draft, "store-a", () => "same"));
assert.throws(() => adapter.buildAdminPlan(draft, "", () => "id"));
const sourceDraft = structuredClone(draft); sourceDraft.source = "ai"; sourceDraft.groups[0].name = "사이즈";
assert.throws(() => planFor(sourceDraft), "AI size scope requires owner review");
assert.ok(planFor(model.markReviewed(sourceDraft, "group", "size", true)));
assert.notEqual(storage.draftStorageKey("a"), storage.draftStorageKey("b"));
assert.notEqual(storage.draftStorageKey("a"), storage.DRAFT_STORAGE_KEY);
assert.equal(storage.draftStorageKey(""), storage.DRAFT_STORAGE_KEY, "legacy preview remains accessible but is never migrated to a store");

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function main() {
  let authorized = true, count = 0, missingSchema = false, complete = false, absentStore = false, queried = 0;
  const env = { NODE_ENV: "development" };
  const admin = { from: (table) => {
    queried++;
    // Only SELECT exists: any write would fail the test.
    let filtered = false;
    return { select: (_columns, options) => ({ eq: (column, value) => {
      assert.equal(column, "store_id"); assert.equal(value, "store-a"); filtered = true;
      if (table === "stores") return { maybeSingle: async () => ({ data: absentStore ? null : { setup_completed: complete }, error: null }) };
      assert.equal(options.head, true); assert.equal(options.count, "exact"); assert.equal(filtered, true);
      return Promise.resolve({ count: missingSchema ? null : count, error: missingSchema ? { code: "42703" } : null });
    } }) };
  } };
  const routePath = "src/app/api/preview/menu-setup/compatibility/route.ts";
  const route = load(routePath, {
    "node:crypto": { randomUUID: () => String(++id) },
    "@/app/preview/menu-setup/adminPlan": adapter,
    "@/app/api/_lib/storeAuth": { ApiError, createSupabaseAdminClient: () => admin, requireStoreRole: async (params) => {
      assert.equal(params.allowedRoles.length, 1); assert.equal(params.allowedRoles[0], "owner");
      if (!authorized) throw new ApiError(403, "denied");
    } },
  }, { process: { env } });
  const req = (body = { storeId: "store-a", draft, confirmed: true }, origin = "http://localhost:3016") => {
    const request = new Request("http://localhost:3016/api/preview/menu-setup/compatibility", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
    return { body: request.body, headers: request.headers, nextUrl: new URL(request.url) };
  };
  let response = await route.POST(req());
  assert.equal(response.status, 200); assert.equal((await response.json()).compatible, true);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  count = 1; response = await route.POST(req()); assert.equal((await response.json()).compatible, false);
  count = 0; complete = true; response = await route.POST(req()); assert.equal((await response.json()).compatible, false); complete = false;
  missingSchema = true; assert.equal((await route.POST(req())).status, 409); missingSchema = false;
  absentStore = true; assert.equal((await route.POST(req())).status, 409); absentStore = false;
  authorized = false; const oldCount = queried; assert.equal((await route.POST(req())).status, 403); assert.equal(queried, oldCount); authorized = true;
  assert.equal((await route.POST(req(undefined, "https://evil.example"))).status, 403);
  assert.equal((await route.POST(req(undefined, "http://localhost:9999"))).status, 403);
  assert.equal((await route.POST(req(null))).status, 400);
  assert.equal((await route.POST(req({ storeId: "store-a", draft, confirmed: false }))).status, 400);
  assert.equal((await route.POST(req({ storeId: "store-a", draft: null, confirmed: true }))).status, 400);
  assert.equal((await route.POST(req({ padding: "x".repeat(2 * 1024 * 1024) }))).status, 413);
  env.NODE_ENV = "production"; const last = queried; assert.equal((await route.POST(req())).status, 404); assert.equal(queried, last);
  const ui = fs.readFileSync(root + "AdminCompatibilityCheck.tsx", "utf8");
  assert.ok(ui.includes("controller.current?.abort()"), "unmount aborts stale checks");
  const mainUi = fs.readFileSync(root + "MenuSetupPreview.tsx", "utf8");
  const resume = mainUi.slice(mainUi.indexOf("function resumeDraft()"), mainUi.indexOf("function restartDraft()"));
  assert.ok(resume.includes('setCategoryId("all")') && resume.includes('setQuery("")') && resume.includes("setOnlyIssues(false)"), "resume cannot hide menus behind stale category/search filters");
  assert.ok(mainUi.includes("boundStoreId={storeId}"), "analysis and compatibility use the same store context");
  assert.ok(fs.readFileSync(root + "AnalysisLauncher.tsx", "utf8").includes("storeId: boundStoreId || storeId.trim()"), "manual development override cannot cross a bound store");
  const adminMenu = fs.readFileSync("src/app/admin/menu/page.tsx", "utf8");
  const camera = adminMenu.slice(adminMenu.indexOf('capture="environment"'), adminMenu.indexOf('capture="environment"') + 650);
  assert.ok(camera.includes('aria-label="메뉴 사진 직접 촬영"') && camera.includes("void onUploadMenuImage(file)"), "camera uses existing image upload flow, not a separate save path");
  assert.ok(fs.readFileSync(root + "page.tsx", "utf8").includes('key={storeId || "unscoped"}'), "store switch remounts state");
  assert.equal(/\.(insert|update|upsert|delete|rpc)\(/.test(fs.readFileSync("src/app/api/_lib/menuSetupRoutes/compatibility.ts", "utf8")), false);
  console.log("PASS: admin mapping, scoped drafts, no-option/exclusive/override semantics, integer limits, read-only schema/collision/auth/origin/body gates. No live DB or AI calls.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
