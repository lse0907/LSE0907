import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";

const ratings = ["helpful", "neutral", "unhelpful"] as const;
const reasons = ["need_evidence", "not_actionable", "not_relevant", "inaccurate", "other"] as const;

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
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const briefIds = String(req.nextUrl.searchParams.get("briefs") || req.nextUrl.searchParams.get("brief") || "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 30);
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    if (!briefIds.length) throw new ApiError(400, "브리핑 정보를 확인해 주세요.", "AI_BRIEF_REQUIRED");
    const { data, error } = await admin
      .from("ai_brief_feedback")
      .select("brief_id,rating,reason_code,note,updated_at")
      .in("brief_id", briefIds)
      .eq("store_id", storeId)
      .eq("submitted_by_user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw new ApiError(500, "브리핑 평가를 불러오지 못했습니다.", "AI_BRIEF_FEEDBACK_LOAD_FAILED");
    return privateResponse({ ok: true, feedback: data || [] });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.store || "").trim();
    const briefId = String(body?.briefId || "").trim();
    const rating = String(body?.rating || "").trim();
    const reasonCode = body?.reasonCode === undefined || body?.reasonCode === null ? null : String(body.reasonCode).trim();
    const note = body?.note === undefined || body?.note === null ? null : String(body.note).trim();
    if (!briefId) throw new ApiError(400, "브리핑 정보를 확인해 주세요.", "AI_BRIEF_REQUIRED");
    if (!ratings.includes(rating as typeof ratings[number])) throw new ApiError(400, "평가를 선택해 주세요.", "AI_BRIEF_RATING_INVALID");
    if (reasonCode && !reasons.includes(reasonCode as typeof reasons[number])) throw new ApiError(400, "평가 이유를 확인해 주세요.", "AI_BRIEF_REASON_INVALID");
    if (rating === "unhelpful" && !reasonCode) throw new ApiError(400, "도움이 안 된 이유를 선택해 주세요.", "AI_BRIEF_REASON_REQUIRED");
    if (note && note.length > 500) throw new ApiError(400, "의견은 500자 이내로 입력해 주세요.", "AI_BRIEF_NOTE_TOO_LONG");

    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const { data: brief, error: briefError } = await admin.from("ai_briefs").select("id").eq("id", briefId).eq("store_id", storeId).maybeSingle();
    if (briefError) throw new ApiError(500, "브리핑을 확인하지 못했습니다.", "AI_BRIEF_LOOKUP_FAILED");
    if (!brief) throw new ApiError(404, "이 매장의 브리핑을 찾을 수 없습니다.", "AI_BRIEF_NOT_FOUND");

    const { data, error } = await admin
      .from("ai_brief_feedback")
      .upsert({ brief_id: briefId, store_id: storeId, submitted_by_user_id: userId, rating, reason_code: reasonCode || null, note: note || null, updated_at: new Date().toISOString() }, { onConflict: "brief_id,submitted_by_user_id" })
      .select("rating,reason_code,note,updated_at")
      .single();
    if (error || !data) throw new ApiError(500, "브리핑 평가를 저장하지 못했습니다.", "AI_BRIEF_FEEDBACK_SAVE_FAILED");
    return privateResponse({ ok: true, feedback: data });
  } catch (error) { return fail(error); }
}
