"use client";

import { useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

type MenuItem = {
  id: string;
  name: string;
  price: number;
};

export default function MenuPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // 테이블 QR이면 /menu?table=3 형태로 들어옴 (카운터 QR은 그냥 /menu)
  const table = sp.get("table") || "";

  const items: MenuItem[] = useMemo(
    () => [
      { id: "americano", name: "아메리카노", price: 4500 },
      { id: "sig-latte", name: "시그니처라떼", price: 5500 },
      { id: "ice-cream-latte", name: "아이스크림라떼", price: 6000 },
      { id: "brown-bubble", name: "흑당버블티", price: 6000 },
    ],
    []
  );

  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(items.map((it) => [it.id, 0]))
  );

  const inc = (id: string) => setQty((p) => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const dec = (id: string) =>
    setQty((p) => ({ ...p, [id]: Math.max(0, (p[id] || 0) - 1) }));

  const totalCount = items.reduce((sum, it) => sum + (qty[it.id] || 0), 0);
  const totalPrice = items.reduce((sum, it) => sum + it.price * (qty[it.id] || 0), 0);

  const goConfirm = () => {
    if (totalCount === 0) return;

    const cart = encodeURIComponent(JSON.stringify(qty));
    const url = table
      ? `/confirm?table=${encodeURIComponent(table)}&cart=${cart}`
      : `/confirm?cart=${cart}`;

    router.push(url);
  };

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1>메뉴</h1>

      <div style={{ marginTop: 8, color: "#444" }}>
        {table ? (
          <p>
            테이블 QR로 접속 · 테이블 <b>{table}</b>
          </p>
        ) : (
          <p>카운터 QR로 접속</p>
        )}
      </div>

      <h2 style={{ marginTop: 18 }}>인기 메뉴 4개</h2>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontWeight: 700 }}>{it.name}</div>
              <div style={{ color: "#666", marginTop: 4 }}>{it.price.toLocaleString()}원</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={() => dec(it.id)} style={{ width: 36, height: 36 }}>
                -
              </button>
              <b style={{ width: 18, textAlign: "center" }}>{qty[it.id] || 0}</b>
              <button onClick={() => inc(it.id)} style={{ width: 36, height: 36 }}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div>
          총 수량: <b>{totalCount}</b>
        </div>
        <div style={{ marginTop: 6 }}>
          총 금액: <b>{totalPrice.toLocaleString()}원</b>
        </div>

        <button
          onClick={goConfirm}
          disabled={totalCount === 0}
          style={{
            marginTop: 14,
            padding: 14,
            width: "100%",
            borderRadius: 12,
            opacity: totalCount === 0 ? 0.5 : 1,
          }}
        >
          주문 확인
        </button>
      </div>
    </main>
  );
}
