import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    if (process.env.NODE_ENV !== "production") return new Response(null, { status: 204 });
    if (/bot|crawler|spider|preview/i.test(req.headers.get("user-agent") || "")) return new Response(null, { status: 204 });
    const raw = await req.text();
    if (raw.length > 2048) throw new ApiError(413, "요청이 너무 큽니다.", "VISIT_TOO_LARGE");
    let body;
    try { body = JSON.parse(raw); } catch { throw new ApiError(400, "잘못된 방문 정보입니다.", "VISIT_INVALID"); }
    if (!body || typeof body.sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.sessionId)) throw new ApiError(400, "잘못된 방문 정보입니다.", "VISIT_INVALID");
    const admin = createSupabaseAdminClient();
    const round = await admin.from("beta_recruitment_rounds").select("id").eq("status", "open").maybeSingle();
    if (round.error) throw new ApiError(503, "모집 상태를 확인하지 못했습니다.", "VISIT_ROUND_FAILED");
    if (!round.data) return new Response(null, { status: 204 });
    const result = await admin.from("beta_page_visits").upsert({ session_id: body.sessionId, recruitment_round_id: round.data.id }, { onConflict: "session_id,recruitment_round_id", ignoreDuplicates: true });
    if (result.error) throw new ApiError(503, "방문 통계를 기록하지 못했습니다.", "VISIT_SAVE_FAILED");
    return new Response(null, { status: 204 });
  } catch (error) { return apiErrorResponse(error); }
}
