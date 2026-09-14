import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PushKeys = { p256dh?: unknown; auth?: unknown };
type PushSubscription = { endpoint?: unknown; keys?: PushKeys };
type NotificationBody = { action?: unknown; storeId?: unknown; orderId?: unknown; accessToken?: unknown; subscription?: PushSubscription };

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", "Referrer-Policy": "no-referrer" };

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function tokenMatches(expected: unknown, received: string) {
  const expectedBuffer = Buffer.from(String(expected || "").trim(), "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return expectedBuffer.length > 0 && expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function value(raw: unknown, max: number) {
  const result = String(raw || "").trim();
  return result.length > 0 && result.length <= max ? result : "";
}

function validSubscription(subscription: PushSubscription | undefined) {
  const endpoint = value(subscription?.endpoint, 2048);
  const p256dh = value(subscription?.keys?.p256dh, 512);
  const auth = value(subscription?.keys?.auth, 512);
  if (!endpoint || !p256dh || !auth) return null;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch { return null; }
  return { endpoint, p256dh, auth };
}

async function verifiedOrder(body: NotificationBody) {
  const storeId = value(body.storeId, 120);
  const orderId = value(body.orderId, 80);
  const accessToken = value(body.accessToken, 200);
  if (!storeId || !orderId || !accessToken) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("orders").select("id,store_id,status,access_token").eq("id", orderId).eq("store_id", storeId).maybeSingle();
  if (error) throw error;
  if (!data || !tokenMatches(data.access_token, accessToken)) return null;
  return { admin, storeId, orderId, status: String(data.status || "") };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as NotificationBody;
    const action = value(body.action, 32);
    if (action !== "subscribe" && action !== "status" && action !== "disable_device") {
      return privateJson({ ok: false, code: "INVALID_ACTION", message: "알림 요청 형식이 올바르지 않습니다." }, 400);
    }
    const order = await verifiedOrder(body);
    if (!order) return privateJson({ ok: false, code: "ORDER_ACCESS_DENIED", message: "주문 정보를 확인할 수 없습니다." }, 404);

    const subscription = validSubscription(body.subscription);
    if (!subscription) return privateJson({ ok: false, code: "INVALID_SUBSCRIPTION", message: "이 기기의 알림 정보를 확인할 수 없습니다." }, 400);

    if (action === "status") {
      const { data, error } = await order.admin.from("customer_order_push_subscriptions").select("status").eq("store_id", order.storeId).eq("order_id", order.orderId).eq("endpoint", subscription.endpoint).eq("status", "active").limit(1).maybeSingle();
      if (error) throw error;
      return privateJson({ ok: true, subscribed: Boolean(data) });
    }

    if (action === "disable_device") {
      // Browser PushSubscription is device-wide. Keep the server record in
      // lockstep so a later order cannot send to a device the customer disabled.
      const now = new Date().toISOString();
      const { error } = await order.admin.from("customer_order_push_subscriptions").update({ status: "revoked", revoked_at: now, updated_at: now }).eq("endpoint", subscription.endpoint).eq("status", "active");
      if (error) throw error;
      return privateJson({ ok: true, subscribed: false });
    }
    if (order.status === "cancelled" || order.status === "completed") {
      return privateJson({ ok: false, code: "ORDER_NOTIFICATION_CLOSED", message: "종료된 주문에는 알림을 설정할 수 없습니다." }, 409);
    }
    const now = new Date().toISOString();
    const { error } = await order.admin.from("customer_order_push_subscriptions").upsert({ store_id: order.storeId, order_id: order.orderId, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth_secret: subscription.auth, status: "active", subscribed_at: now, revoked_at: null, last_error_code: null, updated_at: now }, { onConflict: "order_id,endpoint" });
    if (error) throw error;
    return privateJson({ ok: true, subscribed: true });
  } catch (error: unknown) {
    console.error("[customer-order-notifications] request failed", error);
    const response = apiErrorResponse(error);
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(name, value);
    return response;
  }
}
