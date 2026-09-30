import { readFileSync } from "node:fs";

const reconciliation = readFileSync("supabase/migrations/20260930051656_beta_recruitment_schema_reconciliation.sql", "utf8");
const consent = readFileSync("supabase/migrations/20260929231122_beta_application_consent.sql", "utf8");
const announcement = readFileSync("supabase/migrations/20260929144515_platform_announcements.sql", "utf8");

for (const [label, source, required] of [
  ["beta reconciliation", reconciliation, ["create table if not exists public.beta_recruitment_rounds", "create table if not exists public.beta_applications", "enable row level security", "revoke all on table public.beta_applications from anon, authenticated", "privacy_consent_version"]],
  ["beta consent", consent, ["alter table if exists public.beta_applications", "privacy_consented_at"]],
  ["announcement storage", announcement, ["create table if not exists public.platform_announcements", "enable row level security", "revoke all on table public.platform_announcements from anon, authenticated"]],
]) {
  for (const phrase of required) {
    if (!source.includes(phrase)) throw new Error(`${label}: missing ${phrase}`);
  }
}

console.log("beta recruitment and announcement migrations contain the required protected schema definitions");
