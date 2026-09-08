import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { privacyStatuses, privacyTypes, validatePrivacyInput } from "@/app/lib/privacyRequests";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = "id,subject_user_id,audience,request_type,status,requested_at,updated_at,decision_summary";
function privateResponse(body: unknown) { return Response.json(body, { headers: { "Cache-Control": "private, no-store" } }); }
function failure(error: unknown) {
  const response = apiErrorResponse(error instanceof ApiError ? error : new ApiError(500, "개인정보 요청 처리 중 오류가 발생했습니다.", "OPS_PRIVACY_FAILED"));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "support"]);
    const requestId = req.nextUrl.searchParams.get("requestId");
    if (requestId) {
      if (!uuid.test(requestId)) throw new ApiError(400, "요청 번호를 확인해 주세요.");
      const { data: request, error } = await admin.from("privacy_rights_requests").select(`${columns},request_detail`)
        .eq("id", requestId).in("request_type", Object.keys(privacyTypes)).not("subject_user_id", "is", null).maybeSingle();
      if (error) throw new ApiError(500, "요청을 불러오지 못했습니다.");
      if (!request) throw new ApiError(404, "요청을 찾을 수 없습니다.");
      const audit = await admin.from("privacy_request_events").insert({ subject_user_id: request.subject_user_id, rights_request_id: request.id, event_type: "ops_privacy_viewed", actor_type: "ops", actor_user_id: actor.userId });
      if (audit.error) throw new ApiError(500, "조회 이력을 기록하지 못했습니다.");
      const { data: events, error: eventError } = await admin.from("privacy_request_events")
        .select("id,event_type,actor_type,actor_user_id,occurred_at,metadata").eq("rights_request_id", requestId)
        .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(50);
      if (eventError) throw new ApiError(500, "처리 이력을 불러오지 못했습니다.");
      return privateResponse({ ok: true, request: { ...request, request_detail: { note: String(request.request_detail?.note || "").slice(0, 1000) } }, events });
    }
    const status = req.nextUrl.searchParams.get("status") || "open";
    const page = Number(req.nextUrl.searchParams.get("page") || "0");
    if ((status !== "open" && status !== "all" && !Object.hasOwn(privacyStatuses, status)) || !Number.isInteger(page) || page < 0 || page > 10000) throw new ApiError(400, "조회 조건을 확인해 주세요.");
    let query = admin.from("privacy_rights_requests").select(columns, { count: "exact" }).in("request_type", Object.keys(privacyTypes)).not("subject_user_id", "is", null)
      .order("requested_at", { ascending: true }).order("id", { ascending: true }).range(page * 30, page * 30 + 29);
    if (status === "open") query = query.in("status", ["received", "identity_verification_required", "in_review", "partially_completed"]);
    else if (status !== "all") query = query.eq("status", status);
    const { data, error, count } = await query;
    if (error) throw new ApiError(500, "개인정보 요청 목록을 불러오지 못했습니다.");
    return privateResponse({ ok: true, requests: data || [], count: count || 0, hasMore: (page + 1) * 30 < (count || 0) });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "support"]);
    const body = await req.json().catch(() => ({}));
    const requestId = String(body.requestId || "");
    const version = String(body.expectedVersion || "");
    const action = String(body.action || "");
    const summary = String(body.summary || "").trim();
    const value = String(body.value || "").trim();
    if (!uuid.test(requestId) || !version || !Number.isFinite(Date.parse(version))) throw new ApiError(400, "요청 번호와 최신 상태를 확인해 주세요.");
    const validation = validatePrivacyInput(action, summary, value);
    if (validation) throw new ApiError(400, validation);
    const { data, error } = await admin.rpc("ops_process_privacy_request", { p_actor_id: actor.userId, p_request_id: requestId,
      p_expected_version: version, p_action: action, p_summary: summary, p_value: value || null, p_resolves_request: body.resolvesRequest === true });
    if (error) {
      const code = String(error.message || "");
      if (code.includes("OPS_PRIVACY_FORBIDDEN")) throw new ApiError(403, "OPS 처리 권한을 확인해 주세요.");
      if (code.includes("PRIVACY_REQUEST_NOT_FOUND")) throw new ApiError(404, "요청을 찾을 수 없습니다.");
      if (/PRIVACY_REQUEST_CONFLICT|PRIVACY_REQUEST_CLOSED/.test(code)) throw new ApiError(409, "다른 처리로 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.");
      if (/PRIVACY_REVIEW_REQUIRED|PRIVACY_SUBJECT_UNAVAILABLE|PRIVACY_PROFILE_NOT_FOUND/.test(code)) throw new ApiError(409, "검토 상태·서비스 이용 상태·탈퇴 진행 여부를 확인해 주세요. 요청은 완료 처리되지 않았습니다.");
      if (/INVALID_PRIVACY|PRIVACY_ACTION_TYPE_MISMATCH|PRIVACY_SUMMARY_REQUIRED/.test(code)) throw new ApiError(400, "요청 종류와 처리 범위·입력값을 확인해 주세요.");
      throw new ApiError(503, "처리 기능 또는 필수 정책을 확인해야 합니다. 요청은 완료 처리되지 않았습니다.", "OPS_PRIVACY_EXECUTION_FAILED");
    }
    return privateResponse({ ok: true, result: data });
  } catch (error) { return failure(error); }
}
