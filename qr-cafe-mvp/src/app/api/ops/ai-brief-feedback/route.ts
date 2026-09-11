import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

type FeedbackRow = { store_id: string; rating: "helpful" | "neutral" | "unhelpful"; reason_code: string | null; created_at: string };

function privateResponse(body: unknown, status = 200) {
  const result = Response.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

function sinceKst(days: number) {
  const target = new Date(Date.now() - days * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(target);
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const since = `${sinceKst(30)}T00:00:00+09:00`;
    const { data, error } = await admin.from("ai_brief_feedback").select("store_id,rating,reason_code,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
    if (error) throw new ApiError(500, "AI 브리핑 평가를 불러오지 못했습니다.", "AI_BRIEF_FEEDBACK_OPS_LOAD_FAILED");

    const feedback = (data || []) as FeedbackRow[];
    const total = feedback.length;
    const helpful = feedback.filter((row) => row.rating === "helpful").length;
    const unhelpful = feedback.filter((row) => row.rating === "unhelpful").length;
    const reasons = new Map<string, number>();
    const stores = new Map<string, { total: number; unhelpful: number }>();
    for (const row of feedback) {
      const store = stores.get(row.store_id) || { total: 0, unhelpful: 0 };
      store.total += 1;
      if (row.rating === "unhelpful") {
        store.unhelpful += 1;
        if (row.reason_code) reasons.set(row.reason_code, (reasons.get(row.reason_code) || 0) + 1);
      }
      stores.set(row.store_id, store);
    }
    const attentionCandidates = [...stores.entries()].filter(([, value]) => value.unhelpful > 0).map(([storeId, value]) => ({ storeId, ...value, unhelpfulRate: Math.round((value.unhelpful / value.total) * 100) })).sort((a, b) => b.unhelpfulRate - a.unhelpfulRate || b.unhelpful - a.unhelpful).slice(0, 10);
    const { data: storeRows } = attentionCandidates.length ? await admin.from("stores").select("store_id,store_name").in("store_id", attentionCandidates.map((row) => row.storeId)) : { data: [] };
    const storeNames = new Map((storeRows || []).map((row) => [row.store_id, row.store_name || "이름 없는 매장"]));
    const attentionStores = attentionCandidates.map((row) => ({ ...row, storeName: storeNames.get(row.storeId) || "이름 없는 매장" }));
    const commonReasons = [...reasons.entries()].map(([reasonCode, count]) => ({ reasonCode, count })).sort((a, b) => b.count - a.count).slice(0, 5);
    return privateResponse({ ok: true, summary: { periodDays: 30, total, helpful, neutral: total - helpful - unhelpful, unhelpful, helpfulRate: total ? Math.round((helpful / total) * 100) : null }, attentionStores, commonReasons });
  } catch (error) {
    const result = apiErrorResponse(error);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
}
