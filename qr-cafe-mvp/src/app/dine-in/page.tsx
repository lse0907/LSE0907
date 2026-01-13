"use client";

import { useSearchParams } from "next/navigation";

export default function DineInPage() {
  const sp = useSearchParams();
  const table = sp.get("table");

  return (
    <main style={{ padding: 40 }}>
      <h1>매장 이용</h1>
      <p>테이블 번호: {table}</p>

      <a href={`/menu?table=${table}`}>
        <button style={{ marginTop: 20, padding: 12 }}>
          메뉴 보기
        </button>
      </a>
    </main>
  );
}
