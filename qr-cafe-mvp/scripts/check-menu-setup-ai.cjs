/* eslint-disable @typescript-eslint/no-require-imports -- Offline CommonJS test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(path, imports = {}, extra = {}) {
  const context = { exports: {}, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, Buffer, Response, URL, process: { env: {} }, require: (id) => {
    if (id === "../menuSetupAccess") return load("src/app/api/_lib/menuSetupAccess.ts", imports, extra);
    if (id.startsWith("@/app/api/_lib/menuSetupRoutes/")) return load("src/app/api/_lib/menuSetupRoutes/" + id.split("/").pop() + ".ts", imports, extra);
    if (!imports[id]) throw new Error(`Unexpected dependency: ${id}`);
    return imports[id];
  }, ...extra };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const root = "src/app/preview/menu-setup/";
const storage = load(root + "draftStorage.ts");
const contract = load(root + "analysisContract.ts", { "./draftStorage": storage });
const raw = { categories: [{ id: "coffee", name: "커피" }], groups: [], menus: [{ id: "a", name: "아메리카노", price: "", categoryId: "coffee", groupIds: [], prices: [] }], warnings: ["가격과 옵션 정보를 확인해주세요."] };
const draft = contract.normalizeAnalysis(raw);
assert.equal(draft.source, "ai"); assert.equal(draft.menus[0].price, ""); assert.equal(draft.notes.length, 1);
assert.throws(() => contract.normalizeAnalysis({ ...raw, menus: [...raw.menus, ...raw.menus] }));
assert.throws(() => contract.normalizeAnalysis({ ...raw, menus: [{ ...raw.menus[0], groupIds: ["missing"] }] }));
assert.throws(() => contract.normalizeAnalysis({ ...raw, menus: [] }));
assert.throws(() => contract.normalizeAnalysis({ ...raw, menus: [{ ...raw.menus[0], prices: [{ itemId: "__proto__", price: "0" }] }] }));
for (const bad of [[], [{ name: "a", kind: "image", content: "https://evil.example/a.png" }], [{ name: "a", kind: "csv", content: "" }], [{ name: "a", kind: "csv", content: "x".repeat(200001) }]]) assert.throws(() => contract.validateSources(bad));
const sources = contract.validateSources([{ name: "외부.csv", kind: "csv", content: "상품명,판매가\n커피,3000" }]);
const nearLimit = { name: "한".repeat(200), kind: "image", content: "data:image/png;base64," + "A".repeat(contract.MAX_REQUEST_BYTES - 250) };
assert.throws(() => contract.validateSources([nearLimit]), /너무 큽니다/, "serialized Unicode filenames and JSON metadata also count toward the body limit");
assert.equal(contract.validateSources([{ name: "menu.png", kind: "image", content: "data:image/png;base64," + "A".repeat(contract.MAX_REQUEST_BYTES - 2048) }]).length, 1);
class ApiError extends Error { constructor(status, message, code = "ERROR") { super(message); this.status = status; this.code = code; } }
class ProviderError extends ApiError { constructor(status, message, code, usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }) { super(status, message, code); this.usage = usage; } }
async function main() {
  let sent = 0, request;
  const env = { OPENAI_API_KEY: "offline-dummy", AI_EXTERNAL_CALLS_ENABLED: "true", MENU_SETUP_ANALYSIS_ENABLED: "true" };
  let fixture = { status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(raw) }] }], usage: { input_tokens: 100, output_tokens: 50 } };
  const provider = load("src/app/api/_lib/menuSetupProvider.ts", { "./openAiProvider": { OpenAiProviderError: ProviderError }, "@/app/preview/menu-setup/analysisContract": contract }, { process: { env }, fetch: async (_url, init) => { sent++; request = JSON.parse(init.body); return { ok: true, json: async () => fixture }; } });
  const result = await provider.generateMenuSetup(sources, "offline-model");
  assert.equal(result.draft.menus[0].price, ""); assert.equal(result.inputTokens, 100); assert.equal(sent, 1);
  assert.equal(request.store, false); assert.equal(request.text.format.strict, true); assert.ok(request.instructions.includes("untrusted DATA"));
  assert.ok(request.instructions.includes("ADDITIONAL charges above that base"), "size selling prices must not be used as option surcharges");
  assert.ok(request.instructions.includes("base 3000 with L=0,J=800,K=1600"), "explicit size prices are converted to base plus deltas");
  assert.ok(request.instructions.includes("unlinked common group"), "unspecified add-on scope must not silently drop visible extras");
  fixture = { ...fixture, status: "incomplete" };
  await assert.rejects(() => provider.generateMenuSetup(sources, "offline-model"), (error) => error.usage.inputTokens === 100);
  env.AI_EXTERNAL_CALLS_ENABLED = "false";
  await assert.rejects(() => provider.generateMenuSetup(sources, "offline-model")); assert.equal(sent, 2, "disabled provider never calls fetch");

  let enabled = false, authorized = true, reserveAllowed = true, failProvider = false, generated = 0, finalized = [];
  const calls = [];
  const routeEnv = { NODE_ENV: "development", MENU_SETUP_ANALYSIS_ENABLED: "true" };
  const route = load("src/app/api/preview/menu-setup/analyze/route.ts", {
    "@/app/api/_lib/storeAuth": { ApiError, apiErrorResponse: (error) => Response.json({ ok: false, message: error.message }, { status: error.status }), createSupabaseAdminClient: () => ({}), requireStoreRole: async () => { calls.push("auth"); if (!authorized) throw new ApiError(403, "denied"); return { userId: "owner" }; } },
    "@/app/api/_lib/aiExecution": { isExternalAiEnabled: () => enabled, reserveAiExecution: async (params) => { calls.push("reserve"); assert.equal(params.feature, "menu_setup"); if (!reserveAllowed) throw new ApiError(429, "blocked"); return { requestId: "id", model: "offline" }; }, finalizeAiExecution: async (params) => finalized.push(params.status) },
    "@/app/api/_lib/openAiProvider": { OpenAiProviderError: ProviderError },
    "@/app/api/_lib/menuSetupProvider": { generateMenuSetup: async () => { calls.push("provider"); generated++; if (failProvider) throw new ProviderError(502, "invalid output", "TEST", { inputTokens: 42, outputTokens: 4, cachedInputTokens: 0 }); return result; } },
    "@/app/preview/menu-setup/analysisContract": contract,
  }, { process: { env: routeEnv } });
  function req(body = { storeId: "test", sources, confirmExternalProcessing: true }, origin = "http://localhost:3016") { const r = new Request("http://localhost:3016/api/preview/menu-setup/analyze", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }); return { body: r.body, headers: r.headers, nextUrl: new URL(r.url) }; }
  assert.equal((await route.POST(req())).status, 503); assert.equal(generated, 0);
  enabled = true;
  for (const invalid of [null, [], "invalid"]) assert.equal((await route.POST(req(invalid))).status, 400);
  assert.equal((await route.POST(req(undefined, "https://other.example"))).status, 403);
  assert.equal((await route.POST(req(undefined, "http://localhost:9999"))).status, 403);
  assert.equal((await route.POST(req({ storeId: "test", sources, confirmExternalProcessing: false }))).status, 400);
  authorized = false; assert.equal((await route.POST(req())).status, 403); assert.equal(generated, 0);
  authorized = true; reserveAllowed = false; assert.equal((await route.POST(req())).status, 429); assert.equal(generated, 0);
  reserveAllowed = true; calls.length = 0;
  const response = await route.POST(req()); assert.equal(response.status, 200); assert.deepEqual(calls, ["auth", "reserve", "provider"]); assert.deepEqual(finalized, ["succeeded"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  failProvider = true; assert.equal((await route.POST(req())).status, 502); assert.deepEqual(finalized, ["succeeded", "failed"]);
  routeEnv.NODE_ENV = "production"; assert.equal((await route.POST(req())).status, 404); assert.equal(generated, 2);
  console.log("PASS: offline AI schema/normalization, input limits, no fabricated prices, provider usage/errors, origin/auth/quota gates, production disabled. No live API or database calls.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
