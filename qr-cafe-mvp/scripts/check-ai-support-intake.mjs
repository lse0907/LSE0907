import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260910075210_ai_support_intake.sql"), "utf8");
const route = fs.readFileSync(path.join(root, "src/app/api/admin/support/route.ts"), "utf8");
const attachmentRoute = fs.readFileSync(path.join(root, "src/app/api/admin/support/attachment/route.ts"), "utf8");
const opsRoute = fs.readFileSync(path.join(root, "src/app/api/ops/support/route.ts"), "utf8");
const retentionMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260910091831_ai_support_ops_retention.sql"), "utf8");

function expect(value, message) { if (!value) throw new Error(message); }

expect(migration.includes("support_ticket_events"), "support event history table is missing");
expect(migration.includes("support_ticket_attachments"), "private attachment metadata table is missing");
expect(migration.includes("'support-evidence'"), "private evidence bucket is missing");
expect(/'support-evidence'\s*,\s*'support-evidence'\s*,\s*false/.test(migration), "evidence bucket must not be public");
expect(migration.includes("enable row level security"), "new support tables must have RLS");
expect(!migration.includes("revoke all on table storage.objects"), "migration must not revoke global storage permissions");
expect(route.includes("MAX_FILES = 3"), "attachment count limit is missing");
expect(route.includes("MAX_FILE_BYTES = 5 * 1024 * 1024"), "attachment size limit is missing");
expect(route.includes("image/png") && route.includes("image/jpeg") && route.includes("image/webp"), "attachment MIME restrictions are incomplete");
expect(route.includes("requireStoreRole"), "support intake must recheck store role on server");
expect(route.includes("createSupabaseAdminClient"), "support intake must use a server-only client");
expect(attachmentRoute.includes("createSignedUrl") && attachmentRoute.includes("requireStoreRole"), "evidence reads must use role-checked signed URLs");
expect(opsRoute.includes("requireOpsUser"), "OPS support handling must require an OPS role");
expect(retentionMigration.includes("set_support_evidence_expiry") && retentionMigration.includes("90 days"), "evidence retention window is missing");
expect(retentionMigration.includes("rion-order-support-evidence-retention"), "evidence retention schedule is missing");

console.log("AI support intake checks passed.");
