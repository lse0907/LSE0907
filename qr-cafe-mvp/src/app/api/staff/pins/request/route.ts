import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";
import { makePinHash, normalizePinRole, recordSecurityEvent } from "../../../admin/members/_lib";

function validatePin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

type Body = { storeId?: string; displayName?: string; contactHint?: string; pin?: string; requestedRole?: "staff" | "manager" };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const displayName = String(body.displayName || "").trim();
    const contactHint = String(body.contactHint || "").trim().slice(0, 80);
    const pin = String(body.pin || "").trim();
    const requestedRole = normalizePinRole(body.requestedRole);

    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });
    if (!displayName || !validatePin(pin)) {
      return NextResponse.json({ ok: false, message: "이름과 4~8자리 숫자 PIN이 필요합니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data: duplicate, error: duplicateErr } = await supabaseAdmin
      .from("store_staff_pins")
      .select("id,approval_status,is_active")
      .eq("store_id", storeId)
      .eq("display_name", displayName)
      .in("approval_status", ["pending", "approved"])
      .limit(1);
    if (duplicateErr && duplicateErr.code !== "42703") {
      return NextResponse.json({ ok: false, message: `PIN 중복 확인 실패: ${duplicateErr.message}` }, { status: 500 });
    }
    if ((duplicate || []).length > 0) {
      return NextResponse.json({ ok: false, message: "같은 이름의 승인대기/사용중 PIN이 이미 있습니다. 이름 뒤에 구분 문구를 추가해주세요." }, { status: 409 });
    }

    const { data, error } = await supabaseAdmin
      .from("store_staff_pins")
      .insert({
        store_id: storeId,
        display_name: displayName,
        contact_hint: contactHint || null,
        pin_role: requestedRole,
        pin_hash: makePinHash(pin),
        approval_status: "pending",
        is_active: false,
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ ok: false, message: `PIN 등록 요청 실패: ${error.message}` }, { status: 500 });
    await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "pin_requested", metadata: { pinId: data?.id, displayName, requestedRole, hasContactHint: !!contactHint } });
    return NextResponse.json({ ok: true, pinId: data?.id });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
