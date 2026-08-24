/* eslint-disable @typescript-eslint/no-explicit-any */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { verifyPinHash } from "../../admin/members/_lib";

type CancelBody = {
  storeId?: string;
  orderId?: string;
  accessToken?: string;
  actor?: "customer" | "staff";
  reason?: string;
  reasonCode?: string;
  actorPinId?: string | null;
  managerPin?: string | null;
};

function secureTokenMatches(expected: unknown, received: string) {
  const expectedBuffer = Buffer.from(String(expected || "").trim(), "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

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
    const reasonCode = String(body?.reasonCode || "").trim() || "other";

    if (!storeId || !orderId) {
      return NextResponse.json({ ok: false, code: "MISSING_REQUIRED_FIELDS", message: "필수 정보가 없습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();

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
      return NextResponse.json({ ok: false, code: "ORDER_LOOKUP_FAILED", message: `주문 조회 실패: ${orderErr.message}` }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ ok: false, code: "ORDER_NOT_FOUND", message: "주문을 찾을 수 없습니다." }, { status: 404 });
    }

    if (actor === "customer") {
      if (!accessToken || !secureTokenMatches(order.access_token, accessToken)) {
        return NextResponse.json({ ok: false, code: "CANCEL_FORBIDDEN", message: "취소 권한이 없습니다." }, { status: 403 });
      }
      if (String(order.status || "") !== "new") {
        return NextResponse.json(
          { ok: false, code: "ORDER_ALREADY_CONFIRMED", message: "매장에서 주문 확인 후에는 앱에서 직접 취소할 수 없습니다." },
          { status: 409 }
        );
      }
    } else {
      const auth = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });
      const status = String(order.status || "");
      if (status === "completed" || status === "cancelled") {
        return NextResponse.json({ ok: false, code: "ORDER_LOCKED", message: "이미 끝난 주문입니다." }, { status: 409 });
      }
      const staffCanCancelDirectly = auth.role === "staff" && (status === "new" || status === "checked");
      if (auth.role === "staff" && !staffCanCancelDirectly) {
        const managerPin = String(body.managerPin || "").trim();
        if (!managerPin) {
          return NextResponse.json({ ok: false, code: "MANAGER_PIN_REQUIRED", message: "이 주문 취소는 매니저 PIN 승인이 필요합니다." }, { status: 403 });
        }
        const { data: managerPins, error: pinErr } = await supabaseAdmin
          .from("store_staff_pins")
          .select("id,pin_hash,is_active,pin_role")
          .eq("store_id", storeId)
          .eq("pin_role", "manager")
          .eq("is_active", true)
          .eq("approval_status", "approved");
        if (pinErr) return NextResponse.json({ ok: false, code: "MANAGER_PIN_LOOKUP_FAILED", message: `PIN 조회 실패: ${pinErr.message}` }, { status: 500 });
        const approvedPin = (managerPins || []).find((pinRow) => verifyPinHash(managerPin, String(pinRow.pin_hash || "")));
        if (!approvedPin) {
          return NextResponse.json({ ok: false, code: "MANAGER_PIN_INVALID", message: "매니저 PIN이 올바르지 않습니다." }, { status: 403 });
        }
        (order as any).__approvedByPinId = approvedPin.id;
      }
      (order as any).__actorUserId = auth.userId;
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
        return NextResponse.json({ ok: false, code: "PG_LOOKUP_FAILED", message: `결제 설정 조회 실패: ${pgErr.message}` }, { status: 500 });
      }

      const secretKey = String(pgRow?.secret_key || "").trim();
      if (!secretKey) {
        return NextResponse.json({ ok: false, code: "PG_SECRET_MISSING", message: "결제 취소 설정이 없습니다." }, { status: 400 });
      }

      const tossOrderId = String((order as any)?.toss_order_id || "").trim();
      const knownPaymentKey = String((order as any)?.payment_key || "").trim() || null;
      if (!knownPaymentKey && !tossOrderId) {
        return NextResponse.json(
          {
            ok: false,
            code: "PAYMENT_IDENTIFIER_MISSING",
            message: "결제 취소 정보가 없습니다.",
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
          { ok: false, code: "PG_CANCEL_FAILED", message: cancelRes.message, toss: cancelRes.toss },
          { status: cancelRes.status || 500 }
        );
      }
    }

    const beforeStatus = String(order.status || "");
    const { error: updateErr } = await supabaseAdmin
      .from("orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("store_id", storeId);
    if (updateErr) {
      return NextResponse.json({ ok: false, code: "ORDER_CANCEL_UPDATE_FAILED", message: `취소 저장 실패: ${updateErr.message}` }, { status: 500 });
    }

    const eventRes = await supabaseAdmin.from("order_events").insert({
      store_id: storeId,
      order_id: orderId,
      event_type: "order_cancelled",
      before_status: beforeStatus,
      after_status: "cancelled",
      actor_user_id: (order as any).__actorUserId || null,
      actor_pin_id: body.actorPinId || null,
      approved_by_pin_id: (order as any).__approvedByPinId || null,
      reason_code: reasonCode,
      reason_text: reason,
      metadata: { actor, paymentStatus },
    });
    if (eventRes.error) console.warn("[order_events] insert skipped:", eventRes.error.message);

    const { error: rollbackErr } = await supabaseAdmin.rpc("rollback_order_rewards", {
      p_store_id: storeId,
      p_order_id: orderId,
    });
    if (rollbackErr) {
      return NextResponse.json({ ok: false, code: "REWARD_ROLLBACK_FAILED", message: `보상 롤백 실패: ${rollbackErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiErrorResponse(e);
  }
}
