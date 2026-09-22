import { NextRequest } from "next/server";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";
const statuses = new Set(["submitted", "reviewing", "selected", "not_selected", "closed"]);

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const status = String(req.nextUrl.searchParams.get("status") || "").trim();
    const roundId = Number(req.nextUrl.searchParams.get("roundId"));
    if (req.nextUrl.searchParams.get("summary") === "1") {
      const [countResult, latestResult] = await Promise.all([
        admin.from("beta_applications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        admin.from("beta_applications").select("created_at").eq("status", "submitted").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (countResult.error || latestResult.error) throw new ApiError(500, "베타 신청 현황을 불러오지 못했습니다.", "BETA_APPLICATION_SUMMARY_FAILED");
      return Response.json({ ok: true, count: countResult.count || 0, latestCreatedAt: latestResult.data?.created_at || null }, { headers: { "Cache-Control": "private, no-store" } });
    }
    let query = admin.from("beta_applications").select("id,created_at,store_name,business_type,operation_type,region,contact_name,contact_method,contact_email,contact_phone,preferred_start,preferred_start_date,feedback_available,note,status,review_note,reviewed_at,recruitment_round:beta_recruitment_rounds(title)").order("created_at", { ascending: false }).limit(200);
    if (statuses.has(status)) query = query.eq("status", status);
    if (Number.isInteger(roundId) && roundId > 0) query = query.eq("recruitment_round_id", roundId);
    const result = await query;
    if (result.error) throw new ApiError(500, "베타 신청 목록을 불러오지 못했습니다.", "BETA_APPLICATION_LOAD_FAILED");
    return Response.json({ ok: true, rows: result.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "support"]);
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id); const status = String(body.status || ""); const note = String(body.reviewNote || "").trim().slice(0, 2000);
    if (!Number.isInteger(id) || id < 1 || !statuses.has(status)) throw new ApiError(400, "신청 상태를 확인해 주세요.", "BETA_APPLICATION_UPDATE_INVALID");
    const result = await admin.from("beta_applications").update({ status, review_note: note || null, reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    if (result.error) throw new ApiError(500, "검토 결과를 저장하지 못했습니다.", "BETA_APPLICATION_UPDATE_FAILED");
    return Response.json({ ok: true });
  } catch (error) { return apiErrorResponse(error); }
}
