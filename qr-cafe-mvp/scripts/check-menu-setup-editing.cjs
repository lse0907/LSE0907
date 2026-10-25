/* eslint-disable @typescript-eslint/no-require-imports -- Actual editor handlers in an offline hook/JSX harness. No browser, network or DB writes. */
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
const { randomUUID } = require("node:crypto");
const root = "src/app/preview/menu-setup/";
function load(file, imports = {}, extra = {}) {
  const context = { exports: {}, TextDecoder, structuredClone, ...extra, require(name) { assert.ok(name in imports, name); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const model = load(root + "draftModel.ts"), storage = load(root + "draftStorage.ts");
const adapter = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
const key = storage.draftStorageKey("edit-store") + ":admin";
const initial = { source: "ai", categories: [{ id: "c", name: "커피" }, { id: "d", name: "디저트" }],
  groups: [{ id: "g", name: "사이즈", scope: "common", menuId: "", required: "yes", max: "1", items: [{ id: "regular", name: "기본", price: "0" }, { id: "large", name: "라지", price: "500" }] }],
  menus: [{ id: "a", name: "오독 라떼", selected: true, price: "3000", categoryId: "c", groupIds: ["g"], prices: { large: "700" } },
    { id: "b", name: "커피", selected: true, price: "3500", categoryId: "c", groupIds: ["g"], prices: { large: "1000" } },
    { id: "cookie", name: "쿠키", selected: true, price: "2000", categoryId: "d", groupIds: [], prices: {} }] };
const disk = new Map([[key, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), draft: initial })]]);
const fakeStorage = { getItem: (k) => disk.get(k) || null, setItem: (k, v) => disk.set(k, v), removeItem: (k) => disk.delete(k) };
const jsx = (type, props) => ({ type, props });
const nodes = (n) => !n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const text = (n) => n == null || typeof n === "boolean" ? "" : typeof n !== "object" ? String(n) : Array.isArray(n) ? n.map(text).join("") : text(n.props?.children);
function mount() {
  let cursor = 0, tree; const hooks = [], effects = [];
  const react = {
    useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], (next) => { hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next; }]; },
    useRef(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect(fn, deps) { const slot = cursor++; if (!hooks[slot] || deps.some((d, i) => d !== hooks[slot][i])) effects.push(fn); hooks[slot] = deps; },
  };
  const component = load(root + "MenuSetupPreview.tsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./draftModel": model, "./draftStorage": storage, "./preview.module.css": { default: {} },
    "./AdminCompatibilityCheck": { default: "Compatibility" }, "./AnalysisLauncher": { default: "Launcher" },
    "./NewAnalysisReview": { default: "AnalysisReview" }, "./SourceEvidence": { default: "Evidence", ConnectedMenus: "ConnectedMenus" },
    "./sourceFiles": load(root + "sourceFiles.ts"), "./analysisReview": load(root + "analysisReview.ts"),
    "./qualityExample": { qualityExampleDraft: () => { throw new Error("No synthetic injection"); }, qualityExamplePhoto: () => null },
  }, { localStorage: fakeStorage, crypto: { randomUUID }, window: { addEventListener() {}, removeEventListener() {}, scrollTo() {}, scrollY: 0, innerHeight: 844 },
    document: { body: { style: { overflow: "" } } }, requestAnimationFrame: (fn) => fn(), setTimeout: () => 1, clearTimeout() {} }).default;
  function render() { cursor = 0; tree = component({ storeId: "edit-store", integrated: true, registrationEnabled: true }); effects.splice(0).forEach((fn) => fn()); return tree; }
  const all = () => nodes(tree);
  const button = (name) => { const found = all().find((n) => n.type === "button" && (text(n) === name || n.props["aria-label"] === name)); assert.ok(found, "Missing button: " + name); return found; };
  const click = (name) => { const b = button(name); assert.ok(!b.props.disabled, "Disabled: " + name); b.props.onClick(); render(); };
  const field = (label, index = 0) => { const labels = all().filter((n) => n.type === "label" && text([n.props.children].flat().filter((child) => !["input", "select"].includes(child?.type))).trim() === label.trim()); assert.ok(labels[index], "Missing label: " + label);
    return nodes(labels[index]).find((n) => ["input", "select"].includes(n.type)); };
  const change = (label, value, index = 0) => { const input = field(label, index); input.props.onChange({ target: { value } }); render(); };
  const check = (label, checked) => { field(label).props.onChange({ target: { checked } }); render(); };
  const saved = () => storage.parseSavedDraft(disk.get(key));
  render(); render();
  return { render, all, button, click, change, check, saved };
}
let ui = mount();
ui.click("이어서 하기");
ui.click("오독 라떼 메뉴 확인");
ui.change("메뉴명", "수정 라떼"); ui.change("기본 가격 (원)", "4100");
ui.change("카테고리 이동", "d");
ui.check("사이즈 · 공통", false);
assert.equal(ui.saved().draft.menus[0].price, "3000", "unapplied edits must not overwrite approved draft");
assert.equal(ui.saved().pendingEdit.draft.menus[0].price, "4100", "unapplied edit is recoverable");
// Real reload: reconstruct all hooks, then resume stored pending editor.
ui = mount(); ui.click("이어서 하기");
assert.equal(ui.saved().pendingEdit.draft.menus[0].name, "수정 라떼");
ui.click("취소");
assert.ok(ui.all().some((n) => text(n) === "아직 적용하지 않은 수정이 있어요."));
ui.click("계속 수정"); ui.click("수정 적용");
let edited = ui.saved().draft;
assert.equal(edited.menus[0].name, "수정 라떼"); assert.equal(edited.menus[0].price, "4100"); assert.equal(edited.menus[0].categoryId, "d");
assert.equal(edited.menus[0].groupIds.length, 0);
assert.equal(JSON.stringify(edited.menus[1]), JSON.stringify(initial.menus[1]), "unlink one menu must not delete common option or change peer");
assert.equal(edited.groups.length, 1); assert.equal(JSON.stringify(edited.menus[2]), JSON.stringify(initial.menus[2]));
ui.click("옵션 1개");
const groupButton = ui.all().find((n) => n.type === "button" && text(n).startsWith("사이즈 · 공통"));
assert.ok(groupButton); groupButton.props.onClick(); ui.render();
ui.change("기본 추가 요금 (원)", "1200", 1);
assert.equal(ui.button("수정 적용").props.disabled, true, "size edits require source review again");
ui.check("연결 메뉴와 사이즈 제공 범위를 원본과 확인했습니다.", true); ui.click("수정 적용");
edited = ui.saved().draft;
assert.equal(edited.groups[0].items[1].price, "1200");
assert.equal(edited.menus[1].prices.large, "1000", "common default edit must preserve menu override");
assert.equal(edited.menus[0].groupIds.length, 0);
ui.click("최종 확인");
ui.check(" 메뉴판의 가격·카테고리·옵션 연결을 최종 확인했습니다.", true);
let approved = ui.all().find((n) => n.type === "Compatibility");
assert.equal(approved.props.enabled, true);
let plan = adapter.buildAdminPlan(approved.props.draft, "edit-store", randomUUID);
assert.equal(plan.menuRows[0].name, "수정 라떼"); assert.equal(plan.menuRows[0].price, 4100);
assert.equal(plan.menuRows[0].option_not_required, true);
assert.equal(plan.priceRows.some((r) => r.menu_id === plan.menuRows[0].id), false, "detached stale overrides must never be saved");
assert.equal(plan.priceRows.find((r) => r.option_item_id === plan.optionRows[1].id).price_delta, 1000);
ui.click("닫기"); ui.click("수정 라떼 메뉴 확인"); ui.change("기본 가격 (원)", "4200"); ui.click("수정 적용");
ui.click("최종 확인"); approved = ui.all().find((n) => n.type === "Compatibility");
assert.equal(approved.props.enabled, false, "any applied edit clears final approval");
ui.check(" 메뉴판의 가격·카테고리·옵션 연결을 최종 확인했습니다.", true);
approved = ui.all().find((n) => n.type === "Compatibility");
plan = adapter.buildAdminPlan(approved.props.draft, "edit-store", randomUUID);
assert.equal(plan.menuRows[0].price, 4200);
ui.click("닫기"); ui.click("커피 메뉴 확인");
const override = ui.all().find((n) => n.type === "input" && n.props["aria-label"] === "커피 라지 추가 요금");
assert.ok(override); override.props.onChange({ target: { value: "" } }); ui.render(); ui.click("수정 적용");
assert.equal(ui.saved().draft.menus[1].prices.large, undefined, "empty override means use common default, not zero");
ui.click("옵션 1개");
ui.all().find((n) => n.type === "button" && text(n).startsWith("사이즈 · 공통")).props.onClick(); ui.render();
ui.check("연결 메뉴와 사이즈 제공 범위를 원본과 확인했습니다.", true); ui.click("수정 적용");
ui.click("쿠키 메뉴 확인");
ui.check(" 이 메뉴를 승인 시 등록합니다 (해제하면 보류)", false); ui.click("수정 적용");
ui.click("최종 확인"); ui.check(" 메뉴판의 가격·카테고리·옵션 연결을 최종 확인했습니다.", true);
approved = ui.all().find((n) => n.type === "Compatibility");
plan = adapter.buildAdminPlan(approved.props.draft, "edit-store", randomUUID);
assert.equal(plan.menuRows.length, 2); assert.equal(plan.heldMenus, 1);
assert.equal(ui.saved().draft.menus.length, 3, "holding a menu must not delete the recoverable draft");
assert.equal(plan.priceRows.find((r) => r.option_item_id === plan.optionRows[1].id).price_delta, 1200);
console.log("PASS: actual editor handlers - name/price/category edits, pending-edit reload, dirty close protection, one-menu unlink without common deletion, shared default with per-menu override, approval reset, exact admin mapping. No live writes.");
