import { NextRequest } from "next/server";

import { finalizeAiExecution, isExternalAiEnabled, reserveAiExecution } from "@/app/api/_lib/aiExecution";
import { generateBriefWithOpenAi } from "@/app/api/_lib/openAiProvider";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

/**
 * OPS master-only, one ledgered provider check. It deliberately sends fixed
 * zero-value aggregates, never a store's orders, customer, payment, or prompt
 * text. The normal 200-order briefing threshold is not affected.
 */
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }
    if (!isExternalAiEnabled()) throw new ApiError(503, "AI 외부 분석은 아직 활성화되지 않았습니다.", "AI_PROVIDER_NOT_READY");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const storeId = String(body.storeId || "").trim();
    if (!storeId) throw new ApiError(400, "검증 기준 매장을 선택해 주세요.", "AI_STORE_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master"]);
    const { data: store, error: storeError } = await admin
      .from("stores")
      .select("store_id")
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .maybeSingle();
    if (storeError || !store) throw new ApiError(404, "검증 기준 매장을 찾을 수 없습니다.", "AI_STORE_NOT_FOUND");

    const reservation = await reserveAiExecution({
      admin,
      storeId,
      requestedByUserId: actor.userId,
      feature: "provider_check",
      estimatedInputTokens: 160,
      estimatedOutputTokens: 80,
    });

    try {
      const result = await generateBriefWithOpenAi({
        feature: "provider_check",
        model: reservation.model,
        periodLabel: "운영자 1회 연결 검증용 고정 집계",
        orderCount: 0,
        salesWon: 0,
      });
      await finalizeAiExecution({
        admin,
        requestId: reservation.requestId,
        model: reservation.model,
        status: "succeeded",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedInputTokens: result.cachedInputTokens,
      });
      return privateResponse({
        ok: true,
        provider: "openai",
        model: reservation.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error) {
      await finalizeAiExecution({
        admin,
        requestId: reservation.requestId,
        model: reservation.model,
        status: "failed",
        inputTokens: 0,
        outputTokens: 0,
        errorCode: error instanceof ApiError ? error.code : "AI_PROVIDER_CHECK_FAILED",
      });
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
