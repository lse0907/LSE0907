import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type ConfirmSubscriptionBody = {
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  storeId?: string;
  planMonths?: number;
  payBase?: boolean;
  payAddon?: boolean;
};

type BillingApplyRow = {
  id: number;
  store_id: string;
  amount_krw: number | null;
  after_paid_until: string | null;
  order_id: string | null;
  payment_key: string | null;
  status: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizePlanMonths(value: unknown) {
  const planMonths = Number(value || 0);
  return planMonths === 1 || planMonths === 3 || planMonths === 6 || planMonths === 12 ? planMonths : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmSubscriptionBody;
    const paymentKey = String(body?.paymentKey || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const storeId = String(body?.storeId || "").trim();
    const amount = Number(body?.amount || 0);
    const planMonths = normalizePlanMonths(body?.planMonths);
    const payBase = body?.payBase === true;
    const payAddon = body?.payAddon === true;

    if (!paymentKey || !orderId || !storeId || !Number.isFinite(amount) || amount <= 0 || !planMonths) {
      return NextResponse.json({ ok: false, message: "필수 결제 정보가 누락되었습니다." }, { status: 400 });
    }

    if (!payBase && !payAddon) {
      return NextResponse.json({ ok: false, message: "결제할 구독 항목을 선택해 주세요." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const existingByPaymentKey = await supabaseAdmin
      .from("billing_payments")
      .select("id, store_id, amount_krw, after_paid_until, order_id, payment_key, status")
      .eq("payment_key", paymentKey)
      .eq("store_id", storeId)
      .maybeSingle();
    if (existingByPaymentKey.error) {
      return NextResponse.json({ ok: false, message: `결제 이력 확인 실패: ${existingByPaymentKey.error.message}` }, { status: 500 });
    }
    if (existingByPaymentKey.data) {
      return NextResponse.json({ ok: true, alreadyApplied: true, billingPayment: existingByPaymentKey.data });
    }

    const existingByOrderId = await supabaseAdmin
      .from("billing_payments")
      .select("id, store_id, amount_krw, after_paid_until, order_id, payment_key, status")
      .eq("order_id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (existingByOrderId.error) {
      return NextResponse.json({ ok: false, message: `결제 이력 확인 실패: ${existingByOrderId.error.message}` }, { status: 500 });
    }
    if (existingByOrderId.data) {
      return NextResponse.json({ ok: true, alreadyApplied: true, billingPayment: existingByOrderId.data });
    }

    const [baseRes, addonRes, pgRes] = await Promise.all([
      supabaseAdmin.from("store_billing").select("base_price_krw").eq("store_id", storeId).maybeSingle(),
      supabaseAdmin.from("store_addons").select("prepay_addon_price_krw").eq("store_id", storeId).maybeSingle(),
      supabaseAdmin.from("platform_pg_config").select("secret_key").eq("id", 1).maybeSingle(),
    ]);

    if (baseRes.error) {
      return NextResponse.json({ ok: false, message: `기본 구독 정보 확인 실패: ${baseRes.error.message}` }, { status: 500 });
    }
    if (addonRes.error) {
      return NextResponse.json({ ok: false, message: `옵션 구독 정보 확인 실패: ${addonRes.error.message}` }, { status: 500 });
    }
    if (pgRes.error) {
      return NextResponse.json({ ok: false, message: `플랫폼 PG 조회 실패: ${pgRes.error.message}` }, { status: 500 });
    }

    const basePrice = Math.max(0, Number(baseRes.data?.base_price_krw || 8900));
    const addonPrice = Math.max(0, Number(addonRes.data?.prepay_addon_price_krw || 5000));
    const expectedAmount = planMonths * ((payBase ? basePrice : 0) + (payAddon ? addonPrice : 0));
    if (Math.round(expectedAmount) !== Math.round(amount)) {
      return NextResponse.json(
        {
          ok: false,
          message: "결제 금액이 현재 구독 금액과 일치하지 않습니다. 새로고침 후 다시 결제해 주세요.",
          expectedAmount,
        },
        { status: 409 }
      );
    }

    const secretKey = String(pgRes.data?.secret_key || "").trim();
    if (!secretKey) {
      return NextResponse.json({ ok: false, message: "플랫폼 Secret Key가 없습니다." }, { status: 400 });
    }

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
      cache: "no-store",
    });

    const raw = await tossRes.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!tossRes.ok) {
      return NextResponse.json({ ok: false, message: "토스 승인 실패", toss: parsed }, { status: tossRes.status });
    }

    const toss = asRecord(parsed);
    const tossPaymentKey = String(toss.paymentKey || "").trim();
    const tossOrderId = String(toss.orderId || "").trim();
    const tossStatus = String(toss.status || "").trim();
    const tossTotalAmount = Number(toss.totalAmount ?? toss.amount ?? NaN);

    if (
      tossPaymentKey !== paymentKey ||
      tossOrderId !== orderId ||
      !Number.isFinite(tossTotalAmount) ||
      Math.round(tossTotalAmount) !== Math.round(amount) ||
      tossStatus !== "DONE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "토스 승인 응답이 요청한 구독 결제 정보와 일치하지 않습니다.",
          toss: parsed,
        },
        { status: 502 }
      );
    }

    const { data, error } = await supabaseAdmin.rpc("apply_store_billing_payment_verified", {
      p_store_id: storeId,
      p_payer_user_id: userId,
      p_plan_months: planMonths,
      p_base_paid: payBase,
      p_addon_paid: payAddon,
      p_payment_key: paymentKey,
      p_order_id: orderId,
      p_amount_krw: amount,
      p_note: `플랫폼 PG 결제 ${planMonths}개월`,
    });

    if (error) {
      return NextResponse.json({ ok: false, message: `결제 반영 실패: ${error.message}`, toss: parsed }, { status: 500 });
    }

    return NextResponse.json({ ok: true, toss: parsed, billingPayment: data as BillingApplyRow | null });
  } catch (e: unknown) {
    return apiErrorResponse(e);
  }
}
