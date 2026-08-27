import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(root, "supabase", "migrations");
const migrationName = fs
  .readdirSync(migrationDir)
  .find((name) => name.endsWith("_p0_point_expiry_lots.sql"));

assert.ok(migrationName, "P0 point expiry migration is missing");

const migration = fs.readFileSync(path.join(migrationDir, migrationName), "utf8");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");

function expectText(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message || `Missing: ${needle}`);
}

expectText(migration, "create table public.point_lots", "point lot table missing");
expectText(
  migration,
  "create table public.point_lot_allocations",
  "point lot allocation table missing",
);
expectText(
  migration,
  "point_recovery_amount integer not null default 0",
  "internal recovery amount missing",
);
expectText(
  migration,
  "with (security_invoker = true)",
  "customer point summary must use invoker security",
);
expectText(
  migration,
  "and (l.expires_at is null or l.expires_at > now())",
  "expired lots are not excluded from the customer summary",
);
expectText(
  migration,
  "order by l.expires_at asc nulls last, l.created_at, l.id",
  "FIFO lot locking order is missing",
);
expectText(
  migration,
  "greatest(l.expires_at, v_now + interval '30 days')",
  "refund restoration does not guarantee the 30-day minimum",
);
expectText(
  migration,
  "source_kind = 'legacy_backfill'",
  "legacy positive wallet backfill is missing",
);
expectText(
  migration,
  "POINT_LOT_BACKFILL_MISMATCH",
  "backfill total verification is missing",
);
expectText(
  migration,
  "revoke all privileges on table public.point_lots from public, anon, authenticated",
  "point lot client write hardening is missing",
);
expectText(
  migration,
  "grant select on table public.point_lots to authenticated",
  "authenticated point lot read grant is missing",
);
expectText(
  migration,
  "'recovery_add'",
  "recovery addition audit event is missing",
);
expectText(
  migration,
  "'recovery_offset'",
  "recovery offset audit event is missing",
);
expectText(
  migration,
  "'recovery_release'",
  "recovery release audit event is missing",
);

const guardPosition = migration.indexOf("if v_order.loyalty_snapshot is not null then");
const firstWalletMutation = migration.indexOf(
  "insert into public.customer_store_wallets (customer_user_id, store_id)",
  migration.indexOf("create or replace function public.apply_loyalty_on_paid_order"),
);
assert.ok(
  guardPosition >= 0 && firstWalletMutation > guardPosition,
  "loyalty idempotency guard must run before wallet mutations",
);

const customerSources = [
  "src/app/confirm/page.tsx",
  "src/app/menu/page.tsx",
  "src/app/me/MeDashboard.tsx",
  "src/app/api/orders/_lib/orderValidation.ts",
];

for (const source of customerSources) {
  const text = read(source);
  expectText(
    text,
    '.from("customer_point_summaries")',
    `${source} still bypasses the expiry-aware point summary`,
  );
  assert.ok(
    !text.includes('.from("customer_store_wallets")'),
    `${source} still reads the legacy wallet balance directly`,
  );
}

const confirm = read("src/app/confirm/page.tsx");
expectText(
  confirm,
  "expires_at.is.null,expires_at.gte.",
  "checkout still displays already-expired coupons",
);

const benefits = read("src/app/me/MeBenefitSections.tsx");
expectText(
  benefits,
  "pointExpiryText(wallet)",
  "customer benefit view does not show the expiry notice",
);

// Deterministic policy examples independent of a live database.
function consumeFifo(lots, requested) {
  let remaining = requested;
  const allocations = [];
  for (const lot of [...lots].sort((a, b) => a.expires - b.expires || a.id - b.id)) {
    const used = Math.min(remaining, lot.points);
    if (used > 0) allocations.push([lot.id, used]);
    remaining -= used;
    if (remaining === 0) break;
  }
  assert.equal(remaining, 0, "fixture has insufficient points");
  return allocations;
}

assert.deepEqual(
  consumeFifo(
    [
      { id: 2, expires: 200, points: 300 },
      { id: 1, expires: 100, points: 200 },
    ],
    350,
  ),
  [
    [1, 200],
    [2, 150],
  ],
  "FIFO example failed",
);

const day = 86_400_000;
const now = Date.UTC(2026, 7, 27);
assert.equal(
  Math.max(Date.UTC(2026, 7, 28), now + 30 * day),
  now + 30 * day,
  "refund grace example failed",
);
assert.deepEqual(
  { recovery: Math.max(0, 500 - 300), spendableEarn: Math.max(0, 300 - 500) },
  { recovery: 200, spendableEarn: 0 },
  "recovery offset example failed",
);

console.log("P0 point expiry checks passed");
