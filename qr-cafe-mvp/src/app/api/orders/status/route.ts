import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type StatusBody = {
  storeId?: string;
  orderId?: string;
  status?: OrderStatus;
  buzzerNo?: string | null;
  paymentStatus?: unknown;
  actorPinId?: string | null;
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StatusBody;
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, code: "MISSING_REQUIRED_FIELDS", message: "필수 정보가 없습니다." }, { status: 400 });
    }
    if (typeof body.paymentStatus !== "undefined") {
      return NextResponse.json(
        { ok: false, code: "PAYMENT_STATUS_SERVER_MANAGED", message: "온라인 결제상태는 결제 승인·취소 처리에서만 변경할 수 있습니다." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const auth = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id,status,store_id")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, code: "ORDER_LOOKUP_FAILED", message: `주문 조회 실패: ${error.message}` }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다." }, { status: 404 });

    const order = data as OrderRow;
    const currentStatus = normalizeStatus(order.status) || "new";
    if (currentStatus === "completed" || currentStatus === "cancelled") {
      return NextResponse.json({ ok: false, code: "ORDER_LOCKED", message: "이미 끝난 주문입니다." }, { status: 409 });
    }

    const payload: Record<string, unknown> = {};
    const nextStatus = normalizeStatus(body.status);
    if (nextStatus) {
      if (nextStatus === "cancelled") {
        return NextResponse.json({ ok: false, code: "USE_CANCEL_API", message: "취소 버튼을 사용해주세요." }, { status: 400 });
      }
      if (!ALLOWED_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
        return NextResponse.json({ ok: false, code: "INVALID_STATUS_FLOW", message: "이전 단계를 먼저 처리해주세요." }, { status: 409 });
      }
      payload.status = nextStatus;
    }

    if (typeof body.buzzerNo !== "undefined") payload.buzzer_no = String(body.buzzerNo || "").trim() || null;

    if (!Object.keys(payload).length) {
      return NextResponse.json({ ok: false, code: "NO_CHANGE", message: "변경할 내용이 없습니다." }, { status: 400 });
    }

    const updateRes = await supabaseAdmin.from("orders").update(payload).eq("id", orderId).eq("store_id", storeId);
    if (updateRes.error) return NextResponse.json({ ok: false, code: "ORDER_STATUS_UPDATE_FAILED", message: `저장 실패: ${updateRes.error.message}` }, { status: 500 });

    if (payload.status || typeof body.buzzerNo !== "undefined") {
      const eventRes = await supabaseAdmin.from("order_events").insert({
        store_id: storeId,
        order_id: orderId,
        event_type: payload.status ? "order_status_changed" : "order_updated",
        before_status: currentStatus,
        after_status: payload.status || currentStatus,
        actor_user_id: auth.userId,
        actor_pin_id: body.actorPinId || null,
        metadata: { patch: payload },
      });
      if (eventRes.error) console.warn("[order_events] insert skipped:", eventRes.error.message);
    }

    if (payload.status === "completed") {
      const { error: finalizeErr } = await supabaseAdmin.rpc("finalize_order_rewards", {
        p_store_id: storeId,
        p_order_id: orderId,
      });
      if (finalizeErr) return NextResponse.json({ ok: false, code: "REWARD_FINALIZE_FAILED", message: `보상 처리 실패: ${finalizeErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, patch: payload });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
