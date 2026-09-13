import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  finalizeCheckoutAttempt,
  getCheckoutAttempt,
  paymentWebhookSecretHash,
  recordApprovedCheckoutRecoveryFailure,
} from "../../../orders/_lib/checkoutAttempts";
import { createSupabaseAdminClient } from "../../../_lib/storeAuth";

type PaymentRecord = Record<string, unknown>;

function asRecord(value: unknown): PaymentRecord {
  return value && typeof value === "object" ? (value as PaymentRecord) : {};
}

function sameSecret(expected: unknown, received: unknown) {
  const left = Buffer.from(String(expected || "").trim());
  const right = Buffer.from(String(received || "").trim());
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

async function responseJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function isVerifiedDone(value: unknown, expected: { paymentKey: string; tossOrderId: string; amount: number }) {
  const payment = asRecord(value);
  return (
    String(payment.paymentKey || "").trim() === expected.paymentKey &&
    String(payment.orderId || "").trim() === expected.tossOrderId &&
    String(payment.status || "").trim() === "DONE" &&
    Math.round(Number(payment.totalAmount ?? payment.amount ?? Number.NaN)) === expected.amount
  );
}

/**
 * This endpoint never approves a payment. It resumes an order only after a
 * prior server approval stored Toss' per-payment webhook secret. The incoming
 * secret and an independent server-to-server Toss lookup must both match.
 */
export async function POST(req: NextRequest) {
  try {
    const event = asRecord(await req.json().catch(() => null));
    const data = asRecord(event.data);
    const paymentKey = String(data.paymentKey || "").trim();
    const tossOrderId = String(data.orderId || "").trim();
    const amount = Math.round(Number(data.totalAmount ?? data.amount ?? Number.NaN));
    if (
      String(event.eventType || "").trim() !== "PAYMENT_STATUS_CHANGED" ||
      String(data.status || "").trim() !== "DONE" ||
      !paymentKey ||
      !tossOrderId ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) return NextResponse.json({ ok: true, ignored: true });

    const admin = createSupabaseAdminClient();
    const attempt = await getCheckoutAttempt({ supabaseAdmin: admin, tossOrderId });
    if (!attempt || attempt.checkout_type !== "prepaid" || attempt.status === "completed") {
      return NextResponse.json({ ok: true, ignored: true });
    }
    if (
      amount !== Number(attempt.payable_amount) ||
      attempt.payment_key !== paymentKey ||
      !sameSecret(asRecord(attempt.toss_response).webhookSecretHash, paymentWebhookSecretHash(data.secret))
    ) return NextResponse.json({ ok: true, ignored: true });

    const pg = await admin.from("store_pg_config").select("secret_key").eq("store_id", attempt.store_id).maybeSingle();
    const secretKey = String(pg.data?.secret_key || "").trim();
    if (pg.error || !secretKey) return NextResponse.json({ ok: false }, { status: 503 });

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const providerResponse = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, {
      headers: { Authorization: `Basic ${basicToken}` },
      cache: "no-store",
    });
    const providerPayment = await responseJson(providerResponse);
    if (!providerResponse.ok || !isVerifiedDone(providerPayment, { paymentKey, tossOrderId, amount })) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }

    try {
      await finalizeCheckoutAttempt(admin, attempt.id);
      return NextResponse.json({ ok: true });
    } catch (error: unknown) {
      await recordApprovedCheckoutRecoveryFailure(admin, attempt.id, error);
      return NextResponse.json({ ok: false }, { status: 503 });
    }
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
