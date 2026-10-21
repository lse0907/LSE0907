/* eslint-disable @typescript-eslint/no-require-imports -- Local in-memory Postgres verification, never Supabase. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { randomUUID } = require("node:crypto");
const { PGlite } = require(process.env.MENU_SETUP_PGLITE_MODULE || "@electric-sql/pglite");
function load(file, imports = {}) {
  const context = { exports: {}, require: (name) => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const root = "src/app/preview/menu-setup/";
const model = load(root + "draftModel.ts"), storage = load(root + "draftStorage.ts");
const { buildAdminPlan } = load(root + "adminPlan.ts", { "./draftModel": model, "./draftStorage": storage });
const actor = "00000000-0000-4000-8000-000000000001";
const otherActor = "00000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
const draft = { categories: [{ id: "c", name: "커피" }], menus: [
  { id: "a", name: "라떼", selected: true, price: "3500", categoryId: "c", groupIds: ["g", "e"], prices: { big: "0" } },
  { id: "b", name: "커피", selected: true, price: "3000", categoryId: "c", groupIds: ["g"], prices: { big: "1200" } },
  { id: "c", name: "디저트", selected: true, price: "4500", categoryId: "c", groupIds: [], prices: {} },
], groups: [
  { id: "g", name: "크기", scope: "common", menuId: "", required: "yes", max: "1", items: [{ id: "small", name: "기본", price: "0" }, { id: "big", name: "큰 컵", price: "1000" }] },
  { id: "e", name: "크림", scope: "exclusive", menuId: "a", required: "no", max: "1", items: [{ id: "cream", name: "추가", price: "500" }] },
] };
async function main() {
  const db = new PGlite();
  try {
    // Reproduce inspected production FK order, NOT a permissive simplified mock.
    await db.exec(`
      create role service_role nologin bypassrls; create role anon nologin; create role authenticated nologin;
      create table public.stores(store_id text primary key,status text not null default 'active',setup_completed boolean not null default false,
        setup_last_step smallint not null default 0,setup_step1_confirmed boolean not null default false,setup_step2_confirmed boolean not null default false,setup_step3_confirmed boolean not null default false);
      create table public.store_members(store_id text references public.stores(store_id),user_id uuid,role text,primary key(store_id,user_id));
      create table public.menu_categories(id text primary key,store_id text not null,name text not null,sort_order integer,is_active boolean not null default true);
      create table public.menu_items(id text primary key,store_id text not null,name text not null,price integer not null default 0,image text not null default '',is_sold_out boolean not null default false,
        category_id text references public.menu_categories(id) on update cascade on delete set null,option_group_ids text[] not null default '{}',option_not_required boolean not null default false,sort_order integer);
      create table public.option_groups(id text primary key,store_id text not null,name text not null,required boolean not null default false,min integer not null default 0,max integer not null default 1,
        scope text not null default 'common',linked_menu_id text references public.menu_items(id) on update cascade on delete set null,sort_order integer not null default 1,
        constraint option_groups_scope_link_chk check((coalesce(scope,'common')='common' and linked_menu_id is null) or (scope='exclusive' and linked_menu_id is not null)));
      create table public.option_items(id text primary key,store_id text not null,group_id text not null references public.option_groups(id) on delete cascade,name text not null,price_delta integer not null default 0);
      create table public.menu_option_prices(store_id text not null,menu_id text not null,option_item_id text not null,price_delta integer not null default 0,primary key(store_id,menu_id,option_item_id));
      create table public.menu_option_item_exclusions(store_id text not null,menu_id text not null references public.menu_items(id),option_item_id text not null references public.option_items(id),primary key(store_id,menu_id,option_item_id));
      create table public.store_qr_codes(id text primary key,store_id text,tag text);
      grant usage on schema public to service_role,anon,authenticated;
      grant select,insert,update,delete on all tables in schema public to service_role;
    `);
    await db.exec(fs.readFileSync("supabase/migrations/20261019232203_admin_menu_setup_import_v1.sql", "utf8"));
    const query = (sql, params = []) => db.query(sql, params);
    const addStore = async (id, role = "owner") => {
      await query("insert into public.stores(store_id) values($1)", [id]);
      await query("insert into public.store_members values($1,$2,$3)", [id, actor, role]);
    };
    const run = async (storeId, plan, requestId = randomUUID(), fingerprint = hash, user = actor) => db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return (await tx.query("select public.admin_import_menu_setup_v1($1,$2,$3,$4,$5::jsonb) as result", [storeId, user, requestId, fingerprint, JSON.stringify(plan)])).rows[0].result;
    });
    const count = async (table, storeId) => Number((await query(`select count(*) as n from public.${table} where store_id=$1`, [storeId])).rows[0].n);
    const empty = async (storeId) => {
      for (const table of ["menu_categories", "menu_items", "option_groups", "option_items", "menu_option_prices", "menu_setup_imports"]) assert.equal(await count(table, storeId), 0, `${table} must roll back`);
      const store = (await query("select * from public.stores where store_id=$1", [storeId])).rows[0];
      assert.equal(store.setup_last_step, 0); assert.equal(store.setup_step1_confirmed, false);
    };
    await addStore("good"); await query("insert into public.store_qr_codes values('existing-qr','good','unchanged')");
    const plan = buildAdminPlan(draft, "good", randomUUID), requestId = randomUUID();
    const result = await run("good", plan, requestId);
    assert.equal(result.menus, 3); assert.equal(result.replayed, false);
    assert.equal(await count("menu_items", "good"), 3); assert.equal(await count("option_groups", "good"), 2);
    const menuRows = (await query("select * from public.menu_items where store_id='good' order by sort_order")).rows;
    assert.equal(menuRows[2].option_not_required, true); assert.equal(menuRows[0].image, "");
    const groups = (await query("select * from public.option_groups where store_id='good' order by sort_order")).rows;
    assert.equal(groups[1].linked_menu_id, menuRows[0].id);
    const prices = (await query("select p.menu_id,i.name,p.price_delta from public.menu_option_prices p join public.option_items i on i.id=p.option_item_id where p.store_id='good'")).rows;
    assert.equal(prices.find((p) => p.menu_id === menuRows[0].id && p.name === "큰 컵").price_delta, 0);
    assert.equal(prices.find((p) => p.menu_id === menuRows[1].id && p.name === "큰 컵").price_delta, 1200);
    const progress = (await query("select * from public.stores where store_id='good'")).rows[0];
    assert.equal(progress.setup_last_step, 4); assert.equal(progress.setup_completed, false);
    assert.equal(progress.setup_step1_confirmed && progress.setup_step2_confirmed && progress.setup_step3_confirmed, true);
    assert.equal((await query("select tag from public.store_qr_codes where id='existing-qr'")).rows[0].tag, "unchanged");
    await query("update public.menu_items set price=777 where id=$1", [menuRows[0].id]);
    assert.equal((await run("good", buildAdminPlan(draft, "good", randomUUID), requestId)).replayed, true);
    assert.equal((await query("select price from public.menu_items where id=$1", [menuRows[0].id])).rows[0].price, 777, "replay must never undo later admin edits");
    await assert.rejects(() => run("good", plan), /MENU_SETUP_ALREADY_IMPORTED/);
    await assert.rejects(() => run("good", plan, requestId, "b".repeat(64)), /MENU_SETUP_ALREADY_IMPORTED/);
    await assert.rejects(() => run("good", plan, requestId, hash, otherActor), /MENU_SETUP_OWNER_REQUIRED/);
    await addStore("viewer", "viewer"); await assert.rejects(() => run("viewer", buildAdminPlan(draft, "viewer", randomUUID)), /MENU_SETUP_OWNER_REQUIRED/); await empty("viewer");
    await addStore("late-failure");
    const broken = buildAdminPlan(draft, "late-failure", randomUUID); broken.priceRows[0].menu_id = "missing-menu";
    await assert.rejects(() => run("late-failure", broken), /MENU_SETUP_INVALID_LINKS/); await empty("late-failure");
    await addStore("middle-failure");
    const duplicate = buildAdminPlan(draft, "middle-failure", randomUUID); duplicate.optionRows[1].id = duplicate.optionRows[0].id;
    await assert.rejects(() => run("middle-failure", duplicate), /duplicate key/); await empty("middle-failure");
    // Force an error AFTER progress was updated, when writing the final receipt.
    // This is a test-only trigger in the disposable local DB, never a migration.
    await db.exec(`create function public.test_fail_import_receipt() returns trigger language plpgsql as $$ begin
      if new.store_id in ('receipt-failure','large-rollback') then raise exception 'FORCED_RECEIPT_FAILURE'; end if; return new; end $$;
      create trigger test_import_receipt_failure before insert on public.menu_setup_imports for each row execute function public.test_fail_import_receipt();`);
    await addStore("receipt-failure");
    await assert.rejects(() => run("receipt-failure", buildAdminPlan(draft, "receipt-failure", randomUUID)), /FORCED_RECEIPT_FAILURE/); await empty("receipt-failure");
    await addStore("cross-store");
    const crossed = buildAdminPlan(draft, "cross-store", randomUUID); crossed.menuRows[0].category_id = plan.categoryRows[0].id;
    await assert.rejects(() => run("cross-store", crossed), /MENU_SETUP_INVALID_LINKS/); await empty("cross-store");
    await addStore("missing-price");
    const missingPrice = buildAdminPlan(draft, "missing-price", randomUUID); missingPrice.priceRows.pop();
    await assert.rejects(() => run("missing-price", missingPrice), /MENU_SETUP_INVALID_LINKS/); await empty("missing-price");
    await addStore("wrong-exclusive");
    const wrongExclusive = buildAdminPlan(draft, "wrong-exclusive", randomUUID); wrongExclusive.groupRows[1].linked_menu_id = wrongExclusive.menuRows[1].id;
    await assert.rejects(() => run("wrong-exclusive", wrongExclusive), /MENU_SETUP_INVALID_LINKS/); await empty("wrong-exclusive");
    await addStore("wrong-no-option");
    const wrongNone = buildAdminPlan(draft, "wrong-no-option", randomUUID); wrongNone.menuRows[2].option_not_required = false;
    await assert.rejects(() => run("wrong-no-option", wrongNone), /MENU_SETUP_INVALID_LINKS/); await empty("wrong-no-option");
    await addStore("cross-row");
    const crossRow = buildAdminPlan(draft, "cross-row", randomUUID); crossRow.optionRows[0].store_id = "good";
    await assert.rejects(() => run("cross-row", crossRow), /MENU_SETUP_INVALID_PLAN/); await empty("cross-row");
    await addStore("legacy"); await query("insert into public.menu_categories(id,store_id,name) values('old-category','legacy','기존')");
    await assert.rejects(() => run("legacy", buildAdminPlan(draft, "legacy", randomUUID)), /MENU_SETUP_TARGET_NOT_EMPTY/);
    assert.equal(await count("menu_categories", "legacy"), 1); assert.equal(await count("menu_items", "legacy"), 0);
    await addStore("completed"); await query("update public.stores set setup_completed=true where store_id='completed'");
    await assert.rejects(() => run("completed", buildAdminPlan(draft, "completed", randomUUID)), /MENU_SETUP_TARGET_NOT_EMPTY/);
    await addStore("inactive"); await query("update public.stores set status='inactive' where store_id='inactive'");
    await assert.rejects(() => run("inactive", buildAdminPlan(draft, "inactive", randomUUID)), /MENU_SETUP_STORE_UNAVAILABLE/);
    await addStore("no-options"); const plain = structuredClone(draft); plain.groups = []; plain.menus.forEach((m) => { m.groupIds = []; m.prices = {}; });
    assert.equal((await run("no-options", buildAdminPlan(plain, "no-options", randomUUID))).groups, 0);
    for (const role of ["anon", "authenticated"]) {
      await assert.rejects(() => db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.query("select * from public.menu_setup_imports"); }), /permission denied/);
      await assert.rejects(() => db.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.query("select public.admin_import_menu_setup_v1('good',$1,$2,$3,$4::jsonb)", [actor, requestId, hash, JSON.stringify(plan)]); }), /permission denied/);
    }
    const fn = (await query("select prosecdef,proconfig from pg_proc where proname='admin_import_menu_setup_v1'")).rows[0];
    assert.equal(fn.prosecdef, false); assert.ok(fn.proconfig.some((c) => c.startsWith("search_path=")));
    const large = {
      categories: Array.from({ length: 100 }, (_, i) => ({ id: "c" + i, name: "분류 " + i })),
      groups: [{ id: "extra", name: "추가 선택", scope: "common", menuId: "", required: "no", max: "1",
        items: Array.from({ length: 40 }, (_, i) => ({ id: "i" + i, name: "항목 " + i, price: String(i * 100) })) }],
      menus: Array.from({ length: 500 }, (_, i) => ({ id: "m" + i, name: "메뉴 " + i, price: String(3000 + i),
        selected: true, categoryId: "c" + (i % 100), groupIds: ["extra"], prices: { i1: "0", i2: String(i) } })),
    };
    await addStore("large");
    const largePlan = buildAdminPlan(large, "large", randomUUID), largeRequest = randomUUID();
    const started = performance.now();
    assert.equal((await run("large", largePlan, largeRequest)).menus, 500);
    const elapsed = Math.round(performance.now() - started);
    assert.equal(await count("menu_items", "large"), 500); assert.equal(await count("menu_categories", "large"), 100);
    assert.equal(await count("menu_option_prices", "large"), 20000);
    const storedPrice = (await query("select price_delta from public.menu_option_prices where store_id='large' and menu_id=$1 and option_item_id=$2",
      [largePlan.menuRows[499].id, largePlan.optionRows[2].id])).rows[0].price_delta;
    assert.equal(storedPrice, 499);
    const storedZero = (await query("select price_delta from public.menu_option_prices where store_id='large' and menu_id=$1 and option_item_id=$2",
      [largePlan.menuRows[499].id, largePlan.optionRows[1].id])).rows[0].price_delta;
    assert.equal(storedZero, 0);
    assert.equal((await run("large", largePlan, largeRequest)).replayed, true);
    assert.equal(await count("menu_option_prices", "large"), 20000, "large retry must not duplicate rows");
    await addStore("large-rollback");
    await assert.rejects(() => run("large-rollback", buildAdminPlan(large, "large-rollback", randomUUID)), /FORCED_RECEIPT_FAILURE/);
    await empty("large-rollback");
    console.log("PASS: 500 menus / 100 categories / 20,000 price rows saved and replayed; forced final failure rolls back all rows/progress. Local SQL " + elapsed + "ms (not production SLA).");
    console.log("PASS: real in-memory PostgreSQL transaction/FK order, partial+late failure rollback, links, idempotent replay preserving later edits, ownership, role grants, progress/QR preservation. Single connection: multi-session lock contention needs separate validation. No remote DB writes.");
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
