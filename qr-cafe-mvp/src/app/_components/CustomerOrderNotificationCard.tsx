"use client";

import { useEffect, useState } from "react";

type Props = {
  storeId: string;
  orderId: string;
  accessToken: string;
  preview?: boolean;
};

type PushKeys = { p256dh: string; auth: string };
type SavedSubscription = { endpoint: string; keys: PushKeys };

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function serializeSubscription(subscription: PushSubscription): SavedSubscription | null {
  const json = subscription.toJSON();
  const endpoint = String(json.endpoint || subscription.endpoint || "").trim();
  const p256dh = String(json.keys?.p256dh || "").trim();
  const auth = String(json.keys?.auth || "").trim();
  return endpoint && p256dh && auth ? { endpoint, keys: { p256dh, auth } } : null;
}

export function CustomerOrderNotificationCard({ storeId, orderId, accessToken, preview = false }: Props) {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || "";
  const [state, setState] = useState<"idle" | "working" | "enabled" | "unavailable" | "error">("idle");
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(false);

  const configured = Boolean(publicKey);
  const canRequest = supported && configured && !preview;

  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }, []);

  useEffect(() => {
    if (preview) setMessage("정식 연결 전 미리보기입니다. 실제 권한 요청이나 알림 발송은 하지 않습니다.");
    else if (!supported || !configured) setState("unavailable");
    else setState((current) => current === "unavailable" ? "idle" : current);
  }, [configured, preview, supported]);

  const save = async (action: "subscribe" | "unsubscribe", subscription: SavedSubscription) => {
    const response = await fetch("/api/orders/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, storeId, orderId, accessToken, subscription }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new Error(String(body?.message || "알림 설정을 저장하지 못했습니다."));
  };

  const enable = async () => {
    if (!canRequest || state === "working") return;
    try {
      setState("working");
      setMessage("");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("idle");
        setMessage("알림을 허용하지 않았어요. 주문 조회 화면에서 준비 상태를 확인할 수 있습니다.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) });
      const saved = serializeSubscription(subscription);
      if (!saved) throw new Error("이 기기의 알림 정보를 확인할 수 없습니다.");
      await save("subscribe", saved);
      setState("enabled");
      setMessage("메뉴가 준비되면 이 휴대폰으로 알려드릴게요.");
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "알림 설정 중 문제가 발생했습니다.");
    }
  };

  const disable = async () => {
    if (!canRequest || state === "working") return;
    try {
      setState("working");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const saved = subscription ? serializeSubscription(subscription) : null;
      if (saved) await save("unsubscribe", saved);
      await subscription?.unsubscribe();
      setState("idle");
      setMessage("이 주문의 준비 알림을 해제했습니다.");
    } catch (error: unknown) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "알림 해제 중 문제가 발생했습니다.");
    }
  };

  // Never expose a disabled promise to real customers before the VAPID keys
  // are connected. `notificationPreview=1` remains available for design QA.
  if (!configured && !preview) return null;

  return (
    <section className="customerNotificationCard" aria-labelledby="customer-notification-title">
      <div className="customerNotificationIcon" aria-hidden="true">●</div>
      <div className="customerNotificationCopy">
        <h2 id="customer-notification-title">메뉴 준비 알림</h2>
        <p>{state === "enabled" ? "이 주문의 준비 완료를 알림으로 받습니다." : "주문 화면을 닫아도 메뉴가 준비되면 알려드립니다."}</p>
      </div>
      {state === "enabled" ? <button type="button" className="customerNotificationTextButton" onClick={disable} disabled={!canRequest}>알림 해제</button> : <button type="button" className="customerNotificationButton" onClick={enable} disabled={!canRequest || state === "working"}>{state === "working" ? "설정 중" : "알림 받기"}</button>}
      {message ? <p className="customerNotificationHint" role="status">{message}</p> : null}
      {!message && state === "unavailable" ? <p className="customerNotificationHint">이 기기 또는 현재 서비스 설정에서는 알림을 받을 수 없습니다. 주문 조회 화면에서 준비 상태를 확인해 주세요.</p> : null}
      <p className="customerNotificationNote">휴대폰 설정, 무음 또는 집중 모드에 따라 소리·진동은 제한될 수 있습니다.</p>
    </section>
  );
}
