import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { menuSetupRouteEnabled, menuSetupOriginAllowed, type MenuSetupScope } from "../menuSetupAccess";
import { ApiError, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";
import { buildAdminPlan } from "@/app/preview/menu-setup/adminPlan";
import { isDraft } from "@/app/preview/menu-setup/draftStorage";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function createMenuSetupRegister(scope: MenuSetupScope) {
return async function POST(req: NextRequest) {
  let rpcStarted = false, definiteFailure = false;
  try {
    if (!menuSetupRouteEnabled(scope)) return reply({ ok: false }, 404);
    if (process.env.MENU_SETUP_REGISTRATION_ENABLED !== "true") throw new ApiError(503, "실제 메뉴 저장은 아직 활성화하지 않았습니다.");
    if (!menuSetupOriginAllowed(req, scope)) throw new ApiError(403, "허용되지 않은 요청입니다.");
    if (!req.body) throw new ApiError(400, "초안이 없습니다.");
    const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError(413, "초안이 너무 큽니다."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch { throw new ApiError(400, "요청 형식을 확인해주세요."); }
    const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!storeId || storeId.length > 200 || body.confirmed !== true || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) throw new ApiError(400, "대상 매장과 최종 확인을 확인해주세요.");
    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    if (!isDraft(body.draft) || body.draft.source !== "ai" || body.draft.notes?.some((note) => note.startsWith("검증용 가상 예시"))) throw new ApiError(400, "가상 예시는 실제 등록할 수 없습니다. 분석한 초안을 사용해주세요.");
    let plan;
    try { plan = buildAdminPlan(body.draft, storeId, randomUUID); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "초안을 확인해주세요."); }
    // Hash the reviewed draft, NOT the randomized row IDs. Same request+draft can
    // recover a committed result after a lost response without rewriting later edits.
    const fingerprint = createHash("sha256").update(JSON.stringify(body.draft)).digest("hex");
    rpcStarted = true;
    const saved = await admin.rpc("admin_import_menu_setup_v1", { p_store_id: storeId, p_actor_id: actor.userId,
      p_request_id: requestId, p_draft_hash: fingerprint, p_plan: plan });
    if (saved.error) {
      const code = String(saved.error.code || ""), message = String(saved.error.message || "");
      definiteFailure = ["PGRST202", "42883", "42501", "P0001", "55P03", "40P01", "57014", "23502", "23503", "23505", "23514", "22003", "22023", "22P02"].includes(code);
      if (["PGRST202", "42883"].includes(code)) throw new ApiError(503, "메뉴 저장용 DB 호환 변경을 먼저 적용해야 합니다.");
      if (code === "42501") throw new ApiError(403, "현재 매장의 소유자 권한을 다시 확인해주세요.");
      if (/MENU_SETUP_(TARGET_NOT_EMPTY|ALREADY_IMPORTED)/.test(message)) throw new ApiError(409, "기존 설정 또는 등록 이력이 있어 새로 저장하지 않았습니다. 관리자 메뉴를 확인해주세요.");
      if (message.includes("MENU_SETUP_STORE_UNAVAILABLE")) throw new ApiError(409, "현재 이용할 수 없는 매장입니다.");
      if (["55P03", "40P01", "57014"].includes(code)) throw new ApiError(409, "다른 설정 작업과 겹쳐 이번 저장은 취소됐습니다. 잠시 후 같은 요청으로 다시 확인해주세요.");
      if (definiteFailure) throw new ApiError(409, "메뉴 저장에 실패해 이번 변경은 모두 취소됐습니다. 초안과 기존 설정을 확인해주세요.");
      // A transport error can be returned as saved.error even after DB commit.
      // Never claim rollback or discard the request ID without a definite SQL failure.
      throw new ApiError(502, "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.");
    }
    const result = saved.data;
    if (!result || result.storeId !== storeId || !Number.isInteger(result.menus) || result.menus < 1) throw new ApiError(502, "저장 결과를 확인하지 못했습니다. 관리자에서 확인하거나 같은 요청으로 다시 확인해주세요.");
    return reply({ ok: true, result });
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(502, "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.");
    return reply({ ok: false, message: safe.message, notSaved: !rpcStarted || definiteFailure }, safe.status);
  }
}

}
