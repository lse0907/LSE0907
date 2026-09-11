import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";
import { BriefPeriod, createBriefSnapshot, rangeForCurrentPeriod } from "@/app/api/_lib/aiBriefSnapshot";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  const result = Response.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

function normalizePeriod(value: string | null): BriefPeriod {
  if (value === "weekly" || value === "monthly") return value;
  return "daily";
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const period = normalizePeriod(req.nextUrl.searchParams.get("period"));
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });

    const { data, error } = await admin
      .from("ai_briefs")
      .select("id,brief_period,period_start,period_end,headline,summary,brief_status,data_confidence,generated_at,source_order_count,source_sales_won")
      .eq("store_id", storeId)
      .eq("brief_period", period)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("generated_at", { ascending: false })
      .limit(30);
    if (error) throw new ApiError(500, "저장된 AI 브리핑을 불러오지 못했습니다.", "AI_BRIEF_HISTORY_LOAD_FAILED");
    return response({ ok: true, period, briefs: data || [] });
  } catch (error) {
    const result = apiErrorResponse(error);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const payload = await req.json().catch(() => ({}));
    const storeId = String(payload?.store || "").trim();
    const period = normalizePeriod(typeof payload?.period === "string" ? payload.period : null);
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const snapshot = await createBriefSnapshot({
      admin,
      storeId,
      period,
      range: rangeForCurrentPeriod(period),
      requestedByUserId: userId,
    });
    return response({ ok: true, ...snapshot }, snapshot.created ? 201 : 200);
  } catch (error) {
    const result = apiErrorResponse(error);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
}
