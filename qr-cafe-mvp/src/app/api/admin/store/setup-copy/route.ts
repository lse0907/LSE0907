import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  createRequestSupabaseClient,
  createSupabaseAdminClient,
  requireStoreRole,
} from "../../../_lib/storeAuth";
import { recordSecurityEvent } from "../../members/_lib";

type CopyKind = "categories" | "menus" | "options";

type CopyBody = {
  kind?: string;
  sourceStoreId?: string;
  targetStoreId?: string;
};

const functionByKind: Record<CopyKind, string> = {
  categories: "admin_copy_categories_v1",
  menus: "admin_copy_menus_v1",
  options: "admin_copy_options_v1",
};

function isCopyKind(value: string): value is CopyKind {
  return value === "categories" || value === "menus" || value === "options";
}

function isLegacyRpcAuthError(message: string) {
  return message.includes("Authentication required") || message.includes("로그인이 필요합니다");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CopyBody;
    const kind = String(body.kind || "").trim();
    const sourceStoreId = String(body.sourceStoreId || "").trim();
    const targetStoreId = String(body.targetStoreId || "").trim();
    if (!isCopyKind(kind) || !sourceStoreId || !targetStoreId || sourceStoreId === targetStoreId) {
      throw new ApiError(400, "복사 종류와 원본·대상 매장을 확인해주세요.", "SETUP_COPY_INPUT_INVALID");
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const targetActor = await requireStoreRole({
      req,
      supabaseAdmin,
      storeId: targetStoreId,
      allowedRoles: ["owner", "manager"],
    });
    await requireStoreRole({
      req,
      supabaseAdmin,
      storeId: sourceStoreId,
      allowedRoles: ["owner", "manager"],
    });

    const args = { p_source_store_id: sourceStoreId, p_target_store_id: targetStoreId };
    const functionName = functionByKind[kind];
    let result = await supabaseAdmin.rpc(functionName, args);
    // Safe rollout compatibility; see the customer-search route.
    if (result.error && isLegacyRpcAuthError(result.error.message)) {
      result = await createRequestSupabaseClient(req).rpc(functionName, args);
    }
    if (result.error) {
      throw new ApiError(400, `설정 복사 실패: ${result.error.message}`, "SETUP_COPY_FAILED");
    }

    const copyResult = result.data && typeof result.data === "object" ? result.data : null;
    await recordSecurityEvent(supabaseAdmin, {
      storeId: targetStoreId,
      userId: targetActor.userId,
      eventType: "store_setup_copied",
      metadata: { kind, sourceStoreId, targetStoreId, result: copyResult },
    });

    return NextResponse.json({ ok: true, result: copyResult });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
