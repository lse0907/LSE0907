import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";
import { cancelTossOrderPayment, inspectTossOrderPayment } from "../../orders/_lib/tossCancellation";

type Body = { attemptId?: unknown; action?: unknown; reason?: unknown; kind?: unknown };

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "billing"]);
    const [result, partialResult] = await Promise.all([admin
      .from("order_payment_cancel_attempts")
      .select("id,order_id,store_id,status,attempt_count,pg_status,failure_code,failure_detail,requested_at,last_attempt_at,next_retry_at,completed_at,updated_at")
      .in("status", ["requested", "processing", "retryable", "pg_cancelled", "reconcile_required"])
      .order("updated_at", { ascending: true })
      .limit(200), admin
      .from("order_partial_refunds")
      .select("id,order_id,store_id,status,attempt_count,pg_status,failure_code,failure_detail,requested_at,last_attempt_at,next_retry_at,completed_at,updated_at,refund_amount")
      .in("status", ["requested", "processing", "retryable", "pg_refunded", "reconcile_required"])
      .order("updated_at", { ascending: true })
      .limit(200)]);
    if (result.error) throw new ApiError(500, "주문 결제취소 예외건을 불러오지 못했습니다.", "ORDER_CANCEL_CASES_FAILED");
    if (partialResult.error) throw new ApiError(500, "부분 환불 예외건을 불러오지 못했습니다.", "PARTIAL_REFUND_CASES_FAILED");
    return NextResponse.json({ ok: true, cases: [
      ...(result.data || []).map((row) => ({ ...row, kind: "full" })),
      ...(partialResult.data || []).map((row) => ({ ...row, kind: "partial" })),
    ].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))) });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const attemptId = String(body.attemptId || "").trim();
    const action = String(body.action || "inspect").trim();
    const reason = String(body.reason || "").trim();
    const kind = String(body.kind || "full") === "partial" ? "partial" : "full";
    if (!attemptId || !["inspect", "retry"].includes(action)) {
      throw new ApiError(400, "결제취소 확인 요청이 올바르지 않습니다.", "INVALID_ORDER_CANCEL_RECONCILE_REQUEST");
    }
    if (reason.length < 2) throw new ApiError(400, "처리 사유를 입력해 주세요.", "REASON_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "billing"]);
    if (kind === "partial") {
      const partialRes = await admin.from("order_partial_refunds")
        .select("id,order_id,store_id,payment_key,toss_order_id,idempotency_key,reason,status,previous_refunded_amount,refund_amount,attempt_count")
        .eq("id", attemptId).maybeSingle();
      if (partialRes.error || !partialRes.data) throw new ApiError(404, "부분 환불 건을 찾지 못했습니다.", "PARTIAL_REFUND_NOT_FOUND");
      const partial = partialRes.data;
      const pgRes = await admin.from("store_pg_config").select("secret_key").eq("store_id", partial.store_id).maybeSingle();
      const secretKey = String(pgRes.data?.secret_key || "").trim();
      if (!secretKey) throw new ApiError(409, "매장 PG 결제 확인정보가 없습니다.", "STORE_PG_LOOKUP_UNAVAILABLE");
      const nextAttempt = Number(partial.attempt_count || 0) + (action === "retry" ? 1 : 0);
      const expectedCancelledAmount = Number(partial.previous_refunded_amount || 0) + Number(partial.refund_amount || 0);
      if (action === "retry") await admin.from("order_partial_refunds").update({ status: "processing", attempt_count: nextAttempt, last_attempt_at: new Date().toISOString(), next_retry_at: null }).eq("id", attemptId);
      const toss = action === "retry"
        ? await cancelTossOrderPayment({
            secretKey,
            paymentKey: partial.payment_key,
            tossOrderId: partial.toss_order_id,
            idempotencyKey: partial.idempotency_key,
            cancelReason: partial.reason,
            cancelAmount: partial.refund_amount,
            expectedCancelledAmount,
          })
        : await inspectTossOrderPayment({ secretKey, paymentKey: partial.payment_key, tossOrderId: partial.toss_order_id, expectedCancelledAmount });
      if (!toss.confirmed) {
        await admin.from("order_partial_refunds").update({ status: action === "retry" && nextAttempt < 3 ? "retryable" : "reconcile_required", pg_status: toss.pgStatus, failure_code: toss.failureCode, failure_detail: `${reason}: ${toss.failureDetail || "PG partial refund not confirmed"}`.slice(0, 1000), next_retry_at: action === "retry" && nextAttempt < 3 ? new Date(Date.now() + 30 * 60_000).toISOString() : null }).eq("id", attemptId);
        return NextResponse.json({ ok: true, state: "partial_refund_pending", pgStatus: toss.pgStatus });
      }
      const finalized = await admin.rpc("finalize_order_partial_refund", { p_partial_refund_id: attemptId, p_pg_status: toss.pgStatus, p_pg_cancel_transaction_key: toss.transactionKey, p_pg_response: toss.snapshot });
      if (finalized.error) throw new ApiError(500, "PG 환불은 확인됐지만 내부 정산을 완료하지 못했습니다.", "PARTIAL_REFUND_FINALIZE_FAILED");
      await admin.from("order_events").insert({ store_id: partial.store_id, order_id: partial.order_id, event_type: "partial_refund_ops_reconciled", before_status: "completed", after_status: "completed", actor_user_id: actor.userId, reason_code: action, reason_text: reason, metadata: { partial_refund_id: attemptId, pg_status: toss.pgStatus } });
      return NextResponse.json({ ok: true, state: "partially_refunded", pgStatus: toss.pgStatus });
    }
    const attemptRes = await admin
      .from("order_payment_cancel_attempts")
      .select("id,order_id,store_id,payment_key,toss_order_id,idempotency_key,cancel_reason,status")
      .eq("id", attemptId)
      .maybeSingle();
    if (attemptRes.error || !attemptRes.data) throw new ApiError(404, "결제취소 건을 찾지 못했습니다.", "ORDER_CANCEL_ATTEMPT_NOT_FOUND");
    const attempt = attemptRes.data;
    if (attempt.status === "completed") {
      return NextResponse.json({ ok: true, state: "refunded", duplicate: true });
    }

    const pgRes = await admin.from("store_pg_config").select("secret_key").eq("store_id", attempt.store_id).maybeSingle();
    const secretKey = String(pgRes.data?.secret_key || "").trim();
    if (pgRes.error || !secretKey) throw new ApiError(409, "매장 PG 결제 확인정보가 없습니다.", "STORE_PG_LOOKUP_UNAVAILABLE");

    if (action === "retry") {
      const begin = await admin.rpc("begin_order_payment_cancel_attempt", { p_attempt_id: attemptId });
      if (begin.error) throw new ApiError(500, "결제취소 재시도 상태를 저장하지 못했습니다.", "ORDER_CANCEL_RETRY_BEGIN_FAILED");
    }

    const toss = action === "retry"
      ? await cancelTossOrderPayment({
          secretKey,
          paymentKey: attempt.payment_key,
          tossOrderId: attempt.toss_order_id,
          idempotencyKey: String(attempt.idempotency_key),
          cancelReason: String(attempt.cancel_reason || "주문 취소"),
        })
      : await inspectTossOrderPayment({ secretKey, paymentKey: attempt.payment_key, tossOrderId: attempt.toss_order_id });

    const checkedAt = new Date().toISOString();
    if (!toss.confirmed) {
      const pendingStatus = action === "retry" ? "retryable" : "reconcile_required";
      await admin
        .from("order_payment_cancel_attempts")
        .update({
          status: pendingStatus,
          pg_status: toss.pgStatus,
          failure_code: toss.failureCode,
          failure_detail: `${reason}: ${toss.failureDetail || "PG cancellation not confirmed"}`.slice(0, 1000),
          next_retry_at: action === "retry" ? new Date(Date.now() + 5 * 60_000).toISOString() : null,
        })
        .eq("id", attemptId)
        .neq("status", "completed");
      await admin.from("order_events").insert({
        store_id: attempt.store_id,
        order_id: attempt.order_id,
        event_type: "payment_cancel_ops_checked",
        before_status: "cancelled",
        after_status: "cancelled",
        actor_user_id: actor.userId,
        reason_code: action,
        reason_text: reason,
        metadata: { cancel_attempt_id: attemptId, result: pendingStatus, pg_status: toss.pgStatus },
      });
      return NextResponse.json({ ok: true, state: "cancel_pending", pgStatus: toss.pgStatus, checkedAt });
    }

    const finalized = await admin.rpc("finalize_order_payment_cancellation", {
      p_attempt_id: attemptId,
      p_pg_status: toss.pgStatus,
      p_pg_cancel_transaction_key: toss.transactionKey,
      p_pg_response: toss.snapshot,
    });
    if (finalized.error || !finalized.data) {
      await admin
        .from("order_payment_cancel_attempts")
        .update({
          status: "reconcile_required",
          pg_status: toss.pgStatus,
          pg_cancel_transaction_key: toss.transactionKey,
          pg_response: toss.snapshot,
          failure_code: "OPS_CANCEL_FINALIZE_FAILED",
          failure_detail: finalized.error?.message || "Cancellation finalizer returned no data.",
        })
        .eq("id", attemptId)
        .neq("status", "completed");
      throw new ApiError(500, "PG 취소는 확인됐지만 내부 결제상태를 반영하지 못했습니다.", "OPS_CANCEL_FINALIZE_FAILED");
    }

    await admin.from("order_events").insert({
      store_id: attempt.store_id,
      order_id: attempt.order_id,
      event_type: "payment_cancel_ops_reconciled",
      before_status: "cancelled",
      after_status: "cancelled",
      actor_user_id: actor.userId,
      reason_code: action,
      reason_text: reason,
      metadata: { cancel_attempt_id: attemptId, pg_status: toss.pgStatus, reconciled_at: checkedAt },
    });
    return NextResponse.json({ ok: true, state: "refunded", pgStatus: toss.pgStatus, checkedAt });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
