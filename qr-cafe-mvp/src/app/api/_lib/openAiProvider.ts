import { ApiError } from "@/app/api/_lib/storeAuth";
import type { AiFeature } from "@/app/api/_lib/aiExecution";

export type BriefProviderResult = {
  headline: string;
  summary: string;
  hypothesis: string | null;
  recommendation: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 20_000;

type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

type OpenAiResponseBody = {
  output_text?: unknown;
  output?: unknown;
  status?: unknown;
  error?: { code?: unknown } | null;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: { cached_tokens?: unknown };
  };
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function usageFrom(body: OpenAiResponseBody): ProviderUsage {
  return {
    inputTokens: number(body.usage?.input_tokens),
    outputTokens: number(body.usage?.output_tokens),
    cachedInputTokens: number(body.usage?.input_tokens_details?.cached_tokens),
  };
}

function outputTextFrom(body: OpenAiResponseBody) {
  const direct = text(body.output_text, 3_000);
  if (direct) return direct;
  if (!Array.isArray(body.output)) return "";

  return text(body.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.map((part) => part && typeof part === "object" ? (part as { text?: unknown }).text : "");
  }).filter((value): value is string => typeof value === "string").join("\n"), 3_000);
}

export class OpenAiProviderError extends ApiError {
  usage: ProviderUsage;

  constructor(status: number, message: string, code: string, usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }) {
    super(status, message, code);
    this.usage = usage;
  }
}

const BRIEF_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    hypothesis: { type: ["string", "null"] },
    recommendation: { type: ["string", "null"] },
  },
  required: ["headline", "summary", "hypothesis", "recommendation"],
} as const;

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
        text: {
          format: {
            type: "json_schema",
            name: "rion_brief",
            strict: true,
            schema: BRIEF_RESPONSE_SCHEMA,
          },
          verbosity: "low",
        },
        input: [
          { role: "system", content: "You are RION Order's Korean store operations analyst. Use only supplied aggregate metrics. Never invent facts, never propose automatic changes, and return compact Korean JSON only." },
          { role: "user", content: `분석 기간: ${params.periodLabel}\n주문 건수: ${params.orderCount}\n매출 합계(원): ${params.salesWon}\n반환 JSON: {\"headline\":string,\"summary\":string,\"hypothesis\":string|null,\"recommendation\":string|null}. 제공된 집계 외의 수치나 사실을 만들지 말고, 추정은 hypothesis에만 쓰세요. 데이터가 부족하면 hypothesis와 recommendation은 null.` },
        ],
      }),
    });
    if (!response.ok) throw providerError(response.status, `AI_PROVIDER_HTTP_${response.status}`);
    const body = await response.json() as OpenAiResponseBody;
    const usage = usageFrom(body);
    const responseStatus = text(body.status, 32);
    if (responseStatus && responseStatus !== "completed") {
      throw new OpenAiProviderError(502, "AI 분석 응답을 완료하지 못했습니다.", text(body.error?.code, 80) || "AI_PROVIDER_INCOMPLETE", usage);
    }
    const raw = outputTextFrom(body).replace(/^```json\s*|\s*```$/g, "");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { throw new OpenAiProviderError(502, "AI 분석 응답을 확인하지 못했습니다.", "AI_PROVIDER_RESPONSE_INVALID", usage); }
    const headline = text(parsed.headline, 90);
    const summary = text(parsed.summary, 300);
    if (!headline || !summary) throw new OpenAiProviderError(502, "AI 분석 응답이 불완전합니다.", "AI_PROVIDER_RESPONSE_INVALID", usage);
    return {
      headline, summary,
      hypothesis: text(parsed.hypothesis, 300) || null,
      recommendation: text(parsed.recommendation, 300) || null,
      ...usage,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(504, "AI 분석 시간이 초과되었습니다.", "AI_PROVIDER_TIMEOUT");
    throw providerError(502, "AI_PROVIDER_NETWORK_FAILED");
  } finally { clearTimeout(timer); }
}
