import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

export const dynamic = "force-dynamic";

const requestTypes = new Set(["support_action", "refund_review", "subscription_review", "business_verification", "incident_analysis"]);
const riskLevels = new Set(["low", "medium", "high"]);
const decisions = new Set(["on_hold", "approved", "rejected"]);

function privateResponse(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = String(value || "").trim();
  if (!text) throw new ApiError(400, `${label}을(를) 입력해 주세요.`, "APPROVAL_INPUT_REQUIRED");
  if (text.length > maxLength) throw new ApiError(400, `${label}은(는) ${maxLength}자 이내로 입력해 주세요.`, "APPROVAL_INPUT_TOO_LONG");
  return text;
}

function migrationNotReady(error: { code?: string | null } | null) {
  return ["42P01", "PGRST205"].includes(String(error?.code || ""));
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const status = String(req.nextUrl.searchParams.get("status") || "open");
    const query = admin
      .from("ai_ops_approval_requests")
      .select("id,store_id,request_type,source_kind,source_reference,title,change_summary,proposed_action,risk_level,execution_kind,status,reviewed_at,decision_note,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status === "open") query.in("status", ["pending", "on_hold"]);
    else if (["pending", "on_hold", "approved", "rejected", "cancelled", "completed"].includes(status)) query.eq("status", status);
    const { data, error } = await query;
    if (error) {
      if (migrationNotReady(error)) return privateResponse({ ok: true, ready: false, requests: [], message: "승인함 DB 연결을 준비 중입니다. 로컬 마이그레이션 검증 뒤 별도 승인으로 반영합니다." });
      throw new ApiError(500, "승인 대기 목록을 불러오지 못했습니다.", "AI_APPROVAL_LOAD_FAILED");
    }
    const requests = data || [];
    const storeIds = [...new Set(requests.map((row) => String(row.store_id || "")).filter(Boolean))];
    const { data: stores } = storeIds.length ? await admin.from("stores").select("store_id,store_name").in("store_id", storeIds) : { data: [] };
    const names = new Map((stores || []).map((row) => [String(row.store_id), String(row.store_name || "이름 없는 매장")]));
    return privateResponse({ ok: true, ready: true, requests: requests.map((row) => ({ ...row, store_name: row.store_id ? names.get(String(row.store_id)) || "이름 없는 매장" : "플랫폼 공통" })) });
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if ((origin && origin !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master"]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");

    if (action === "create") {
      const requestType = String(body.requestType || "");
      const riskLevel = String(body.riskLevel || "");
      if (!requestTypes.has(requestType)) throw new ApiError(400, "승인 요청 유형이 올바르지 않습니다.", "APPROVAL_TYPE_INVALID");
      if (!riskLevels.has(riskLevel)) throw new ApiError(400, "위험 수준이 올바르지 않습니다.", "APPROVAL_RISK_INVALID");
      const storeId = String(body.storeId || "").trim() || null;
      if (storeId) {
        const { data: store, error: storeError } = await admin.from("stores").select("store_id").eq("store_id", storeId).maybeSingle();
        if (storeError || !store) throw new ApiError(400, "매장 정보를 다시 확인해 주세요.", "APPROVAL_STORE_INVALID");
      }
      const payload = {
        store_id: storeId,
        request_type: requestType,
        source_kind: requiredText(body.sourceKind, "출처 유형", 80),
        source_reference: requiredText(body.sourceReference, "출처 번호", 160),
        title: requiredText(body.title, "제목", 200),
        change_summary: requiredText(body.changeSummary, "검토 이유", 1000),
        proposed_action: requiredText(body.proposedAction, "제안 조치", 1000),
        risk_level: riskLevel,
        execution_kind: "manual_only",
        created_by_user_id: actor.userId,
      };
      const { data: created, error } = await admin.from("ai_ops_approval_requests").insert(payload).select("id").single();
      if (error) {
        if (migrationNotReady(error)) throw new ApiError(503, "승인함 DB 연결을 준비 중입니다.", "AI_APPROVAL_NOT_READY");
        if (error.code === "23505") throw new ApiError(409, "같은 건의 진행 중인 승인 요청이 이미 있습니다.", "AI_APPROVAL_DUPLICATE");
        throw new ApiError(500, "승인 요청을 만들지 못했습니다.", "AI_APPROVAL_CREATE_FAILED");
      }
      return privateResponse({ ok: true, id: created.id }, 201);
    }

    if (action === "decide") {
      const requestId = requiredText(body.requestId, "승인 요청", 64);
      const decision = String(body.decision || "");
      if (!decisions.has(decision)) throw new ApiError(400, "처리 방식이 올바르지 않습니다.", "APPROVAL_DECISION_INVALID");
      const note = String(body.note || "").trim();
      if (!note) throw new ApiError(400, "결정 사유를 남겨 주세요.", "APPROVAL_DECISION_NOTE_REQUIRED");
      if (note.length > 1000) throw new ApiError(400, "결정 사유는 1,000자 이내로 입력해 주세요.", "APPROVAL_DECISION_NOTE_TOO_LONG");
      const { data, error } = await admin.rpc("decide_ai_ops_approval_request", { p_request_id: requestId, p_decision: decision, p_actor_user_id: actor.userId, p_decision_note: note });
      if (error) {
        if (migrationNotReady(error)) throw new ApiError(503, "승인함 DB 연결을 준비 중입니다.", "AI_APPROVAL_NOT_READY");
        throw new ApiError(409, "이미 처리되었거나 현재 상태에서는 결정할 수 없는 요청입니다.", "AI_APPROVAL_DECISION_CONFLICT");
      }
      return privateResponse({ ok: true, request: data });
    }

    throw new ApiError(400, "지원하지 않는 승인함 요청입니다.", "APPROVAL_ACTION_INVALID");
  } catch (error) {
    const response = apiErrorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
