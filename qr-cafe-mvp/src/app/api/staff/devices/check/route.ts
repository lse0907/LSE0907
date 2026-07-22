import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, normalizeRole, requireStoreRole } from "../../../_lib/storeAuth";
import { hashDeviceFingerprint, recordSecurityEvent } from "../../../admin/members/_lib";

type Body = { storeId?: string; fingerprint?: string; deviceName?: string; deviceType?: string; browser?: string; os?: string };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const fingerprint = String(body.fingerprint || "").trim();
    if (!storeId || !fingerprint) return NextResponse.json({ ok: false, message: "매장/기기 정보가 필요합니다." }, { status: 400 });

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });
    if (actor.role === "owner") return NextResponse.json({ ok: true, status: "owner_bypass" });

    const fingerprintHash = hashDeviceFingerprint(fingerprint);
    const { data, error } = await supabaseAdmin
      .from("store_devices")
      .select("id,status,device_name")
      .eq("store_id", storeId)
      .eq("user_id", actor.userId)
      .eq("device_fingerprint_hash", fingerprintHash)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: true, status: "setup_required", message: error.message });

    if (!data) {
      const ins = await supabaseAdmin.from("store_devices").insert({
        store_id: storeId,
        user_id: actor.userId,
        device_fingerprint_hash: fingerprintHash,
        device_name: String(body.deviceName || "새 기기").trim() || "새 기기",
        device_type: String(body.deviceType || "web").trim(),
        browser: String(body.browser || "").trim() || null,
        os: String(body.os || "").trim() || null,
        status: "pending",
      }).select("id,status,device_name").single();
      if (ins.error) return NextResponse.json({ ok: true, status: "setup_required", message: ins.error.message });
      await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, deviceId: ins.data.id, eventType: "device_requested", metadata: { role: normalizeRole(actor.role) } });
      return NextResponse.json({ ok: true, status: "pending", device: ins.data });
    }

    if (data.status === "approved") {
      await supabaseAdmin.from("store_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
    }
    return NextResponse.json({ ok: true, status: data.status, device: data });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
