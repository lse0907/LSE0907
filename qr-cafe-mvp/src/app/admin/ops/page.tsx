"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AdminOpsPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = (sp.get("store") || "").trim();

  const go = (path: string) => {
    if (!storeId) return;
    router.push(`${path}?store=${encodeURIComponent(storeId)}`);
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          max-width: 920px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .h1 {
          margin: 0;
          font-size: 22px;
          font-weight: 950;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
        }
        .btnRow {
          display: grid;
          gap: 10px;
        }
        .btn {
          border: 1px solid var(--line);
          background: #fff;
          padding: 12px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
          text-align: left;
        }
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        @media (max-width: 640px) {
          .wrap {
            padding: 12px;
          }
        }
      `}</style>

      <header className="topbar">
        <h1 className="h1">매장운영</h1>
        <button className="btn" type="button" onClick={() => router.back()}>
          뒤로가기
        </button>
      </header>

      <section className="card">
        <div className="btnRow">
          <button className="btn" onClick={() => go("/admin/menu")} disabled={!storeId}>
            메뉴관리
          </button>
          <button className="btn" onClick={() => go("/admin/options")} disabled={!storeId}>
            옵션관리
          </button>
          <button className="btn" onClick={() => go("/admin/qr")} disabled={!storeId}>
            QR생성
          </button>
        </div>
      </section>
    </main>
  );
}
export default function AdminOpsPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminOpsPageInner />
    </Suspense>
  );
}