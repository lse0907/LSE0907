import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { storeId?: unknown; orderId?: unknown; reason?: unknown };
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    if (!storeId || !orderId) return NextResponse.json({ ok: false, message: "결제 준비 정보가 올바르지 않습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const attempt = await admin.from("billing_payment_attempts").select("id,payer_user_id,status").eq("store_id", storeId).eq("order_id", orderId).maybeSingle();
    if (attempt.error || !attempt.data) return NextResponse.json({ ok: true, released: false });
    if (attempt.data.payer_user_id !== userId) return NextResponse.json({ ok: false, message: "결제 요청자가 일치하지 않습니다." }, { status: 403 });
    if (["approved", "approved_not_applied", "applied"].includes(String(attempt.data.status))) {
      return NextResponse.json({ ok: true, released: false });
    }
    const released = await admin.rpc("release_billing_payment_attempt_v2", {
      p_attempt_id: Number(attempt.data.id),
      p_reason: String(body.reason || "결제창 취소").slice(0, 240),
    });
    if (released.error) throw new Error(`결제 예약 해제 실패: ${released.error.message}`);
    return NextResponse.json({ ok: true, released: true });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
