import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "../../_lib/storeAuth";
import { cancelTossOrderPayment } from "../../orders/_lib/tossCancellation";

type Row = Record<string, unknown>;

function authorized(req: NextRequest) {
  const expected = String(process.env.ORDER_REFUND_RETRY_SECRET || "").trim();
  const received = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: "허용되지 않은 요청입니다." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let completed = 0;
  let escalated = 0;

  const fullRes = await admin.from("order_payment_cancel_attempts")
    .select("id,store_id,payment_key,toss_order_id,idempotency_key,cancel_reason,attempt_count")
    .eq("status", "retryable").lte("next_retry_at", now).limit(10);
  for (const raw of fullRes.data || []) {
    const row = raw as Row;
    const attemptCount = Number(row.attempt_count || 0);
    if (attemptCount >= 3) {
      await admin.from("order_payment_cancel_attempts").update({ status: "reconcile_required", next_retry_at: null, failure_code: "AUTO_RETRY_LIMIT_REACHED" }).eq("id", row.id);
      escalated += 1;
      continue;
    }
    const pg = await admin.from("store_pg_config").select("secret_key").eq("store_id", row.store_id).maybeSingle();
    const secretKey = String(pg.data?.secret_key || "").trim();
    if (!secretKey) {
      await admin.from("order_payment_cancel_attempts").update({ status: "reconcile_required", next_retry_at: null, failure_code: "PG_SECRET_MISSING" }).eq("id", row.id);
      escalated += 1;
      continue;
    }
    await admin.rpc("begin_order_payment_cancel_attempt", { p_attempt_id: row.id });
    const toss = await cancelTossOrderPayment({ secretKey, paymentKey: String(row.payment_key || "") || null, tossOrderId: String(row.toss_order_id || "") || null, idempotencyKey: String(row.idempotency_key), cancelReason: String(row.cancel_reason || "주문 취소") });
    if (toss.confirmed) {
      const finalized = await admin.rpc("finalize_order_payment_cancellation", { p_attempt_id: row.id, p_pg_status: toss.pgStatus, p_pg_cancel_transaction_key: toss.transactionKey, p_pg_response: toss.snapshot });
      if (!finalized.error) { completed += 1; continue; }
    }
    const nextCount = attemptCount + 1;
    await admin.from("order_payment_cancel_attempts").update({
      status: nextCount >= 3 ? "reconcile_required" : "retryable",
      pg_status: toss.pgStatus, failure_code: toss.failureCode || "AUTO_RETRY_UNCONFIRMED",
      failure_detail: toss.failureDetail, next_retry_at: nextCount >= 3 ? null : new Date(Date.now() + (nextCount === 1 ? 5 : 30) * 60_000).toISOString(),
    }).eq("id", row.id);
    if (nextCount >= 3) escalated += 1;
  }

  const partialRes = await admin.from("order_partial_refunds")
    .select("id,store_id,payment_key,toss_order_id,idempotency_key,reason,previous_refunded_amount,refund_amount,attempt_count")
    .eq("status", "retryable").lte("next_retry_at", now).limit(10);
  for (const raw of partialRes.data || []) {
    const row = raw as Row;
    const attemptCount = Number(row.attempt_count || 0);
    if (attemptCount >= 3) {
      await admin.from("order_partial_refunds").update({ status: "reconcile_required", next_retry_at: null, failure_code: "AUTO_RETRY_LIMIT_REACHED" }).eq("id", row.id);
      escalated += 1;
      continue;
    }
    const pg = await admin.from("store_pg_config").select("secret_key").eq("store_id", row.store_id).maybeSingle();
    const secretKey = String(pg.data?.secret_key || "").trim();
    if (!secretKey) {
      await admin.from("order_partial_refunds").update({ status: "reconcile_required", next_retry_at: null, failure_code: "PG_SECRET_MISSING" }).eq("id", row.id);
      escalated += 1;
      continue;
    }
    const nextCount = attemptCount + 1;
    await admin.from("order_partial_refunds").update({ status: "processing", attempt_count: nextCount, last_attempt_at: now, next_retry_at: null }).eq("id", row.id);
    const refundAmount = Number(row.refund_amount || 0);
    const toss = await cancelTossOrderPayment({
      secretKey,
      paymentKey: String(row.payment_key || "") || null,
      tossOrderId: String(row.toss_order_id || "") || null,
      idempotencyKey: String(row.idempotency_key),
      cancelReason: String(row.reason || "부분 환불"),
      cancelAmount: refundAmount,
      expectedCancelledAmount: Number(row.previous_refunded_amount || 0) + refundAmount,
    });
    if (toss.confirmed) {
      const finalized = await admin.rpc("finalize_order_partial_refund", { p_partial_refund_id: row.id, p_pg_status: toss.pgStatus, p_pg_cancel_transaction_key: toss.transactionKey, p_pg_response: toss.snapshot });
      if (!finalized.error) { completed += 1; continue; }
    }
    await admin.from("order_partial_refunds").update({
      status: nextCount >= 3 ? "reconcile_required" : "retryable", pg_status: toss.pgStatus,
      failure_code: toss.failureCode || "AUTO_RETRY_UNCONFIRMED", failure_detail: toss.failureDetail,
      next_retry_at: nextCount >= 3 ? null : new Date(Date.now() + (nextCount === 1 ? 5 : 30) * 60_000).toISOString(),
    }).eq("id", row.id);
    if (nextCount >= 3) escalated += 1;
  }
  return NextResponse.json({ ok: true, completed, escalated });
}
