"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done";

type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  items: Array<{ id: string; name: string; price: number; qty: number }>;
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
};

const LS_ORDERS_KEY = "qrCafeOrders";
const LS_LAST_ORDER_ID_KEY = "qrCafeLastOrderId";

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "접수됨",
  making: "제조중",
  ready: "준비완료",
  done: "완료",
};

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

export default function StatusPage() {
  const sp = useSearchParams();
  const orderIdFromQuery = sp.get("orderId");

  const [tick, setTick] = useState(0);
  const [lastOrderId, setLastOrderId] = useState<string>("");

  useEffect(() => {
    setLastOrderId(localStorage.getItem(LS_LAST_ORDER_ID_KEY) || "");
  }, []);

  const orderId = useMemo(() => {
    return orderIdFromQuery || lastOrderId || "";
  }, [orderIdFromQuery, lastOrderId]);

  const order = useMemo(() => {
    if (!orderId) return null;
    const list = loadOrders();
    return list.find((o) => o.id === orderId) || null;
  }, [orderId, tick]);

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900 }}>주문 상태</h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
        <button onClick={() => setTick((p) => p + 1)} style={{ padding: 10 }}>
          새로고침
        </button>
        <Link href="/menu" style={{ padding: 10 }}>
          메뉴로
        </Link>
      </div>

      {!order ? (
        <p style={{ marginTop: 16, color: "#666" }}>
          확인할 주문이 없어요. 주문을 접수한 뒤 다시 확인해 주세요.
        </p>
      ) : (
        <>
          <div
            style={{
              marginTop: 16,
              padding: 16,
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.7 }}>주문번호</div>
            <div style={{ fontSize: 48, fontWeight: 900, marginTop: 6 }}>
              {order.displayNo}
            </div>

            <div style={{ marginTop: 10, color: "#444" }}>
              {order.mode === "dine-in" ? (
                <span>
                  매장 이용{order.table ? ` · 테이블 ${order.table}` : ""}
                </span>
              ) : (
                <span>포장</span>
              )}
            </div>

            <div style={{ marginTop: 8 }}>
              상태: <b>{STATUS_LABEL[order.status]}</b>
              {order.buzzerNo ? (
                <>
                  {" · "}벨 <b>{order.buzzerNo}</b>
                </>
              ) : null}
            </div>

            <div style={{ marginTop: 10, color: "#666" }}>
              * 진동벨은 직원이 지급한 경우에만 표시됩니다.
            </div>
          </div>
        </>
      )}
    </main>
  );
}
