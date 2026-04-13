import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CancelBody = {
  paymentId?: number;
  storeId?: string;
  reason?: string;
  pgMode?: "store" | "platform" | string;
};

const CANCEL_WINDOW_MINUTES = 10;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const paymentId = Number(body?.paymentId || 0);
    const storeId = String(body?.storeId || "").trim();
    const reason = String(body?.reason || "").trim();
    const pgMode = String(body?.pgMode || "platform").trim();

    if (!Number.isFinite(paymentId) || paymentId <= 0 || !storeId) {
      return NextResponse.json({ ok: false, message: "필수 파라미터가 누락되었습니다." }, { status: 400 });
    }

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const serviceRole =
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json({ ok: false, message: "서버 환경변수 설정이 필요합니다." }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const paymentRes = await supabaseAdmin
      .from("billing_payments")
      .select("id, store_id, payment_key, order_id, amount_krw, paid_at, status, base_paid, addon_paid, before_paid_until, after_paid_until, note")
      .eq("id", paymentId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (paymentRes.error || !paymentRes.data) {
      return NextResponse.json({ ok: false, message: `결제건 조회 실패: ${paymentRes.error?.message || "결제건 없음"}` }, { status: 404 });
    }

    const payment = paymentRes.data;
    if (String(payment.status) !== "paid") {
      return NextResponse.json({ ok: false, message: "이미 취소/환불 또는 실패 처리된 결제건입니다." }, { status: 409 });
    }

    const paidAtMs = new Date(String(payment.paid_at || "")).getTime();
    if (!Number.isFinite(paidAtMs)) {
      return NextResponse.json({ ok: false, message: "결제 시간 정보가 유효하지 않습니다." }, { status: 400 });
    }
    const elapsedMin = Math.floor((Date.now() - paidAtMs) / 60000);
    if (elapsedMin > CANCEL_WINDOW_MINUTES) {
      return NextResponse.json({ ok: false, message: `결제 후 ${CANCEL_WINDOW_MINUTES}분이 지나 즉시 취소가 불가합니다.` }, { status: 409 });
    }

    const pgRes =
      pgMode === "platform"
        ? await supabaseAdmin.from("platform_pg_config").select("secret_key").eq("id", 1).maybeSingle()
        : await supabaseAdmin.from("store_pg_config").select("secret_key").eq("store_id", storeId).maybeSingle();
    if (pgRes.error) {
      return NextResponse.json({ ok: false, message: `PG 조회 실패: ${pgRes.error.message}` }, { status: 500 });
    }

    const secretKey = String(pgRes.data?.secret_key || "").trim();
    const paymentKey = String(payment.payment_key || "").trim();
    if (!secretKey || !paymentKey) {
      return NextResponse.json({ ok: false, message: "PG 취소에 필요한 키 정보가 없습니다." }, { status: 400 });
    }

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const cancelRes = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cancelReason: reason || "관리자 즉시 취소" }),
      cache: "no-store",
    });

    const raw = await cancelRes.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!cancelRes.ok) {
      return NextResponse.json({ ok: false, message: "토스 취소 실패", toss: parsed }, { status: cancelRes.status });
    }

    const cancelNote = `[즉시취소] ${reason || "사유 미입력"}`;
    const updatePayment = await supabaseAdmin
      .from("billing_payments")
      .update({
        status: "refunded",
        updated_at: new Date().toISOString(),
        note: `${String(payment.note || "").trim()} ${cancelNote}`.trim(),
      })
      .eq("id", paymentId)
      .eq("store_id", storeId);

    if (updatePayment.error) {
      return NextResponse.json({ ok: false, message: `결제 상태 업데이트 실패: ${updatePayment.error.message}` }, { status: 500 });
    }

    const beforePaidUntil = String(payment.before_paid_until || "").trim() || null;
    const statusFromBefore = beforePaidUntil && new Date(beforePaidUntil).getTime() > Date.now() ? "active" : "inactive";

    if (payment.base_paid) {
      const baseRes = await supabaseAdmin
        .from("store_billing")
        .update({
          paid_until: beforePaidUntil,
          base_plan_status: statusFromBefore,
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", storeId)
        .eq("paid_until", payment.after_paid_until || "");
      if (baseRes.error) {
        return NextResponse.json({ ok: false, message: `기본 구독 롤백 실패: ${baseRes.error.message}` }, { status: 500 });
      }
    }

    if (payment.addon_paid) {
      const addonRes = await supabaseAdmin
        .from("store_addons")
        .update({
          addon_paid_until: beforePaidUntil,
          prepay_addon_status: statusFromBefore,
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", storeId)
        .eq("addon_paid_until", payment.after_paid_until || "");
      if (addonRes.error) {
        return NextResponse.json({ ok: false, message: `옵션 구독 롤백 실패: ${addonRes.error.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, toss: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
