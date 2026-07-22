import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";
import { recordSecurityEvent, verifyPinHash } from "../../../admin/members/_lib";

type Body = { storeId?: string; pin?: string; requiredRole?: "staff" | "manager" };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const pin = String(body.pin || "").trim();
    const requiredRole = body.requiredRole === "manager" ? "manager" : "staff";
    if (!storeId || !pin) return NextResponse.json({ ok: false, message: "매장/PIN 정보가 필요합니다." }, { status: 400 });

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data, error } = await supabaseAdmin
      .from("store_staff_pins")
      .select("id,display_name,pin_role,pin_hash,is_active,failed_attempts,locked_until,approval_status")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .eq("approval_status", "approved");
    if (error) return NextResponse.json({ ok: false, message: `PIN 조회 실패: ${error.message}` }, { status: 500 });

    const now = Date.now();
    for (const row of data || []) {
      const lockedUntil = String(row.locked_until || "").trim();
      if (lockedUntil && new Date(lockedUntil).getTime() > now) continue;
      if (!verifyPinHash(pin, String(row.pin_hash || ""))) continue;
      const pinRole = String(row.pin_role || "staff") === "manager" ? "manager" : "staff";
      if (requiredRole === "manager" && pinRole !== "manager") {
        await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_role_denied", metadata: { pinId: row.id, requiredRole } });
        return NextResponse.json({ ok: false, message: "매니저 PIN이 필요합니다." }, { status: 403 });
      }
      await supabaseAdmin.from("store_staff_pins").update({ failed_attempts: 0, locked_until: null, last_used_at: new Date().toISOString() }).eq("id", row.id);
      await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_verified", metadata: { pinId: row.id, pinRole } });
      return NextResponse.json({ ok: true, pin: { id: row.id, displayName: row.display_name, pinRole } });
    }

    await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_failed" });
    return NextResponse.json({ ok: false, message: "PIN이 올바르지 않습니다." }, { status: 403 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
