import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("src/app/lib/privacyRequests.ts");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const helpers = await import(dataUrl(compiled));
for (const status of ["completed", "rejected", "canceled"]) assert.deepEqual(helpers.availablePrivacyActions({ status, audience: "customer", request_type: "deletion" }), []);
for (const audience of ["customer", "owner"]) {
  for (const request_type of ["access", "correction", "deletion", "restriction"]) {
    assert.deepEqual(helpers.availablePrivacyActions({ status: "received", audience, request_type }), ["review", "identity_required", "reject"]);
  }
}
assert.ok(!helpers.availablePrivacyActions({ status: "in_review", audience: "owner", request_type: "deletion" }).includes("delete_customer_phone"));
assert.ok(helpers.availablePrivacyActions({ status: "in_review", audience: "customer", request_type: "correction" }).includes("correct_customer_name"));
assert.ok(helpers.validatePrivacyInput("complete", "처리 안내입니다.", ""));
assert.ok(helpers.validatePrivacyInput("correct_customer_phone", "처리 안내입니다.", "bad"));
assert.equal(helpers.validatePrivacyInput("correct_customer_phone", "회원이 요청한 연락처를 확인했습니다.", "010-1234-5678"), null);

// Route contract tests: exercise the actual compiled handler with isolated auth/RPC doubles.
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const state = { role: "support", calls: [], queries: 0, rpcError: null };
const admin = { from() { state.queries++; throw new Error("Unexpected DB query"); }, async rpc(name, args) { state.calls.push({ name, args }); return { data: { status: "partially_completed" }, error: state.rpcError }; } };
globalThis.__rionPrivacyTest = { ApiError, createSupabaseAdminClient: () => admin,
  apiErrorResponse: (error) => Response.json({ ok: false, message: error.message }, { status: error.status || 500 }),
  requireOpsUser: async (_req, _admin, allowedRoles) => {
    if (state.role === "anonymous") throw new ApiError(401, "Login required");
    if (!allowedRoles.includes(state.role)) throw new ApiError(403, "Forbidden");
    return { userId: "30000000-0000-0000-0000-000000000001", opsRole: state.role };
  } };
const mock = dataUrl("export const { ApiError, createSupabaseAdminClient, apiErrorResponse, requireOpsUser } = globalThis.__rionPrivacyTest;");
const routeCode = ts.transpileModule(read("src/app/api/ops/privacy-requests/route.ts"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replaceAll('"@/app/api/_lib/storeAuth"', JSON.stringify(mock)).replaceAll('"@/app/api/_lib/opsAuth"', JSON.stringify(mock))
  .replaceAll('"@/app/lib/privacyRequests"', JSON.stringify(dataUrl(compiled)));
const route = await import(dataUrl(routeCode));
const body = { requestId: "10000000-0000-0000-0000-000000000001", expectedVersion: "2026-09-03T01:00:00Z", action: "review", summary: "요청 범위를 검토하고 있습니다." };
function req(payload = body, origin = "http://localhost:3010") { return { headers: new Headers({ origin }), nextUrl: new URL("http://localhost:3010/api/ops/privacy-requests"), json: async () => payload }; }
for (const role of ["anonymous", "viewer", "billing"]) {
  state.role = role;
  assert.equal((await route.GET(req())).status, role === "anonymous" ? 401 : 403);
  assert.equal((await route.POST(req())).status, role === "anonymous" ? 401 : 403);
}
assert.equal(state.calls.length, 0); assert.equal(state.queries, 0);
state.role = "support";
assert.equal((await route.POST(req(body, "https://evil.example"))).status, 403);
assert.equal((await route.POST(req({ ...body, action: "complete" }))).status, 400);
assert.equal((await route.POST(req({ ...body, actorId: "spoofed", subjectUserId: "spoofed" }))).status, 200);
assert.equal(state.calls[0].args.p_actor_id, "30000000-0000-0000-0000-000000000001");
assert.equal(state.calls[0].args.p_resolves_request, false);
assert.ok(!Object.hasOwn(state.calls[0].args, "p_subject_user_id"));
state.rpcError = { message: "PRIVACY_REQUEST_CONFLICT" };
assert.equal((await route.POST(req())).status, 409);
delete globalThis.__rionPrivacyTest;

const sql = read("supabase/migrations/20260903085755_p1_ops_privacy_requests.sql");
assert.match(sql, /security invoker/); assert.match(sql, /for update/);
assert.match(sql, /from public,anon,authenticated/);
assert.ok(!sql.includes("security definer"));
console.log("OPS privacy helper and API authorization/validation checks passed.");

const libraryPath = process.argv.find((arg) => arg.startsWith("--pglite-path="))?.slice("--pglite-path=".length);
if (!libraryPath) {
  console.log("SQL execution checks not run. Pass --pglite-path=<installed @electric-sql/pglite/dist/index.js> for isolated PostgreSQL checks.");
  process.exit(0);
}
const { PGlite } = await import(pathToFileURL(libraryPath).href);
const db = new PGlite();
const actor = "30000000-0000-0000-0000-000000000001";
const subject = "20000000-0000-0000-0000-000000000001";
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
  insert into auth.users values('${actor}','{"role":"ops","ops_role":"support"}');
  create table public.privacy_rights_requests(id uuid primary key,subject_user_id uuid,audience text,request_type text,status text default 'received',request_detail jsonb default '{}',decision_summary text,requested_at timestamptz default now(),responded_at timestamptz,completed_at timestamptz,updated_at timestamptz default now());
  create table public.privacy_request_events(id bigint generated always as identity primary key,subject_user_id uuid,rights_request_id uuid references public.privacy_rights_requests(id),event_type text,actor_type text,actor_user_id uuid,metadata jsonb default '{}',occurred_at timestamptz default now());
  create table public.account_roles(user_id uuid,audience text,status text);
  insert into public.account_roles values('${subject}','customer','active'),('${subject}','owner','active');
  create table public.account_lifecycle_states(subject_user_id uuid,status text);
  create table public.account_withdrawal_requests(subject_user_id uuid,audience text,status text);
  create table public.customer_profiles(user_id uuid primary key,name text,phone text,marketing_consent boolean,updated_at timestamptz);
  insert into public.customer_profiles values('${subject}','테스트','01012345678',true,now());
  create table public.profiles(user_id uuid primary key,name text,phone text);
  insert into public.profiles values('${subject}','사업자 테스트','0212345678');
  create table public.policy_documents(id bigint primary key,document_type text,audience text,status text,effective_at timestamptz);
  insert into public.policy_documents values(1,'marketing','customer','published','2020-01-01'),(2,'marketing','owner','published','2020-01-01');
  create table public.policy_acceptance_events(user_id uuid,document_id bigint,audience text,action text,source text,entry_path text,language text,idempotency_key text unique,metadata jsonb);
`);
await db.exec(sql);
let seq = 0;
async function newRequest(type = "deletion", audience = "customer", status = "in_review") {
  const id = `10000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
  await db.query("insert into public.privacy_rights_requests(id,subject_user_id,audience,request_type,status) values($1,$2,$3,$4,$5)", [id, subject, audience, type, status]);
  return id;
}
async function current(id) { return (await db.query("select *, updated_at::text as version from public.privacy_rights_requests where id=$1", [id])).rows[0]; }
async function processRequest(id, action, { who = actor, value = null, resolves = false, version } = {}) {
  const expected = version || (await current(id)).version;
  return db.query("select public.ops_process_privacy_request($1,$2,$3,$4,$5,$6,$7) as result", [who, id, expected, action, "요청과 처리 범위를 확인했습니다.", value, resolves]);
}
const deletion = await newRequest();
const oldVersion = (await current(deletion)).version;
await processRequest(deletion, "delete_customer_phone");
assert.equal((await current(deletion)).status, "partially_completed");
assert.equal((await db.query("select phone from public.customer_profiles")).rows[0].phone, null);
await assert.rejects(processRequest(deletion, "delete_customer_phone", { version: oldVersion }), /PRIVACY_REQUEST_CONFLICT/);
await assert.rejects(processRequest(await newRequest(), "delete_customer_phone", { who: subject }), /OPS_PRIVACY_FORBIDDEN/);
await assert.rejects(processRequest(await newRequest("deletion", "owner"), "delete_customer_phone"), /PRIVACY_ACTION_TYPE_MISMATCH/);
await assert.rejects(processRequest(await newRequest("deletion", "customer", "received"), "delete_customer_phone"), /PRIVACY_REVIEW_REQUIRED/);
const correction = await newRequest("correction");
await processRequest(correction, "correct_customer_name", { value: "새 이름", resolves: true });
assert.equal((await current(correction)).status, "completed");
assert.equal((await db.query("select name from public.customer_profiles")).rows[0].name, "새 이름");
await assert.rejects(processRequest(correction, "correct_customer_name", { value: "중복" }), /PRIVACY_REQUEST_CLOSED/);
await assert.rejects(processRequest(await newRequest("correction"), "correct_customer_phone", { value: "bad" }), /INVALID_PRIVACY_VALUE/);
const phone = await newRequest("correction");
await processRequest(phone, "correct_customer_phone", { value: "010-1234-5678", resolves: true });
assert.equal((await db.query("select phone from public.customer_profiles")).rows[0].phone, "010-1234-5678");
const access = await newRequest("access", "owner");
await processRequest(access, "provide_profile_access", { resolves: true });
assert.equal((await current(access)).profile_access_granted, true);
const restriction = await newRequest("restriction");
await processRequest(restriction, "restrict_marketing", { resolves: true });
assert.equal((await db.query("select marketing_consent from public.customer_profiles")).rows[0].marketing_consent, false);
assert.equal((await db.query("select count(*)::int as count from public.policy_acceptance_events")).rows[0].count, 1);
const blocked = await newRequest();
await db.query("insert into public.account_withdrawal_requests values($1,'customer','recovery_pending')", [subject]);
await assert.rejects(processRequest(blocked, "delete_customer_phone"), /PRIVACY_SUBJECT_UNAVAILABLE/);
await db.exec("delete from public.account_withdrawal_requests");
// A failed audit INSERT must roll back the profile change AND request completion.
await db.exec("alter table public.privacy_request_events add constraint test_audit_failure check(event_type <> 'ops_privacy_delete_customer_phone') not valid");
const rollback = await newRequest();
await assert.rejects(processRequest(rollback, "delete_customer_phone", { resolves: true }), /test_audit_failure/);
assert.equal((await db.query("select phone from public.customer_profiles")).rows[0].phone, "010-1234-5678");
assert.equal((await current(rollback)).status, "in_review");
const permissions = await db.query("select has_function_privilege('anon','public.ops_process_privacy_request(uuid,uuid,timestamptz,text,text,text,boolean)','execute') as anon, has_function_privilege('authenticated','public.ops_process_privacy_request(uuid,uuid,timestamptz,text,text,text,boolean)','execute') as member, has_function_privilege('service_role','public.ops_process_privacy_request(uuid,uuid,timestamptz,text,text,text,boolean)','execute') as service");
assert.deepEqual(permissions.rows[0], { anon: false, member: false, service: true });
await db.close();
console.log("Isolated PostgreSQL checks passed: execution, partial/full result, type guards, auth, stale/duplicate requests, withdrawal blocker, audit rollback, privileges. No live DB used.");
