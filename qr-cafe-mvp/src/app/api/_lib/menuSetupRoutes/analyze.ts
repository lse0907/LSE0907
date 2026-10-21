import { NextRequest } from "next/server";
import { menuSetupRouteEnabled, menuSetupOriginAllowed, type MenuSetupScope } from "../menuSetupAccess";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";
import { finalizeAiExecution, isExternalAiEnabled, reserveAiExecution } from "@/app/api/_lib/aiExecution";
import { OpenAiProviderError } from "@/app/api/_lib/openAiProvider";
import { generateMenuSetup } from "@/app/api/_lib/menuSetupProvider";
import { MAX_OUTPUT_TOKENS, MAX_REQUEST_BYTES, validateSources } from "@/app/preview/menu-setup/analysisContract";

function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
async function readBody(req: NextRequest) {
  if (!req.body) throw new ApiError(400, "첨부 자료가 없습니다.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_REQUEST_BYTES + 65536) { await reader.cancel(); throw new ApiError(413, "자료가 너무 큽니다. 나누어 첨부해주세요."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  }
  catch { throw new ApiError(400, "요청 형식을 확인해주세요."); }
}
export function createMenuSetupAnalyze(scope: MenuSetupScope) {
return async function POST(req: NextRequest) {
  try {
    if (!menuSetupRouteEnabled(scope)) return reply({ ok: false }, 404);
    if (!menuSetupOriginAllowed(req, scope)) throw new ApiError(403, "허용되지 않은 요청입니다.");
    if (!isExternalAiEnabled() || process.env.MENU_SETUP_ANALYSIS_ENABLED !== "true") throw new ApiError(503, "AI 분석 기능이 준비되지 않았습니다. API 키·메뉴 분석 활성화·사용 한도 설정을 확인해주세요.", "MENU_AI_NOT_READY");
    const body = await readBody(req);
    if (body.confirmExternalProcessing !== true) throw new ApiError(400, "AI 분석을 위한 첨부 자료 전송을 확인해주세요.");
    let sources;
    try { sources = validateSources(body.sources); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "첨부 형식을 확인해주세요."); }
    const admin = createSupabaseAdminClient();
    const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    // New feature must be registered in the database capability allowlist first.
    // A missing policy/reservation fails closed; never reuse another feature's quota.
    const reservation = await reserveAiExecution({ admin, storeId, requestedByUserId: actor.userId, feature: "menu_setup",
      estimatedInputTokens: sources.reduce((sum, source) => sum + (source.kind === "image" ? 20000 : source.content.length), 2000), estimatedOutputTokens: MAX_OUTPUT_TOKENS });
    let result;
    try { result = await generateMenuSetup(sources, reservation.model); }
    catch (error) {
      const usage = error instanceof OpenAiProviderError ? error.usage : { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      await finalizeAiExecution({ admin, requestId: reservation.requestId, model: reservation.model, status: "failed", ...usage, errorCode: "MENU_AI_FAILED" });
      throw error;
    }
    await finalizeAiExecution({ admin, requestId: reservation.requestId, model: reservation.model, status: "succeeded", inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens });
    return reply({ ok: true, draft: result.draft });
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(500, "분석 연결을 확인해주세요.", "MENU_AI_FAILED");
    const response = apiErrorResponse(safe); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}

}
