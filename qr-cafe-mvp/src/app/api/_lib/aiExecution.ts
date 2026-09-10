import { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/app/api/_lib/storeAuth";

export type AiFeature = "daily_brief" | "weekly_brief" | "monthly_brief" | "support_response" | "incident_analysis";

export const AI_PROVIDER = "openai" as const;

const MODEL_BY_FEATURE: Record<AiFeature, string> = {
  daily_brief: "gpt-5.6-luna",
  support_response: "gpt-5.6-luna",
  weekly_brief: "gpt-5.6-terra",
  monthly_brief: "gpt-5.6-terra",
  incident_analysis: "gpt-5.6-terra",
};

const USD_PER_MILLION: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
};

export function modelForAiFeature(feature: AiFeature) { return MODEL_BY_FEATURE[feature]; }

export function estimateAiCostUsd(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0) {
  const pricing = USD_PER_MILLION[model];
  if (!pricing) throw new ApiError(500, "허용되지 않은 AI 모델입니다.", "AI_MODEL_NOT_ALLOWED");
  const input = Math.max(0, inputTokens - cachedInputTokens);
  return Number(((input * pricing.input + Math.max(0, cachedInputTokens) * pricing.cachedInput + Math.max(0, outputTokens) * pricing.output) / 1_000_000).toFixed(6));
}

export function isExternalAiEnabled() {
  return process.env.AI_EXTERNAL_CALLS_ENABLED === "true" && Boolean((process.env.OPENAI_API_KEY || "").trim());
}

type Reservation = { event_id: number; allowed: boolean; block_code: string | null };

export async function reserveAiExecution(params: {
  admin: SupabaseClient;
  storeId: string;
  requestedByUserId: string | null;
  feature: AiFeature;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}) {
  const model = modelForAiFeature(params.feature);
  const requestId = crypto.randomUUID();
  const estimatedCostUsd = estimateAiCostUsd(model, params.estimatedInputTokens, params.estimatedOutputTokens);
  const { data, error } = await params.admin.rpc("ai_reserve_execution", {
    p_request_id: requestId,
    p_store_id: params.storeId,
    p_requested_by_user_id: params.requestedByUserId,
    p_feature: params.feature,
    p_provider: AI_PROVIDER,
    p_model: model,
    p_estimated_cost_usd: estimatedCostUsd,
  });
  if (error) throw new ApiError(500, "AI 사용 한도를 확인하지 못했습니다.", "AI_RESERVATION_FAILED");
  const row = Array.isArray(data) ? data[0] as Reservation | undefined : undefined;
  if (!row?.allowed) throw new ApiError(429, "현재 AI 분석을 준비할 수 없습니다. 잠시 후 다시 확인해 주세요.", row?.block_code || "AI_CALL_BLOCKED");
  return { requestId, model, estimatedCostUsd };
}

export async function finalizeAiExecution(params: {
  admin: SupabaseClient;
  requestId: string;
  model: string;
  status: "succeeded" | "failed";
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  errorCode?: string | null;
}) {
  const modelCost = params.status === "succeeded" ? estimateAiCostUsd(params.model, params.inputTokens, params.outputTokens, params.cachedInputTokens || 0) : 0;
  const { error } = await params.admin.rpc("ai_finalize_execution", {
    p_request_id: params.requestId,
    p_status: params.status,
    p_input_tokens: params.inputTokens,
    p_output_tokens: params.outputTokens,
    p_cached_input_tokens: params.cachedInputTokens || 0,
    p_actual_cost_usd: modelCost,
    p_error_code: params.errorCode || null,
  });
  if (error) throw new ApiError(500, "AI 사용 기록을 저장하지 못했습니다.", "AI_FINALIZE_FAILED");
}
