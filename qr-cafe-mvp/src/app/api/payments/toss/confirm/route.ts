import { NextRequest, NextResponse } from "next/server";
import {
  finalizeCheckoutAttempt,
  getCheckoutAttempt,
  orderResponse,
} from "../../../orders/_lib/checkoutAttempts";
import { apiErrorResponse, createSupabaseAdminClient } from "../../../_lib/storeAuth";

type ConfirmBody = {
  checkoutAttemptId?: string;
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  storeId?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function responseJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function tossErrorCode(value: unknown) {
  const code = String(asRecord(value).code || "TOSS_CONFIRM_FAILED").trim();
  return code.slice(0, 100) || "TOSS_CONFIRM_FAILED";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmBody;
    const attemptId = String(body.checkoutAttemptId || "").trim();
    const paymentKey = String(body.paymentKey || "").trim();
    const tossOrderId = String(body.orderId || "").trim();
    const requestStoreId = String(body.storeId || "").trim();
    const amount = Number(body.amount || 0);

    if (!paymentKey || !tossOrderId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { ok: false, code: "PAYMENT_CONFIRM_INPUT_INVALID", message: "결제 확인 정보가 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const attempt = await getCheckoutAttempt({
      supabaseAdmin,
      attemptId: attemptId || null,
      tossOrderId: attemptId ? null : tossOrderId,
    });
    if (!attempt || attempt.checkout_type !== "prepaid") {
      return NextResponse.json(
        { ok: false, code: "CHECKOUT_ATTEMPT_NOT_FOUND", message: "결제 요청 정보를 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (
      (requestStoreId && requestStoreId !== attempt.store_id) ||
      tossOrderId !== attempt.toss_order_id ||
      Math.round(amount) !== Number(attempt.payable_amount)
    ) {
      return NextResponse.json(
        { ok: false, code: "PAYMENT_ATTEMPT_MISMATCH", message: "저장된 주문의 결제 정보와 일치하지 않습니다." },
        { status: 409 },
      );
    }

    if (attempt.payment_key && attempt.payment_key !== paymentKey) {
      return NextResponse.json(
        { ok: false, code: "PAYMENT_KEY_MISMATCH", message: "이미 확인된 결제키와 일치하지 않습니다." },
        { status: 409 },
      );
    }

    if (attempt.status === "quoted" && new Date(attempt.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("order_checkout_attempts")
        .update({ status: "expired", failure_code: "CHECKOUT_ATTEMPT_EXPIRED" })
        .eq("id", attempt.id)
        .eq("status", "quoted");
      return NextResponse.json(
        { ok: false, code: "CHECKOUT_ATTEMPT_EXPIRED", message: "결제 요청 시간이 만료되었습니다. 다시 주문해주세요." },
        { status: 410 },
      );
    }

    if (attempt.status === "completed") {
      const existing = await finalizeCheckoutAttempt(supabaseAdmin, attempt.id);
      return NextResponse.json({ ok: true, order: orderResponse(existing), duplicate: true });
    }

    if (attempt.status === "approved_not_applied" && attempt.pg_status === "DONE") {
      const recovered = await finalizeCheckoutAttempt(supabaseAdmin, attempt.id);
      return NextResponse.json({ ok: true, order: orderResponse(recovered), recovered: true });
    }

    if (!["quoted", "confirming"].includes(attempt.status)) {
      return NextResponse.json(
        { ok: false, code: "CHECKOUT_ATTEMPT_NOT_CONFIRMABLE", message: "현재 결제를 승인할 수 없는 상태입니다." },
        { status: 409 },
      );
    }

    const pgRes = await supabaseAdmin
      .from("store_pg_config")
      .select("secret_key")
      .eq("store_id", attempt.store_id)
      .maybeSingle();
    if (pgRes.error) {
      return NextResponse.json(
        { ok: false, code: "PG_CONFIG_LOOKUP_FAILED", message: "매장 결제설정 조회에 실패했습니다." },
        { status: 500 },
      );
    }

    const secretKey = String(pgRes.data?.secret_key || "").trim();
    if (!secretKey) {
      return NextResponse.json(
        { ok: false, code: "PG_SECRET_MISSING", message: "매장 결제 승인키가 설정되지 않았습니다." },
        { status: 400 },
      );
    }

    const confirming = await supabaseAdmin
      .from("order_checkout_attempts")
      .update({ status: "confirming", failure_code: null, failure_detail: null })
      .eq("id", attempt.id)
      .in("status", ["quoted", "confirming"])
      .select("id")
      .maybeSingle();
    if (confirming.error || !confirming.data) {
      return NextResponse.json(
        {
          ok: false,
          code: confirming.error ? "CHECKOUT_ATTEMPT_UPDATE_FAILED" : "CHECKOUT_ATTEMPT_STATE_CHANGED",
          message: confirming.error
            ? "결제 승인 준비 상태를 저장하지 못했습니다. 다시 시도해주세요."
            : "결제 상태가 변경되었습니다. 다시 확인해주세요.",
        },
        { status: confirming.error ? 500 : 409 },
      );
    }

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const headers = {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": String(attempt.confirm_idempotency_key || attempt.id),
    };
    const confirmRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ paymentKey, orderId: tossOrderId, amount }),
      cache: "no-store",
    });
    let tossResult = await responseJson(confirmRes);

    if (!confirmRes.ok) {
      const queryRes = await fetch(
        `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`,
        { method: "GET", headers: { Authorization: `Basic ${basicToken}` }, cache: "no-store" },
      );
      const queried = await responseJson(queryRes);
      if (queryRes.ok && String(asRecord(queried).status || "") === "DONE") {
        tossResult = queried;
      } else {
        const code = tossErrorCode(tossResult);
        await supabaseAdmin
          .from("order_checkout_attempts")
          .update({
            status: confirmRes.status === 409 ? "confirming" : "failed",
            failure_code: code,
            failure_detail: `Toss confirm HTTP ${confirmRes.status}`,
          })
          .eq("id", attempt.id);
        return NextResponse.json(
          {
            ok: false,
            code,
            message:
              confirmRes.status === 409
                ? "결제 승인이 처리 중입니다. 잠시 후 다시 확인해주세요."
                : "토스 결제 승인에 실패했습니다.",
          },
          { status: confirmRes.status === 409 ? 409 : 400 },
        );
      }
    }

    const toss = asRecord(tossResult);
    const confirmedPaymentKey = String(toss.paymentKey || "").trim();
    const confirmedOrderId = String(toss.orderId || "").trim();
    const confirmedStatus = String(toss.status || "").trim();
    const confirmedAmount = Number(toss.totalAmount ?? toss.amount ?? NaN);
    if (
      confirmedPaymentKey !== paymentKey ||
      confirmedOrderId !== tossOrderId ||
      confirmedStatus !== "DONE" ||
      !Number.isFinite(confirmedAmount) ||
      Math.round(confirmedAmount) !== Math.round(amount)
    ) {
      await supabaseAdmin
        .from("order_checkout_attempts")
        .update({
          status: "failed",
          failure_code: "TOSS_RESPONSE_MISMATCH",
          failure_detail: "Confirmed payment identifiers, status, or amount did not match the checkout attempt.",
        })
        .eq("id", attempt.id);
      return NextResponse.json(
        { ok: false, code: "TOSS_RESPONSE_MISMATCH", message: "승인된 결제 정보가 주문과 일치하지 않습니다." },
        { status: 502 },
      );
    }

    const approved = await supabaseAdmin
      .from("order_checkout_attempts")
      .update({
        status: "approved_not_applied",
        payment_key: paymentKey,
        pg_status: confirmedStatus,
        pg_approved_at: new Date().toISOString(),
        toss_response: tossResult,
        failure_code: null,
        failure_detail: null,
      })
      .eq("id", attempt.id)
      .in("status", ["quoted", "confirming", "approved_not_applied"]);
    if (approved.error) {
      return NextResponse.json(
        {
          ok: false,
          code: "PAYMENT_APPROVED_NOT_RECORDED",
          message: "결제는 승인됐지만 주문 기록을 복구해야 합니다. 고객센터에 문의해주세요.",
        },
        { status: 500 },
      );
    }

    try {
      const finalized = await finalizeCheckoutAttempt(supabaseAdmin, attempt.id);
      return NextResponse.json({ ok: true, order: orderResponse(finalized) });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      await supabaseAdmin
        .from("order_checkout_attempts")
        .update({
          status: "approved_not_applied",
          failure_code: "ORDER_FINALIZE_FAILED",
          failure_detail: detail.slice(0, 1000),
        })
        .eq("id", attempt.id);
      return NextResponse.json(
        {
          ok: false,
          code: "PAYMENT_APPROVED_ORDER_RECOVERY_REQUIRED",
          message: "결제는 확인됐으며 주문 접수를 복구하고 있습니다. 다시 확인해주세요.",
        },
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
