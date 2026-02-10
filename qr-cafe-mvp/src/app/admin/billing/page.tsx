"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import {
  BillingSettings,
  loadBillingSettings,
  maskToken,
  saveBillingSettings,
} from "@/app/lib/billingSettings";

function BillingForm({ storeId }: { storeId: string }) {
  const initial = useMemo(() => loadBillingSettings(storeId), [storeId]);
  const [form, setForm] = useState<BillingSettings>(initial);
  const [saveBadge, setSaveBadge] = useState<"idle" | "saved">("idle");

  const activationReady = useMemo(() => {
    return form.baseApproved && form.addonApproved && !!form.pgMid && !!form.pgClientKey && !!form.pgSecretKey;
  }, [form]);

  const onSave = () => {
    saveBillingSettings(storeId, form);
    setSaveBadge("saved");
    setTimeout(() => setSaveBadge("idle"), 1400);
  };

  return (
    <>
      <section className="card">
        <div className="pill">store: {storeId || "-"}</div>
        <p className="muted">정식 과금 연동 전에는 테스트 승인 토글을 사용해 상태를 검증합니다.</p>

        <div className="grid2">
          <label className="toggleRow">
            <input
              type="checkbox"
              checked={form.baseApproved}
              onChange={(e) => setForm((prev) => ({ ...prev, baseApproved: e.target.checked }))}
            />
            <span>기본 구독 테스트 승인</span>
          </label>

          <label className="toggleRow">
            <input
              type="checkbox"
              checked={form.addonApproved}
              onChange={(e) => setForm((prev) => ({ ...prev, addonApproved: e.target.checked }))}
            />
            <span>선결재 옵션 테스트 승인</span>
          </label>
        </div>
      </section>

      <section className="card">
        <h2 className="h2">토스페이먼츠 PG 연결</h2>
        <p className="muted">토스페이먼츠를 아직 사용하지 않는 매장은 먼저 가맹점 가입/심사를 완료해 주세요.</p>
        <div className="links">
          <a href="https://www.tosspayments.com/" target="_blank" rel="noreferrer" className="linkBtn">
            토스페이먼츠 홈페이지
          </a>
          <a href="https://docs.tosspayments.com/" target="_blank" rel="noreferrer" className="linkBtn">
            개발자 문서
          </a>
        </div>

        <label className="field">
          <span>MID</span>
          <input
            className="input"
            value={form.pgMid}
            onChange={(e) => setForm((prev) => ({ ...prev, pgMid: e.target.value }))}
            placeholder="예: mall_123456"
          />
        </label>

        <label className="field">
          <span>Client Key</span>
          <input
            className="input"
            value={form.pgClientKey}
            onChange={(e) => setForm((prev) => ({ ...prev, pgClientKey: e.target.value }))}
            placeholder="라이브 Client Key"
          />
          <small className="hint">저장 후 마스킹 표시: {maskToken(form.pgClientKey) || "-"}</small>
        </label>

        <label className="field">
          <span>Secret Key</span>
          <input
            className="input"
            type="password"
            value={form.pgSecretKey}
            onChange={(e) => setForm((prev) => ({ ...prev, pgSecretKey: e.target.value }))}
            placeholder="라이브 Secret Key"
          />
          <small className="hint">저장 후 마스킹 표시: {maskToken(form.pgSecretKey) || "-"}</small>
        </label>

        <div className="row">
          <button className="btn primary" type="button" onClick={onSave}>
            저장
          </button>
          <span className="muted">{saveBadge === "saved" ? "저장됨 ✅" : ""}</span>
        </div>
      </section>

      <section className="card">
        <h2 className="h2">선결재 기능 활성화 상태</h2>
        <p className={activationReady ? "ok" : "warn"}>
          {activationReady
            ? "사용 가능: 기본/옵션 승인 + PG 입력이 완료되었습니다."
            : "사용 불가: 기본 승인, 옵션 승인, PG 입력을 모두 완료해야 합니다."}
        </p>
      </section>
    </>
  );
}

export default function AdminBillingPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => {
    const queryStore = (sp.get("store") || "").trim();
    const savedStore = (getCurrentStoreId() || "").trim();
    return queryStore || savedStore;
  }, [sp]);

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, storeId]);

  return (
    <main className="wrap">
      <style jsx global>{css}</style>

      <header className="topbar">
        <h1 className="h1">결제/구독 설정</h1>
        <button className="btn" type="button" onClick={() => router.back()}>
          뒤로가기
        </button>
      </header>

      {storeId ? <BillingForm key={storeId} storeId={storeId} /> : null}
    </main>
  );
}

const css = `
  :root {
    --bg: #f7f8fc;
    --card: #fff;
    --line: #e6e8f0;
    --txt: #111827;
    --muted: #6b7280;
    --primary: #2563eb;
    --ok: #047857;
    --warn: #b45309;
    --radius: 14px;
  }
  * {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    color: var(--txt);
    background: var(--bg);
  }
  .wrap {
    max-width: 860px;
    margin: 0 auto;
    padding: 16px;
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
    font-weight: 900;
  }
  .h2 {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 900;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px;
    display: grid;
    gap: 10px;
  }
  .muted {
    color: var(--muted);
    margin: 0;
    font-size: 13px;
  }
  .pill {
    display: inline-block;
    background: #eef2ff;
    color: #1e3a8a;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
  }
  .grid2 {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .toggleRow {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px;
    font-size: 14px;
    font-weight: 700;
  }
  .field {
    display: grid;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
  }
  .input {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 14px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
  .btn {
    border: 1px solid var(--line);
    background: #fff;
    color: #111;
    padding: 10px 12px;
    border-radius: 10px;
    font-weight: 800;
    cursor: pointer;
  }
  .primary {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .links {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .linkBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #bfdbfe;
    color: #1d4ed8;
    background: #eff6ff;
    padding: 8px 10px;
    border-radius: 10px;
    text-decoration: none;
    font-size: 13px;
    font-weight: 700;
  }
  .ok {
    color: var(--ok);
    font-weight: 800;
    margin: 0;
  }
  .warn {
    color: var(--warn);
    font-weight: 800;
    margin: 0;
  }
  @media (max-width: 700px) {
    .grid2 {
      grid-template-columns: 1fr;
    }
  }
`;
