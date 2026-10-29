import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { menuSetupRouteEnabled, menuSetupOriginAllowed, menuSetupStoreAllowed, type MenuSetupScope } from "../menuSetupAccess";
import { ApiError, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";
import { buildAdminPlan } from "@/app/preview/menu-setup/adminPlan";

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const tables = [
  ["menu_categories", "id,store_id,name,sort_order,is_active"],
  ["menu_items", "id,store_id,name,price,image,category_id,option_group_ids,option_not_required,is_sold_out,sort_order"],
  ["option_groups", "id,store_id,name,required,min,max,scope,linked_menu_id,sort_order"],
  ["option_items", "id,store_id,group_id,name,price_delta"],
  ["menu_option_prices", "store_id,menu_id,option_item_id,price_delta"],
  ["menu_option_item_exclusions", "store_id,menu_id,option_item_id"],
] as const;

export function createMenuSetupCompatibility(scope: MenuSetupScope) {
return async function POST(req: NextRequest) {
  try {
    if (!menuSetupRouteEnabled(scope)) return reply({ ok: false }, 404);
    if (!menuSetupOriginAllowed(req, scope)) throw new ApiError(403, "허용되지 않은 요청입니다.");
    if (!req.body) throw new ApiError(400, "초안이 없습니다.");
    const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError(413, "초안이 너무 큽니다."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: { storeId?: unknown; draft?: unknown; confirmed?: unknown };
    try {
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { throw new ApiError(400, "요청 형식을 확인해주세요."); }
    const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
    if (!storeId || storeId.length > 200 || body.confirmed !== true) throw new ApiError(400, "매장과 최종 확인을 확인해주세요.");
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    if (!menuSetupStoreAllowed(storeId)) throw new ApiError(403, "이 매장은 아직 AI 메뉴 설정 대상이 아닙니다.");
    let plan;
    try { plan = buildAdminPlan(body.draft, storeId, randomUUID); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "초안을 확인해주세요."); }
    const store = await admin.from("stores").select("store_id,setup_completed").eq("store_id", storeId).maybeSingle();
    if (store.error || !store.data) throw new ApiError(409, "매장 설정을 확인하지 못했습니다. 저장은 진행하지 않습니다.");
    const checks = await Promise.all(tables.map(async ([table, columns]) => {
      const result = await admin.from(table).select(columns, { head: true, count: "exact" }).eq("store_id", storeId);
      if (result.error || result.count === null || result.count === undefined) throw new ApiError(409, "관리자 DB 호환성을 확인하지 못했습니다. 기존 설정은 변경하지 않았습니다.");
      return result.count;
    }));
    const blocked = !!store.data.setup_completed || checks.some((count) => count > 0);
    return reply({ ok: true, compatible: !blocked,
      message: blocked ? "기존 설정이 있는 매장입니다. 덮어쓰기를 막기 위해 등록 연결을 차단했습니다."
        : "관리자 데이터 형식과 빈 매장 조건을 확인했습니다. 등록 버튼을 눌러야 실제 저장됩니다.",
      summary: { categories: plan.categoryRows.length, menus: plan.menuRows.length, groups: plan.groupRows.length, heldMenus: plan.heldMenus },
      deferredGroups: plan.deferredGroups,
    });
  } catch (error) {
    const safe = error instanceof ApiError ? error : new ApiError(500, "연결 점검에 실패했습니다. 기존 설정은 변경하지 않았습니다.");
    return reply({ ok: false, message: safe.message }, safe.status);
  }
}

}
