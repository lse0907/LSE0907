import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type PaymentStatus = "not_required" | "pending" | "paid";

type StatusBody = {
  storeId?: string;
  orderId?: string;
  status?: OrderStatus;
  buzzerNo?: string | null;
  paymentStatus?: PaymentStatus;
};

type OrderRow = {
  id: string;
  status: string | null;
  store_id: string | null;
};

const ALLOWED_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["checked"],
  checked: ["making", "ready_for_packing"],
  making: ["ready_for_packing"],
  ready_for_packing: ["completed"],
  completed: [],
  cancelled: [],
};

function normalizeStatus(raw: unknown): OrderStatus | null {
  const status = String(raw || "").trim();
  if (status === "new" || status === "checked" || status === "making" || status === "ready_for_packing" || status === "completed" || status === "cancelled") return status;
  return null;
}

function normalizePaymentStatus(raw: unknown): PaymentStatus | null {
  const status = String(raw || "").trim();
  if (status === "not_required" || status === "pending" || status === "paid") return status;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StatusBody;
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, message: "필수 파라미터(storeId, orderId)가 누락되었습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id,status,store_id")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, message: `주문 조회 실패: ${error.message}` }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, message: "주문을 찾을 수 없습니다." }, { status: 404 });

    const order = data as OrderRow;
    const currentStatus = normalizeStatus(order.status) || "new";
    if (currentStatus === "completed" || currentStatus === "cancelled") {
      return NextResponse.json({ ok: false, message: "완료/취소 주문은 변경할 수 없습니다." }, { status: 409 });
    }

    const payload: Record<string, unknown> = {};
    const nextStatus = normalizeStatus(body.status);
    if (nextStatus) {
      if (nextStatus === "cancelled") {
        return NextResponse.json({ ok: false, message: "주문 취소는 취소 API를 사용해주세요." }, { status: 400 });
      }
      if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
        return NextResponse.json({ ok: false, message: `허용되지 않는 상태 변경입니다. (${currentStatus} → ${nextStatus})` }, { status: 409 });
      }
      payload.status = nextStatus;
    }

    if (typeof body.buzzerNo !== "undefined") payload.buzzer_no = String(body.buzzerNo || "").trim() || null;

    const paymentStatus = normalizePaymentStatus(body.paymentStatus);
    if (paymentStatus) payload.payment_status = paymentStatus;

    if (!Object.keys(payload).length) {
      return NextResponse.json({ ok: false, message: "변경할 값이 없습니다." }, { status: 400 });
    }

    const updateRes = await supabaseAdmin.from("orders").update(payload).eq("id", orderId).eq("store_id", storeId);
    if (updateRes.error) return NextResponse.json({ ok: false, message: `주문 상태 업데이트 실패: ${updateRes.error.message}` }, { status: 500 });

    if (payload.status === "completed") {
      const { error: finalizeErr } = await supabaseAdmin.rpc("finalize_order_rewards", {
        p_store_id: storeId,
        p_order_id: orderId,
      });
      if (finalizeErr) return NextResponse.json({ ok: false, message: `보상 확정 처리 실패: ${finalizeErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, patch: payload });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
