"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  clientRequestId?: string;
  checkoutAttemptId?: string;
  recoveryToken?: string;
  tossOrderId?: string;
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
  const attemptId = useMemo(() => String(sp.get("attempt") || "").trim(), [sp]);
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
      let pending: PendingPrepay | null = null;
      if (raw) {
        try {
          pending = JSON.parse(raw) as PendingPrepay;
        } catch {
          pending = null;
        }
      }

      if (pending && (pending.storeId !== storeId || pending.tossOrderId !== orderId)) {
        setStatus("error");
        setMessage("저장된 주문 정보와 결제 결과가 일치하지 않습니다.");
        return;
      }

      if (pending?.createdOrderId && pending.createdAccessToken) {
        localStorage.setItem(lsLastOrderIdKey(storeId), pending.createdOrderId);
        localStorage.setItem(lsLastOrderTokenKey(storeId), pending.createdAccessToken);
        localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(pending.createdOrderId)}`,
        );
        return;
      }

      try {
        if (mounted) {
          setStatus("working");
          setMessage("결제 확인 및 주문 접수 중...");
        }

        const confirmRes = await fetch("/api/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checkoutAttemptId: pending?.checkoutAttemptId || attemptId || undefined,
            storeId,
            paymentKey,
            orderId,
            amount,
          }),
        });

        const confirmJson = await confirmRes.json();
        if (!confirmRes.ok || !confirmJson?.ok || !confirmJson?.order) {
          throw new Error(
            String(
              confirmJson?.message ||
                "결제 확인 후 주문 접수를 복구하고 있습니다. 다시 확인해주세요.",
            ),
          );
        }

        const created = confirmJson.order;
        const newOrderId = String(created.orderId || "");
        const accessToken = String(created.accessToken || "");
        if (!newOrderId || !accessToken) {
          throw new Error("주문 확인 정보가 누락되었습니다.");
        }

        if (pending) {
          localStorage.setItem(
            `${PREPAY_PENDING_KEY}:${poid}`,
            JSON.stringify({
              ...pending,
              createdOrderId: newOrderId,
              createdAccessToken: accessToken,
            }),
          );
        }
        localStorage.setItem(lsLastOrderIdKey(storeId), newOrderId);
        localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
        localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
        localStorage.removeItem(`${PREPAY_PENDING_KEY}:${poid}`);
        try {
          if (pending) {
            const cartKey = `qrCafeCart:${storeId}:${pending.mode === "dine-in" && pending.table ? pending.table : "counter"}`;
            sessionStorage.removeItem(cartKey);
          }
          sessionStorage.removeItem(`qrCafeCheckoutRequest:${storeId}`);
        } catch {
          // ignore storage cleanup errors
        }

        if (mounted) {
          setStatus("done");
          setMessage("주문 접수 완료");
        }

        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(newOrderId)}`,
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
  }, [amount, attemptId, orderId, paymentKey, poid, retryCount, router, storeId]);

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
