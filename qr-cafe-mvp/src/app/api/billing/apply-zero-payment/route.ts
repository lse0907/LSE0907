import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type Body = { storeId?: unknown; orderId?: unknown };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, message: "결제 준비 정보가 올바르지 않습니다." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const attemptRes = await admin
      .from("billing_payment_attempts")
      .select("id,payer_user_id,external_amount_krw,status")
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .maybeSingle();
    if (attemptRes.error || !attemptRes.data) {
      return NextResponse.json({ ok: false, message: "결제 준비 정보를 찾지 못했습니다." }, { status: 404 });
    }
    if (attemptRes.data.payer_user_id !== userId) {
      return NextResponse.json({ ok: false, message: "결제 요청자가 일치하지 않습니다." }, { status: 403 });
    }
    if (Number(attemptRes.data.external_amount_krw) !== 0 || !["credit_ready", "applied"].includes(String(attemptRes.data.status))) {
      return NextResponse.json({ ok: false, message: "0원 결제로 처리할 수 없는 요청입니다." }, { status: 409 });
    }
    if (attemptRes.data.status === "applied") return NextResponse.json({ ok: true, alreadyApplied: true });

    const applied = await admin.rpc("apply_billing_payment_attempt", { p_attempt_id: Number(attemptRes.data.id) });
    if (applied.error) {
      return NextResponse.json({ ok: false, message: "크레딧 결제를 구독에 반영하지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, billingPayment: applied.data });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
