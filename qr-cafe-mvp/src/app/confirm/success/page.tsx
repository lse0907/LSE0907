"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { lsLastOrderIdKey, lsLastOrderTokenKey } from "@/app/lib/storeScope";

type SelectedOptionItem = {
  id: string;
  name: string;
  priceDelta: number;
};

type SelectedGroup = {
  groupId: string;
  groupName: string;
  required: boolean;
  min: number;
  max: number;
  items: SelectedOptionItem[];
};

type CartLine = {
  lineId: string;
  menuId: string;
  name: string;
  basePrice: number;
  qty: number;
  image?: string;
  options: SelectedGroup[];
  optionTotal: number;
};

type PendingPrepay = {
  createdAt: number;
  storeId: string;
  customerUserId?: string | null;
  cartLines: CartLine[];
  mode: "dine-in" | "takeout";
  table: string;
  requestNote: string;
  totalCount: number;
  totalPrice: number;
  usedPoints?: number;
  usedCouponId?: string | null;
  payableAmount?: number;
  paymentConfirmed?: boolean;
  createdOrderId?: string;
  createdAccessToken?: string;
};

const PREPAY_PENDING_KEY = "qrCafePrepayPending";
const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

function ConfirmSuccessPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const poid = useMemo(() => String(sp.get("poid") || "").trim(), [sp]);
  const paymentKey = useMemo(() => String(sp.get("paymentKey") || "").trim(), [sp]);
  const orderId = useMemo(() => String(sp.get("orderId") || "").trim(), [sp]);
  const amount = useMemo(() => Number(sp.get("amount") || 0), [sp]);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("결제 확인을 준비중입니다.");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!storeId || !poid || !paymentKey || !orderId || !Number.isFinite(amount) || amount <= 0) {
        setStatus("error");
        setMessage("결제 정보가 올바르지 않습니다.");
        return;
      }

      const raw = localStorage.getItem(`${PREPAY_PENDING_KEY}:${poid}`);
      if (!raw) {
        setStatus("error");
        setMessage("주문 정보가 없습니다. 다시 주문해주세요.");
        return;
      }

      let pending: PendingPrepay;
      try {
        pending = JSON.parse(raw) as PendingPrepay;
      } catch {
        setStatus("error");
        setMessage("주문 정보를 읽지 못했습니다.");
        return;
      }

      if (!pending || pending.storeId !== storeId || !Array.isArray(pending.cartLines) || !pending.cartLines.length) {
        setStatus("error");
        setMessage("주문 정보가 올바르지 않습니다.");
        return;
      }

      if (pending.createdOrderId && pending.createdAccessToken) {
        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(pending.createdOrderId)}&accessToken=${encodeURIComponent(
            pending.createdAccessToken
          )}`
        );
        return;
      }

      try {
        if (mounted) {
          setStatus("working");
          setMessage(pending.paymentConfirmed ? "주문 접수 중..." : "결제 확인 중...");
        }

        if (!pending.paymentConfirmed) {
          const confirmRes = await fetch("/api/payments/toss/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentKey, orderId, amount, storeId }),
          });

          const confirmJson = await confirmRes.json();
          if (!confirmRes.ok || !confirmJson?.ok) {
            throw new Error(String(confirmJson?.message || "결제 확인에 실패했습니다."));
          }

          pending = { ...pending, paymentConfirmed: true };
          localStorage.setItem(`${PREPAY_PENDING_KEY}:${poid}`, JSON.stringify(pending));
        }

        let loyaltyCustomerUserId = pending.customerUserId || null;
        if (!loyaltyCustomerUserId) {
          const { data: authData } = await supabase.auth.getUser();
          loyaltyCustomerUserId = authData?.user?.id || null;
        }

        const createRes = await fetch("/api/orders/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId,
            cartLines: pending.cartLines,
            mode: pending.mode,
            table: pending.mode === "dine-in" ? pending.table || "" : "",
            requestNote: pending.requestNote || "",
            customerUserId: loyaltyCustomerUserId,
            usedPoints: Math.max(0, Number(pending.usedPoints || 0)),
            usedCouponId: pending.usedCouponId || null,
            paymentStatus: "paid",
            paymentKey,
            tossOrderId: orderId,
            paidAmount: amount,
          }),
        });

        const createJson = await createRes.json();
        if (!createRes.ok || !createJson?.ok || !createJson?.order) {
          throw new Error(String(createJson?.message || "결제 완료. 주문 접수 재시도가 필요합니다."));
        }

        const created = createJson.order;
        const newOrderId = String(created.orderId || "");
        const accessToken = String(created.accessToken || "");
        if (!newOrderId || !accessToken) {
          throw new Error("주문 확인 정보가 누락되었습니다.");
        }

        localStorage.setItem(
          `${PREPAY_PENDING_KEY}:${poid}`,
          JSON.stringify({ ...pending, createdOrderId: newOrderId, createdAccessToken: accessToken })
        );
        localStorage.setItem(lsLastOrderIdKey(storeId), newOrderId);
        localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
        localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
        localStorage.removeItem(`${PREPAY_PENDING_KEY}:${poid}`);
        try {
          const cartKey = `qrCafeCart:${storeId}:${pending.mode === "dine-in" && pending.table ? pending.table : "counter"}`;
          sessionStorage.removeItem(cartKey);
        } catch {
          // ignore storage cleanup errors
        }

        if (mounted) {
          setStatus("done");
          setMessage("주문 접수 완료");
        }

        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(newOrderId)}&accessToken=${encodeURIComponent(accessToken)}`
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mounted) {
          setStatus("error");
          setMessage(msg || "처리에 실패했습니다.");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [amount, orderId, paymentKey, poid, retryCount, router, storeId]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontWeight: 950 }}>결제 처리</h1>
      <p style={{ marginTop: 12, color: status === "error" ? "crimson" : "#374151", fontWeight: 800 }}>{message}</p>
      {status === "error" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button
            onClick={() => setRetryCount((x) => x + 1)}
            style={{ padding: 12, borderRadius: 12, fontWeight: 900 }}
          >
            다시 확인
          </button>
          <button
            onClick={() => router.push(`/confirm?store=${encodeURIComponent(storeId)}`)}
            style={{ padding: 12, borderRadius: 12, fontWeight: 900 }}
          >
            주문 확인으로
          </button>
        </div>
      ) : null}
    </main>
  );
}
export default function ConfirmSuccessPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <ConfirmSuccessPageInner />
    </Suspense>
  );
}
