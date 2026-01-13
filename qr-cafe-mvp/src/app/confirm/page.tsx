"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextDailySequence, format4, todayKey } from "../lib/orderNumber";

type MenuItem = {
  id: string;
  name: string;
  price: number;
};

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done";

type OrderRecord = {
  id: string; // 내부용 orderId (긴 값)
  createdAt: number;
  orderDate: string; // YYYY-MM-DD
  displayNo: string; // 고객/직원용 4자리 번호
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  items: Array<{ id: string; name: string; price: number; qty: number }>;
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
};

const MENU: MenuItem[] = [
  { id: "americano", name: "아메리카노", price: 4500 },
  { id: "sig-latte", name: "시그니처라떼", price: 5500 },
  { id: "ice-cream-latte", name: "아이스크림라떼", price: 6000 },
  { id: "brown-bubble", name: "흑당버블티", price: 6000 },
];

const LS_ORDERS_KEY = "qrCafeOrders";
const LS_LAST_ORDER_ID_KEY = "qrCafeLastOrderId";

function parseCart(cartParam: string | null): Record<string, number> {
  if (!cartParam) return {};
  try {
    const decoded = decodeURIComponent(cartParam);
    const obj = JSON.parse(decoded);
    if (obj && typeof obj === "object") return obj;
    return {};
  } catch {
    return {};
  }
}

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

function saveOrders(list: OrderRecord[]) {
  localStorage.setItem(LS_ORDERS_KEY, JSON.stringify(list));
}

export default function ConfirmPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const tableFromMenu = sp.get("table") || "";
  const cart = useMemo(() => parseCart(sp.get("cart")), [sp]);

  const items = useMemo(() => {
    return MENU.map((m) => {
      const qty = Number(cart[m.id] || 0);
      return { ...m, qty };
    }).filter((x) => x.qty > 0);
  }, [cart]);

  const totalCount = items.reduce((sum, it) => sum + it.qty, 0);
  const totalPrice = items.reduce((sum, it) => sum + it.qty * it.price, 0);

  // 테이블 QR이면 매장 기본, 카운터 QR이면 포장 기본
  const [mode, setMode] = useState<OrderMode>(tableFromMenu ? "dine-in" : "takeout");
  const [tableInput, setTableInput] = useState<string>(tableFromMenu);
  const [requestNote, setRequestNote] = useState("");

  const canSubmit = totalCount > 0;

  const onSubmit = () => {
    if (!canSubmit) return;

    // ✅ 오늘의 순번 1~9999 → 4자리 표시
    const seq = nextDailySequence();
    const displayNo = format4(seq);
    const orderDate = todayKey();

    const orderId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const finalTable =
      mode === "dine-in"
        ? (tableInput.trim() ? tableInput.trim() : undefined)
        : undefined;

    const order: OrderRecord = {
      id: orderId,
      createdAt: Date.now(),
      orderDate,
      displayNo,
      mode,
      table: finalTable,
      requestNote: requestNote.trim(),
      items: items.map((it) => ({
        id: it.id,
        name: it.name,
        price: it.price,
        qty: it.qty,
      })),
      totalCount,
      totalPrice,
      status: "new",
    };

    const list = loadOrders();
    list.unshift(order);
    saveOrders(list);

    // ✅ 최근 주문 자동 복구용
    localStorage.setItem(LS_LAST_ORDER_ID_KEY, orderId);

    router.push(`/done?orderId=${encodeURIComponent(orderId)}`);
  };

  const onBack = () => router.back();

  return (
    <main style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
      <h1>주문 확인</h1>

      <div style={{ marginTop: 16 }}>
        <h2>주문 내역</h2>

        {items.length === 0 ? (
          <p style={{ color: "crimson" }}>선택한 메뉴가 없습니다. 메뉴로 돌아가주세요.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {items.map((it) => (
              <div
                key={it.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{it.name}</div>
                  <div style={{ color: "#666", marginTop: 4 }}>
                    {it.price.toLocaleString()}원 · {it.qty}개
                  </div>
                </div>
                <div style={{ fontWeight: 700 }}>
                  {(it.price * it.qty).toLocaleString()}원
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div>
          총 수량: <b>{totalCount}</b>
        </div>
        <div style={{ marginTop: 6 }}>
          총 금액: <b>{totalPrice.toLocaleString()}원</b>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2>요청사항 (주문 전체 1개)</h2>
        <textarea
          value={requestNote}
          onChange={(e) => setRequestNote(e.target.value)}
          placeholder="예) 얼음 적게 / 덜 달게 (가능한 경우에만 반영됩니다)"
          style={{
            width: "100%",
            minHeight: 90,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            marginTop: 10,
          }}
        />
        <p style={{ marginTop: 8, color: "#666" }}>
          * 요청사항은 참고용이며, 매장 상황에 따라 반영되지 않을 수 있습니다.
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2>이용 방식 선택</h2>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            onClick={() => setMode("dine-in")}
            style={{
              padding: 12,
              flex: 1,
              borderRadius: 12,
              border: mode === "dine-in" ? "2px solid #111" : "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            매장 이용
          </button>

          <button
            onClick={() => setMode("takeout")}
            style={{
              padding: 12,
              flex: 1,
              borderRadius: 12,
              border: mode === "takeout" ? "2px solid #111" : "1px solid #ddd",
              background: "white",
              cursor: "pointer",
            }}
          >
            포장
          </button>
        </div>

        {mode === "dine-in" && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", color: "#444" }}>
              테이블 번호 (선택)
              <input
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                placeholder="예: 3"
                style={{
                  display: "block",
                  marginTop: 8,
                  padding: 10,
                  width: 200,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                }}
              />
            </label>
            <p style={{ marginTop: 8, color: "#666" }}>
              * 테이블 QR로 들어오면 자동으로 채워집니다. 카운터 QR이면 비워도 됩니다.
            </p>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        <button onClick={onBack} style={{ padding: 12, flex: 1 }}>
          메뉴로 돌아가기
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ padding: 12, flex: 1, opacity: canSubmit ? 1 : 0.5 }}
        >
          주문 접수
        </button>
      </div>
    </main>
  );
}
