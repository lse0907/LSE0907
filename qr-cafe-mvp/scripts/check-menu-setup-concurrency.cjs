/* eslint-disable @typescript-eslint/no-require-imports -- Disposable native PostgreSQL only; never loads .env or connects to an existing DB. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), vm = require("node:vm"), ts = require("typescript");
const { randomUUID, randomBytes } = require("node:crypto");
const { execFile } = require("node:child_process"), { promisify } = require("node:util"), { pathToFileURL } = require("node:url"), net = require("node:net");
const runFile = promisify(execFile);
const runtime = process.env.MENU_SETUP_NATIVE_RUNTIME;
if (!runtime) throw new Error("Set MENU_SETUP_NATIVE_RUNTIME to an isolated install of @embedded-postgres/windows-x64 and pg. No production connection string is accepted.");
const { Client } = require(path.resolve(runtime, "node_modules/pg"));
function load(file, imports = {}) {
  const context = { exports: {}, require(name) { assert.ok(name in imports, name); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const root = "src/app/preview/menu-setup/";
const model = load(root + "draftModel.ts"), storage = load(root + "draftStorage.ts");
const { buildAdminPlan } = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
const actor = "00000000-0000-4000-8000-000000000001", hash = "a".repeat(64);
const draft = { categories: [{ id: "c", name: "검증" }], groups: [], menus: [{ id: "m", name: "검증 메뉴", selected: true, price: "3500", categoryId: "c", groupIds: [], prices: {} }] };
const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}
async function main() {
  assert.equal(process.platform, "win32", "This runner uses Windows native binaries");
  const bin = await import(pathToFileURL(path.resolve(runtime, "node_modules/@embedded-postgres/windows-x64/dist/index.js")).href);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "rion-menu-concurrency-db-"));
  const marker = randomUUID(), data = path.join(base, "data"), passwordFile = path.join(base, "test-password");
  fs.writeFileSync(path.join(base, "qa-owner"), marker);
  const password = randomBytes(24).toString("hex"); fs.writeFileSync(passwordFile, password);
  const clients = []; let running = false;
  const reports = [];
  try {
    const port = await freePort();
    await runFile(bin.initdb, ["-D", data, "-U", "qa_admin", "--pwfile=" + passwordFile, "-A", "scram-sha-256", "--locale=C", "-E", "UTF8"], { windowsHide: true, timeout: 30000 });
    fs.unlinkSync(passwordFile);
    await runFile(bin.pg_ctl, ["start", "-D", data, "-l", path.join(base, "postgres.log"), "-o", "-h 127.0.0.1 -p " + port, "-w", "-t", "15"], { windowsHide: true, timeout: 20000 });
    running = true;
    async function connect(name) {
      const client = new Client({ host: "127.0.0.1", port, database: "postgres", user: "qa_admin", password, application_name: "rion-qa-" + name, connectionTimeoutMillis: 5000 });
      client.on("error", () => {}); await client.connect(); clients.push(client);
      await client.query("set statement_timeout='8s'"); return client;
    }
    const observer = await connect("observer"), a = await connect("writer-a"), b = await connect("writer-b");
    const version = (await observer.query("select version() as version")).rows[0].version;
    // Reuse the inspected FK-compatible disposable schema, not an unrelated permissive schema.
    const fixture = fs.readFileSync("scripts/check-menu-setup-transaction.cjs", "utf8").match(/await db\.exec\(\x60([\s\S]*?)\x60\);/);
    assert.ok(fixture?.[1].includes("option_groups_scope_link_chk"));
    await observer.query(fixture[1]);
    await observer.query(fs.readFileSync("supabase/migrations/20261019232203_admin_menu_setup_import_v1.sql", "utf8"));
    for (const client of [a, b]) await client.query("set role service_role");
    const pidB = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
    async function seed(id) { await observer.query("insert into public.stores(store_id) values($1)", [id]); await observer.query("insert into public.store_members values($1,$2,'owner')", [id, actor]); }
    function call(client, storeId, requestId, plan = buildAdminPlan(draft, storeId, randomUUID)) {
      return client.query("select public.admin_import_menu_setup_v1($1,$2,$3,$4,$5::jsonb) as result", [storeId, actor, requestId, hash, JSON.stringify(plan)]).then((r) => r.rows[0].result);
    }
    async function blocked(pid) {
      const until = Date.now() + 1500;
      while (Date.now() < until) {
        const row = (await observer.query("select cardinality(pg_blocking_pids($1)) as blockers", [pid])).rows[0];
        if (row.blockers > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Expected real independent-backend lock wait");
    }
    async function state(id) {
      const row = (await observer.query("select setup_last_step,setup_step1_confirmed,(select count(*)::int from menu_items where store_id=$1) menus,(select count(*)::int from menu_categories where store_id=$1) categories,(select count(*)::int from menu_setup_imports where store_id=$1) receipts from stores where store_id=$1", [id])).rows[0];
      return row;
    }
    // Two different requests race: exactly one import, not a mixed pair of plans.
    await seed("different"); const first = randomUUID(), second = randomUUID();
    await a.query("begin"); await call(a, "different", first);
    assert.equal((await state("different")).menus, 0, "uncommitted import must be invisible");
    const competing = settle(call(b, "different", second)); await blocked(pidB);
    await a.query("commit"); const losing = await competing;
    assert.match(losing.error?.message || "", /MENU_SETUP_ALREADY_IMPORTED/);
    assert.equal((await state("different")).menus, 1); assert.equal((await state("different")).receipts, 1);
    reports.push("different requests: one winner, one rejected, one receipt");
    // Same request racing a lost acknowledgement recovers the receipt.
    await seed("same"); const sameId = randomUUID();
    await a.query("begin"); await call(a, "same", sameId);
    const duplicate = settle(call(b, "same", sameId)); await blocked(pidB); await a.query("commit");
    assert.equal((await duplicate).value.replayed, true); assert.equal((await state("same")).menus, 1);
    reports.push("same request: concurrent replay, no duplicate");
    // Legacy writers don't lock stores: table-level guard must still see their committed data.
    await seed("manual-first"); await a.query("begin");
    await a.query("insert into menu_categories(id,store_id,name) values('manual_cat','manual-first','수동 분류')");
    const importAfterManual = settle(call(b, "manual-first", randomUUID())); await blocked(pidB); await a.query("commit");
    assert.match((await importAfterManual).error?.message || "", /MENU_SETUP_TARGET_NOT_EMPTY/);
    const manual = await state("manual-first");
    assert.equal(manual.categories, 1); assert.equal(manual.menus, 0); assert.equal(manual.receipts, 0); assert.equal(manual.setup_last_step, 0);
    reports.push("manual first: import blocked, manual category preserved, no partial import");
    // Import first: following admin edit waits, then survives a retry of the import.
    await seed("import-first"); const editId = randomUUID(), editPlan = buildAdminPlan(draft, "import-first", randomUUID);
    await a.query("begin"); await call(a, "import-first", editId, editPlan);
    const followingEdit = settle(b.query("update menu_items set price=4100 where id=$1", [editPlan.menuRows[0].id])); await blocked(pidB);
    await a.query("commit"); assert.equal((await followingEdit).value.rowCount, 1);
    assert.equal((await call(b, "import-first", editId)).replayed, true);
    assert.equal((await observer.query("select price from menu_items where store_id='import-first'")).rows[0].price, 4100);
    reports.push("import first: following edit preserved, replay never overwrites it");
    // Cross-store writes are serialized by current global table lock; ordinary reads remain available.
    await seed("other-store"); await observer.query("insert into menu_categories(id,store_id,name) values('other_cat','other-store','기존')");
    await observer.query("insert into menu_items(id,store_id,name,price,category_id,option_not_required) values('other_menu','other-store','기존 메뉴',3000,'other_cat',true)");
    await seed("cross-store"); await a.query("begin"); await call(a, "cross-store", randomUUID());
    const otherEdit = settle(b.query("update menu_items set price=3200 where id='other_menu'")); await blocked(pidB);
    assert.equal((await observer.query("select price from menu_items where id='other_menu'")).rows[0].price, 3000);
    await a.query("commit"); assert.equal((await otherEdit).value.rowCount, 1);
    reports.push("other store: write waits behind global lock; SELECT continues");
    // Bounded timeout: no partial state, subsequent manual retry succeeds.
    await seed("timeout"); const timeoutId = randomUUID(); await a.query("begin");
    await a.query("update menu_categories set name='잠금 검증' where id='other_cat'");
    const started = Date.now(), timed = settle(call(b, "timeout", timeoutId)); await blocked(pidB);
    const timeout = await timed; assert.equal(timeout.error?.code, "55P03");
    const elapsed = Date.now() - started; assert.ok(elapsed >= 1500 && elapsed < 6000);
    assert.equal((await state("timeout")).menus, 0); assert.equal((await state("timeout")).receipts, 0);
    assert.equal((await state("timeout")).setup_step1_confirmed, false);
    await a.query("rollback"); assert.equal((await call(b, "timeout", timeoutId)).replayed, false);
    reports.push("lock timeout " + elapsed + "ms: full rollback, retry succeeds");
    // A connection lost before commit rolls back and releases the locks.
    await seed("disconnect"); const reconnectId = randomUUID(); await a.query("begin"); await call(a, "disconnect", reconnectId);
    await a.end(); const recovered = await call(b, "disconnect", reconnectId);
    assert.equal(recovered.replayed, false); assert.equal((await state("disconnect")).menus, 1); assert.equal((await state("disconnect")).receipts, 1);
    reports.push("connection closed before commit: rollback, retry creates exactly one import");
    console.log(JSON.stringify({ ok: true, engine: version, independentBackends: true, scenarios: reports, remoteWrites: false }, null, 2));
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    if (running || fs.existsSync(path.join(data, "postmaster.pid"))) await runFile(bin.pg_ctl, ["stop", "-D", data, "-m", "fast", "-w", "-t", "15"], { windowsHide: true, timeout: 20000 });
    // Only remove the fresh directory this run created, after native PostgreSQL has stopped.
    const resolved = path.resolve(base), temp = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), temp);
    assert.match(path.basename(resolved), /^rion-menu-concurrency-db-[A-Za-z0-9]+$/);
    assert.equal(fs.readFileSync(path.join(resolved, "qa-owner"), "utf8"), marker);
    assert.equal(fs.existsSync(path.join(data, "postmaster.pid")), false, "Never delete a running database");
    fs.rmSync(resolved, { recursive: true });
    console.log("CLEANUP: temporary database stopped and its verified test-only directory removed.");
  }
}
main().catch((error) => { console.error({ ok: false, message: error.message, code: error.code }); process.exitCode = 1; });
