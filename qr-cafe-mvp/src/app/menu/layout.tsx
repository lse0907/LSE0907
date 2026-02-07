// src/app/menu/layout.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getStoreIdFromSearchParams,
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
  lsOrdersKey,
} from "@/app/lib/storeScope";

type OrderStatus = "new" | "making" | "ready" | "done" | "canceled";

type OrderRecord = {
  id: string;
  displayNo: string;
  status: OrderStatus;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

function loadOrders(storeId: string): OrderRecord[] {
  try {
    const raw = localStorage.getItem(lsOrdersKey(storeId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function isActiveStatus(s: OrderStatus) {
  return s === "new" || s === "making";
}

function statusLabel(s: OrderStatus) {
  if (s === "new") return "접수됨";
  if (s === "making") return "제조중";
  if (s === "ready") return "준비완료";
  if (s === "done") return "완료";
  return "취소";
}

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const currentStoreId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);

  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastStoreId, setLastStoreId] = useState<string>("");
  const [lastOrderToken, setLastOrderToken] = useState<string>("");

  // ✅ 다른 탭/새로고침/이동 후에도 lastOrderId / lastStoreId 최신화
  useEffect(() => {
    const read = () => {
      try {
        setLastOrderId((localStorage.getItem(lsLastOrderIdKey(currentStoreId)) || "").trim());
      } catch {
        setLastOrderId("");
      }
      try {
        setLastOrderToken((localStorage.getItem(lsLastOrderTokenKey(currentStoreId)) || "").trim());
      } catch {
        setLastOrderToken("");
      }
      try {
        setLastStoreId((localStorage.getItem(LS_LAST_STORE_ID_KEY) || "").trim());
      } catch {
        setLastStoreId("");
      }
    };

    read();

    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith("qrCafeLastOrderId:")) read();
      if (e.key?.startsWith("qrCafeLastOrderToken:")) read();
      if (e.key?.startsWith("qrCafeOrders:")) read();
      if (e.key === LS_LAST_STORE_ID_KEY) read();
    };
    window.addEventListener("storage", onStorage);

    // 같은 탭에서도 반영
    const t = window.setInterval(read, 1200);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, [currentStoreId]);

  const lastOrder = useMemo(() => {
    if (!lastOrderId) return null;
    const list = loadOrders(currentStoreId);
    return list.find((o) => o.id === lastOrderId) || null;
  }, [currentStoreId, lastOrderId]);

  // ✅ 멀티매장 핵심: 현재 store와 lastStore가 같을 때만 배너 표시
  const storeMatch = !!lastStoreId && lastStoreId === currentStoreId;

  // ✅ "ready/done/canceled"이면 배너 숨김 + store mismatch면 숨김
  const showBanner = !!lastOrder && storeMatch && isActiveStatus(lastOrder.status);

  return (
    <div>
      {showBanner ? (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            padding: 10,
            background: "rgba(17,24,39,0.92)",
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            color: "white",
            display: "flex",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: "-0.01em" }}>
            진행 중인 주문 <span style={{ opacity: 0.9 }}>·</span>{" "}
            <span style={{ fontSize: 16 }}>{lastOrder.displayNo}</span>{" "}
            <span style={{ opacity: 0.8, fontWeight: 800, marginLeft: 6 }}>
              ({statusLabel(lastOrder.status)})
            </span>
          </div>

          <Link
            href={`/status?store=${encodeURIComponent(currentStoreId)}&orderId=${encodeURIComponent(
              lastOrder.id
            )}&accessToken=${encodeURIComponent(lastOrderToken)}`}
            style={{
              padding: "8px 10px",
              background: "white",
              color: "#111827",
              borderRadius: 10,
              textDecoration: "none",
              fontWeight: 950,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            상태 보기
          </Link>
        </div>
      ) : null}

      {children}
    </div>
  );
}
