import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type CancelBody = {
  paymentId?: number;
  storeId?: string;
  reason?: string;
  pgMode?: "store" | "platform" | string;
};

type PgMode = "store" | "platform";

const CANCEL_WINDOW_MINUTES = 10;
const MAX_CANCEL_REASON_LENGTH = 120;

function parsePgMode(rawPgMode: unknown, defaultMode: PgMode): PgMode | null {
  const pgMode = String(rawPgMode || defaultMode).trim();
  return pgMode === "store" || pgMode === "platform" ? pgMode : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const paymentId = Number(body?.paymentId || 0);
    const storeId = String(body?.storeId || "").trim();
    const reason = String(body?.reason || "").trim();
    const pgMode = parsePgMode(body?.pgMode, "platform");

    if (!Number.isFinite(paymentId) || paymentId <= 0 || !storeId) {
      return NextResponse.json({ ok: false, message: "필수 파라미터가 누락되었습니다." }, { status: 400 });
    }

    if (!pgMode) {
      return NextResponse.json({ ok: false, message: "지원하지 않는 PG 결제 모드입니다." }, { status: 400 });
    }

    if (reason.length > MAX_CANCEL_REASON_LENGTH) {
      return NextResponse.json({ ok: false, message: `취소 사유는 ${MAX_CANCEL_REASON_LENGTH}자 이하로 입력해 주세요.` }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    if (pgMode === "platform") {
      await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    }

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

    const cancelReason = reason || "관리자 즉시 취소";
    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const cancelRes = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cancelReason }),
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
    return apiErrorResponse(e);
  }
}
