import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type ConfirmSubscriptionBody = { paymentKey?: unknown; orderId?: unknown; amount?: unknown; storeId?: unknown };
type AttemptRow = {
  id: number;
  order_id: string;
  store_id: string;
  payer_user_id: string;
  final_amount_krw: number;
  status: string;
  payment_key: string | null;
  expires_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function publicError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmSubscriptionBody;
    const paymentKey = String(body.paymentKey || "").trim();
    const orderId = String(body.orderId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const amount = Number(body.amount || 0);
    if (!paymentKey || !orderId || !storeId || !Number.isFinite(amount) || amount <= 0) {
      return publicError("INVALID_PAYMENT_RETURN", "결제 확인 정보가 올바르지 않습니다.", 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    const attemptRes = await supabaseAdmin
      .from("billing_payment_attempts")
      .select("id,order_id,store_id,payer_user_id,final_amount_krw,status,payment_key,expires_at")
      .eq("order_id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (attemptRes.error) return publicError("ATTEMPT_LOOKUP_FAILED", "결제 준비 정보를 확인하지 못했습니다.", 500);
    if (!attemptRes.data) return publicError("ATTEMPT_NOT_FOUND", "결제 준비 정보가 없습니다. 다시 결제하지 말고 고객센터에 문의해 주세요.", 404);
    const attempt = attemptRes.data as AttemptRow;
    if (attempt.payer_user_id !== userId) return publicError("ATTEMPT_OWNER_MISMATCH", "결제 요청자가 일치하지 않습니다.", 403);
    if (Math.round(attempt.final_amount_krw) !== Math.round(amount)) {
      return publicError("PAYMENT_AMOUNT_MISMATCH", "결제 금액이 서버 견적과 일치하지 않습니다.", 409);
    }
    if (attempt.status === "applied") return NextResponse.json({ ok: true, alreadyApplied: true });
    if (attempt.payment_key && attempt.payment_key !== paymentKey) {
      return publicError("PAYMENT_KEY_MISMATCH", "이미 다른 결제 정보로 처리된 주문입니다.", 409);
    }

    if (attempt.status === "approved" || attempt.status === "approved_not_applied") {
      const applyRes = await supabaseAdmin.rpc("apply_billing_payment_attempt", { p_attempt_id: attempt.id });
      if (applyRes.error) {
        await supabaseAdmin.from("billing_payment_attempts").update({ status: "approved_not_applied", public_error_code: "SUBSCRIPTION_APPLY_FAILED" }).eq("id", attempt.id);
        return publicError("APPROVED_NOT_APPLIED", "결제는 승인되었습니다. 구독 반영을 확인 중이니 다시 결제하지 마세요.", 202);
      }
      return NextResponse.json({ ok: true, recovered: true, billingPayment: applyRes.data });
    }

    const pgRes = await supabaseAdmin.from("platform_pg_config").select("secret_key").eq("id", 1).maybeSingle();
    const secretKey = String(pgRes.data?.secret_key || "").trim();
    if (pgRes.error || !secretKey) return publicError("PLATFORM_PG_UNAVAILABLE", "구독 결제 설정을 확인할 수 없습니다.", 503);

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    let tossRes: Response;
    try {
      tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: { Authorization: `Basic ${basicToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount: attempt.final_amount_krw }),
        cache: "no-store",
      });
    } catch {
      return publicError("TOSS_UNREACHABLE", "결제사 응답을 확인하지 못했습니다. 카드 승인 문자를 받았다면 다시 결제하지 마세요.", 502);
    }

    const raw = await tossRes.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
    if (!tossRes.ok) {
      await supabaseAdmin.from("billing_payment_attempts").update({ status: "failed", public_error_code: "TOSS_CONFIRM_FAILED" }).eq("id", attempt.id);
      return publicError("TOSS_CONFIRM_FAILED", "결제가 승인되지 않았습니다. 카드 승인 여부를 확인해 주세요.", tossRes.status);
    }

    const toss = asRecord(parsed);
    const responseAmount = Number(toss.totalAmount ?? toss.amount ?? NaN);
    if (
      String(toss.paymentKey || "") !== paymentKey ||
      String(toss.orderId || "") !== orderId ||
      String(toss.status || "").toUpperCase() !== "DONE" ||
      !Number.isFinite(responseAmount) || Math.round(responseAmount) !== Math.round(attempt.final_amount_krw)
    ) {
      return publicError("TOSS_RESPONSE_MISMATCH", "결제는 접수되었지만 결과 확인이 필요합니다. 다시 결제하지 마세요.", 502);
    }

    const approvedUpdate = await supabaseAdmin.from("billing_payment_attempts").update({
      status: "approved", payment_key: paymentKey, toss_response: parsed, approved_at: new Date().toISOString(), public_error_code: null,
    }).eq("id", attempt.id);
    if (approvedUpdate.error) {
      return publicError("APPROVAL_SAVE_FAILED", "결제는 승인되었습니다. 구독 반영을 확인 중이니 다시 결제하지 마세요.", 202);
    }

    const applyRes = await supabaseAdmin.rpc("apply_billing_payment_attempt", { p_attempt_id: attempt.id });
    if (applyRes.error) {
      await supabaseAdmin.from("billing_payment_attempts").update({ status: "approved_not_applied", public_error_code: "SUBSCRIPTION_APPLY_FAILED" }).eq("id", attempt.id);
      return publicError("APPROVED_NOT_APPLIED", "결제는 승인되었습니다. 구독 반영을 확인 중이니 다시 결제하지 마세요.", 202);
    }
    return NextResponse.json({ ok: true, billingPayment: applyRes.data });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
