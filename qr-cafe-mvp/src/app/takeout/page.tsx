"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TakeoutPage() {
  const router = useRouter();
  const [orderNumber] = useState(
    Math.floor(1000 + Math.random() * 9000)
  );

  return (
    <main style={{ padding: 40 }}>
      <h1>포장 주문</h1>
      <p>주문번호: {orderNumber}</p>

      <button
        style={{ marginTop: 20, padding: 12 }}
        onClick={() => router.push(`/menu?order=${orderNumber}`)}
      >
        메뉴 보기
      </button>
    </main>
  );
}
