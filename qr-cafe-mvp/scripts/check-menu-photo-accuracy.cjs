/* eslint-disable @typescript-eslint/no-require-imports -- Offline audit; no provider calls. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const reference = require("./fixtures/menu-photo-reference.json");
const input = process.argv[2];
if (!input) { console.error("Usage: node scripts/check-menu-photo-accuracy.cjs result.json"); process.exit(2); }
const { draft } = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
assert.ok(Array.isArray(draft?.menus));
const normalized = (name) => name.normalize("NFC").replace(/\s+/g, "").toLowerCase();
const used = new Set(), issues = [];
let exactNames = 0, checkedSizes = 0;
const rows = Object.entries(reference.sections).flatMap(([category, menus]) => menus.map((row) => ({ category, row })));
assert.equal(rows.length, 59);
for (const { category, row: [name, base, jumbo, king] } of rows) {
  const candidates = draft.menus.filter((menu) => normalized(menu.name) === normalized(name) &&
    normalized(draft.categories.find((c) => c.id === menu.categoryId)?.name || "") === normalized(category));
  if (!candidates.length) { issues.push({ kind: "missing_or_misread", category, name }); continue; }
  exactNames++;
  if (candidates.length > 1) issues.push({ kind: "ambiguous_duplicate", name, count: candidates.length });
  const menu = candidates.find((m) => Number(m.price) === base) || candidates[0]; used.add(menu.id);
  if (Number(menu.price) !== base) issues.push({ kind: "base_price", name, expected: base, actual: menu.price });
  const sizes = draft.groups.filter((g) => menu.groupIds.includes(g.id)).flatMap((g) => g.items).filter((i) => /^(L|J|K)$/i.test(i.name.trim()));
  const expected = jumbo != null || king != null ? { L: base, ...(jumbo != null ? { J: jumbo } : {}), ...(king != null ? { K: king } : {}) } : {};
  const actual = Object.fromEntries(sizes.map((item) => [item.name.trim().toUpperCase(), Number(menu.price) + Number(menu.prices[item.id] ?? item.price)]));
  checkedSizes++;
  if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(actual).sort())) issues.push({ kind: "size_availability_or_price", name, expected, actual });
}
for (const menu of draft.menus) if (!used.has(menu.id)) issues.push({ kind: "unexpected_or_duplicate", name: menu.name, price: menu.price });
console.log(JSON.stringify({ mode: "offline-audit-of-existing-AI-result", expectedMenus: rows.length, actualMenus: draft.menus.length, exactNames, checkedSizes,
  automaticAccuracyPassed: issues.length === 0, issues }, null, 2));
// Findings are audit output, not a test harness crash. Use --require-pass as a future release gate.
if (process.argv.includes("--require-pass") && issues.length) process.exitCode = 1;
