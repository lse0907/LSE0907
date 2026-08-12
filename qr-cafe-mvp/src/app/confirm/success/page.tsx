"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  CustomerTrustFooter,
  StoreIdentity,
} from "@/app/_components/StoreCustomerBrand";
import { CustomerIcon } from "@/app/_components/CustomerIcon";
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
  const paymentKey = useMemo(
    () => String(sp.get("paymentKey") || "").trim(),
    [sp],
  );
  const orderId = useMemo(() => String(sp.get("orderId") || "").trim(), [sp]);
  const amount = useMemo(() => Number(sp.get("amount") || 0), [sp]);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("결제 확인을 준비중입니다.");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (
        !storeId ||
        !poid ||
        !paymentKey ||
        !orderId ||
        !Number.isFinite(amount) ||
        amount <= 0
      ) {
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

      if (
        !pending ||
        pending.storeId !== storeId ||
        !Array.isArray(pending.cartLines) ||
        !pending.cartLines.length
      ) {
        setStatus("error");
        setMessage("주문 정보가 올바르지 않습니다.");
        return;
      }

      if (pending.createdOrderId && pending.createdAccessToken) {
        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(pending.createdOrderId)}&accessToken=${encodeURIComponent(
            pending.createdAccessToken,
          )}`,
        );
        return;
      }

      try {
        if (mounted) {
          setStatus("working");
          setMessage(
            pending.paymentConfirmed ? "주문 접수 중..." : "결제 확인 중...",
          );
        }

        if (!pending.paymentConfirmed) {
          const confirmRes = await fetch("/api/payments/toss/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentKey, orderId, amount, storeId }),
          });

          const confirmJson = await confirmRes.json();
          if (!confirmRes.ok || !confirmJson?.ok) {
            throw new Error(
              String(confirmJson?.message || "결제 확인에 실패했습니다."),
            );
          }

          pending = { ...pending, paymentConfirmed: true };
          localStorage.setItem(
            `${PREPAY_PENDING_KEY}:${poid}`,
            JSON.stringify(pending),
          );
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
          throw new Error(
            String(
              createJson?.message ||
                "결제 완료. 주문 접수 재시도가 필요합니다.",
            ),
          );
        }

        const created = createJson.order;
        const newOrderId = String(created.orderId || "");
        const accessToken = String(created.accessToken || "");
        if (!newOrderId || !accessToken) {
          throw new Error("주문 확인 정보가 누락되었습니다.");
        }

        localStorage.setItem(
          `${PREPAY_PENDING_KEY}:${poid}`,
          JSON.stringify({
            ...pending,
            createdOrderId: newOrderId,
            createdAccessToken: accessToken,
          }),
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
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(newOrderId)}&accessToken=${encodeURIComponent(accessToken)}`,
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
    <main className="paymentPage customer-page">
      <section className="paymentCard" aria-live="polite">
        <StoreIdentity storeId={storeId} compact />
        <div
          className={`loader ${status === "error" ? "loaderError" : ""}`}
          aria-hidden="true"
        >
          {status === "error" ? <CustomerIcon name="warning" size={28} /> : ""}
        </div>
        <span className="eyebrow">
          {status === "error" ? "PAYMENT CHECK" : "SECURE PAYMENT"}
        </span>
        <h1>
          {status === "error"
            ? "결제 상태를 확인해 주세요"
            : "결제를 확인하고 있어요"}
        </h1>
        <p className={status === "error" ? "message error" : "message"}>
          {message}
        </p>
        {status !== "error" ? (
          <p className="notice">
            완료될 때까지 이 화면을 닫거나 뒤로 이동하지 마세요.
          </p>
        ) : null}
        {status === "error" ? (
          <div className="actions">
            <button
              className="secondary"
              onClick={() => setRetryCount((x) => x + 1)}
            >
              다시 확인
            </button>
            <button
              className="primary"
              onClick={() =>
                router.push(`/confirm?store=${encodeURIComponent(storeId)}`)
              }
            >
              주문 확인으로
            </button>
          </div>
        ) : null}
        <CustomerTrustFooter />
      </section>
      <style jsx>{`
        .paymentPage {
          display: grid;
          place-items: center;
          padding: 24px 16px;
        }
        .paymentCard {
          width: 100%;
          max-width: 520px;
          padding: 24px;
          border: 1px solid var(--customer-line);
          border-radius: 22px;
          background: #fff;
          box-shadow: var(--customer-shadow);
        }
        .loader {
          width: 58px;
          height: 58px;
          margin-top: 34px;
          border: 5px solid #dbe3ef;
          border-top-color: var(--rion-navy);
          border-radius: 50%;
          animation: spin 0.9s linear infinite;
        }
        .loaderError {
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 18px;
          background: #fff1f2;
          color: #be123c;
          font-size: 28px;
          font-weight: 800;
          animation: none;
        }
        .eyebrow {
          display: block;
          margin-top: 22px;
          color: #315fba;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.13em;
        }
        h1 {
          margin: 8px 0 0;
          color: var(--rion-navy);
          font-size: clamp(28px, 7vw, 34px);
          font-weight: 850;
          line-height: 1.2;
          letter-spacing: -0.045em;
        }
        .message {
          margin: 12px 0 0;
          color: var(--customer-muted);
          font-weight: 500;
          line-height: 1.65;
        }
        .message.error {
          color: #9f1239;
        }
        .notice {
          margin: 20px 0 0;
          padding: 12px 14px;
          border-radius: 12px;
          background: #f1f5f9;
          color: #475569;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.5;
        }
        .actions {
          display: flex;
          gap: 10px;
          margin-top: 22px;
        }
        button {
          flex: 1;
          min-height: 50px;
          padding: 0 18px;
          border-radius: 14px;
          font-weight: 750;
        }
        .primary {
          border: 1px solid var(--rion-navy);
          background: var(--rion-navy);
          color: #fff;
        }
        .secondary {
          border: 1px solid var(--customer-line);
          background: #fff;
          color: var(--customer-ink);
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  );
}
export default function ConfirmSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <ConfirmSuccessPageInner />
    </Suspense>
  );
}
