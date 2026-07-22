import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";
import { makePinHash, normalizePinRole, recordSecurityEvent } from "../_lib";

type Body = { storeId?: string; displayName?: string; pin?: string; pinRole?: "staff" | "manager"; pinId?: string; action?: "create" | "disable" | "reset" | "enable" };

function validatePin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const action = body.action || "create";
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    if (action === "disable" || action === "enable") {
      const pinId = String(body.pinId || "").trim();
      if (!pinId) return NextResponse.json({ ok: false, message: "PIN ID가 필요합니다." }, { status: 400 });
      const patch = action === "disable" ? { is_active: false, disabled_at: new Date().toISOString() } : { is_active: true, disabled_at: null };
      const { error } = await supabaseAdmin.from("store_staff_pins").update(patch).eq("id", pinId).eq("store_id", storeId);
      if (error) return NextResponse.json({ ok: false, message: `PIN 상태 변경 실패: ${error.message}` }, { status: 500 });
      await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: `pin_${action}`, metadata: { pinId } });
      return NextResponse.json({ ok: true });
    }

    const displayName = String(body.displayName || "").trim();
    const pin = String(body.pin || "").trim();
    const pinRole = normalizePinRole(body.pinRole);
    if (!displayName || !validatePin(pin)) {
      return NextResponse.json({ ok: false, message: "이름과 4~8자리 숫자 PIN이 필요합니다." }, { status: 400 });
    }

    if (action === "reset") {
      const pinId = String(body.pinId || "").trim();
      if (!pinId) return NextResponse.json({ ok: false, message: "PIN ID가 필요합니다." }, { status: 400 });
      const { error } = await supabaseAdmin.from("store_staff_pins").update({ pin_hash: makePinHash(pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", pinId).eq("store_id", storeId);
      if (error) return NextResponse.json({ ok: false, message: `PIN 재설정 실패: ${error.message}` }, { status: 500 });
      await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_reset", metadata: { pinId } });
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabaseAdmin.from("store_staff_pins").insert({ store_id: storeId, display_name: displayName, pin_role: pinRole, pin_hash: makePinHash(pin), is_active: true });
    if (error) return NextResponse.json({ ok: false, message: `PIN 생성 실패: ${error.message}` }, { status: 500 });
    await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_created", metadata: { displayName, pinRole } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
