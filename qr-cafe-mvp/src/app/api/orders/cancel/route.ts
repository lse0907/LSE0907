import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CancelBody = {
  storeId?: string;
  orderId?: string;
  accessToken?: string;
  actor?: "customer" | "staff";
  reason?: string;
};

async function cancelTossPaymentByOrder(
  secretKey: string,
  tossOrderId: string,
  paymentKey: string | null,
  cancelReason: string
) {
  const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
  let resolvedPaymentKey = String(paymentKey || "").trim();

  if (!resolvedPaymentKey) {
    const lookupRes = await fetch(`https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(tossOrderId)}`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${basicToken}`,
      },
      cache: "no-store",
    });

    const lookupRaw = await lookupRes.text();
    let lookupJson: any = null;
    try {
      lookupJson = JSON.parse(lookupRaw);
    } catch {
      lookupJson = { raw: lookupRaw };
    }

    if (!lookupRes.ok) {
      return {
        ok: false,
        status: lookupRes.status,
        message: "토스 결제 조회 실패",
        toss: lookupJson,
      };
    }

    resolvedPaymentKey = String(lookupJson?.paymentKey || "").trim();
  }

  if (!resolvedPaymentKey) {
    return {
      ok: false,
      status: 400,
      message: "결제 취소를 위한 paymentKey를 찾지 못했습니다.",
      toss: null,
    };
  }

  const cancelRes = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(resolvedPaymentKey)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cancelReason: cancelReason || "고객 요청 주문취소",
    }),
    cache: "no-store",
  });

  const cancelRaw = await cancelRes.text();
  let cancelJson: any = null;
  try {
    cancelJson = JSON.parse(cancelRaw);
  } catch {
    cancelJson = { raw: cancelRaw };
  }

  if (!cancelRes.ok) {
    return {
      ok: false,
      status: cancelRes.status,
      message: "토스 결제 취소 실패",
      toss: cancelJson,
    };
  }

  return {
    ok: true,
    status: 200,
    message: "ok",
    toss: cancelJson,
    paymentKey: resolvedPaymentKey,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const storeId = String(body?.storeId || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const accessToken = String(body?.accessToken || "").trim();
    const actor = body?.actor === "staff" ? "staff" : "customer";
    const reason = String(body?.reason || "").trim() || "주문 취소";

    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, message: "필수 파라미터(storeId, orderId)가 누락되었습니다." }, { status: 400 });
    }

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const serviceRole =
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json({ ok: false, message: "서버 환경변수(SUPABASE)가 필요합니다." }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let orderQuery = await supabaseAdmin
      .from("orders")
      .select("id,store_id,status,payment_status,access_token,payment_key,toss_order_id")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (orderQuery.error) {
      const low = String(orderQuery.error.message || "").toLowerCase();
      const missingPaymentKeyColumn = low.includes("payment_key") && (low.includes("column") || low.includes("schema cache"));
      const missingTossOrderIdColumn = low.includes("toss_order_id") && (low.includes("column") || low.includes("schema cache"));
      if (missingPaymentKeyColumn || missingTossOrderIdColumn) {
        orderQuery = await supabaseAdmin
          .from("orders")
          .select("id,store_id,status,payment_status,access_token")
          .eq("id", orderId)
          .eq("store_id", storeId)
          .maybeSingle();
      }
    }
    const { data: order, error: orderErr } = orderQuery;

    if (orderErr) {
      return NextResponse.json({ ok: false, message: `주문 조회 실패: ${orderErr.message}` }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ ok: false, message: "주문을 찾을 수 없습니다." }, { status: 404 });
    }

    if (actor === "customer") {
      if (!accessToken || accessToken !== String(order.access_token || "").trim()) {
        return NextResponse.json({ ok: false, message: "주문 취소 권한이 없습니다." }, { status: 403 });
      }
      if (String(order.status || "") !== "new") {
        return NextResponse.json(
          { ok: false, code: "ORDER_ALREADY_CONFIRMED", message: "매장에서 주문 확인 후에는 앱에서 직접 취소할 수 없습니다." },
          { status: 409 }
        );
      }
    } else {
      const status = String(order.status || "");
      if (status === "completed" || status === "cancelled") {
        return NextResponse.json({ ok: false, message: "완료/취소 주문은 취소할 수 없습니다." }, { status: 409 });
      }
    }

    if (String(order.status || "") === "cancelled") {
      return NextResponse.json({ ok: true, skipped: "already_cancelled" });
    }

    const paymentStatus = String(order.payment_status || "not_required");
    if (paymentStatus === "paid") {
      const { data: pgRow, error: pgErr } = await supabaseAdmin
        .from("store_pg_config")
        .select("secret_key")
        .eq("store_id", storeId)
        .maybeSingle();

      if (pgErr) {
        return NextResponse.json({ ok: false, message: `PG 조회 실패: ${pgErr.message}` }, { status: 500 });
      }

      const secretKey = String(pgRow?.secret_key || "").trim();
      if (!secretKey) {
        return NextResponse.json({ ok: false, message: "매장 Secret Key가 없습니다." }, { status: 400 });
      }

      const tossOrderId = String((order as any)?.toss_order_id || "").trim();
      const knownPaymentKey = String((order as any)?.payment_key || "").trim() || null;
      if (!knownPaymentKey && !tossOrderId) {
        return NextResponse.json(
          {
            ok: false,
            message: "결제 취소 식별자(payment_key / toss_order_id)가 없어 취소할 수 없습니다. DB 마이그레이션 반영이 필요합니다.",
          },
          { status: 409 }
        );
      }

      const cancelRes = await cancelTossPaymentByOrder(
        secretKey,
        tossOrderId,
        knownPaymentKey,
        reason
      );
      if (!cancelRes.ok) {
        return NextResponse.json(
          { ok: false, message: cancelRes.message, toss: cancelRes.toss },
          { status: cancelRes.status || 500 }
        );
      }
    }

    const { error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("store_id", storeId);
    if (updateErr) {
      return NextResponse.json({ ok: false, message: `주문 상태 업데이트 실패: ${updateErr.message}` }, { status: 500 });
    }

    const { error: rollbackErr } = await supabaseAdmin.rpc("rollback_order_rewards", {
      p_store_id: storeId,
      p_order_id: orderId,
    });
    if (rollbackErr) {
      return NextResponse.json({ ok: false, message: `보상 롤백 실패: ${rollbackErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
