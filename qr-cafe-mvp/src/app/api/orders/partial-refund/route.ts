import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { cancelTossOrderPayment } from "../_lib/tossCancellation";

type Body = {
  storeId?: unknown;
  orderId?: unknown;
  items?: Array<{ orderItemId?: unknown; quantity?: unknown }>;
  reason?: unknown;
};

type JsonRecord = Record<string, unknown>;
const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" ? value as JsonRecord : {};
const toInt = (value: unknown) => Math.max(0, Math.round(Number(value || 0)) || 0);

function couponDiscount(coupon: JsonRecord, orderAmount: number) {
  const type = String(coupon.discount_type_snapshot || "");
  const value = toInt(coupon.discount_value_snapshot);
  const minimum = toInt(coupon.min_order_amount_snapshot);
  const maximum = coupon.max_discount_amount_snapshot == null ? null : toInt(coupon.max_discount_amount_snapshot);
  if (!type || !value || orderAmount < minimum) return 0;
  const calculated = type === "percent" ? Math.floor((orderAmount * value) / 100) : value;
  return Math.max(0, Math.min(orderAmount, maximum == null ? calculated : Math.min(calculated, maximum)));
}

function classifyClaimError(message: string) {
  const code = message.toUpperCase();
  if (code.includes("ORDER_NOT_FOUND")) return new ApiError(404, "주문을 찾지 못했습니다.", "ORDER_NOT_FOUND");
  if (code.includes("COMPLETED_ONLY")) return new ApiError(409, "완료 주문만 부분 환불할 수 있습니다.", "PARTIAL_REFUND_COMPLETED_ONLY");
  if (code.includes("ALREADY_PROCESSING")) return new ApiError(409, "이미 처리 중인 부분 환불이 있습니다.", "PARTIAL_REFUND_ALREADY_PROCESSING");
  if (code.includes("QUANTITY_EXCEEDED")) return new ApiError(409, "취소 수량이 남은 주문 수량을 초과했습니다.", "PARTIAL_REFUND_QUANTITY_EXCEEDED");
  if (code.includes("USE_FULL_CANCELLATION")) return new ApiError(409, "전체 수량은 부분 환불로 처리할 수 없습니다.", "USE_FULL_CANCELLATION");
  return new ApiError(500, "부분 환불 원장을 생성하지 못했습니다.", "PARTIAL_REFUND_CLAIM_FAILED");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    const reason = String(body.reason || "부분 환불").trim().slice(0, 500);
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((item) => ({ orderItemId: String(item.orderItemId || "").trim(), quantity: toInt(item.quantity) }))
      .filter((item) => item.orderItemId && item.quantity > 0);
    if (!storeId || !orderId || !items.length) throw new ApiError(400, "환불할 메뉴와 수량을 선택해 주세요.", "PARTIAL_REFUND_ITEMS_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager"] });
    const orderRes = await admin
      .from("orders")
      .select("id,store_id,status,payment_status,total_price,adjusted_total_price,refunded_amount,used_points,used_coupon_id,earned_points,effective_used_points,effective_coupon_discount,effective_earned_points,points_rate_snapshot,loyalty_snapshot,payment_key,toss_order_id,customer_user_id")
      .eq("id", orderId).eq("store_id", storeId).maybeSingle();
    if (orderRes.error || !orderRes.data) throw new ApiError(404, "주문을 찾지 못했습니다.", "ORDER_NOT_FOUND");
    const order = asRecord(orderRes.data);
    if (String(order.status) !== "completed") throw new ApiError(409, "완료 주문만 부분 환불할 수 있습니다.", "PARTIAL_REFUND_COMPLETED_ONLY");

    const itemIds = Array.from(new Set(items.map((item) => item.orderItemId)));
    const [orderItemsRes, optionsRes] = await Promise.all([
      admin.from("order_items").select("id,name,price,qty").eq("order_id", orderId).eq("store_id", storeId).in("id", itemIds),
      admin.from("order_item_options").select("order_item_id,price_delta,qty").eq("store_id", storeId).in("order_item_id", itemIds),
    ]);
    if (orderItemsRes.error || optionsRes.error || (orderItemsRes.data || []).length !== itemIds.length) {
      throw new ApiError(409, "부분 환불 대상 메뉴를 확인하지 못했습니다.", "PARTIAL_REFUND_ITEM_LOOKUP_FAILED");
    }
    const optionTotals = new Map<string, number>();
    for (const option of optionsRes.data || []) {
      const id = String(option.order_item_id || "");
      optionTotals.set(id, (optionTotals.get(id) || 0) + toInt(option.price_delta) * Math.max(1, toInt(option.qty)));
    }
    const itemMap = new Map((orderItemsRes.data || []).map((item) => [String(item.id), item]));
    const adjustmentAmount = items.reduce((sum, selected) => {
      const item = itemMap.get(selected.orderItemId);
      return sum + (toInt(item?.price) + (optionTotals.get(selected.orderItemId) || 0)) * selected.quantity;
    }, 0);
    const previousTotal = toInt(order.adjusted_total_price || order.total_price);
    const finalTotal = previousTotal - adjustmentAmount;
    if (finalTotal <= 0) throw new ApiError(409, "전체 수량은 기존 전체 취소 절차로 처리해 주세요.", "USE_FULL_CANCELLATION");

    const currentPoints = toInt(order.effective_used_points ?? order.used_points);
    const currentCouponDiscount = toInt(order.effective_coupon_discount);
    let finalPoints = 0;
    let finalCouponDiscount = 0;
    if (currentPoints > 0) {
      const snapshot = asRecord(order.loyalty_snapshot);
      const maxPct = Math.min(100, Math.max(0, Number(snapshot.max_redeem_pct ?? 30)));
      const minimum = toInt(snapshot.min_redeem_points ?? 100);
      finalPoints = Math.min(currentPoints, finalTotal, Math.floor((finalTotal * maxPct) / 100));
      if (finalPoints < minimum) finalPoints = 0;
    } else if (order.used_coupon_id && currentCouponDiscount > 0) {
      const couponRes = await admin
        .from("customer_coupons")
        .select("discount_type_snapshot,discount_value_snapshot,min_order_amount_snapshot,max_discount_amount_snapshot")
        .eq("id", String(order.used_coupon_id)).maybeSingle();
      if (couponRes.error) throw new ApiError(500, "쿠폰 정산 기준을 확인하지 못했습니다.", "COUPON_SNAPSHOT_LOOKUP_FAILED");
      finalCouponDiscount = couponDiscount(asRecord(couponRes.data), finalTotal);
    }
    const finalPayable = Math.max(0, finalTotal - finalPoints - finalCouponDiscount);
    const rate = Math.max(0, Number(order.points_rate_snapshot || 0));
    const finalEarned = order.customer_user_id ? Math.floor((finalPayable * rate) / 100) : 0;

    const claimRes = await admin.rpc("claim_order_partial_refund", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_items: items,
      p_reason: reason,
      p_actor_user_id: actor.userId,
      p_approved_by_pin_id: null,
      p_final_used_points: finalPoints,
      p_final_coupon_discount: finalCouponDiscount,
      p_final_earned_points: finalEarned,
    });
    if (claimRes.error || !claimRes.data) throw classifyClaimError(claimRes.error?.message || "claim failed");
    const claim = asRecord(claimRes.data);
    const partialRefundId = String(claim.partialRefundId || "");
    const refundAmount = toInt(claim.refundAmount);

    if (!claim.requiresPg || refundAmount === 0) {
      const finalized = await admin.rpc("finalize_order_partial_refund", { p_partial_refund_id: partialRefundId });
      if (finalized.error) throw new ApiError(500, "부분 취소 정산을 완료하지 못했습니다.", "PARTIAL_REFUND_FINALIZE_FAILED");
      return NextResponse.json({ ok: true, state: "completed", partialRefundId, refundAmount });
    }

    const pgRes = await admin.from("store_pg_config").select("secret_key").eq("store_id", storeId).maybeSingle();
    const secretKey = String(pgRes.data?.secret_key || "").trim();
    if (pgRes.error || !secretKey) {
      await admin.from("order_partial_refunds").update({ status: "reconcile_required", failure_code: "PG_SECRET_MISSING", failure_detail: "Store PG secret is missing." }).eq("id", partialRefundId);
      return NextResponse.json({ ok: true, state: "partial_refund_pending", partialRefundId, refundAmount, message: "부분 환불이 OPS 확인 대상으로 등록되었습니다." }, { status: 202 });
    }

    await admin.from("order_partial_refunds").update({ status: "processing", attempt_count: 1, last_attempt_at: new Date().toISOString() }).eq("id", partialRefundId);
    const toss = await cancelTossOrderPayment({
      secretKey,
      paymentKey: String(claim.paymentKey || "") || null,
      tossOrderId: String(claim.tossOrderId || "") || null,
      idempotencyKey: String(claim.idempotencyKey || ""),
      cancelReason: reason,
      cancelAmount: refundAmount,
      expectedCancelledAmount: toInt(claim.previousRefundedAmount) + refundAmount,
    });
    if (!toss.confirmed) {
      await admin.from("order_partial_refunds").update({
        status: "retryable", pg_status: toss.pgStatus, failure_code: toss.failureCode,
        failure_detail: toss.failureDetail, next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }).eq("id", partialRefundId);
      return NextResponse.json({ ok: true, state: "partial_refund_pending", partialRefundId, refundAmount, message: "부분 환불을 확인하고 있습니다." }, { status: 202 });
    }

    const finalized = await admin.rpc("finalize_order_partial_refund", {
      p_partial_refund_id: partialRefundId,
      p_pg_status: toss.pgStatus,
      p_pg_cancel_transaction_key: toss.transactionKey,
      p_pg_response: toss.snapshot,
    });
    if (finalized.error) {
      await admin.from("order_partial_refunds").update({ status: "reconcile_required", pg_status: toss.pgStatus, pg_response: toss.snapshot, failure_code: "PARTIAL_REFUND_FINALIZE_FAILED", failure_detail: finalized.error.message }).eq("id", partialRefundId);
      return NextResponse.json({ ok: true, state: "partial_refund_pending", partialRefundId, refundAmount, message: "PG 환불은 확인됐으며 내부 상태를 반영하고 있습니다." }, { status: 202 });
    }
    return NextResponse.json({ ok: true, state: "partially_refunded", partialRefundId, refundAmount, message: "부분 환불이 완료되었습니다." });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
