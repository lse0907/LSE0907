import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";

const resultStatuses = ["success", "failed", "inconclusive"] as const;

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

function asText(value: unknown, max: number) {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw new ApiError(400, "입력 내용을 다시 확인해 주세요.", "AI_EXPERIMENT_INPUT_INVALID");
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const { data, error } = await admin
      .from("ai_experiments")
      .select("id,source_brief_id,experiment_key,title,change_summary,change_scope,duration_days,success_metric,success_threshold,guardrail_metric,status,result_status,result_summary,approved_at,started_at,stopped_at,ended_at,rollback_completed_at,created_at,updated_at")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) {
      if (["42P01", "PGRST205"].includes(String(error.code || ""))) throw new ApiError(503, "AI 실험 기능을 준비하고 있습니다. 잠시 후 다시 확인해 주세요.", "AI_EXPERIMENT_SCHEMA_PENDING");
      throw new ApiError(500, "AI 실험 기록을 불러오지 못했습니다.", "AI_EXPERIMENT_LOAD_FAILED");
    }
    return privateResponse({ ok: true, experiments: data || [] });
  } catch (error) { return fail(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.store || "").trim();
    const action = String(body?.action || "").trim();
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });

    if (action === "create") {
      const briefId = asText(body?.briefId, 100);
      const { data: brief, error: briefError } = await admin
        .from("ai_briefs")
        .select("id,recommendation")
        .eq("id", briefId)
        .eq("store_id", storeId)
        .maybeSingle();
      if (briefError) throw new ApiError(500, "AI 제안을 확인하지 못했습니다.", "AI_EXPERIMENT_BRIEF_LOOKUP_FAILED");
      const recommendation = String(brief?.recommendation || "").trim();
      if (!brief || !recommendation) throw new ApiError(400, "실험으로 만들 수 있는 AI 제안이 없습니다.", "AI_EXPERIMENT_PROPOSAL_REQUIRED");

      const { data, error } = await admin
        .from("ai_experiments")
        .insert({
          store_id: storeId,
          source_brief_id: briefId,
          experiment_key: `brief:${briefId}`,
          title: "AI 제안을 7일 동안 관찰하기",
          change_summary: recommendation,
          change_scope: "manual_copy",
          duration_days: 7,
          success_metric: "같은 요일·시간대 주문 흐름",
          success_threshold: "주문 증가 여부를 참고하되 단정하지 않음",
          guardrail_metric: "취소율이 이전 기준보다 높아지지 않는지 확인",
        })
        .select("id,title,status,change_summary,duration_days,success_metric,success_threshold,guardrail_metric")
        .single();
      if (error || !data) {
        if (String(error?.code || "") === "23505") throw new ApiError(409, "이 AI 제안은 이미 실험 기록으로 관리하고 있습니다.", "AI_EXPERIMENT_ALREADY_EXISTS");
        throw new ApiError(500, "AI 실험 제안을 만들지 못했습니다.", "AI_EXPERIMENT_CREATE_FAILED");
      }
      const { error: eventError } = await admin.from("ai_experiment_events").insert({ experiment_id: data.id, store_id: storeId, actor_user_id: userId, event_type: "proposal_created", event_summary: "AI 브리핑 제안을 승인 전 실험안으로 저장했습니다. 아직 어떤 매장 설정도 변경되지 않았습니다." });
      if (eventError) throw new ApiError(500, "AI 실험 이력을 저장하지 못했습니다.", "AI_EXPERIMENT_EVENT_CREATE_FAILED");
      return privateResponse({ ok: true, experiment: data });
    }

    const experimentId = asText(body?.experimentId, 100);
    const { data: experiment, error: lookupError } = await admin
      .from("ai_experiments")
      .select("id,store_id,status,experiment_key,title")
      .eq("id", experimentId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (lookupError) throw new ApiError(500, "AI 실험을 확인하지 못했습니다.", "AI_EXPERIMENT_LOOKUP_FAILED");
    if (!experiment) throw new ApiError(404, "AI 실험을 찾을 수 없습니다.", "AI_EXPERIMENT_NOT_FOUND");

    const now = new Date().toISOString();
    if (action === "approve_and_start") {
      if (experiment.status !== "proposal") throw new ApiError(409, "승인할 수 있는 실험 상태가 아닙니다.", "AI_EXPERIMENT_APPROVAL_INVALID");
      const { error } = await admin.from("ai_experiments").update({ status: "active", approved_by_user_id: userId, approved_at: now, started_at: now, updated_at: now }).eq("id", experimentId).eq("status", "proposal");
      if (error) throw new ApiError(500, "AI 실험을 시작하지 못했습니다.", "AI_EXPERIMENT_START_FAILED");
      await admin.from("ai_experiment_events").insert({ experiment_id: experimentId, store_id: storeId, actor_user_id: userId, event_type: "approved_and_started", event_summary: "점주가 실험 조건을 최종 승인했습니다. 초기 범위는 안내 문구의 수동 적용만 허용하며, 시스템 설정은 자동으로 변경하지 않습니다." });
      return privateResponse({ ok: true, status: "active" });
    }
    if (action === "stop_and_rollback") {
      if (experiment.status !== "active") throw new ApiError(409, "중지할 수 있는 실험 상태가 아닙니다.", "AI_EXPERIMENT_STOP_INVALID");
      if (body?.confirmStop !== true) throw new ApiError(400, "중지와 되돌리기를 확인해 주세요.", "AI_EXPERIMENT_STOP_CONFIRM_REQUIRED");
      const { error } = await admin.from("ai_experiments").update({ status: "stopped", stopped_at: now, rollback_completed_at: now, updated_at: now }).eq("id", experimentId).eq("status", "active");
      if (error) throw new ApiError(500, "AI 실험을 중지하지 못했습니다.", "AI_EXPERIMENT_STOP_FAILED");
      await admin.from("ai_experiment_events").insert({ experiment_id: experimentId, store_id: storeId, actor_user_id: userId, event_type: "stopped_and_rolled_back", event_summary: "점주가 실험을 중지했습니다. 초기 실험은 자동 변경이 없으므로 되돌릴 시스템 설정은 없습니다." });
      return privateResponse({ ok: true, status: "stopped" });
    }
    if (action === "complete") {
      if (experiment.status !== "active") throw new ApiError(409, "완료 처리할 수 있는 실험 상태가 아닙니다.", "AI_EXPERIMENT_COMPLETE_INVALID");
      const resultStatus = String(body?.resultStatus || "");
      if (!resultStatuses.includes(resultStatus as typeof resultStatuses[number])) throw new ApiError(400, "결과 분류를 선택해 주세요.", "AI_EXPERIMENT_RESULT_INVALID");
      const resultSummary = asText(body?.resultSummary, 1000);
      const { error } = await admin.from("ai_experiments").update({ status: "completed", result_status: resultStatus, result_summary: resultSummary, ended_at: now, updated_at: now }).eq("id", experimentId).eq("status", "active");
      if (error) throw new ApiError(500, "AI 실험 결과를 저장하지 못했습니다.", "AI_EXPERIMENT_COMPLETE_FAILED");
      await admin.from("ai_experiment_events").insert({ experiment_id: experimentId, store_id: storeId, actor_user_id: userId, event_type: "completed", event_summary: `점주가 실험 결과를 ${resultStatus === "success" ? "성공" : resultStatus === "failed" ? "실패" : "추가 관찰"}으로 분류했습니다.` });
      return privateResponse({ ok: true, status: "completed" });
    }
    if (action === "mark_stable") {
      if (experiment.status !== "completed") throw new ApiError(409, "완료된 실험만 STABLE로 관리할 수 있습니다.", "AI_EXPERIMENT_STABLE_INVALID");
      const { data: current, error: currentError } = await admin.from("ai_experiments").select("result_status").eq("id", experimentId).single();
      if (currentError || current?.result_status !== "success") throw new ApiError(409, "성공으로 분류된 실험만 STABLE로 관리할 수 있습니다.", "AI_EXPERIMENT_STABLE_RESULT_REQUIRED");
      const { error } = await admin.from("ai_experiments").update({ status: "stable", updated_at: now }).eq("id", experimentId).eq("status", "completed");
      if (error) throw new ApiError(500, "STABLE 상태를 저장하지 못했습니다.", "AI_EXPERIMENT_STABLE_SAVE_FAILED");
      await admin.from("ai_experiment_events").insert({ experiment_id: experimentId, store_id: storeId, actor_user_id: userId, event_type: "marked_stable", event_summary: "점주가 검증된 결과를 STABLE 운영 방식으로 관리하기로 결정했습니다." });
      return privateResponse({ ok: true, status: "stable" });
    }
    throw new ApiError(400, "처리 유형을 확인해 주세요.", "AI_EXPERIMENT_ACTION_INVALID");
  } catch (error) { return fail(error); }
}
