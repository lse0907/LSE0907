"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type OrderStatus = "new" | "making" | "ready" | "done";

type OrderRecord = {
  id: string;
  storeId: string;
  displayNo: string;
  status: OrderStatus;
};

const LS_ORDERS_KEY = "qrCafeOrders";
const LS_LAST_ORDER_ID_KEY = "qrCafeLastOrderId";
const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

function loadOrders(): OrderRecord[] {
  try {
    const raw = localStorage.getItem(LS_ORDERS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  const sp = useSearchParams();
  const storeId = sp.get("store") || process.env.NEXT_PUBLIC_STORE_ID || "";
  const table = sp.get("table") || "";
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastStoreId, setLastStoreId] = useState<string>("");

  useEffect(() => {
    setLastOrderId(localStorage.getItem(LS_LAST_ORDER_ID_KEY) || "");
    setLastStoreId(localStorage.getItem(LS_LAST_STORE_ID_KEY) || "");
  }, []);

  const lastOrder = useMemo(() => {
    if (!lastOrderId) return null;
    if (storeId && lastStoreId !== storeId) return null;
    const list = loadOrders();
    return (
      list.find((o) => o.id === lastOrderId && (!storeId || o.storeId === storeId)) ||
      null
    );
  }, [lastOrderId, lastStoreId, storeId]);

  const clear = () => {
    localStorage.removeItem(LS_LAST_ORDER_ID_KEY);
    localStorage.removeItem(LS_LAST_STORE_ID_KEY);
    setLastOrderId("");
    setLastStoreId("");
  };

  const statusParams = useMemo(() => {
    if (!lastOrder) return "";
    const params = new URLSearchParams();
    params.set("orderId", lastOrder.id);
    if (storeId) params.set("store", storeId);
    if (table) params.set("table", table);
    return params.toString();
  }, [lastOrder, storeId, table]);

  return (
    <div>
      {lastOrder && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            padding: 12,
            background: "#fff8db",
            borderBottom: "1px solid #f0d98a",
            display: "flex",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            진행 중인 주문: <b>{lastOrder.displayNo}</b>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Link
              href={`/status?${statusParams}`}
              style={{
                padding: "8px 10px",
                background: "black",
                color: "white",
                borderRadius: 6,
                textDecoration: "none",
              }}
            >
              상태 보기
            </Link>

            <button
              onClick={clear}
              style={{
                padding: "8px 10px",
                background: "white",
                border: "1px solid #999",
                borderRadius: 6,
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
