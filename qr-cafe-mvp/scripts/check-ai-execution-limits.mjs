import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260910050131_ai_execution_limits.sql");
const execution = read("src/app/api/_lib/aiExecution.ts");
const requiredMigration = ["ai_provider_budget_controls", "monthly_stop_usd", "monthly_hard_limit_usd", "ai_reserve_execution", "ai_finalize_execution", "security definer", "revoke all on function"];
for (const value of requiredMigration) if (!migration.includes(value)) throw new Error(`Missing migration safeguard: ${value}`);
for (const value of ["daily_brief", "weekly_brief", "monthly_brief", "support_response", "incident_analysis"]) if (!migration.includes(`'${value}'`)) throw new Error(`Missing AI feature: ${value}`);
for (const value of ["gpt-5.6-luna", "gpt-5.6-terra", "AI_EXTERNAL_CALLS_ENABLED", "reserveAiExecution"]) if (!execution.includes(value)) throw new Error(`Missing execution guard: ${value}`);
console.log("AI execution limit checks passed.");
