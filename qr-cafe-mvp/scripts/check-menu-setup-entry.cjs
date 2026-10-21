/* eslint-disable @typescript-eslint/no-require-imports -- Offline route regression; no live credentials or DB. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

async function main() {
  const env = { NODE_ENV: "development", MENU_SETUP_REGISTRATION_ENABLED: "false" };
  let authorized = true, existing = false, complete = false, schemaError = false, reads = 0;
  const tableReads = [];
  const admin = { from(table) {
    reads++; tableReads.push(table);
    return { select() { return { eq() {
      if (table === "stores") return { maybeSingle: async () => ({ data: { store_name: "검증", setup_completed: complete }, error: null }) };
      return Promise.resolve({ count: existing ? 1 : 0, error: schemaError ? new Error("schema") : null });
    } }; } };
  } };
  const accessContext = { exports: {}, URL, process: { env } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/api/_lib/menuSetupAccess.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, accessContext);
  const imports = {
    "@/app/api/_lib/menuSetupAccess": accessContext.exports,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "Fragment" },
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "next/server": { NextRequest: Request },
    "@/app/admin/_components/AdminPageHeader": { default: "AdminPageHeader" },
    "@/app/preview/menu-setup/MenuSetupPreview": { default: "MenuSetupPreview" },
    "@/app/api/_lib/storeAuth": { createSupabaseAdminClient: () => admin, requireStoreRole: async (args) => {
      assert.deepEqual(Array.from(args.allowedRoles), ["owner"]);
      assert.equal(args.storeId, "store-a");
      if (!authorized) throw new Error("unauthorized");
    } },
  };
  const context = { exports: {}, Request, Headers, process: { env }, require(name) {
    assert.ok(name in imports, `Unexpected dependency: ${name}`); return imports[name];
  } };
  const code = fs.readFileSync("src/app/admin/menu/setup/page.tsx", "utf8");
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const render = async (store = "store-a") => JSON.stringify(await context.exports.default({ searchParams: Promise.resolve({ store }) }));
  let tree = await render();
  assert.match(tree, /MenuSetupPreview/); assert.match(tree, /"integrated":true/); assert.match(tree, /"registrationEnabled":false/);
  assert.equal(tableReads.length, 7); assert.ok(!tableReads.includes("qr_codes"), "QR-only store remains eligible");
  env.MENU_SETUP_REGISTRATION_ENABLED = "true";
  assert.match(await render(), /"registrationEnabled":true/);
  for (const kind of ["existing", "complete", "schema"]) {
    existing = kind === "existing"; complete = kind === "complete"; schemaError = kind === "schema";
    tree = await render(); assert.doesNotMatch(tree, /MenuSetupPreview/);
    assert.match(tree, kind === "schema" ? /확인하지 못했습니다/ : /기존 내용을 보호/);
  }
  existing = complete = schemaError = false;
  authorized = false; const priorReads = reads;
  assert.doesNotMatch(await render(), /MenuSetupPreview/); assert.equal(reads, priorReads, "unauthorized requests must not read store data");
  authorized = true;
  await assert.rejects(render(["store-a", "store-b"]), /NOT_FOUND/);
  env.NODE_ENV = "production"; const productionReads = reads;
  await assert.rejects(render(), /NOT_FOUND/); assert.equal(reads, productionReads);
  env.MENU_SETUP_ENABLED = env.NEXT_PUBLIC_MENU_SETUP_ENABLED = "true";
  await assert.rejects(render(), /NOT_FOUND/, "missing deployment origin keeps page closed");
  env.MENU_SETUP_ORIGIN = "https://menu.example";
  assert.match(await render(), /MenuSetupPreview/, "explicitly enabled production page uses the real owner and empty-store checks");
  existing = true; assert.doesNotMatch(await render(), /MenuSetupPreview/); existing = false;
  authorized = false; const deniedReads = reads;
  assert.doesNotMatch(await render(), /MenuSetupPreview/); assert.equal(reads, deniedReads);
  const client = fs.readFileSync("src/app/preview/menu-setup/MenuSetupPreview.tsx", "utf8");
  assert.match(client, /integrated \? ":admin" : ""/);
  assert.match(client, /!integrated && <details className=\{styles.devSettings\}/);
  assert.match(client, /!integrated && \(!storeId \|\| !registrationEnabled\) && <button/);
  assert.match(client, /setDraft\(integrated \? null : exampleDraft\(\)\)/);
  const setup = fs.readFileSync("src/app/admin/setup/page.tsx", "utf8");
  assert.match(setup, /\.card\[hidden\]\s*\{\s*display:\s*none;/, "author display:grid must not override the hidden checklist");
  console.log("PASS: integrated entry owner/empty-store/schema/production guards, no QR restriction, separate draft storage, no synthetic tools/save in admin mode. No live DB/AI calls.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
