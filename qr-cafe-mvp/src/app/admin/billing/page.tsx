"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import { BillingSettings, maskToken } from "@/app/lib/billingSettings";

type SaveMode = "db" | "unsynced";
type SavedPgView = {
  mid: string;
  clientKey: string;
  hasSecret: boolean;
  updatedAt: string | null;
};

const EMPTY_BILLING: BillingSettings = {
  baseApproved: false,
  addonApproved: false,
  pgMid: "",
  pgClientKey: "",
  pgSecretKey: "",
  updatedAt: null,
};

async function loadBillingFromDb(storeId: string): Promise<BillingSettings | null> {
  try {
    const { data: pgRow, error } = await supabase
      .from("store_pg_config")
      .select("mid, client_key, secret_key, updated_at")
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) return null;
    if (!pgRow) return null;

    return {
      baseApproved: false,
      addonApproved: false,
      pgMid: String(pgRow?.mid || ""),
      pgClientKey: String(pgRow?.client_key || ""),
      pgSecretKey: String(pgRow?.secret_key || ""),
      updatedAt: Number.isFinite(new Date(String(pgRow?.updated_at || "")).getTime())
        ? new Date(String(pgRow?.updated_at || "")).getTime()
        : null,
    };
  } catch {
    return null;
  }
}

async function saveBillingToDb(storeId: string, form: BillingSettings): Promise<boolean> {
  try {
    const pgPayload: {
      store_id: string;
      mid: string;
      client_key: string;
      updated_at: string;
      secret_key?: string;
    } = {
      store_id: storeId,
      mid: form.pgMid.trim(),
      client_key: form.pgClientKey.trim(),
      updated_at: new Date().toISOString(),
    };
    if (form.pgSecretKey.trim()) pgPayload.secret_key = form.pgSecretKey.trim();

    const { error } = await supabase.from("store_pg_config").upsert(pgPayload, { onConflict: "store_id" });
    return !error;
  } catch {
    return false;
  }
}

function BillingForm({ storeId }: { storeId: string }) {
  const [form, setForm] = useState<BillingSettings>(EMPTY_BILLING);
  const [savedPg, setSavedPg] = useState<SavedPgView | null>(null);
  const [saveBadge, setSaveBadge] = useState<"idle" | "saved" | "error">("idle");
  const [saveMode, setSaveMode] = useState<SaveMode>("unsynced");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const dbData = await loadBillingFromDb(storeId);
      if (!mounted) return;
      if (dbData) {
        setForm(dbData);
        setSavedPg({
          mid: dbData.pgMid,
          clientKey: dbData.pgClientKey,
          hasSecret: !!dbData.pgSecretKey,
          updatedAt: dbData.updatedAt ? new Date(dbData.updatedAt).toISOString() : null,
        });
        setSaveMode("db");
      } else {
        setForm(EMPTY_BILLING);
        setSavedPg(null);
        setSaveMode("unsynced");
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId]);

  const activationReady = useMemo(() => !!form.pgMid && !!form.pgClientKey && !!form.pgSecretKey, [form]);

  const onSave = async () => {
    const savedToDb = await saveBillingToDb(storeId, form);
    if (savedToDb) {
      const latest = await loadBillingFromDb(storeId);
      if (latest) {
        setSavedPg({
          mid: latest.pgMid,
          clientKey: latest.pgClientKey,
          hasSecret: !!latest.pgSecretKey,
          updatedAt: latest.updatedAt ? new Date(latest.updatedAt).toISOString() : null,
        });
      }
      setForm((prev) => ({ ...prev, pgSecretKey: "" }));
      setSaveMode("db");
      setSaveBadge("saved");
      setTimeout(() => setSaveBadge("idle"), 1400);
      return;
    }

    setSaveMode("unsynced");
    setSaveBadge("error");
    setTimeout(() => setSaveBadge("idle"), 2000);
  };

  if (loading) {
    return (
      <section className="card">
        <p className="muted">PG 설정 로딩 중...</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="rowWrap">
          <div className="pill">store: {storeId || "-"}</div>
          <div className={saveMode === "db" ? "mode modeDb" : "mode modeUnsynced"}>
            저장 상태: {saveMode === "db" ? "Supabase(DB) 동기화 완료" : "DB 미동기화"}
          </div>
        </div>
        <p className="muted">이 페이지는 매장 PG 연결 정보 저장과 연결 상태 확인 전용입니다.</p>
      </section>

      {saveMode !== "db" ? (
        <section className="card warningCard">
          <p className="warn">
            현재 PG 설정이 DB에 동기화되지 않았습니다. 저장 후 다시 확인해 주세요.
          </p>
        </section>
      ) : null}

      <section className="card">
        <h2 className="h2">등록된 PG 정보</h2>
        <div className="field">
          <span>MID</span>
          <strong>{savedPg?.mid || "-"}</strong>
        </div>
        <div className="field">
          <span>Client Key</span>
          <strong>{savedPg?.clientKey ? maskToken(savedPg.clientKey) : "-"}</strong>
        </div>
        <div className="field">
          <span>Secret Key</span>
          <strong>{savedPg?.hasSecret ? "********(등록됨)" : "-"}</strong>
        </div>
        <p className="muted">최근 수정: {savedPg?.updatedAt ? new Date(savedPg.updatedAt).toLocaleString("ko-KR", { hour12: false }) : "-"}</p>
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
            placeholder="라이브 Secret Key (변경 시에만 입력)"
          />
          <small className="hint">공란으로 저장하면 기존 Secret Key를 유지합니다.</small>
        </label>

        <div className="row">
          <button className="btn primary" type="button" onClick={onSave}>
            저장
          </button>
          <span className="muted">
            {saveBadge === "saved"
              ? "DB 저장 완료 ✅"
              : saveBadge === "error"
                ? "DB 저장 실패: 네트워크/권한/테이블 상태를 확인하세요"
                : ""}
          </span>
        </div>
      </section>

      <section className="card">
        <h2 className="h2">PG 연결 활성화 상태</h2>
        <p className={activationReady ? "ok" : "warn"}>
          {activationReady
            ? "사용 가능: PG 입력이 완료되었습니다."
            : "사용 불가: MID/Client Key/Secret Key 입력을 완료해야 합니다."}
        </p>
      </section>

    </>
  );
}

function AdminBillingPageInner() {
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
        <h1 className="h1">PG 설정</h1>
        <button className="btn" type="button" onClick={() => router.back()}>
          관리자 홈
        </button>
      </header>

      {storeId ? (
       <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
        <BillingForm key={storeId} storeId={storeId} />
       </Suspense>
      ) : null}
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
  .rowWrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .mode {
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 800;
  }
  .modeDb {
    background: #ecfdf3;
    color: #065f46;
    border: 1px solid #a7f3d0;
  }
  .modeUnsynced {
    background: #fff7ed;
    color: #9a3412;
    border: 1px solid #fed7aa;
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
export default function AdminBillingPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminBillingPageInner />
    </Suspense>
  );
}
