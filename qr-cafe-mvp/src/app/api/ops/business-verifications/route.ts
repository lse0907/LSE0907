import { NextRequest } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, ApiError } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const status = String(req.nextUrl.searchParams.get("status") || "submitted");
    const summary = req.nextUrl.searchParams.get("summary") === "1";
    if (summary) {
      const query = admin
        .from("business_verification_requests")
        .select("submitted_at", { count: "exact" })
        .order("submitted_at", { ascending: true })
        .limit(1);
      const { data, error, count } = status === "all" ? await query : await query.eq("status", status);
      if (error) throw new ApiError(500, "사업자 인증 요청을 불러오지 못했습니다.", "OPS_BUSINESS_LIST_FAILED");
      return Response.json({ ok: true, count: count || 0, oldestSubmittedAt: data?.[0]?.submitted_at || null });
    }
    const query = admin
      .from("business_verification_requests")
      .select("id,status,applicant_user_id,applicant_role,business_phone,phone_verified_at,business_document_path,delegation_document_path,submitted_at,reviewed_at,review_note,business_entities(*)", { count: "exact" })
      .order("submitted_at", { ascending: true })
      .limit(100);
    const { data, error, count } = status === "all" ? await query : await query.eq("status", status);
    if (error) throw new ApiError(500, "사업자 인증 요청을 불러오지 못했습니다.", "OPS_BUSINESS_LIST_FAILED");
    const requests = await Promise.all((data || []).map(async (row) => {
      const [businessDocument, delegationDocument] = await Promise.all([
        row.business_document_path
          ? admin.storage.from("business-verification").createSignedUrl(row.business_document_path, 300)
          : Promise.resolve({ data: null, error: null }),
        row.delegation_document_path
          ? admin.storage.from("business-verification").createSignedUrl(row.delegation_document_path, 300)
          : Promise.resolve({ data: null, error: null }),
      ]);
      return {
        ...row,
        business_document_url: businessDocument.data?.signedUrl || null,
        delegation_document_url: delegationDocument.data?.signedUrl || null,
      };
    }));
    return Response.json({ ok: true, requests, count: count || 0 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "support"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = String(body.requestId || "").trim();
    const decision = String(body.decision || "").trim();
    const note = String(body.note || "").trim().slice(0, 1000);
    if (!requestId || !new Set(["approve", "changes_requested", "reject"]).has(decision)) throw new ApiError(400, "심사 요청과 처리 결과를 확인해 주세요.", "INVALID_REVIEW_DECISION");
    if (decision !== "approve" && !note) throw new ApiError(400, "보완 또는 거절 사유를 입력해 주세요.", "REVIEW_NOTE_REQUIRED");

    const { data: requestRow, error } = await admin.from("business_verification_requests").select("id,status,business_entity_id,applicant_user_id,applicant_role,business_document_path").eq("id", requestId).single();
    if (error || !requestRow) throw new ApiError(404, "사업자 인증 요청을 찾지 못했습니다.", "BUSINESS_REQUEST_NOT_FOUND");
    if (!requestRow.business_document_path) throw new ApiError(409, "사업자등록증 확인이 필요합니다.", "BUSINESS_DOCUMENT_MISSING");
    const now = new Date().toISOString();
    const nextStatus = decision === "approve" ? "approved" : decision;
    const updated = await admin.from("business_verification_requests").update({ status: nextStatus, reviewed_at: now, reviewed_by: actor.userId, review_note: note || null, phone_verified_at: decision === "approve" ? now : null, updated_at: now }).eq("id", requestId);
    if (updated.error) throw new ApiError(500, "사업자 인증 결과를 저장하지 못했습니다.", "BUSINESS_REVIEW_SAVE_FAILED");

    if (decision === "approve") {
      const [entity, member, role] = await Promise.all([
        admin.from("business_entities").update({ verification_status: "approved", business_status: "active", verified_at: now, verified_by: actor.userId, updated_at: now }).eq("id", requestRow.business_entity_id),
        admin.from("business_entity_members").update({ role: requestRow.applicant_role, status: "active", updated_at: now }).eq("business_entity_id", requestRow.business_entity_id).eq("user_id", requestRow.applicant_user_id),
        admin.from("account_roles").update({ status: "active", activated_at: now, updated_at: now }).eq("user_id", requestRow.applicant_user_id).eq("audience", "owner"),
      ]);
      if (entity.error || member.error || role.error) throw new ApiError(500, "승인 상태 연결을 완료하지 못했습니다.", "BUSINESS_APPROVAL_LINK_FAILED");
    } else {
      await Promise.all([
        admin.from("business_entities").update({ verification_status: decision === "reject" ? "rejected" : "changes_requested", updated_at: now }).eq("id", requestRow.business_entity_id),
        admin.from("account_roles").update({ status: decision === "reject" ? "verification_required" : "changes_requested", updated_at: now }).eq("user_id", requestRow.applicant_user_id).eq("audience", "owner"),
      ]);
    }
    await admin.from("business_verification_events").insert({ request_id: requestId, actor_user_id: actor.userId, event_type: decision === "approve" ? "approved" : decision, note: note || null });
    return Response.json({ ok: true, status: nextStatus });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
