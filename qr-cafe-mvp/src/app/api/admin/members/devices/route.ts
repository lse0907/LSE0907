import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";
import { recordSecurityEvent } from "../_lib";

type Body = { storeId?: string; deviceId?: string; action?: "approve" | "reject" | "disable"; deviceName?: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const deviceId = String(body.deviceId || "").trim();
    const action = body.action || "approve";
    if (!storeId || !deviceId) return NextResponse.json({ ok: false, message: "매장/기기 정보가 필요합니다." }, { status: 400 });

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const patch: Record<string, unknown> = { status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "disabled" };
    if (action === "approve") {
      patch.approved_by = actor.userId;
      patch.approved_at = new Date().toISOString();
      if (body.deviceName) patch.device_name = String(body.deviceName).trim();
    }
    if (action === "disable") patch.disabled_at = new Date().toISOString();

    const { error } = await supabaseAdmin.from("store_devices").update(patch).eq("id", deviceId).eq("store_id", storeId);
    if (error) return NextResponse.json({ ok: false, message: `기기 상태 변경 실패: ${error.message}` }, { status: 500 });

    await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, deviceId, eventType: `device_${action}` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
