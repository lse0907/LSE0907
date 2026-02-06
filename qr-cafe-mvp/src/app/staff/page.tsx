"use client";

import { useEffect, useMemo, useState } from "react";

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

const LS_KEY = "qrCafeOrders";

function loadAllOrders(): OrderRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function loadOrders(storeId: string): OrderRecord[] {
  const list = loadAllOrders();
  if (!storeId) return list;
  return list.filter((order) => order.storeId === storeId);
}

function saveOrders(list: OrderRecord[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "신규",
  making: "제조중",
  ready: "준비완료",
  done: "완료",
};

export default function StaffPage() {
  const storeId = process.env.NEXT_PUBLIC_STORE_ID || "";
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setOrders(loadOrders(storeId));
  }, [storeId]);

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) || null,
    [orders, selectedId]
  );

  const refresh = () => setOrders(loadOrders(storeId));

  const updateOrder = (id: string, patch: Partial<OrderRecord>) => {
    const list = loadAllOrders();
    const nextAll = list.map((o) => {
      if (o.id !== id) return o;
      if (storeId && o.storeId !== storeId) return o;
      return { ...o, ...patch };
    });
    saveOrders(nextAll);
    setOrders(loadOrders(storeId));
  };

  const deleteAll = () => {
    if (!confirm("정말 모든 주문을 삭제할까요? (테스트용)")) return;
    const list = loadAllOrders();
    const nextAll = storeId ? list.filter((o) => o.storeId !== storeId) : [];
    if (storeId) {
      saveOrders(nextAll);
    } else {
      localStorage.removeItem(LS_KEY);
    }
    setOrders(loadOrders(storeId));
    setSelectedId(null);
  };

  const nextStatus = (s: OrderStatus): OrderStatus => {
    if (s === "new") return "making";
    if (s === "making") return "ready";
    if (s === "ready") return "done";
    return "done";
  };

  const statusButtonLabel = (s: OrderStatus) => {
    if (s === "new") return "제조 시작";
    if (s === "making") return "준비 완료";
    if (s === "ready") return "완료 처리";
    return "완료됨";
  };

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>직원 화면</h1>
          <p style={{ marginTop: 6, color: "#666" }}>
            주문 리스트 확인 → 벨번호 입력(선택) → 상태 변경
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={refresh} style={{ padding: 10 }}>
            새로고침
          </button>
          <button onClick={deleteAll} style={{ padding: 10 }}>
            전체 삭제(테스트)
          </button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <section
          style={{
            border: "1px solid #eee",
            borderRadius: 16,
            padding: 14,
            minHeight: 420,
          }}
        >
          <h2 style={{ marginTop: 0 }}>주문 목록 ({orders.length})</h2>

          {orders.length === 0 ? (
            <p style={{ color: "#666" }}>아직 주문이 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {orders.map((o) => {
                const isSelected = o.id === selectedId;
                return (
                  <button
                    key={o.id}
                    onClick={() => setSelectedId(o.id)}
                    style={{
                      textAlign: "left",
                      padding: 12,
                      borderRadius: 14,
                      border: isSelected ? "2px solid #111" : "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900, fontSize: 18 }}>
                        {o.displayNo}
                        {o.buzzerNo ? ` · 벨 ${o.buzzerNo}` : ""}
                      </div>
                      <div style={{ color: "#666" }}>{formatTime(o.createdAt)}</div>
                    </div>

                    <div style={{ marginTop: 6, color: "#444" }}>
                      {o.mode === "dine-in" ? `매장(테이블 ${o.table ?? "-"})` : "포장"} ·{" "}
                      {STATUS_LABEL[o.status]}
                    </div>

                    <div style={{ marginTop: 6, color: "#666" }}>
                      {o.items
                        .map((it) => `${it.name}×${it.qty}`)
                        .slice(0, 2)
                        .join(", ")}
                      {o.items.length > 2 ? "…" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section
          style={{
            border: "1px solid #eee",
            borderRadius: 16,
            padding: 14,
            minHeight: 420,
          }}
        >
          <h2 style={{ marginTop: 0 }}>주문 상세</h2>

          {!selected ? (
            <p style={{ color: "#666" }}>왼쪽에서 주문을 선택하세요.</p>
          ) : (
            <div>
              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <div style={{ fontSize: 26, fontWeight: 900 }}>
                  주문번호 {selected.displayNo}
                </div>

                <div style={{ marginTop: 6, color: "#444" }}>
                  {selected.mode === "dine-in"
                    ? `매장 · 테이블 ${selected.table ?? "-"}`
                    : "포장 주문"}
                  {" · "}
                  상태: <b>{STATUS_LABEL[selected.status]}</b>
                </div>

                <div style={{ marginTop: 6, color: "#666" }}>
                  주문시각: {formatTime(selected.createdAt)}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <h3 style={{ marginBottom: 8 }}>진동벨 번호 (선택)</h3>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    value={selected.buzzerNo ?? ""}
                    onChange={(e) =>
                      updateOrder(selected.id, { buzzerNo: e.target.value.trim() })
                    }
                    placeholder="예: 12"
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      width: 160,
                    }}
                  />
                  <span style={{ color: "#666" }}>
                    * 벨을 지급한 경우에만 입력하세요.
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <h3>주문 내역</h3>
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  {selected.items.map((it) => (
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
                        <div style={{ fontWeight: 800 }}>{it.name}</div>
                        <div style={{ color: "#666", marginTop: 4 }}>
                          {it.price.toLocaleString()}원 · {it.qty}개
                        </div>
                      </div>
                      <div style={{ fontWeight: 800 }}>
                        {(it.price * it.qty).toLocaleString()}원
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
                  <div>
                    총 수량: <b>{selected.totalCount}</b>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    총 금액: <b>{selected.totalPrice.toLocaleString()}원</b>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <h3>요청사항</h3>
                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 12,
                    color: selected.requestNote ? "#111" : "#666",
                  }}
                >
                  {selected.requestNote || "요청사항 없음"}
                </div>
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
                <button
                  onClick={() =>
                    updateOrder(selected.id, { status: nextStatus(selected.status) })
                  }
                  disabled={selected.status === "done"}
                  style={{
                    padding: 12,
                    flex: 1,
                    borderRadius: 12,
                    opacity: selected.status === "done" ? 0.5 : 1,
                  }}
                >
                  {statusButtonLabel(selected.status)}
                </button>

                <button
                  onClick={() => {
                    if (!confirm("이 주문을 삭제할까요?")) return;
                    const list = loadAllOrders();
                    const nextAll = list.filter((o) => o.id !== selected.id);
                    saveOrders(nextAll);
                    setOrders(loadOrders(storeId));
                    setSelectedId(null);
                  }}
                  style={{ padding: 12, borderRadius: 12 }}
                >
                  주문 삭제
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
