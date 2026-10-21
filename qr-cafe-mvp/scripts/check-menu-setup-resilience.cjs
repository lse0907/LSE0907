/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual handler/data tests; never sends network requests. */
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
const { randomUUID } = require("node:crypto");
const root = "src/app/preview/menu-setup/";
function load(file, imports = {}, extras = {}) {
  const context = { exports: {}, TextEncoder, TextDecoder, ...extras, require(name) { assert.ok(name in imports, name); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const storage = load(root + "draftStorage.ts"), model = load(root + "draftModel.ts");
const contract = load(root + "analysisContract.ts", { "./draftStorage": storage });
const adapter = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
function largeDraft(itemCount = 40) {
  return { source: "ai", categories: Array.from({ length: 100 }, (_, i) => ({ id: "c" + i, name: "분류 " + i })),
    groups: [{ id: "g", name: "추가 선택", scope: "common", menuId: "", required: "no", max: "1", items: Array.from({ length: itemCount }, (_, i) => ({ id: "i" + i, name: "추가 " + i, price: String(i * 100) })) }],
    menus: Array.from({ length: 500 }, (_, i) => ({ id: "m" + i, name: "메뉴 " + i, price: String(3000 + i), categoryId: "c" + (i % 100), selected: true, groupIds: ["g"], prices: { i1: "0", i2: String(i) } })) };
}
const large = largeDraft(), snapshot = JSON.stringify(large), started = performance.now();
const plan = adapter.buildAdminPlan(large, "offline-large", randomUUID);
assert.equal(plan.menuRows.length, 500); assert.equal(plan.categoryRows.length, 100); assert.equal(plan.priceRows.length, 20000);
assert.equal(plan.priceRows.find((p) => p.menu_id === plan.menuRows[499].id && p.option_item_id === plan.optionRows[1].id).price_delta, 0);
assert.equal(plan.priceRows.find((p) => p.menu_id === plan.menuRows[499].id && p.option_item_id === plan.optionRows[2].id).price_delta, 499);
assert.equal(JSON.stringify(large), snapshot, "owner edits must not be mutated by conversion");
assert.equal(storage.parseSavedDraft(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), draft: large })).draft.menus.length, 500);
assert.throws(() => adapter.buildAdminPlan(largeDraft(41), "offline-large", randomUUID), /너무 많/);
assert.equal(model.validPrice("2147483647"), true); assert.equal(model.validPrice("2147483648"), false, "UI must reject DB integer overflow before final approval");
const overflow = structuredClone(large); overflow.menus[0].price = "2147483648";
assert.equal(model.registrationState(overflow).canRegister, false);
const raw = { ...large, warnings: [], menus: large.menus.map((m) => ({ ...m, prices: Object.entries(m.prices).map(([itemId, price]) => ({ itemId, price })) })) };
assert.equal(contract.normalizeAnalysis(raw).menus.length, 500);
assert.throws(() => contract.normalizeAnalysis({ ...raw, menus: [...raw.menus, { ...raw.menus[0], id: "m501" }] }));
const mixed = [{ name: "촬영.jpg", kind: "image", content: "data:image/jpeg;base64,AAAA" }, { name: "캡처.png", kind: "image", content: "data:image/png;base64,AAAA" }, { name: "외부.csv", kind: "csv", content: "상품명,판매가\n커피,3000" }];
assert.equal(contract.validateSources(mixed).length, 3);
console.log("PASS: 500 menus / 100 categories / 20,000 price links, zero overrides, storage restore, 501-menu/20,500-link limits, price overflow. Mapping " + Math.round(performance.now() - started) + "ms (local, not production SLA).");

async function main() {
  let calls = 0, outcomes = [], finishes = 0, begin = 0, mode = "success", release;
  const timers = new Map(); let timerId = 0;
  const sample = { source: "ai", categories: [{ id: "c", name: "커피" }], groups: [], menus: [{ id: "m", name: "커피", selected: true, price: "3000", categoryId: "c", groupIds: [], prices: {} }] };
  let props = { sources: mixed, existing: true, locked: false, boundStoreId: "owner-store", integrated: true,
    onResult: (draft, revision) => outcomes.push({ draft, revision }), onBegin: () => ++begin, onFinish: () => finishes++ };
  let cursor = 0, hooks = [], effects = [], tree;
  const react = {
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (v) => { hooks[slot] = v; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect(effect, deps) { const slot = cursor++; if (!hooks[slot] || deps.some((d, i) => d !== hooks[slot][i])) effects.push(effect); hooks[slot] = deps; },
  };
  const jsx = (type, props) => ({ type, props });
  const component = load(root + "AnalysisLauncher.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./analysisContract": contract,
    "./draftStorage": storage, "./preview.module.css": { default: {} } }, {
    URLSearchParams, AbortController, window: { location: { search: "?store=wrong-store" } }, localStorage: { getItem: () => "wrong-store" },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (_url, init) => {
      assert.equal(_url, "/api/admin/menu-setup/analyze", "integrated administrator uses the formal API");
      calls++; const body = JSON.parse(init.body); assert.equal(body.storeId, "owner-store"); assert.equal(body.sources.length, 3); assert.equal(body.confirmExternalProcessing, true);
      if (mode === "deferred") await new Promise((resolve) => { release = resolve; });
      if (mode === "timeout") await new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
      if (mode === "network") throw new Error("network");
      if (mode === "json") return { ok: true, json: async () => { throw new Error("bad JSON"); } };
      return { ok: mode !== "quota", json: async () => mode === "quota" ? { ok: false, message: "quota" } : { ok: true, draft: mode === "invalid" ? {} : sample } };
    },
  }).default;
  const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => { cursor = 0; tree = component(props); effects.splice(0).forEach((fn) => fn()); };
  const button = (name) => nodes(tree).find((n) => n.type === "button" && n.props.children === name);
  const flush = () => new Promise(setImmediate);
  render(); render(); assert.equal(calls, 0, "mount must never trigger paid analysis");
  button("초안 만들기").props.onClick(); render();
  mode = "deferred"; const run = button("동의하고 분석").props.onClick; run(); run(); assert.equal(calls, 1, "double click analysis must be single flight");
  release(); await flush(); render(); assert.equal(outcomes.length, 1); assert.equal(finishes, 1); assert.equal(timers.size, 0);
  for (const failure of ["network", "json", "invalid", "quota", "timeout"]) {
    button("초안 만들기").props.onClick(); render(); mode = failure;
    button("동의하고 분석").props.onClick();
    if (failure === "timeout") [...timers.values()].forEach((fn) => fn());
    await flush(); render();
    assert.equal(outcomes.length, 1, "failed analysis must never replace current draft: " + failure);
    assert.ok(nodes(tree).some((n) => n.props?.role === "alert"), failure + " must be visible");
    assert.equal(timers.size, 0); button("취소").props.onClick(); render();
  }
  props = { ...props, locked: true }; render(); assert.equal(button("초안 만들기").props.disabled, true);
  props = { ...props, locked: false, sources: [] }; render(); assert.equal(button("초안 만들기").props.disabled, true);
  assert.equal(calls, 6); assert.equal(finishes, 6);
  console.log("PASS: actual analysis handlers - mixed image/CSV payload, fixed store, single flight, network/invalid JSON/invalid draft/quota/timeout preserve draft, no automatic retry, timer cleanup.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
