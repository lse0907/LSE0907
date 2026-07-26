import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type RequestBody = { storeId?: unknown; paymentId?: unknown; reason?: unknown };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    const storeId = String(body.storeId || "").trim();
    const paymentId = Number(body.paymentId || 0);
    const reason = String(body.reason || "").trim();
    if (!storeId || !Number.isInteger(paymentId) || paymentId <= 0 || reason.length < 2 || reason.length > 500) {
      throw new ApiError(400, "환불 요청 정보와 사유를 확인해 주세요.", "INVALID_REFUND_REQUEST");
    }

    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const payment = await admin.from("billing_payments")
      .select("id,store_id,order_id,amount_krw,paid_at,status,base_paid,addon_paid")
      .eq("id", paymentId).eq("store_id", storeId).maybeSingle();
    if (payment.error || !payment.data) throw new ApiError(404, "결제 내역을 찾지 못했습니다.", "PAYMENT_NOT_FOUND");
    if (String(payment.data.status) !== "paid") throw new ApiError(409, "이미 취소됐거나 처리 중인 결제입니다.", "PAYMENT_NOT_REQUESTABLE");

    const existing = await admin.from("billing_refund_cases").select("id,status")
      .eq("billing_payment_id", paymentId)
      .in("status", ["requested", "reviewing", "approved", "processing", "reconcile_required"])
      .maybeSingle();
    if (existing.data) return NextResponse.json({ ok: true, alreadyRequested: true, caseId: existing.data.id });

    const label = payment.data.base_paid && payment.data.addon_paid ? "기본 구독 + 선결제 옵션" : payment.data.base_paid ? "기본 구독" : "선결제 옵션";
    const ticket = await admin.from("support_tickets").insert({
      store_id: storeId,
      requester_user_id: actor.userId,
      category: "billing",
      priority: "normal",
      title: `[환불 요청] ${label} · 결제 #${paymentId}`,
      body: `결제일: ${payment.data.paid_at}\n결제금액: ${Number(payment.data.amount_krw || 0).toLocaleString()}원\n주문번호: ${payment.data.order_id || "-"}\n요청사유: ${reason}`,
      billing_payment_id: paymentId,
      status: "open",
    }).select("id").single();
    if (ticket.error || !ticket.data) throw new ApiError(500, "환불 문의를 등록하지 못했습니다.", "REFUND_TICKET_SAVE_FAILED");

    const refundCase = await admin.from("billing_refund_cases").insert({
      billing_payment_id: paymentId,
      store_id: storeId,
      support_ticket_id: ticket.data.id,
      requested_by: actor.userId,
      reason,
      status: "requested",
    }).select("id").single();
    if (refundCase.error || !refundCase.data) {
      await admin.from("support_tickets").delete().eq("id", ticket.data.id);
      throw new ApiError(500, "환불 요청을 저장하지 못했습니다.", "REFUND_CASE_SAVE_FAILED");
    }
    return NextResponse.json({ ok: true, caseId: refundCase.data.id, ticketId: ticket.data.id });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
