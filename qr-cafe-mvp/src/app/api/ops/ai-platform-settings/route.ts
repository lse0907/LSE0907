import { NextRequest } from "next/server";

import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

type BudgetRow = { provider: "openai"; ai_enabled: boolean; monthly_stop_usd: number | string; monthly_hard_limit_usd: number | string; updated_at: string };

const view = (row: BudgetRow | null) => row ? ({ provider: row.provider, aiEnabled: row.ai_enabled, monthlyStopUsd: Number(row.monthly_stop_usd), monthlyHardLimitUsd: Number(row.monthly_hard_limit_usd), updatedAt: row.updated_at }) : null;

function privateResponse(body: unknown, status = 200) {
  const result = Response.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

function fail(error: unknown) {
  const result = apiErrorResponse(error);
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin);
    const [budget, events] = await Promise.all([
      admin.from("ai_provider_budget_controls").select("provider,ai_enabled,monthly_stop_usd,monthly_hard_limit_usd,updated_at").eq("provider", "openai").maybeSingle(),
      admin.from("ai_ops_control_events").select("id,actor_user_id,target_scope,action,reason,previous_value,next_value,occurred_at").eq("target_scope", "platform").order("occurred_at", { ascending: false }).limit(12),
    ]);
    if (budget.error) throw new ApiError(500, "AI 플랫폼 설정을 불러오지 못했습니다.", "AI_PLATFORM_SETTINGS_LOAD_FAILED");
    if (events.error) throw new ApiError(500, "AI 운영 이력을 불러오지 못했습니다.", "AI_PLATFORM_HISTORY_LOAD_FAILED");
    return privateResponse({ ok: true, canManage: actor.opsRole === "master", config: view(budget.data as BudgetRow | null), events: events.data || [] });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.aiEnabled !== "boolean") throw new ApiError(400, "AI 사용 상태를 다시 확인해 주세요.", "AI_PLATFORM_ENABLED_INVALID");
    const aiEnabled = body.aiEnabled;
    const monthlyStopUsd = Number(body.monthlyStopUsd);
    const monthlyHardLimitUsd = Number(body.monthlyHardLimitUsd);
    const reason = String(body.reason || "").trim();
    if (!Number.isFinite(monthlyStopUsd) || !Number.isFinite(monthlyHardLimitUsd) || monthlyStopUsd < 0 || monthlyHardLimitUsd < 0 || monthlyStopUsd > monthlyHardLimitUsd || monthlyHardLimitUsd > 100000) throw new ApiError(400, "월 경고 기준과 절대 상한을 다시 확인해 주세요.", "AI_PLATFORM_BUDGET_INVALID");
    if (!reason || reason.length > 500) throw new ApiError(400, "변경 사유를 1~500자로 입력해 주세요.", "AI_PLATFORM_REASON_REQUIRED");

    const before = await admin.from("ai_provider_budget_controls").select("provider,ai_enabled,monthly_stop_usd,monthly_hard_limit_usd,updated_at").eq("provider", "openai").maybeSingle();
    if (before.error) throw new ApiError(500, "기존 AI 플랫폼 설정을 확인하지 못했습니다.", "AI_PLATFORM_SETTINGS_LOAD_FAILED");
    const saved = await admin.from("ai_provider_budget_controls").upsert({ provider: "openai", ai_enabled: aiEnabled, monthly_stop_usd: monthlyStopUsd, monthly_hard_limit_usd: monthlyHardLimitUsd, updated_by: actor.userId, updated_at: new Date().toISOString() }, { onConflict: "provider" }).select("provider,ai_enabled,monthly_stop_usd,monthly_hard_limit_usd,updated_at").single();
    if (saved.error) throw new ApiError(500, "AI 플랫폼 설정을 저장하지 못했습니다.", "AI_PLATFORM_SETTINGS_SAVE_FAILED");
    const audit = await admin.from("ai_ops_control_events").insert({ actor_user_id: actor.userId, target_scope: "platform", action: aiEnabled ? "set_limit" : "disable", reason, previous_value: view(before.data as BudgetRow | null) || {}, next_value: view(saved.data as BudgetRow) || {} });
    if (audit.error) throw new ApiError(500, "AI 플랫폼 변경 이력을 저장하지 못했습니다.", "AI_PLATFORM_AUDIT_FAILED");
    return privateResponse({ ok: true, config: view(saved.data as BudgetRow) });
  } catch (error) { return fail(error); }
}
