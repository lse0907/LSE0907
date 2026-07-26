import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";

function safeInternalError(value: unknown) {
  return String(value || "")
    .replace(/(?:test|live)_(?:sk|ck)_[A-Za-z0-9_-]+/gi, "[MASKED_PG_KEY]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[MASKED_TOKEN]")
    .slice(0, 500) || null;
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "billing"]);
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 100)));
    const { data, error } = await admin
      .from("billing_refund_attempts")
      .select("id,billing_payment_id,store_id,requested_by,amount_krw,reason,status,public_error_code,internal_error,pg_status,requested_at,pg_responded_at,completed_at,updated_at")
      .order("requested_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`환불 이력을 불러오지 못했습니다: ${error.message}`);
    const cases = await admin.from("billing_refund_cases")
      .select("id,billing_payment_id,store_id,support_ticket_id,reason,status,toss_status,toss_checked_at,local_payment_status_snapshot,ops_note,requested_at,handled_at,completed_at,updated_at")
      .order("requested_at", { ascending: false }).limit(limit);
    if (cases.error) throw new Error(`환불 요청을 불러오지 못했습니다: ${cases.error.message}`);
    const paymentIds = [...new Set((cases.data || []).map((row) => Number(row.billing_payment_id)).filter((id) => Number.isInteger(id) && id > 0))];
    const paymentStatuses = new Map<number, string>();
    if (paymentIds.length) {
      const payments = await admin.from("billing_payments").select("id,status").in("id", paymentIds);
      if (payments.error) throw new Error(`내부 결제 상태를 불러오지 못했습니다: ${payments.error.message}`);
      for (const payment of payments.data || []) paymentStatuses.set(Number(payment.id), String(payment.status || ""));
    }

    const storeIds = [...new Set([...(data || []), ...(cases.data || [])].map((row) => String(row.store_id || "")).filter(Boolean))];
    const storeNames = new Map<string, string>();
    if (storeIds.length) {
      const stores = await admin.from("stores").select("store_id,store_name").in("store_id", storeIds);
      if (stores.error) throw new Error(`환불 매장 정보를 불러오지 못했습니다: ${stores.error.message}`);
      for (const store of stores.data || []) storeNames.set(String(store.store_id), String(store.store_name || ""));
    }

    return NextResponse.json({
      ok: true,
      rows: (data || []).map((row) => ({
        ...row,
        internal_error: safeInternalError(row.internal_error),
        store_name: storeNames.get(String(row.store_id)) || null,
      })),
      cases: (cases.data || []).map((row) => ({ ...row, local_payment_status: paymentStatuses.get(Number(row.billing_payment_id)) || row.local_payment_status_snapshot || null, store_name: storeNames.get(String(row.store_id)) || null })),
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
