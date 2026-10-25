/* eslint-disable @typescript-eslint/no-require-imports -- Production routing with stubbed auth/AI/DB; never reads credentials. */
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript"), crypto = require("node:crypto");
const env = { NODE_ENV: "production" };
let authorized = true, count = 0, dbCalls = 0, providerCalls = 0, reserveCalls = 0, writes = 0;
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const draft = { source: "ai", categories: [{ id: "c", name: "커피" }], groups: [], menus: [{ id: "m", name: "커피", price: "3000", categoryId: "c", groupIds: [], prices: {}, selected: true }] };
const admin = {
  from() { dbCalls++; return { select() { return { eq() { return { count, error: null, maybeSingle: async () => ({ data: { setup_completed: false }, error: null }) }; } }; } }; },
  async rpc(name, args) { writes++; assert.equal(name, "admin_import_menu_setup_v1"); return { data: { storeId: args.p_store_id, menus: 1 }, error: null }; },
};
const imports = {
  "node:crypto": crypto,
  "@/app/api/_lib/storeAuth": { ApiError, apiErrorResponse: error => Response.json({ ok: false }, { status: error.status }), createSupabaseAdminClient: () => admin, requireStoreRole: async args => { assert.equal(args.allowedRoles[0], "owner"); if (!authorized) throw new ApiError(403, "denied"); return { userId: "owner" }; } },
  "@/app/api/_lib/aiExecution": { isExternalAiEnabled: () => env.AI_EXTERNAL_CALLS_ENABLED === "true", reserveAiExecution: async args => { reserveCalls++; assert.equal(args.feature, "menu_setup"); return { requestId: "usage", model: "offline" }; }, finalizeAiExecution: async () => {} },
  "@/app/api/_lib/openAiProvider": { OpenAiProviderError: class extends Error {} },
  "@/app/api/_lib/menuSetupProvider": { generateMenuSetup: async () => { providerCalls++; return { draft, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }; } },
};
function load(file) {
  const context = { exports: {}, Buffer, Response, URL, TextEncoder, TextDecoder, process: { env }, require(name) {
    if (name in imports) return imports[name];
    if (name.startsWith("@/app/")) return load("src/app/" + name.slice(6) + ".ts");
    if (name.startsWith("./") || name.startsWith("../")) return load(require("node:path").resolve(require("node:path").dirname(file), name + ".ts"));
    throw new Error("Unexpected dependency: " + name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const routes = Object.fromEntries(["analyze", "compatibility", "register"].map(kind => [kind, load("src/app/api/admin/menu-setup/" + kind + "/route.ts")]));
const previews = Object.fromEntries(Object.keys(routes).map(kind => [kind, load("src/app/api/preview/menu-setup/" + kind + "/route.ts")]));
const access = load("src/app/api/_lib/menuSetupAccess.ts");
function req(kind, origin = "https://menu.example", target = "https://menu.example", overrides = {}) {
  const body = { storeId: "store-a", draft, confirmed: true, requestId: crypto.randomUUID(), confirmExternalProcessing: true, sources: [{ name: "menu.csv", kind: "csv", content: "name,price\n커피,3000" }], ...overrides };
  const r = new Request(target + "/api/admin/menu-setup/" + kind, { method: "POST", headers: { origin, "x-forwarded-host": "menu.example", "x-forwarded-proto": "https" }, body: JSON.stringify(body) });
  return { headers: r.headers, body: r.body, nextUrl: new URL(r.url) };
}
(async () => {
  for (const kind of Object.keys(routes)) assert.equal((await routes[kind].POST(req(kind))).status, 404);
  env.MENU_SETUP_ENABLED = env.NEXT_PUBLIC_MENU_SETUP_ENABLED = "true";
  for (const value of ["", "http://menu.example", "https://menu.example/path", "https://user:pass@menu.example", "https://menu.example?x=y", "https://localhost"]) {
    env.MENU_SETUP_ORIGIN = value; assert.equal(access.menuSetupRouteEnabled("admin"), false);
    for (const kind of Object.keys(routes)) assert.equal((await routes[kind].POST(req(kind))).status, 404);
  }
  assert.equal(dbCalls + providerCalls + reserveCalls + writes, 0);
  env.MENU_SETUP_ORIGIN = "https://menu.example";
  for (const flag of ["MENU_SETUP_ENABLED", "NEXT_PUBLIC_MENU_SETUP_ENABLED"]) {
    env[flag] = "false"; assert.equal(access.menuSetupRouteEnabled("admin"), false); env[flag] = "true";
  }
  for (const kind of Object.keys(routes)) {
    assert.equal((await previews[kind].POST(req(kind))).status, 404, "preview cannot open in production even with all rollout flags");
    for (const origin of ["", "null", "http://menu.example", "https://other.example", "https://menu.example.evil.test", "https://menu.example/path", "https://user@menu.example"]) {
      // Registration checks its operation switch before origin; enable it for this boundary test.
      env.MENU_SETUP_REGISTRATION_ENABLED = "true";
      assert.equal((await routes[kind].POST(req(kind, origin))).status, 403, kind + " rejects " + origin);
    }
    assert.equal((await routes[kind].POST(req(kind, undefined, "https://evil.example"))).status, 403, "forwarded headers cannot authorize a different request origin");
  }
  env.AI_EXTERNAL_CALLS_ENABLED = env.MENU_SETUP_ANALYSIS_ENABLED = "true";
  authorized = false;
  for (const kind of Object.keys(routes)) assert.equal((await routes[kind].POST(req(kind))).status, 403);
  assert.equal(dbCalls + providerCalls + reserveCalls + writes, 0);
  authorized = true;
  for (const kind of Object.keys(routes)) {
    const response = await routes[kind].POST(req(kind));
    assert.equal(response.status, 200, kind); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(providerCalls, 1); assert.equal(reserveCalls, 1); assert.equal(writes, 1);
  count = 1;
  assert.equal((await (await routes.compatibility.POST(req("compatibility"))).json()).compatible, false);
  env.MENU_SETUP_ANALYSIS_ENABLED = "false"; assert.equal((await routes.analyze.POST(req("analyze"))).status, 503);
  env.MENU_SETUP_REGISTRATION_ENABLED = "false"; assert.equal((await routes.register.POST(req("register"))).status, 503);
  env.NODE_ENV = "development";
  assert.equal(access.menuSetupRouteEnabled("preview"), true);
  assert.equal(access.menuSetupOriginAllowed(req("analyze", "http://127.0.0.1:3016", "http://localhost:3016"), "preview"), true);
  assert.equal(access.menuSetupOriginAllowed(req("analyze", "http://localhost:9999", "http://localhost:3016"), "admin"), false);
  console.log("PASS: production default closed, paired rollout flags + trusted HTTPS origin, preview always closed, hostile/null/forwarded origins blocked, owner denial before side effects, shared analyze/check/register positive paths, no-store, existing data protection, independent operation switches. No live calls.");
})().catch(error => { console.error(error); process.exitCode = 1; });
