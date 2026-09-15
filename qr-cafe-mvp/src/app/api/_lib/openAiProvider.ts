import { ApiError } from "@/app/api/_lib/storeAuth";
import type { AiFeature } from "@/app/api/_lib/aiExecution";

export type BriefProviderResult = {
  headline: string;
  summary: string;
  fact: string;
  hypothesis: string | null;
  recommendation: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 20_000;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function providerError(status: number, code?: string) {
  if (status === 401 || status === 403) return new ApiError(502, "AI 연결 권한을 확인하지 못했습니다.", "AI_PROVIDER_AUTH_FAILED");
  if (status === 429) return new ApiError(429, "AI 분석 요청이 잠시 많습니다. 잠시 후 다시 확인해 주세요.", "AI_PROVIDER_RATE_LIMITED");
  return new ApiError(502, "AI 분석을 준비하지 못했습니다. 잠시 후 다시 확인해 주세요.", code || "AI_PROVIDER_FAILED");
}

/**
 * Server-only OpenAI adapter. It accepts aggregate store metrics only; neither
 * customer, payment nor free-form order data is ever included in the prompt.
 */
export async function generateBriefWithOpenAi(params: {
  feature: AiFeature;
  model: string;
  periodLabel: string;
  orderCount: number;
  salesWon: number;
}): Promise<BriefProviderResult> {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key || process.env.AI_EXTERNAL_CALLS_ENABLED !== "true") {
    throw new ApiError(503, "AI 외부 분석은 아직 활성화되지 않았습니다.", "AI_PROVIDER_NOT_READY");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        // The response is only needed for the current server request. Keeping it
        // out of provider-side response storage also reduces retention surface.
        store: false,
        max_output_tokens: 350,
        input: [
          { role: "system", content: "You are RION Order's Korean store operations analyst. Use only supplied aggregate metrics. Never invent facts, never propose automatic changes, and return compact Korean JSON only." },
          { role: "user", content: `분석 기간: ${params.periodLabel}\n주문 건수: ${params.orderCount}\n매출 합계(원): ${params.salesWon}\n반환 JSON: {\"headline\":string,\"summary\":string,\"fact\":string,\"hypothesis\":string|null,\"recommendation\":string|null}. 사실과 추정을 분리하고, 데이터가 부족하면 hypothesis와 recommendation은 null.` },
        ],
      }),
    });
    if (!response.ok) throw providerError(response.status, `AI_PROVIDER_HTTP_${response.status}`);
    const body = await response.json() as { output_text?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { cached_tokens?: unknown } } };
    const raw = text(body.output_text, 3_000).replace(/^```json\s*|\s*```$/g, "");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { throw new ApiError(502, "AI 분석 응답을 확인하지 못했습니다.", "AI_PROVIDER_RESPONSE_INVALID"); }
    const headline = text(parsed.headline, 90);
    const summary = text(parsed.summary, 300);
    const fact = text(parsed.fact, 300);
    if (!headline || !summary || !fact) throw new ApiError(502, "AI 분석 응답이 불완전합니다.", "AI_PROVIDER_RESPONSE_INVALID");
    return {
      headline, summary, fact,
      hypothesis: text(parsed.hypothesis, 300) || null,
      recommendation: text(parsed.recommendation, 300) || null,
      inputTokens: Number(body.usage?.input_tokens || 0),
      outputTokens: Number(body.usage?.output_tokens || 0),
      cachedInputTokens: Number(body.usage?.input_tokens_details?.cached_tokens || 0),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(504, "AI 분석 시간이 초과되었습니다.", "AI_PROVIDER_TIMEOUT");
    throw providerError(502, "AI_PROVIDER_NETWORK_FAILED");
  } finally { clearTimeout(timer); }
}
