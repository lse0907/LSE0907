import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { sendReadyOrderPush } from "../_lib/customerOrderPush";

type StationReadyBody = {
  storeId?: unknown;
  orderId?: unknown;
  actorPinId?: unknown;
};

type OrderRow = {
  id: string;
  status: string | null;
  display_no: string | null;
};

function value(raw: unknown, max: number) {
  const result = String(raw || "").trim();
  return result.length > 0 && result.length <= max ? result : "";
}

/**
 * The station workflow has a distinct safety boundary: a customer is notified
 * only after every menu item is complete and every item has been checked for
 * handoff. This endpoint deliberately re-reads those facts on the server;
 * the client-side disabled button is only a convenience, never the authority.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StationReadyBody;
    const storeId = value(body.storeId, 120);
    const orderId = value(body.orderId, 80);
    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, code: "MISSING_REQUIRED_FIELDS", message: "필수 정보가 없습니다." }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const auth = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager", "staff"] });
    const { data: orderData, error: orderError } = await admin
      .from("orders")
      .select("id,status,display_no")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (orderError) return NextResponse.json({ ok: false, code: "ORDER_LOOKUP_FAILED", message: `주문 조회 실패: ${orderError.message}` }, { status: 500 });
    if (!orderData) return NextResponse.json({ ok: false, code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다." }, { status: 404 });

    const order = orderData as OrderRow;
    const currentStatus = String(order.status || "new");
    if (currentStatus === "ready_for_packing") {
      const notification = await sendReadyOrderPush({ admin, storeId, orderId, displayNo: String(order.display_no || "") });
      return NextResponse.json({ ok: true, status: "ready_for_packing", alreadyReady: true, notification });
    }
    if (currentStatus !== "checked" && currentStatus !== "making") {
      return NextResponse.json({ ok: false, code: "INVALID_STATUS_FLOW", message: "현재 주문은 준비 완료 처리할 수 없습니다." }, { status: 409 });
    }

    const { data: itemData, error: itemError } = await admin
      .from("order_items")
      .select("id,status")
      .eq("store_id", storeId)
      .eq("order_id", orderId);
    if (itemError) return NextResponse.json({ ok: false, code: "ORDER_ITEMS_LOOKUP_FAILED", message: `주문 메뉴 조회 실패: ${itemError.message}` }, { status: 500 });
    const items = Array.isArray(itemData) ? itemData : [];
    if (!items.length || items.some((item) => String(item.status || "") !== "done")) {
      return NextResponse.json({ ok: false, code: "ITEMS_NOT_COMPLETE", message: "모든 메뉴가 제조 완료되어야 준비 완료 처리할 수 있습니다." }, { status: 409 });
    }

    const itemIds = items.map((item) => String(item.id));
    const { data: checkData, error: checkError } = await admin
      .from("order_item_packing_checks")
      .select("order_item_id,checked")
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .in("order_item_id", itemIds);
    if (checkError) return NextResponse.json({ ok: false, code: "PACKING_CHECK_LOOKUP_FAILED", message: `준비 확인 조회 실패: ${checkError.message}` }, { status: 500 });
    const checkedItemIds = new Set(
      (Array.isArray(checkData) ? checkData : [])
        .filter((check) => Boolean(check.checked))
        .map((check) => String(check.order_item_id || "")),
    );
    if (checkedItemIds.size !== itemIds.length || itemIds.some((itemId) => !checkedItemIds.has(itemId))) {
      return NextResponse.json({ ok: false, code: "PACKING_CHECK_REQUIRED", message: "모든 메뉴를 준비 확인한 뒤 고객에게 알릴 수 있습니다." }, { status: 409 });
    }

    // Conditional update prevents a second staff screen from emitting another
    // ready transition after this screen has already changed the order.
    const { data: updated, error: updateError } = await admin
      .from("orders")
      .update({ status: "ready_for_packing" })
      .eq("id", orderId)
      .eq("store_id", storeId)
      .eq("status", currentStatus)
      .select("id")
      .maybeSingle();
    if (updateError) return NextResponse.json({ ok: false, code: "ORDER_STATUS_UPDATE_FAILED", message: `준비 완료 저장 실패: ${updateError.message}` }, { status: 500 });
    if (!updated) return NextResponse.json({ ok: false, code: "ORDER_CHANGED", message: "다른 화면에서 주문 상태가 변경되었습니다. 새로고침 후 확인해 주세요." }, { status: 409 });

    const actorPinId = value(body.actorPinId, 80) || null;
    let pushResult: { sent: number; skipped: string | null } | null = null;
    try {
      pushResult = await sendReadyOrderPush({ admin, storeId, orderId, displayNo: String(order.display_no || "") });
    } catch (pushError: unknown) {
      // Staff confirmation is durable; notification delivery is recorded and
      // must never undo the order state if a device is temporarily offline.
      console.error("[station-ready] customer push delivery failed", pushError);
    }

    const eventRes = await admin.from("order_events").insert({
      store_id: storeId,
      order_id: orderId,
      event_type: "order_status_changed",
      before_status: currentStatus,
      after_status: "ready_for_packing",
      actor_user_id: auth.userId,
      actor_pin_id: actorPinId,
      metadata: { source: "station_ready", item_count: itemIds.length, push: pushResult },
    });
    if (eventRes.error) console.warn("[station-ready] event insert skipped:", eventRes.error.message);

    return NextResponse.json({ ok: true, status: "ready_for_packing", notification: pushResult });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
