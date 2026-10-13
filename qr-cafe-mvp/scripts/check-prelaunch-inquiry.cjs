const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const oldVersion = "beta-application-v1-2026-09-30";
const inquiryVersion = "beta-inquiry-v1-2026-10-13";
let inserted, queryCalls = 0, duplicate = false, open = true, recentCount = 0;
class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const admin = { from(table) {
  queryCalls++;
  let mode = "select", head = false;
  const query = {
    select(columns, options) { head = !!options?.head; return this; },
    eq() { return this; }, in() { return this; }, gte() { return this; }, limit() { return this; },
    insert(row) { inserted = row; mode = "insert"; return this; },
    single() { return Promise.resolve({ data: { id: 123 }, error: null }); },
    maybeSingle() { return Promise.resolve({ data: open ? { id: 1 } : null, error: null }); },
    then(resolve, reject) { return Promise.resolve({ data: mode === "insert" ? { id: 123 } : duplicate && !head ? [{ id: 1 }] : [], count: recentCount, error: null }).then(resolve, reject); },
  };
  assert.ok(["beta_applications", "beta_recruitment_rounds"].includes(table));
  return query;
} };
const compiled = ts.transpileModule(fs.readFileSync("src/app/api/beta-applications/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, Response, console, require(name) {
  if (name.endsWith("storeAuth")) return { ApiError, apiErrorResponse: (error) => Response.json({ message: error.message, code: error.code }, { status: error.status || 500 }), createSupabaseAdminClient: () => admin };
  if (name.endsWith("betaApplicationConsent")) return { BETA_APPLICATION_CONSENT_VERSION: oldVersion };
  if (name.endsWith("betaInquiryConsent")) return { BETA_INQUIRY_CONSENT_VERSION: inquiryVersion };
  if (name === "next/server") return {};
  throw Error(`Unexpected import: ${name}`);
} };
vm.runInNewContext(compiled, sandbox);
const base = { intakeType: "inquiry", storeName: "문의검증매장", businessType: "cafe", contactMethod: "email", contactEmail: "test@example.com", contactPhone: "01000000000", recruitmentRoundId: 1, privacyConsent: true, privacyConsentVersion: inquiryVersion, note: "" };
function request(body, origin = "http://localhost:3016") { return { headers: new Headers({ origin }), nextUrl: new URL("http://localhost:3016/api/beta-applications"), json: async () => body }; }
async function check(body, status, origin) { inserted = undefined; const response = await sandbox.exports.POST(request(body, origin)); assert.equal(response.status, status); return response; }
(async () => {
  await check(base, 201);
  for (const field of ["operation_type", "region", "contact_name", "preferred_start", "preferred_start_date", "contact_phone"]) assert.equal(inserted[field], null);
  assert.equal(inserted.privacy_consent_version, inquiryVersion);
  assert.equal(inserted.feedback_available, false);
  assert.equal(inserted.contact_email, "test@example.com");
  await check({ ...base, contactMethod: "phone", contactPhone: "010-0000-0000" }, 201);
  assert.equal(inserted.contact_phone, "01000000000"); assert.equal(inserted.contact_email, null);
  await check({ ...base, privacyConsent: false }, 400);
  await check({ ...base, privacyConsentVersion: oldVersion }, 400);
  await check({ ...base, contactEmail: "invalid" }, 400);
  await check({ ...base, contactMethod: "phone", contactPhone: "12345678" }, 400);
  await check({ ...base, businessType: "invalid" }, 400);
  await check(base, 403, "https://untrusted.example");
  open = false; await check(base, 409); open = true;
  duplicate = true; await check(base, 409); duplicate = false;
  recentCount = 3; await check(base, 429); recentCount = 0;
  const before = queryCalls; await check({ ...base, website: "spam" }, 200); assert.equal(queryCalls, before);
  const legacy = { ...base, intakeType: "application", privacyConsentVersion: oldVersion, operationType: "both", region: "서울", contactName: "검증", preferredStart: "asap" };
  await check(legacy, 201); assert.equal(inserted.region, "서울"); assert.equal(inserted.operation_type, "both");
  await check({ ...legacy, region: "" }, 400);
  const sql = fs.readFileSync("supabase/migrations/20261013063140_prelaunch_inquiry_optional_details.sql", "utf8");
  for (const field of ["operation_type", "region", "contact_name", "preferred_start"]) assert.ok(sql.includes(`alter column ${field} drop not null`));
  assert.ok(!/delete from|update public|disable row level|grant /i.test(sql));
  console.log("Inquiry email/SMS queries, null details, legacy intake, consent, closed round, duplicate/rate limits and origin checks passed (mock DB; no production writes).");
})().catch(error => { console.error(error); process.exitCode = 1; });
