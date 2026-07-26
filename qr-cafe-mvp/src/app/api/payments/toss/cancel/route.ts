import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type CancelBody = {
  paymentId?: number;
  storeId?: string;
  reason?: string;
};

const CANCEL_WINDOW_MINUTES = 10;
const MAX_CANCEL_REASON_LENGTH = 120;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function publicCancelError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function classifyRefundClaimError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("check constraint") && normalized.includes("billing_payments")) {
    return {
      code: "REFUND_DB_STATUS_CONSTRAINT",
      message: "결제 취소 상태 설정을 확인하고 있습니다. 중복 결제하지 말고 OPS에 문의해 주세요. (RF-DB-01)",
    };
  }
  if (normalized.includes("subscription_changed_after_payment")) {
    return {
      code: "SUBSCRIPTION_CHANGED_AFTER_PAYMENT",
      message: "결제 후 구독 기간이 변경되어 즉시 취소할 수 없습니다. OPS에 확인을 요청해 주세요.",
    };
  }
  return {
    code: "REFUND_CLAIM_FAILED",
    message: "다른 취소 요청이 처리 중이거나 이후 구독 결제가 있어 즉시 취소할 수 없습니다.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const paymentId = Number(body?.paymentId || 0);
    const storeId = String(body?.storeId || "").trim();
    const reason = String(body?.reason || "").trim();

    if (!Number.isFinite(paymentId) || paymentId <= 0 || !storeId) {
      return publicCancelError("INVALID_CANCEL_REQUEST", "취소할 결제 정보가 올바르지 않습니다.", 400);
    }

    if (reason.length > MAX_CANCEL_REASON_LENGTH) {
      return publicCancelError("CANCEL_REASON_TOO_LONG", `취소 사유는 ${MAX_CANCEL_REASON_LENGTH}자 이하로 입력해 주세요.`, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    // 이 API는 고객 주문 취소가 아니라 점주의 플랫폼 PG 구독 결제 취소 전용입니다.
    const { userId } = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const paymentRes = await supabaseAdmin
      .from("billing_payments")
      .select("id, store_id, payment_key, order_id, amount_krw, paid_at, status, base_paid, addon_paid, before_paid_until, after_paid_until, note")
      .eq("id", paymentId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (paymentRes.error || !paymentRes.data) {
      return publicCancelError("PAYMENT_NOT_FOUND", "결제 정보를 확인할 수 없습니다.", 404);
    }

    const payment = paymentRes.data;
    if (String(payment.status) === "refunded") {
      return NextResponse.json({ ok: true, code: "ALREADY_REFUNDED", message: "이미 취소 및 환불이 완료된 결제입니다." });
    }
    if (String(payment.status) !== "paid") {
      return publicCancelError("PAYMENT_NOT_CANCELABLE", "이미 취소되었거나 취소 처리 중인 결제입니다.", 409);
    }

    const paidAtMs = new Date(String(payment.paid_at || "")).getTime();
    if (!Number.isFinite(paidAtMs)) {
      return publicCancelError("INVALID_PAID_AT", "결제 시간 정보를 확인할 수 없습니다.", 400);
    }
    if (Date.now() - paidAtMs >= CANCEL_WINDOW_MINUTES * 60_000) {
      return publicCancelError("REFUND_WINDOW_EXPIRED", `결제 후 ${CANCEL_WINDOW_MINUTES}분이 지나 즉시 취소할 수 없습니다.`, 409);
    }

    const pgRes = await supabaseAdmin.from("platform_pg_config").select("secret_key").eq("id", 1).maybeSingle();
    if (pgRes.error) {
      return publicCancelError("PG_CONFIG_LOOKUP_FAILED", "환불 처리에 필요한 결제 설정을 확인할 수 없습니다.", 500);
    }

    const secretKey = String(pgRes.data?.secret_key || "").trim();
    const paymentKey = String(payment.payment_key || "").trim();
    if (!secretKey || !paymentKey) {
      return publicCancelError("PG_CANCEL_KEY_MISSING", "환불 처리에 필요한 결제 정보가 없습니다.", 400);
    }

    const cancelReason = reason || "관리자 즉시 취소";
    const attemptRes = await supabaseAdmin.from("billing_refund_attempts").insert({
      billing_payment_id: paymentId,
      store_id: storeId,
      requested_by: userId,
      amount_krw: Math.max(0, Number(payment.amount_krw || 0)),
      reason: cancelReason,
      status: "requested",
    }).select("id").single();
    if (attemptRes.error || !attemptRes.data) {
      return publicCancelError("REFUND_ATTEMPT_SAVE_FAILED", "취소 요청 이력을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
    }
    const refundAttemptId = Number(attemptRes.data.id);
    const markAttempt = async (patch: Record<string, unknown>) => {
      await supabaseAdmin.from("billing_refund_attempts").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", refundAttemptId);
    };

    const claimRes = await supabaseAdmin.rpc("claim_store_billing_refund", {
      p_payment_id: paymentId,
      p_store_id: storeId,
    });
    if (claimRes.error || !claimRes.data) {
      const internalError = claimRes.error?.message || "refund claim returned no row";
      const classified = classifyRefundClaimError(internalError);
      await markAttempt({ status: "failed", public_error_code: classified.code, internal_error: internalError.slice(0, 500) });
      return publicCancelError(
        classified.code,
        classified.message,
        409,
      );
    }
    await markAttempt({ status: "processing" });

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    let cancelRes: Response;
    try {
      cancelRes = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancelReason }),
        cache: "no-store",
      });
    } catch {
      const releaseRes = await supabaseAdmin.rpc("release_store_billing_refund", { p_payment_id: paymentId, p_store_id: storeId });
      await markAttempt({
        status: releaseRes.error ? "reconcile_required" : "failed",
        public_error_code: releaseRes.error ? "REFUND_RELEASE_FAILED" : "TOSS_CANCEL_UNREACHABLE",
        internal_error: releaseRes.error?.message || "Toss cancel request was unreachable",
      });
      return publicCancelError("TOSS_CANCEL_UNREACHABLE", "결제사 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.", 502);
    }

    const raw = await cancelRes.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!cancelRes.ok) {
      const tossError = asRecord(parsed);
      const releaseRes = await supabaseAdmin.rpc("release_store_billing_refund", { p_payment_id: paymentId, p_store_id: storeId });
      await markAttempt({
        status: releaseRes.error ? "reconcile_required" : "failed",
        public_error_code: releaseRes.error ? "REFUND_RELEASE_FAILED" : "TOSS_CANCEL_FAILED",
        internal_error: String(tossError.code || tossError.message || raw).slice(0, 500),
        pg_responded_at: new Date().toISOString(),
      });
      return publicCancelError("TOSS_CANCEL_FAILED", "결제 취소에 실패했습니다. 결제 상태를 확인한 후 다시 시도해 주세요.", 502);
    }

    const tossPayment = asRecord(parsed);
    const tossPaymentKey = String(tossPayment.paymentKey || "").trim();
    const tossOrderId = String(tossPayment.orderId || "").trim();
    const tossStatus = String(tossPayment.status || "").trim().toUpperCase();
    if (tossPaymentKey !== paymentKey || tossOrderId !== String(payment.order_id || "").trim() || tossStatus !== "CANCELED") {
      await markAttempt({
        status: "reconcile_required",
        public_error_code: "TOSS_CANCEL_RESPONSE_MISMATCH",
        internal_error: `paymentKey=${tossPaymentKey === paymentKey},orderId=${tossOrderId === String(payment.order_id || "").trim()},status=${tossStatus || "EMPTY"}`,
        pg_status: tossStatus || null,
        pg_responded_at: new Date().toISOString(),
      });
      return publicCancelError(
        "TOSS_CANCEL_RESPONSE_MISMATCH",
        "환불은 접수되었지만 구독 상태 확인이 필요합니다. 지원센터에 문의해 주세요.",
        500,
      );
    }

    const finalizeRes = await supabaseAdmin.rpc("finalize_store_billing_refund", {
      p_payment_id: paymentId,
      p_store_id: storeId,
      p_cancel_reason: cancelReason,
    });
    if (finalizeRes.error || !finalizeRes.data) {
      await markAttempt({
        status: "reconcile_required",
        public_error_code: "REFUND_FINALIZE_FAILED",
        internal_error: finalizeRes.error?.message || "refund finalize returned no row",
        pg_status: tossStatus,
        pg_cancel_transaction_key: String(tossPayment.lastTransactionKey || "") || null,
        pg_responded_at: new Date().toISOString(),
      });
      return publicCancelError(
        "REFUND_FINALIZE_FAILED",
        "환불은 완료되었지만 구독 상태 확인이 필요합니다. 지원센터에 문의해 주세요.",
        500,
      );
    }

    await markAttempt({
      status: "completed",
      public_error_code: null,
      internal_error: null,
      pg_status: tossStatus,
      pg_cancel_transaction_key: String(tossPayment.lastTransactionKey || "") || null,
      pg_responded_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, code: "REFUND_COMPLETED", message: "결제 취소 및 환불이 완료되었습니다." });
  } catch (e: unknown) {
    if (e instanceof ApiError) return apiErrorResponse(e);
    console.error("[billing-refund] unexpected cancel error", e);
    return publicCancelError("REFUND_INTERNAL_ERROR", "환불 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 500);
  }
}
