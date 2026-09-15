import { NextRequest } from "next/server";

import { finalizeAiExecution, reserveAiExecution } from "@/app/api/_lib/aiExecution";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

type Scenario = "auth" | "rate_limit" | "timeout";

const SCENARIOS: Record<Scenario, { code: string }> = {
  auth: { code: "AI_PROVIDER_AUTH_FAILED" },
  rate_limit: { code: "AI_PROVIDER_RATE_LIMITED" },
  timeout: { code: "AI_PROVIDER_TIMEOUT" },
};

function privateResponse(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function failureResponse(error: unknown) {
  const response = apiErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Preview-only, master-only AI failure ledger check. It never calls OpenAI and
 * exists solely to verify the application's failure finalization path before a
 * beta rollout. Production and ordinary Preview deployments cannot use it.
 */
export async function POST(req: NextRequest) {
  try {
    if (
      process.env.VERCEL_ENV !== "preview" ||
      process.env.AI_PROVIDER_PREVIEW_FAILURE_TESTS !== "true"
    ) {
      throw new ApiError(404, "검증 경로를 찾을 수 없습니다.", "NOT_FOUND");
    }
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const storeId = String(body.storeId || "").trim();
    const scenario = String(body.scenario || "") as Scenario;
    if (!storeId || !SCENARIOS[scenario]) throw new ApiError(400, "검증 조건을 확인해 주세요.", "AI_FAILURE_SCENARIO_INVALID");

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
    const simulated = SCENARIOS[scenario];
    await finalizeAiExecution({
      admin,
      requestId: reservation.requestId,
      model: reservation.model,
      status: "failed",
      inputTokens: 0,
      outputTokens: 0,
      errorCode: simulated.code,
    });

    return privateResponse({
      ok: true,
      simulated: true,
      scenario,
      errorCode: simulated.code,
      actualCostUsd: 0,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
