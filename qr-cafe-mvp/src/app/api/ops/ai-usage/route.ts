import { NextRequest } from "next/server";

import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

export const dynamic = "force-dynamic";

type UsageRow = {
  store_id: string;
  requested_by_user_id: string | null;
  estimated_cost_won: number | string | null;
  status: string;
  occurred_at: string;
};

type LimitRow = {
  target_scope: "platform" | "store" | "user" | "feature";
  target_store_id: string | null;
  target_user_id: string | null;
  target_feature: string | null;
  ai_enabled: boolean;
  daily_analysis_limit: number | null;
  monthly_analysis_limit: number | null;
  daily_cost_limit_won: number | string | null;
  monthly_cost_limit_won: number | string | null;
};

type SettingRow = { store_id: string; beta_status: string; ai_enabled: boolean; updated_at: string };
type StoreRow = { store_id: string; store_name: string | null; owner_user_id: string | null };

function privateResponse(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function fail(error: unknown) {
  const response = apiErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function kstDate(daysAgo = 0) {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000 + daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function monthStartKst() { return `${kstDate().slice(0, 7)}-01`; }
function atKstStart(date: string) { return `${date}T00:00:00+09:00`; }
function money(value: number | string | null | undefined) { return Math.max(0, Number(value || 0)); }

async function ownerEmails(admin: ReturnType<typeof createSupabaseAdminClient>, ownerIds: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(ownerIds.filter(Boolean))];
  await Promise.all(unique.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data.user?.email) result.set(id, data.user.email);
  }));
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin);
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";
    const since = atKstStart(monthStartKst());
    const [usageRes, storesRes, settingsRes, limitsRes] = await Promise.all([
      admin.from("ai_usage_events").select("store_id,requested_by_user_id,estimated_cost_won,status,occurred_at").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(5000),
      admin.from("stores").select("store_id,store_name,owner_user_id").is("deleted_at", null).order("created_at", { ascending: false }),
      admin.from("ai_store_settings").select("store_id,beta_status,ai_enabled,updated_at"),
      admin.from("ai_usage_limits").select("target_scope,target_store_id,target_user_id,target_feature,ai_enabled,daily_analysis_limit,monthly_analysis_limit,daily_cost_limit_won,monthly_cost_limit_won"),
    ]);
    for (const result of [usageRes, storesRes, settingsRes, limitsRes]) if (result.error) throw new ApiError(500, `AI 운영 정보를 불러오지 못했습니다: ${result.error.message}`, "AI_OPS_LOAD_FAILED");

    const usage = (usageRes.data || []) as UsageRow[];
    const stores = (storesRes.data || []) as StoreRow[];
    const settings = new Map(((settingsRes.data || []) as SettingRow[]).map((row) => [row.store_id, row]));
    const limits = (limitsRes.data || []) as LimitRow[];
    const storeLimits = new Map(limits.filter((row) => row.target_scope === "store" && row.target_store_id).map((row) => [row.target_store_id as string, row]));
    const platformLimit = limits.find((row) => row.target_scope === "platform") || null;
    const todayStart = atKstStart(kstDate());
    const byStore = new Map<string, { todayCalls: number; monthCalls: number; todayCost: number; monthCost: number; blocked: number; failed: number; lastOccurredAt: string | null }>();
    let platformTodayCost = 0;
    let platformMonthCost = 0;
    let platformTodayCalls = 0;
    let platformMonthCalls = 0;
    let blockedCount = 0;
    let failedCount = 0;
    for (const event of usage) {
      const previous = byStore.get(event.store_id) || { todayCalls: 0, monthCalls: 0, todayCost: 0, monthCost: 0, blocked: 0, failed: 0, lastOccurredAt: null };
      const cost = money(event.estimated_cost_won);
      previous.monthCalls += 1;
      previous.monthCost += cost;
      if (!previous.lastOccurredAt || previous.lastOccurredAt < event.occurred_at) previous.lastOccurredAt = event.occurred_at;
      platformMonthCalls += 1;
      platformMonthCost += cost;
      if (event.status === "blocked") { previous.blocked += 1; blockedCount += 1; }
      if (event.status === "failed") { previous.failed += 1; failedCount += 1; }
      if (event.occurred_at >= todayStart) {
        previous.todayCalls += 1;
        previous.todayCost += cost;
        platformTodayCalls += 1;
        platformTodayCost += cost;
      }
      byStore.set(event.store_id, previous);
    }

    const platformMonthlyLimitWon = money(platformLimit?.monthly_cost_limit_won);
    if (summaryOnly) {
      return privateResponse({
        ok: true,
        summary: {
          todayCalls: platformTodayCalls,
          monthCalls: platformMonthCalls,
          todayCost: platformTodayCost,
          monthCost: platformMonthCost,
          monthlyLimitWon: platformMonthlyLimitWon,
          blockedCount,
          failedCount,
          activeStores: [...settings.values()].filter((row) => row.ai_enabled && row.beta_status === "enrolled").length,
        },
      });
    }

    const emails = await ownerEmails(admin, stores.map((store) => store.owner_user_id || ""));
    const rows = stores.map((store) => {
      const usageSummary = byStore.get(store.store_id) || { todayCalls: 0, monthCalls: 0, todayCost: 0, monthCost: 0, blocked: 0, failed: 0, lastOccurredAt: null };
      const setting = settings.get(store.store_id) || null;
      const limit = storeLimits.get(store.store_id) || null;
      const disabled = setting?.ai_enabled === false || limit?.ai_enabled === false;
      const monthCostLimit = money(limit?.monthly_cost_limit_won ?? setting?.monthly_cost_limit_won);
      const costRate = monthCostLimit > 0 ? Math.round((usageSummary.monthCost / monthCostLimit) * 100) : null;
      return {
        storeId: store.store_id,
        storeName: store.store_name || "이름 없는 매장",
        ownerEmail: emails.get(store.owner_user_id || "") || null,
        betaStatus: setting?.beta_status || "not_enrolled",
        aiEnabled: !disabled,
        ...usageSummary,
        dailyAnalysisLimit: limit?.daily_analysis_limit ?? setting?.daily_analysis_limit ?? null,
        monthlyAnalysisLimit: limit?.monthly_analysis_limit ?? setting?.monthly_analysis_limit ?? null,
        dailyCostLimitWon: money(limit?.daily_cost_limit_won ?? setting?.daily_cost_limit_won),
        monthlyCostLimitWon: monthCostLimit,
        monthCostRate: costRate,
      };
    }).sort((a, b) => Number(!a.aiEnabled) - Number(!b.aiEnabled) || (b.monthCostRate || 0) - (a.monthCostRate || 0) || b.monthCost - a.monthCost);

    return privateResponse({
      ok: true,
      canControl: actor.opsRole === "master" || actor.opsRole === "billing",
      summary: {
        todayCalls: platformTodayCalls,
        monthCalls: platformMonthCalls,
        todayCost: platformTodayCost,
        monthCost: platformMonthCost,
        monthlyLimitWon: platformMonthlyLimitWon,
        blockedCount,
        failedCount,
        activeStores: rows.filter((row) => row.aiEnabled && row.betaStatus === "enrolled").length,
      },
      stores: rows,
    });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "billing"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const storeId = String(body.storeId || "").trim();
    const action = String(body.action || "").trim();
    const reason = String(body.reason || "").trim();
    if (!storeId) throw new ApiError(400, "매장을 선택해 주세요.", "AI_STORE_REQUIRED");
    if (action !== "enable" && action !== "disable" && action !== "set_limit") throw new ApiError(400, "처리 유형을 확인해 주세요.", "AI_ACTION_INVALID");
    if (!reason || reason.length > 500) throw new ApiError(400, "변경 사유를 1~500자로 입력해 주세요.", "AI_REASON_REQUIRED");
    const { data: store, error: storeError } = await admin.from("stores").select("store_id").eq("store_id", storeId).is("deleted_at", null).maybeSingle();
    if (storeError || !store) throw new ApiError(404, "매장을 찾을 수 없습니다.", "AI_STORE_NOT_FOUND");

    const numberOrNull = (value: unknown, max: number) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > max) throw new ApiError(400, "한도 값을 다시 확인해 주세요.", "AI_LIMIT_INVALID");
      return number;
    };
    const moneyOrNull = (value: unknown) => {
      if (value === null || value === undefined || value === "") return null;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100000000) throw new ApiError(400, "비용 한도를 다시 확인해 주세요.", "AI_COST_LIMIT_INVALID");
      return Math.round(number);
    };
    const dailyAnalysisLimit = numberOrNull(body.dailyAnalysisLimit, 20);
    const monthlyAnalysisLimit = numberOrNull(body.monthlyAnalysisLimit, 500);
    const dailyCostLimitWon = moneyOrNull(body.dailyCostLimitWon);
    const monthlyCostLimitWon = moneyOrNull(body.monthlyCostLimitWon);
    if (action === "set_limit" && [dailyAnalysisLimit, monthlyAnalysisLimit, dailyCostLimitWon, monthlyCostLimitWon].every((value) => value === null)) throw new ApiError(400, "변경할 한도를 하나 이상 입력해 주세요.", "AI_LIMIT_REQUIRED");

    const { error: controlError } = await admin.rpc("ops_apply_ai_store_control", {
      p_actor_user_id: actor.userId,
      p_store_id: storeId,
      p_action: action,
      p_reason: reason,
      p_daily_analysis_limit: dailyAnalysisLimit,
      p_monthly_analysis_limit: monthlyAnalysisLimit,
      p_daily_cost_limit_won: dailyCostLimitWon,
      p_monthly_cost_limit_won: monthlyCostLimitWon,
    });
    if (controlError) throw new ApiError(500, `AI 설정을 저장하지 못했습니다: ${controlError.message}`, "AI_CONTROL_SAVE_FAILED");
    return privateResponse({ ok: true });
  } catch (error) { return fail(error); }
}
