import { NextRequest } from "next/server";
import {
  finalizeCheckoutAttempt,
  listPendingPrepaidCheckoutAttempts,
  recordApprovedCheckoutRecoveryFailure,
} from "../../orders/_lib/checkoutAttempts";
import { essentialPaymentSnapshot } from "../../orders/_lib/tossCancellation";
import { createSupabaseAdminClient } from "../../_lib/storeAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 55;

type PaymentRecord = Record<string, unknown>;

function asRecord(value: unknown): PaymentRecord {
  return value && typeof value === "object" ? (value as PaymentRecord) : {};
}

async function responseJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function verifiedDone(value: unknown, expected: { tossOrderId: string; amount: number }) {
  const payment = asRecord(value);
  const paymentKey = String(payment.paymentKey || "").trim();
  return (
    !!paymentKey &&
    String(payment.orderId || "").trim() === expected.tossOrderId &&
    String(payment.status || "").trim() === "DONE" &&
    Math.round(Number(payment.totalAmount ?? payment.amount ?? Number.NaN)) === expected.amount
  );
}

function authorized(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Webhook-independent last-resort reconciliation. It only looks up a payment
 * by the server-generated Toss order ID, verifies amount and DONE status with
 * the store's secret key, then calls the existing idempotent finalizer.
 *
 * It never approves, cancels, refunds, or creates a customer-supplied order.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return Response.json({ ok: false, code: "CRON_UNAUTHORIZED" }, { status: 401 });

  try {
    const admin = createSupabaseAdminClient();
    const attempts = await listPendingPrepaidCheckoutAttempts({ supabaseAdmin: admin, limit: 50 });
    const outcomes = { completed: 0, pending: 0, skipped: 0, failed: 0 };

    for (const attempt of attempts) {
      try {
        if (attempt.status === "approved_not_applied" && attempt.pg_status === "DONE") {
          await finalizeCheckoutAttempt(admin, attempt.id);
          outcomes.completed += 1;
          continue;
        }

        const tossOrderId = String(attempt.toss_order_id || "").trim();
        if (!tossOrderId) {
          outcomes.skipped += 1;
          continue;
        }
        const pg = await admin.from("store_pg_config").select("secret_key").eq("store_id", attempt.store_id).maybeSingle();
        const secretKey = String(pg.data?.secret_key || "").trim();
        if (pg.error || !secretKey) {
          outcomes.pending += 1;
          continue;
        }

        const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
        const response = await fetch(
          `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(tossOrderId)}`,
          { headers: { Authorization: `Basic ${basicToken}` }, cache: "no-store" },
        );
        const payment = await responseJson(response);
        if (!response.ok || !verifiedDone(payment, { tossOrderId, amount: Number(attempt.payable_amount) })) {
          outcomes.pending += 1;
          continue;
        }

        const paymentKey = String(asRecord(payment).paymentKey || "").trim();
        const marked = await admin
          .from("order_checkout_attempts")
          .update({
            status: "approved_not_applied",
            payment_key: paymentKey,
            pg_status: "DONE",
            pg_approved_at: new Date().toISOString(),
            toss_response: essentialPaymentSnapshot(payment),
            failure_code: null,
            failure_detail: null,
          })
          .eq("id", attempt.id)
          .in("status", ["confirming", "approved_not_applied"]);
        if (marked.error) throw new Error(`PAYMENT_RECONCILIATION_MARK_FAILED: ${marked.error.message}`);

        await finalizeCheckoutAttempt(admin, attempt.id);
        outcomes.completed += 1;
      } catch (error: unknown) {
        try {
          await recordApprovedCheckoutRecoveryFailure(admin, attempt.id, error);
        } catch {
          // Keep the cron pass alive; the next pass will inspect this attempt again.
        }
        outcomes.failed += 1;
      }
    }

    return Response.json({ ok: true, scanned: attempts.length, outcomes }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, code: "ORDER_PAYMENT_RECONCILIATION_FAILED" }, { status: 500 });
  }
}
