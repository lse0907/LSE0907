/* eslint-disable @typescript-eslint/no-require-imports -- Offline actual component input handlers; no device, network or DB. */
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
const { randomUUID } = require("node:crypto");
const root = "src/app/preview/menu-setup/";
function load(file, imports = {}, extra = {}) {
  const context = { exports: {}, TextDecoder, ...extra, require(name) { assert.ok(name in imports, name); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return context.exports;
}
const model = load(root + "draftModel.ts"), storage = load(root + "draftStorage.ts");
const jsx = (type, props) => ({ type, props });
let cursor = 0, tree; const hooks = [];
const react = {
  useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], next => { hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next; }]; },
  useRef(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
  useEffect() { cursor++; },
};
let reads = 0;
class Reader {
  readAsDataURL(file) { reads++; queueMicrotask(() => { if (file.fail) this.onerror(); else { this.result = "data:image/png;base64,eA=="; this.onload(); } }); }
}
const component = load(root + "MenuSetupPreview.tsx", {
  react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./draftModel": model, "./draftStorage": storage, "./preview.module.css": { default: {} },
  "./AdminCompatibilityCheck": { default: "Compatibility" }, "./AnalysisLauncher": { default: "Launcher" },
  "./NewAnalysisReview": { default: "AnalysisReview" }, "./SourceEvidence": { default: "Evidence", ConnectedMenus: "ConnectedMenus" },
  "./sourceFiles": load(root + "sourceFiles.ts"), "./analysisReview": load(root + "analysisReview.ts"),
  "./qualityExample": { qualityExampleDraft: () => { throw new Error("Synthetic draft not allowed"); }, qualityExamplePhoto: () => null },
}, { crypto: { randomUUID }, FileReader: Reader }).default;
const nodes = n => !n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
function render() { cursor = 0; tree = component({ storeId: "capture-offline", integrated: true }); }
const input = label => nodes(tree).find(n => n.type === "input" && n.props["aria-label"] === label);
const sources = () => nodes(tree).find(n => n.type === "Launcher").props.sources;
const file = name => ({ name, size: 100, type: "image/png" });
async function attach(label, files) {
  const target = { files, value: "same-file" };
  input(label).props.onChange({ target });
  assert.equal(target.value, "", "file input must reset so same file can be selected again");
  render();
  if (files?.length && files.every(f => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024)) {
    assert.equal(input("메뉴판 직접 촬영").props.disabled, true);
  }
  await new Promise(resolve => setImmediate(resolve)); render();
}
(async () => {
  render();
  assert.equal(input("메뉴판 직접 촬영").props.capture, "environment");
  assert.equal(input("메뉴판 직접 촬영").props.accept, "image/*");
  assert.equal(input("메뉴판 이미지 선택").props.multiple, true);
  await attach("메뉴판 직접 촬영", [file("camera.png")]); assert.equal(sources().length, 1);
  await attach("메뉴판 직접 촬영", null); assert.equal(sources().length, 1);
  await attach("메뉴판 이미지 선택", [file("one.png"), file("two.png")]); assert.equal(sources().length, 3);
  await attach("메뉴판 직접 촬영", [file("camera.png")]); assert.equal(sources().length, 4);
  const previous = JSON.stringify(sources());
  await attach("메뉴판 이미지 선택", [{ ...file("bad.png"), fail: true }, file("good.png")]);
  assert.equal(JSON.stringify(sources()), previous, "failed batch must preserve existing sources without partial append");
  const beforeInvalid = reads;
  await attach("메뉴판 이미지 선택", [{ ...file("large.png"), size: 11 * 1024 * 1024 }]);
  await attach("메뉴판 이미지 선택", [{ ...file("text.csv"), type: "text/csv" }]);
  assert.equal(reads, beforeInvalid); assert.equal(JSON.stringify(sources()), previous);
  assert.equal(input("메뉴판 직접 촬영").props.disabled, false);
  console.log("PASS: actual admin photo handlers - capture attribute, append, cancel, same-file reselect, busy input lock, failed batch preservation, type/size rejection. No device camera, AI or DB calls.");
})().catch(error => { console.error(error); process.exitCode = 1; });
