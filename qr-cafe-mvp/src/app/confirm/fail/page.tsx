"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ConfirmFailPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const code = useMemo(() => String(sp.get("code") || "").trim(), [sp]);
  const message = useMemo(() => String(sp.get("message") || "").trim(), [sp]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontWeight: 950 }}>결제 실패</h1>
      <p style={{ marginTop: 12, color: "#374151", fontWeight: 800 }}>
        결제가 완료되지 않아 주문이 접수되지 않았습니다.
      </p>
      {code ? <p style={{ marginTop: 8, color: "#6b7280", fontWeight: 700 }}>오류코드: {code}</p> : null}
      {message ? <p style={{ marginTop: 4, color: "#6b7280", fontWeight: 700 }}>사유: {message}</p> : null}

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => router.push(`/confirm?store=${encodeURIComponent(storeId)}`)}
          style={{ padding: 12, borderRadius: 12, fontWeight: 900 }}
        >
          다시 결제하기
        </button>
        <button
          onClick={() => router.push(`/menu?store=${encodeURIComponent(storeId)}`)}
          style={{ padding: 12, borderRadius: 12, fontWeight: 900 }}
        >
          메뉴로 돌아가기
        </button>
      </div>
    </main>
  );
}
export default function ConfirmFailPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <ConfirmFailPageInner />
    </Suspense>
  );
}