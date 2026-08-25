import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";
import { cancelTossOrderPayment, inspectTossOrderPayment } from "../../orders/_lib/tossCancellation";

type Body = { attemptId?: unknown; action?: unknown; reason?: unknown };

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "billing"]);
    const result = await admin
      .from("order_payment_cancel_attempts")
      .select("id,order_id,store_id,status,attempt_count,pg_status,failure_code,failure_detail,requested_at,last_attempt_at,next_retry_at,completed_at,updated_at")
      .in("status", ["requested", "processing", "retryable", "pg_cancelled", "reconcile_required"])
      .order("updated_at", { ascending: true })
      .limit(200);
    if (result.error) throw new ApiError(500, "주문 결제취소 예외건을 불러오지 못했습니다.", "ORDER_CANCEL_CASES_FAILED");
    return NextResponse.json({ ok: true, cases: result.data || [] });
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
    if (!attemptId || !["inspect", "retry"].includes(action)) {
      throw new ApiError(400, "결제취소 확인 요청이 올바르지 않습니다.", "INVALID_ORDER_CANCEL_RECONCILE_REQUEST");
    }
    if (reason.length < 2) throw new ApiError(400, "처리 사유를 입력해 주세요.", "REASON_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "billing"]);
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
