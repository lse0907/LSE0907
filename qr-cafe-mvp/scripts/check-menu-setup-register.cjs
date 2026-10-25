/* eslint-disable @typescript-eslint/no-require-imports -- Offline API and client event tests. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
function load(file, imports = {}, extra = {}) {
  const context = { exports: {}, Buffer, Response, URL, AbortController, setTimeout, clearTimeout, process: { env: {} }, require: (name) => {
    if (name === "../menuSetupAccess") return load("src/app/api/_lib/menuSetupAccess.ts", imports, extra);
    if (name.startsWith("@/app/api/_lib/menuSetupRoutes/")) return load("src/app/api/_lib/menuSetupRoutes/" + name.split("/").pop() + ".ts", imports, extra);
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name];
  }, ...extra };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const root = "src/app/preview/menu-setup/";
const model = load(root + "draftModel.ts"), storage = load(root + "draftStorage.ts");
const adapter = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
const draft = { source: "ai", categories: [{ id: "coffee", name: "커피" }], groups: [], menus: [{ id: "a", name: "아메리카노", selected: true, price: "3000", categoryId: "coffee", groupIds: [], prices: {} }] };
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function main() {
  let authorized = true, error = null, missingResult = false;
  const calls = [], env = { NODE_ENV: "development", MENU_SETUP_REGISTRATION_ENABLED: "false" };
  const route = load("src/app/api/preview/menu-setup/register/route.ts", {
    "node:crypto": crypto,
    "@/app/preview/menu-setup/adminPlan": adapter,
    "@/app/preview/menu-setup/draftStorage": storage,
    "@/app/api/_lib/storeAuth": { ApiError, createSupabaseAdminClient: () => ({ rpc: async (name, args) => {
      assert.equal(name, "admin_import_menu_setup_v1"); calls.push(args);
      return { error, data: missingResult ? null : { storeId: args.p_store_id, menus: 1, categories: 1, groups: 0, replayed: false } };
    } }), requireStoreRole: async (params) => {
      assert.equal(params.storeId, "store-a"); assert.equal(params.allowedRoles[0], "owner");
      if (!authorized) throw new ApiError(403, "denied"); return { userId: "owner-uuid" };
    } },
  }, { process: { env } });
  const requestId = crypto.randomUUID();
  const payload = { storeId: "store-a", draft, confirmed: true, requestId };
  const req = (body = payload, origin = "http://localhost:3016") => {
    const r = new Request("http://localhost:3016/api/preview/menu-setup/register", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
    return { body: r.body, headers: r.headers, nextUrl: new URL(r.url) };
  };
  assert.equal((await route.POST(req())).status, 503); assert.equal(calls.length, 0);
  env.MENU_SETUP_REGISTRATION_ENABLED = "true";
  assert.equal((await route.POST(req(undefined, "https://evil.example"))).status, 403);
  assert.equal((await route.POST(req(undefined, "http://localhost:9999"))).status, 403);
  authorized = false; assert.equal((await route.POST(req())).status, 403); authorized = true; assert.equal(calls.length, 0);
  for (const body of [null, {}, { ...payload, confirmed: false }, { ...payload, requestId: "bad" }, { ...payload, draft: { ...draft, source: undefined } },
    { ...payload, draft: { ...draft, notes: ["검증용 가상 예시 · 실제 AI 아님"] } }, { ...payload, draft: { ...draft, menus: [{ ...draft.menus[0], price: "" }] } }]) assert.equal((await route.POST(req(body))).status, 400);
  assert.equal((await route.POST(req({ padding: "x".repeat(2 * 1024 * 1024) }))).status, 413); assert.equal(calls.length, 0);
  let response = await route.POST(req()); assert.equal(response.status, 200); assert.equal((await response.json()).result.menus, 1);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  await route.POST(req()); assert.equal(calls[0].p_draft_hash, calls[1].p_draft_hash); assert.notEqual(calls[0].p_plan.menuRows[0].id, calls[1].p_plan.menuRows[0].id);
  assert.equal(calls[0].p_request_id, requestId); assert.equal(calls[0].p_plan.menuRows[0].option_not_required, true);
  for (const [code, message, status] of [["PGRST202", "missing", 503], ["42501", "denied", 403], ["P0001", "MENU_SETUP_TARGET_NOT_EMPTY", 409], ["P0001", "MENU_SETUP_ALREADY_IMPORTED", 409], ["55P03", "lock timeout", 409], ["40P01", "deadlock", 409], ["57014", "statement timeout", 409], ["23505", "duplicate", 409]]) {
    error = { code, message }; const failed = await route.POST(req()); assert.equal(failed.status, status); assert.equal((await failed.json()).notSaved, true);
  }
  error = { code: "", message: "TypeError: fetch failed" }; response = await route.POST(req()); assert.equal(response.status, 502); assert.equal((await response.json()).notSaved, false, "unknown commit result must keep the durable request ID");
  error = null; missingResult = true; assert.equal((await route.POST(req())).status, 502); missingResult = false;
  env.NODE_ENV = "production"; const count = calls.length; assert.equal((await route.POST(req())).status, 404); assert.equal(calls.length, count);

  // Execute actual client handlers with small hook/JSX stubs; no DOM or live network.
  const disk = new Map(); let blockedStorage = false, fetchCount = 0, saveCount = 0, failNetwork = true;
  const sentIds = [], savingStates = [];
  const fakeStorage = { getItem: (key) => disk.get(key) || null, setItem: (key, value) => { if (blockedStorage) throw new Error("full"); disk.set(key, value); }, removeItem: (key) => disk.delete(key) };
  function client() {
    let cursor = 0; const hooks = [], effects = [];
    const react = {
      useState: (initial) => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (next) => { hooks[slot] = next; }]; },
      useRef: (initial) => { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
      useEffect: (effect, deps) => { const slot = cursor++; const old = hooks[slot]; if (!old || deps.some((value, i) => value !== old[i])) effects.push(effect); hooks[slot] = deps; },
    };
    const jsx = (type, props) => ({ type, props });
    const ui = load(root + "AdminCompatibilityCheck.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./draftStorage": storage, "./preview.module.css": { default: {} } }, {
      crypto, localStorage: fakeStorage, fetch: async (url, init) => {
        fetchCount++; const body = JSON.parse(init.body);
        if (url.endsWith("compatibility")) return Response.json({ ok: true, compatible: true, message: "empty", deferredGroups: [] });
        saveCount++; assert.ok(disk.get(storage.draftStorageKey("store-a") + ":import-request"), "request ID must be durable before POST");
        sentIds.push(body.requestId); assert.equal(body.confirmed, true);
        if (failNetwork) throw new Error("lost response");
        return Response.json({ ok: true, result: { storeId: "store-a", menus: 1 } });
      },
    }).default;
    let tree;
    const render = () => { cursor = 0; tree = ui({ storeId: "store-a", draft, enabled: true, registrationEnabled: true, onSaving: (value) => savingStates.push(value) }); const pending = effects.splice(0); pending.forEach((fn) => fn()); return tree; };
    const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
    const button = (name) => nodes(tree).find((node) => node.type === "button" && node.props.children === name);
    return { render, button, nodes: () => nodes(tree) };
  }
  let ui = client(); ui.render(); ui.render();
  await ui.button("관리자 호환성 확인 · 읽기 전용").props.onClick(); ui.render();
  blockedStorage = true; await ui.button("이 매장에 메뉴 등록").props.onClick(); assert.equal(saveCount, 0); blockedStorage = false;
  const submit = ui.button("이 매장에 메뉴 등록").props.onClick;
  await Promise.all([submit(), submit()]); ui.render(); assert.equal(saveCount, 1, "double click sends only one registration request");
  const firstId = sentIds[0]; assert.ok(firstId);
  // Simulate reload after unknown commit: same draft recovers same request, with no automatic POST.
  ui = client(); ui.render(); ui.render(); const beforeRetry = fetchCount;
  assert.ok(ui.button("같은 요청으로 등록 결과 확인")); assert.equal(fetchCount, beforeRetry);
  failNetwork = false; await ui.button("같은 요청으로 등록 결과 확인").props.onClick(); ui.render();
  assert.equal(sentIds[1], firstId); assert.equal(saveCount, 2);
  assert.ok(ui.nodes().some((node) => node.type === "a" && node.props.href === "/admin/menu?store=store-a"));
  assert.deepEqual(savingStates, [true, false, true, false]);
  const source = fs.readFileSync(root + "MenuSetupPreview.tsx", "utf8");
  assert.ok(source.includes("if (registering)")); assert.ok(source.includes("disabled={registering}"));
  console.log("PASS: registration API feature/auth/origin/body/source gates, one atomic RPC only, stable server hash, durable request-before-POST, reload/network recovery reusing ID, storage failure blocks writes. No live DB/AI calls.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
