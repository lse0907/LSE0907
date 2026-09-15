import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const expect = (value, message) => { if (!value) throw new Error(message); };

const execution = read("src/app/api/_lib/aiExecution.ts");
const limits = read("supabase/migrations/20260910050131_ai_execution_limits.sql");
const experiments = read("src/app/api/admin/ai-experiments/route.ts");
const experimentMigration = read("supabase/migrations/20260911094030_ai_experiments.sql");
const approvals = read("src/app/api/ops/approvals/route.ts");
const approvalMigration = read("supabase/migrations/20260911115736_ai_ops_approval_queue.sql");
const feedback = read("src/app/api/admin/ai-brief-feedback/route.ts");
const history = read("src/app/api/admin/ai-brief-history/route.ts");
const readiness = read("scripts/check-ai-provider-readiness.mjs");
const previewFailure = read("src/app/api/ops/ai-provider-check/preview-failure/route.ts");

// AI-5: These checks cover beta-safe behavior that is testable without an
// external provider, Docker, or a production database write.
expect(execution.includes('process.env.AI_EXTERNAL_CALLS_ENABLED === "true"') && execution.includes("OPENAI_API_KEY"), "External AI calls must remain opt-in and require a server key");
for (const code of ["AI_PROVIDER_DISABLED", "AI_PLATFORM_BUDGET_STOP", "AI_PLATFORM_BUDGET_LIMIT", "AI_DAILY_CALL_LIMIT", "AI_MONTHLY_CALL_LIMIT"]) {
  expect(limits.includes(code), `Missing AI limit block code: ${code}`);
}
expect(limits.includes("status in ('pending','succeeded')"), "Pending reservations must count toward AI limits");
expect(limits.includes("monthly_stop_usd") && limits.includes("monthly_hard_limit_usd"), "Provider stop and hard limits are required");

expect(experiments.includes('change_scope: "manual_copy"'), "AI experiments must start as manual-only changes");
expect(experiments.includes("confirmStop !== true"), "Experiment stop must require explicit confirmation");
expect(experiments.includes("result_status !== \"success\""), "Only successful experiments can become STABLE");
expect(experimentMigration.includes("prevent_ai_experiment_event_mutation") && experimentMigration.includes("manual_copy"), "Experiment audit history and manual-only scope are required");

expect(approvals.includes('execution_kind: "manual_only"'), "OPS approvals must not create an execution request");
expect(approvals.includes('requireOpsUser(req, admin, ["master"])'), "Only the platform master can decide an OPS approval");
expect(approvals.includes("APPROVAL_DECISION_NOTE_REQUIRED"), "Approval decisions must include a reason");
expect(approvalMigration.includes("execution_kind = 'manual_only'") && approvalMigration.includes("prevent_ai_ops_approval_event_mutation"), "OPS approval records must be manual-only and append-only");

expect(feedback.includes("requireStoreRole") && feedback.includes("AI_BRIEF_NOT_FOUND"), "Brief feedback must be store-scoped");
expect(history.includes("requireStoreRole") && history.includes("ORIGIN_NOT_ALLOWED"), "Brief history creation must require an owner and same-origin request");
expect(readiness.includes("AI_EXTERNAL_CALLS_ENABLED") && readiness.includes("OPENAI_API_KEY") && readiness.includes("--require-ready"), "Provider readiness must verify the key and explicit enable switch without calling the provider");
expect(previewFailure.includes('process.env.VERCEL_ENV !== "preview"') && previewFailure.includes('AI_PROVIDER_PREVIEW_FAILURE_TESTS'), "Provider failure simulation must stay preview-only and explicitly enabled");
for (const code of ["AI_PROVIDER_AUTH_FAILED", "AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_TIMEOUT"]) {
  expect(previewFailure.includes(code), `Missing preview-only provider failure scenario: ${code}`);
}
expect(previewFailure.includes('actualCostUsd: 0') && !previewFailure.includes("generateBriefWithOpenAi"), "Failure simulation must not call OpenAI or record cost");

console.log("AI beta safety scenario checks passed.");
