"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done";

type OrderRecord = {
  id: string;
  storeId: string;
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

export default function DonePage() {
  const sp = useSearchParams();
  const storeId = sp.get("store") || process.env.NEXT_PUBLIC_STORE_ID || "";
  const table = sp.get("table") || "";
  const orderId = useMemo(() => sp.get("orderId") || "", [sp]);

  const order = useMemo(() => {
    const list = loadOrders();
    if (orderId) {
      return (
        list.find((o) => o.id === orderId && (!storeId || o.storeId === storeId)) ||
        null
      );
    }

    // 혹시 파라미터 없이 들어오면 최근 주문 보여줌
    const last = localStorage.getItem(LS_LAST_ORDER_ID_KEY) || "";
    const lastStoreId = localStorage.getItem(LS_LAST_STORE_ID_KEY) || "";
    if (!last || (storeId && lastStoreId !== storeId)) return null;
    return (
      list.find((o) => o.id === last && (!storeId || o.storeId === storeId)) || null
    );
  }, [orderId, storeId]);

  const statusParams = useMemo(() => {
    if (!order) return "";
    const params = new URLSearchParams();
    params.set("orderId", order.id);
    if (storeId) params.set("store", storeId);
    if (table) params.set("table", table);
    return params.toString();
  }, [order, storeId, table]);

  const menuParams = useMemo(() => {
    const params = new URLSearchParams();
    if (storeId) params.set("store", storeId);
    if (table) params.set("table", table);
    return params.toString();
  }, [storeId, table]);

  if (!order) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>주문 접수 완료</h1>
        <p style={{ marginTop: 10 }}>
          주문 정보를 찾을 수 없어요. 메뉴로 돌아가 다시 확인해 주세요.
        </p>
        <div style={{ marginTop: 16 }}>
          <Link href={menuParams ? `/menu?${menuParams}` : "/menu"}>메뉴로 가기</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900 }}>주문 접수 완료</h1>

      <div style={{ marginTop: 8, color: "#444" }}>
        {order.mode === "dine-in" ? (
          <p>
            매장 이용{order.table ? (
              <>
                {" · "}테이블 <b>{order.table}</b>
              </>
            ) : null}
          </p>
        ) : (
          <p>포장 주문</p>
        )}
      </div>

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

        <div style={{ marginTop: 12, lineHeight: 1.5 }}>
          이 주문번호는 자동 저장됩니다. <br />
          페이지를 나갔다가 다시 들어와도 <b>메뉴 화면 상단</b>에서 상태를 다시 볼 수 있어요.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Link
          href={`/status?${statusParams}`}
          style={{
            flex: 1,
            textAlign: "center",
            padding: 12,
            borderRadius: 10,
            background: "black",
            color: "white",
            textDecoration: "none",
          }}
        >
          주문 상태 보기
        </Link>

        <Link
          href={menuParams ? `/menu?${menuParams}` : "/menu"}
          style={{
            flex: 1,
            textAlign: "center",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ccc",
            textDecoration: "none",
          }}
        >
          메뉴로
        </Link>
      </div>
    </main>
  );
}
