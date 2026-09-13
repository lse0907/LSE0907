/* eslint-disable @typescript-eslint/no-explicit-any */
import webpush from "web-push";

type AdminClient = any;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

export async function sendReadyOrderPush(params: {
  admin: AdminClient;
  storeId: string;
  orderId: string;
  displayNo: string;
}) {
  const subject = env("WEB_PUSH_VAPID_SUBJECT");
  const publicKey = env("WEB_PUSH_VAPID_PUBLIC_KEY");
  const privateKey = env("WEB_PUSH_VAPID_PRIVATE_KEY");
  if (!subject || !publicKey || !privateKey) return { sent: 0, skipped: "not_configured" as const };

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const { data, error } = await params.admin
    .from("customer_order_push_subscriptions")
    .select("id,endpoint,p256dh,auth_secret")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .eq("status", "active")
    .is("ready_notified_at", null);
  if (error) throw new Error(error.message);

  const payload = JSON.stringify({
    title: "메뉴가 준비되었습니다",
    body: `주문번호 ${params.displayNo || ""}번 메뉴가 준비되었습니다.`.replace("  ", " "),
    url: `/status?store=${encodeURIComponent(params.storeId)}&orderId=${encodeURIComponent(params.orderId)}`,
    tag: `rion-order-ready-${params.orderId}`,
  });
  let sent = 0;
  for (const subscription of data || []) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } }, payload, { TTL: 60 * 30 });
      const { error: updateError } = await params.admin.from("customer_order_push_subscriptions").update({ status: "sent", ready_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", subscription.id);
      if (updateError) throw new Error(updateError.message);
      sent += 1;
    } catch (error: unknown) {
      const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
      const expired = statusCode === 404 || statusCode === 410;
      const { error: updateError } = await params.admin.from("customer_order_push_subscriptions").update({ status: expired ? "expired" : "active", last_error_code: `PUSH_${statusCode || "FAILED"}`, updated_at: new Date().toISOString() }).eq("id", subscription.id);
      if (updateError) console.error("[customer-order-push] failure record update failed", updateError.message);
      console.warn("[customer-order-push] delivery failed", { orderId: params.orderId, subscriptionId: subscription.id, statusCode });
    }
  }
  return { sent, skipped: null };
}
