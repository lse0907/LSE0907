import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";

type Body = { paymentId?: unknown; action?: unknown; reason?: unknown };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const paymentId = Number(body.paymentId || 0);
    const action = String(body.action || "inspect");
    const reason = String(body.reason || "").trim();
    if (!Number.isInteger(paymentId) || paymentId <= 0 || !["inspect", "sync"].includes(action)) throw new ApiError(400, "결제 확인 요청이 올바르지 않습니다.", "INVALID_RECONCILE_REQUEST");
    if (action === "sync" && reason.length < 2) throw new ApiError(400, "동기화 사유를 입력해 주세요.", "REASON_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "billing"]);
    const payment = await admin.from("billing_payments").select("id,store_id,payment_key,order_id,status").eq("id", paymentId).maybeSingle();
    if (payment.error || !payment.data) throw new ApiError(404, "결제를 찾지 못했습니다.", "PAYMENT_NOT_FOUND");
    const pg = await admin.from("platform_pg_config").select("secret_key").eq("id", 1).maybeSingle();
    const secretKey = String(pg.data?.secret_key || "").trim();
    const paymentKey = String(payment.data.payment_key || "").trim();
    if (pg.error || !secretKey || !paymentKey) throw new ApiError(409, "PG 결제 확인 정보가 없습니다.", "PG_LOOKUP_UNAVAILABLE");

    const auth = Buffer.from(`${secretKey}:`).toString("base64");
    const tossResponse = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
    const raw = await tossResponse.text();
    let toss: Record<string, unknown> = {};
    try { toss = JSON.parse(raw) as Record<string, unknown>; } catch { toss = { raw: raw.slice(0, 300) }; }
    if (!tossResponse.ok) throw new ApiError(502, "Toss 결제 상태를 확인하지 못했습니다.", "TOSS_LOOKUP_FAILED");
    const tossStatus = String(toss.status || "").toUpperCase();
    const matches = String(toss.paymentKey || "") === paymentKey && String(toss.orderId || "") === String(payment.data.order_id || "");
    if (!matches) throw new ApiError(409, "Toss 결제 정보가 내부 결제와 일치하지 않습니다.", "TOSS_PAYMENT_MISMATCH");
    if (action === "inspect") return NextResponse.json({ ok: true, paymentId, localStatus: payment.data.status, tossStatus });
    if (tossStatus !== "CANCELED") throw new ApiError(409, "Toss에서 취소 완료된 결제만 내부 상태를 동기화할 수 있습니다.", "TOSS_NOT_CANCELED");

    const synced = await admin.rpc("sync_verified_historical_billing_refund", { p_payment_id: paymentId, p_store_id: payment.data.store_id, p_actor_user_id: actor.userId, p_reason: reason });
    if (synced.error || !synced.data) throw new ApiError(500, "내부 구독 상태를 동기화하지 못했습니다.", "REFUND_SYNC_FAILED");
    await admin.from("billing_refund_cases").update({ status: "completed", toss_status: tossStatus, ops_note: reason, handled_by: actor.userId, handled_at: new Date().toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("billing_payment_id", paymentId).neq("status", "completed");
    await admin.from("billing_admin_audit_logs").insert({ actor_user_id: actor.userId, action: "historical_refund_synced", store_id: payment.data.store_id, reason, after_data: { payment_id: paymentId, toss_status: tossStatus } });
    return NextResponse.json({ ok: true, paymentId, localStatus: "refunded", tossStatus });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
