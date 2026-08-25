/* eslint-disable @typescript-eslint/no-explicit-any */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { verifyPinHash } from "../../admin/members/_lib";
import { cancelTossOrderPayment } from "../_lib/tossCancellation";

type CancelBody = {
  storeId?: string;
  orderId?: string;
  accessToken?: string;
  actor?: "customer" | "staff";
  reason?: string;
  reasonCode?: string;
  actorPinId?: string | null;
  managerPin?: string | null;
};

type JsonRecord = Record<string, any>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function secureTokenMatches(expected: unknown, received: string) {
  const expectedBuffer = Buffer.from(String(expected || "").trim(), "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function cancellationClaimError(message: string) {
  const normalized = message.toUpperCase();
  if (normalized.includes("ORDER_NOT_FOUND")) {
    return { code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다.", status: 404 };
  }
  if (normalized.includes("ORDER_LOCKED")) {
    return { code: "ORDER_LOCKED", message: "이미 완료된 주문은 주문 취소로 되돌릴 수 없습니다.", status: 409 };
  }
  if (normalized.includes("ORDER_STATUS_CHANGED")) {
    return { code: "ORDER_STATUS_CHANGED", message: "주문 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요.", status: 409 };
  }
  if (normalized.includes("LEGACY_CANCEL_REQUIRES_RECONCILIATION")) {
    return {
      code: "LEGACY_CANCEL_REQUIRES_RECONCILIATION",
      message: "기존 취소 주문의 결제상태 확인이 필요합니다. OPS에서 PG 상태를 확인해 주세요.",
      status: 409,
    };
  }
  return { code: "ORDER_CANCEL_CLAIM_FAILED", message: "주문 취소 상태를 저장하지 못했습니다.", status: 500 };
}

function pendingResponse(message: string) {
  return NextResponse.json(
    {
      ok: true,
      state: "cancel_pending",
      orderStatus: "cancelled",
      paymentStatus: "cancel_pending",
      code: "PAYMENT_CANCEL_PENDING",
      message,
    },
    { status: 202 },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const storeId = String(body?.storeId || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const accessToken = String(body?.accessToken || "").trim();
    const actor = body?.actor === "staff" ? "staff" : "customer";
    const reason = String(body?.reason || "").trim() || "주문 취소";
    const reasonCode = String(body?.reasonCode || "").trim() || "other";

    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, code: "MISSING_REQUIRED_FIELDS", message: "필수 정보가 없습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const orderQuery = await supabaseAdmin
      .from("orders")
      .select("id,store_id,status,payment_status,access_token,payment_key,toss_order_id,customer_user_id")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (orderQuery.error) {
      return NextResponse.json({ ok: false, code: "ORDER_LOOKUP_FAILED", message: `주문 조회 실패: ${orderQuery.error.message}` }, { status: 500 });
    }
    if (!orderQuery.data) {
      return NextResponse.json({ ok: false, code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다." }, { status: 404 });
    }

    const order = orderQuery.data as JsonRecord;
    const currentStatus = String(order.status || "");
    const currentPaymentStatus = String(order.payment_status || "not_required");
    let actorUserId: string | null = null;
    let approvedByPinId: string | null = null;

    if (actor === "customer") {
      if (!accessToken || !secureTokenMatches(order.access_token, accessToken)) {
        return NextResponse.json({ ok: false, code: "CANCEL_FORBIDDEN", message: "취소 권한이 없습니다." }, { status: 403 });
      }
      if (currentStatus !== "new" && currentStatus !== "cancelled") {
        return NextResponse.json(
          { ok: false, code: "ORDER_ALREADY_CONFIRMED", message: "매장에서 주문 확인 후에는 앱에서 직접 취소할 수 없습니다." },
          { status: 409 },
        );
      }
      actorUserId = String(order.customer_user_id || "").trim() || null;
    } else {
      const auth = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });
      actorUserId = auth.userId;
      if (currentStatus === "completed") {
        return NextResponse.json({ ok: false, code: "ORDER_LOCKED", message: "이미 완료된 주문입니다." }, { status: 409 });
      }
      const staffCanCancelDirectly = auth.role === "staff" && (currentStatus === "new" || currentStatus === "checked");
      if (auth.role === "staff" && currentStatus !== "cancelled" && !staffCanCancelDirectly) {
        const managerPin = String(body.managerPin || "").trim();
        if (!managerPin) {
          return NextResponse.json({ ok: false, code: "MANAGER_PIN_REQUIRED", message: "이 주문 취소는 매니저 PIN 승인이 필요합니다." }, { status: 403 });
        }
        const managerPins = await supabaseAdmin
          .from("store_staff_pins")
          .select("id,pin_hash")
          .eq("store_id", storeId)
          .eq("pin_role", "manager")
          .eq("is_active", true)
          .eq("approval_status", "approved");
        if (managerPins.error) {
          return NextResponse.json({ ok: false, code: "MANAGER_PIN_LOOKUP_FAILED", message: `PIN 조회 실패: ${managerPins.error.message}` }, { status: 500 });
        }
        const approvedPin = (managerPins.data || []).find((row) => verifyPinHash(managerPin, String(row.pin_hash || "")));
        if (!approvedPin) {
          return NextResponse.json({ ok: false, code: "MANAGER_PIN_INVALID", message: "매니저 PIN이 올바르지 않습니다." }, { status: 403 });
        }
        approvedByPinId = String(approvedPin.id);
      }
    }

    const claimRes = await supabaseAdmin.rpc("claim_order_cancellation", {
      p_store_id: storeId,
      p_order_id: orderId,
      p_expected_status: currentStatus === "cancelled" ? null : currentStatus,
      p_cancel_reason: reason,
      p_reason_code: reasonCode,
      p_actor_type: actor,
      p_actor_user_id: actorUserId,
      p_actor_pin_id: body.actorPinId || null,
      p_approved_by_pin_id: approvedByPinId,
    });
    if (claimRes.error || !claimRes.data) {
      const classified = cancellationClaimError(claimRes.error?.message || "claim returned no data");
      return NextResponse.json({ ok: false, code: classified.code, message: classified.message }, { status: classified.status });
    }

    const claim = asRecord(claimRes.data);
    const paymentStatus = String(claim.payment_status || currentPaymentStatus);
    if (paymentStatus === "refunded") {
      return NextResponse.json({ ok: true, duplicate: true, state: "refunded", orderStatus: "cancelled", paymentStatus: "refunded", message: "주문과 결제 취소가 완료되었습니다." });
    }
    if (!claim.requires_pg) {
      return NextResponse.json({
        ok: true,
        duplicate: Boolean(claim.duplicate),
        state: paymentStatus,
        orderStatus: "cancelled",
        paymentStatus,
        message: paymentStatus === "failed" ? "주문은 취소되었으며 결제상태 확인이 필요합니다." : "주문이 취소되었습니다.",
      });
    }

    const attemptId = String(claim.attempt_id || "").trim();
    const idempotencyKey = String(claim.idempotency_key || "").trim();
    if (!attemptId || !idempotencyKey) {
      return pendingResponse("주문은 취소되었으며 결제 취소 이력을 확인하고 있습니다.");
    }

    const markAttempt = async (patch: JsonRecord) => {
      const result = await supabaseAdmin.from("order_payment_cancel_attempts").update(patch).eq("id", attemptId).neq("status", "completed");
      if (result.error) console.error("[order-cancel] attempt update failed:", result.error.message);
    };

    const pgConfig = await supabaseAdmin.from("store_pg_config").select("secret_key").eq("store_id", storeId).maybeSingle();
    const secretKey = String(pgConfig.data?.secret_key || "").trim();
    if (pgConfig.error || !secretKey) {
      await markAttempt({
        status: "reconcile_required",
        failure_code: pgConfig.error ? "PG_LOOKUP_FAILED" : "PG_SECRET_MISSING",
        failure_detail: pgConfig.error?.message || "Store PG secret is missing.",
      });
      return pendingResponse("주문은 취소되었으며 결제 취소 설정을 확인하고 있습니다. 매장에 문의해 주세요.");
    }

    const beginRes = await supabaseAdmin.rpc("begin_order_payment_cancel_attempt", { p_attempt_id: attemptId });
    if (beginRes.error) {
      await markAttempt({ status: "reconcile_required", failure_code: "CANCEL_ATTEMPT_BEGIN_FAILED", failure_detail: beginRes.error.message.slice(0, 1000) });
      return pendingResponse("주문은 취소되었으며 결제 취소 요청을 준비하고 있습니다.");
    }

    const tossResult = await cancelTossOrderPayment({
      secretKey,
      paymentKey: String(claim.payment_key || order.payment_key || "").trim() || null,
      tossOrderId: String(claim.toss_order_id || order.toss_order_id || "").trim() || null,
      idempotencyKey,
      cancelReason: String(claim.cancel_reason || reason),
    });

    if (!tossResult.confirmed) {
      await markAttempt({
        status: "retryable",
        pg_status: tossResult.pgStatus,
        failure_code: tossResult.failureCode || "TOSS_CANCEL_RESULT_UNCONFIRMED",
        failure_detail: tossResult.failureDetail || "Toss cancellation was not confirmed.",
        next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      return pendingResponse("주문은 취소되었으며 결제 취소를 확인하고 있습니다. 완료 전까지 결제 취소 완료로 표시되지 않습니다.");
    }

    await markAttempt({
      status: "pg_cancelled",
      payment_key: tossResult.paymentKey,
      toss_order_id: tossResult.tossOrderId,
      pg_status: tossResult.pgStatus,
      pg_cancel_transaction_key: tossResult.transactionKey,
      pg_response: tossResult.snapshot,
      failure_code: null,
      failure_detail: null,
      next_retry_at: null,
    });

    const finalizeRes = await supabaseAdmin.rpc("finalize_order_payment_cancellation", {
      p_attempt_id: attemptId,
      p_pg_status: tossResult.pgStatus,
      p_pg_cancel_transaction_key: tossResult.transactionKey,
      p_pg_response: tossResult.snapshot,
    });
    if (finalizeRes.error || !finalizeRes.data) {
      await markAttempt({
        status: "reconcile_required",
        failure_code: "CANCEL_FINALIZE_FAILED",
        failure_detail: finalizeRes.error?.message || "Cancellation finalizer returned no data.",
      });
      return pendingResponse("결제사 취소는 확인됐으며 내부 결제상태를 반영하고 있습니다.");
    }

    return NextResponse.json({ ok: true, state: "refunded", orderStatus: "cancelled", paymentStatus: "refunded", message: "주문과 결제 취소가 완료되었습니다." });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
