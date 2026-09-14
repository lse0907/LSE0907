import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { sendReadyOrderPush } from "../_lib/customerOrderPush";

type ReadyNotificationBody = {
  storeId?: unknown;
  orderId?: unknown;
};

function value(raw: unknown, max: number) {
  const result = String(raw || "").trim();
  return result.length > 0 && result.length <= max ? result : "";
}

/**
 * Idempotent recovery for a ready order whose initial delivery worker was
 * interrupted after the order state was saved. It never changes order state
 * and sendReadyOrderPush only targets subscriptions not marked as notified.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReadyNotificationBody;
    const storeId = value(body.storeId, 120);
    const orderId = value(body.orderId, 80);
    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, code: "MISSING_REQUIRED_FIELDS", message: "필수 정보가 없습니다." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager", "staff"] });
    const { data, error } = await admin
      .from("orders")
      .select("id,status,display_no")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, code: "ORDER_LOOKUP_FAILED", message: `주문 조회 실패: ${error.message}` }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다." }, { status: 404 });
    if (String(data.status || "") !== "ready_for_packing") {
      return NextResponse.json({ ok: true, skipped: "not_ready" });
    }

    const notification = await sendReadyOrderPush({
      admin,
      storeId,
      orderId,
      displayNo: String(data.display_no || ""),
    });
    return NextResponse.json({ ok: true, notification });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
