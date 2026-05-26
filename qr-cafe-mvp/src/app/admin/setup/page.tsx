"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { clearCurrentStoreId, getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import { clearSetupProgress, getSetupProgress, type SetupProgressState } from "@/app/lib/setupProgress";

type SetupStep = 0 | 1 | 2 | 3 | 4;
type SetupMode = "manual" | "copy" | "bulk";

type StoreSetupRow = {
  store_id: string;
  store_name: string | null;
  setup_completed: boolean | null;
  setup_last_step: number | null;
};
type SetupCounts = {
  categories: number;
  options: number;
  menus: number;
};

const stepOrder: Array<{ step: SetupStep; title: string; desc: string; href?: string }> = [
  { step: 1, title: "카테고리 설정", desc: "카테고리를 먼저 등록하세요.", href: "/admin/categories" },
  { step: 2, title: "옵션 설정", desc: "옵션 그룹/항목을 등록하세요.", href: "/admin/options" },
  { step: 3, title: "메뉴 설정", desc: "메뉴를 등록하고 카테고리/옵션을 연결하세요.", href: "/admin/menu" },
];

function computeProgressStep(counts: SetupCounts): 1 | 2 | 3 {
  if (counts.categories < 1) return 1;
  if (counts.options < 1) return 2;
  if (counts.menus < 1) return 3;
  return 3;
}

function computeCompletedSteps(counts: SetupCounts) {
  let done = 0;
  if (counts.categories > 0) done += 1;
  if (counts.options > 0) done += 1;
  if (counts.menus > 0) done += 1;
  return done;
}

function progressStepLabel(step: 1 | 2 | 3) {
  if (step === 1) return "카테고리 설정";
  if (step === 2) return "옵션 설정";
  return "메뉴 설정";
}

function AdminSetupPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = (sp.get("store") || getCurrentStoreId() || "").trim();
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastStep, setLastStep] = useState<SetupStep>(0);
  const [dbCompleted, setDbCompleted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [counts, setCounts] = useState<SetupCounts>({ categories: 0, options: 0, menus: 0 });
  const [setupMode, setSetupMode] = useState<SetupMode>("manual");
  const [progressConfirm, setProgressConfirm] = useState<SetupProgressState>({ step1: false, step2: false, step3: false });

  useEffect(() => {
    const mode = (sp.get("mode") || "").trim();
    if (mode === "manual" || mode === "copy" || mode === "bulk") setSetupMode(mode as SetupMode);
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, sp, storeId]);

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      setMsg("");
      const { data, error } = await supabase
        .from("stores")
        .select("store_id,store_name,setup_completed,setup_last_step")
        .eq("store_id", storeId)
        .maybeSingle();

      if (!mounted) return;
      if (error) {
        setMsg(`초기 설정 정보 로드 실패: ${error.message}`);
        setLoading(false);
        return;
      }
      const row = (data || null) as StoreSetupRow | null;
      if (!row) {
        setMsg("매장 정보를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }
      setStoreName(String(row.store_name || ""));
      const step = Number(row.setup_last_step || 0);
      setDbCompleted(!!row.setup_completed);
      if (row.setup_completed) {
        setLastStep(4);
      } else if (step >= 1 && step <= 3) {
        setLastStep(step as SetupStep);
      } else {
        setLastStep(0);
      }
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const next = await getSetupProgress(storeId);
      if (!mounted) return;
      setProgressConfirm(next);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId, loading]);

  const loadCounts = async (sid: string) => {
    const [catRes, optRes, menuRes] = await Promise.all([
      supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("option_groups").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("store_id", sid),
    ]);
    if (catRes.error || optRes.error || menuRes.error) return null;
    const next = {
      categories: Number(catRes.count || 0),
      options: Number(optRes.count || 0),
      menus: Number(menuRes.count || 0),
    };
    setCounts(next);
    return next;
  };

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const next = await loadCounts(storeId);
      if (!mounted || !next) return;
      setCounts(next);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId]);

  const saveStep = async (step: SetupStep) => {
    if (!storeId) return;
    setSaving(true);
    setMsg("");
    const payload = {
      setup_last_step: step,
      setup_completed: step >= 4,
      setup_completed_at: step >= 4 ? new Date().toISOString() : null,
    } as Record<string, unknown>;

    const { data: authData } = await supabase.auth.getUser();
    if (step >= 4 && authData?.user?.id) {
      payload.setup_completed_by = authData.user.id;
    }

    const { error } = await supabase.from("stores").update(payload).eq("store_id", storeId);
    if (error) {
      setMsg(`저장 실패: ${error.message}`);
      setSaving(false);
      return;
    }
    setLastStep(step);
    setDbCompleted(step >= 4);
    setSaving(false);
  };

  const onGoStep = async (step: SetupStep, href?: string) => {
    await saveStep(step);
    if (!href) return;
    const qs = new URLSearchParams({ store: storeId, mode: setupMode });
    router.push(`${href}?${qs.toString()}`);
  };

  const onComplete = async () => {
    const latest = (await loadCounts(storeId)) || counts;
    if (latest.categories < 1) {
      setMsg("초기 설정 완료 전, 카테고리를 최소 1개 이상 등록해 주세요.");
      return;
    }
    if (latest.options < 1) {
      setMsg("초기 설정 완료 전, 옵션 그룹을 최소 1개 이상 등록해 주세요.");
      return;
    }
    if (latest.menus < 1) {
      setMsg("초기 설정 완료 전, 메뉴를 최소 1개 이상 등록해 주세요.");
      return;
    }
    await saveStep(4);
    await clearSetupProgress(storeId);
    setConfirmOpen(false);
    router.push(`/admin?store=${encodeURIComponent(storeId)}`);
  };

  const progressStep = computeProgressStep(counts);
  const completedSteps = computeCompletedSteps(counts);
  const isReady = completedSteps === 3;
  const isCompleted = dbCompleted && isReady;
  const missingRequirements: string[] = [];
  if (counts.categories < 1) missingRequirements.push("카테고리 1개 이상 등록이 필요합니다.");
  if (counts.options < 1) missingRequirements.push("옵션 그룹 1개 이상 등록이 필요합니다.");
  if (counts.menus < 1) missingRequirements.push("메뉴 1개 이상 등록이 필요합니다.");
  const canFinalize = missingRequirements.length === 0;
  const allStepsConfirmed = progressConfirm.step1 && progressConfirm.step2 && progressConfirm.step3;
  const canGoOptions = counts.categories >= 1;
  const canGoMenus = counts.categories >= 1 && counts.options >= 1;

  const onSkipForNow = async () => {
    if (!storeId) return router.push("/admin");
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id || "";
    if (!uid) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const memRes = await supabase.from("store_members").select("store_id").eq("user_id", uid);
    if (memRes.error) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);
    const ids = (memRes.data || []).map((x: { store_id?: string | null }) => String(x.store_id || "")).filter(Boolean);
    if (!ids.length) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const storesRes = await supabase
      .from("stores")
      .select("store_id,setup_completed")
      .in("store_id", ids)
      .eq("setup_completed", true)
      .order("store_id", { ascending: true });
    if (storesRes.error) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const completedIds = (storesRes.data || [])
      .map((x: { store_id?: string | null }) => String(x.store_id || ""))
      .filter(Boolean);
    const fallbackStoreId = completedIds.find((id) => id !== storeId) || completedIds[0] || "";
    if (!fallbackStoreId) {
      clearCurrentStoreId();
      return router.push("/admin");
    }
    setCurrentStoreId(fallbackStoreId);
    return router.push(`/admin?store=${encodeURIComponent(fallbackStoreId)}`);
  };

  return (
    <main className="wrap">
      <h1>초기 설정</h1>
      <p className="muted">{storeName ? `${storeName} 매장` : "선택한 매장"}의 기본 설정을 완료해 주세요.</p>

      {loading ? <p>로딩 중...</p> : null}
      {!loading ? (
        <section className="card">
          <h2>진행 단계</h2>
          <p className="muted">진행률: {completedSteps}/3</p>
          <p className="muted">상태: {isCompleted ? "최종 완료" : isReady ? "준비 완료(확정 대기)" : "진행 중"}</p>
          <p className="muted">현재 설정 방식: {setupMode === "manual" ? "직접 설정" : setupMode === "copy" ? "원본 복사" : "일괄 등록"}</p>
          <div className="modePicker">
            <button className={`modeBtn ${setupMode === "manual" ? "modeBtnOn" : ""}`} type="button" onClick={() => setSetupMode("manual")}>직접 설정</button>
            <button className={`modeBtn ${setupMode === "copy" ? "modeBtnOn" : ""}`} type="button" onClick={() => setSetupMode("copy")}>원본 복사</button>
            <button className={`modeBtn ${setupMode === "bulk" ? "modeBtnOn" : ""}`} type="button" onClick={() => setSetupMode("bulk")}>일괄 등록</button>
          </div>
          <p className="muted" style={{ marginTop: -2 }}>
            {setupMode === "manual"
              ? "카테고리/옵션/메뉴를 직접 등록하는 방식입니다."
              : setupMode === "copy"
                ? "다른 매장의 설정을 복사해 빠르게 시작하는 방식입니다."
                : "양식 파일 업로드로 데이터를 한 번에 등록하는 방식입니다."}
          </p>
          <p className="muted">현재 단계: {progressStepLabel(progressStep)}</p>
          <div className="progressWrap" aria-hidden>
            <div className="progressFill" style={{ width: `${(completedSteps / 3) * 100}%` }} />
          </div>
          <p className="muted">
            현재 등록 수 · 카테고리 {counts.categories}개 · 옵션그룹 {counts.options}개 · 메뉴 {counts.menus}개
          </p>
          <ul>
            {stepOrder.map((row) => {
              const done = row.step === 1 ? counts.categories > 0 : row.step === 2 ? counts.options > 0 : counts.menus > 0;
              const current = !done && row.step === progressStep;
              const locked =
                row.step === 2 ? !canGoOptions : row.step === 3 ? !canGoMenus : false;
              const lockReason =
                row.step === 2
                  ? "카테고리를 1개 이상 등록하면 옵션 설정이 열립니다."
                  : row.step === 3
                    ? "카테고리/옵션 설정을 완료하면 메뉴 설정이 열립니다."
                    : "";
              return (
                <li key={row.step} className="stepItem">
                  <div>
                    <strong>
                      {row.step}. {row.title} {done ? "✅" : current ? "(진행 중)" : ""}
                    </strong>
                    <p className="muted">{row.desc}</p>
                    {locked ? <p className="muted" style={{ color: "#b45309", marginTop: 4 }}>{lockReason}</p> : null}
                  </div>
                  <button className="stepBtn" disabled={saving || locked} onClick={() => onGoStep(row.step, row.href)}>
                    {done ? "다시 열기" : "바로 가기"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="actions">
            <button className="ghostBtn" disabled={saving} onClick={onSkipForNow}>
              나중에 하기
            </button>
            <button className="primaryBtn" disabled={saving || isCompleted || !canFinalize || !allStepsConfirmed} onClick={() => setConfirmOpen(true)}>
              {isCompleted ? "초기 설정 완료됨" : "초기 설정 완료"}
            </button>
          </div>
          {!allStepsConfirmed ? <p className="muted">각 단계 페이지에서 “이 단계 완료”를 눌러야 최종 완료가 가능합니다.</p> : null}
          {msg ? <p className="error">{msg}</p> : null}

          {confirmOpen ? (
            <div className="confirmOverlay" role="dialog" aria-modal="true" aria-labelledby="setup-confirm-title">
              <div className="confirmCard">
                <h3 id="setup-confirm-title" style={{ margin: 0, fontSize: 18 }}>초기 설정 완료</h3>
                <p className="muted" style={{ marginTop: 6 }}>
                  현재 등록 수: 카테고리 {counts.categories}개 · 옵션그룹 {counts.options}개 · 메뉴 {counts.menus}개
                </p>
                <p className="muted" style={{ marginTop: 4 }}>완료 후에도 카테고리/옵션/메뉴는 수정할 수 있습니다.</p>
                {missingRequirements.length > 0 ? (
                  <div className="warnBox" role="alert" style={{ marginTop: 10 }}>
                    {missingRequirements.map((text) => (
                      <p key={text} style={{ margin: 0 }}>{text}</p>
                    ))}
                  </div>
                ) : null}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="ghostBtn" disabled={saving} onClick={() => setConfirmOpen(false)}>취소</button>
                  <button className={`primaryBtn ${!canFinalize || !allStepsConfirmed ? "btnDisabledLike" : ""}`} disabled={saving || !canFinalize || !allStepsConfirmed} onClick={onComplete}>최종 완료</button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <style jsx>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 20px 16px 28px; }
        h1 { margin: 0 0 4px; font-size: clamp(26px, 4.2vw, 34px); letter-spacing: -0.02em; line-height: 1.08; color: #0f172a; }
        h2 { margin: 0 0 10px; font-size: clamp(22px, 3.6vw, 30px); letter-spacing: -0.02em; line-height: 1.12; color: #0f172a; }
        .muted { color: #475569; margin: 0; font-size: clamp(14px, 2.1vw, 17px); line-height: 1.45; font-weight: 600; }
        .card {
          margin-top: 14px;
          background: #fff;
          border: 1px solid #dbe1ea;
          border-radius: 20px;
          padding: 20px;
          box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
          display: grid;
          gap: 10px;
        }
        .modePicker { display:flex; gap:8px; flex-wrap:wrap; margin: 0; }
        .modeBtn { padding: 10px 14px; border-radius: 999px; border: 1px solid #cbd5e1; background:#fff; font-size:14px; font-weight:900; color:#0f172a; }
        .modeBtnOn { background:#0f172a; border-color:#0f172a; color:#fff; }
        .progressWrap { height: 10px; border-radius: 999px; background: #e5e7eb; overflow: hidden; margin: 2px 0 4px; }
        .progressFill { height: 100%; background: linear-gradient(90deg, #0f172a, #1e3a8a); border-radius: 999px; transition: width .2s ease; }
        ul { list-style: none; padding: 0; margin: 2px 0 0; display: grid; gap: 10px; }
        .stepItem { display: flex; justify-content: space-between; align-items: center; gap: 12px; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px; background:#fff; }
        .stepBtn, .ghostBtn, .primaryBtn {
          min-height: 44px;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 900;
          padding: 10px 14px;
          border: 1px solid #cbd5e1;
          transition: all .15s ease;
        }
        .stepBtn, .ghostBtn { background:#fff; color:#0f172a; }
        .stepBtn:hover:not(:disabled), .ghostBtn:hover:not(:disabled) { background:#f8fafc; border-color:#94a3b8; }
        .primaryBtn { background:#0f172a; color:#fff; border-color:#0f172a; box-shadow: 0 2px 0 rgba(15,23,42,.16); }
        .primaryBtn:hover:not(:disabled) { background:#111f38; border-color:#111f38; }
        button:disabled { opacity: .55; cursor: not-allowed; box-shadow:none; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
        .error { color: #b91c1c; margin-top: 4px; font-weight: 800; }
        .warnBox { border: 1px solid #fecaca; background: #fef2f2; color: #b91c1c; border-radius: 10px; padding: 10px; display: grid; gap: 4px; font-size: 13px; font-weight: 800; }
        .btnDisabledLike { opacity: .55; cursor: not-allowed; }
        .confirmOverlay { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.5); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
        .confirmCard { width: 100%; max-width: 480px; background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 16px; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.2); display:grid; gap:8px; }

                @media (max-width: 768px) {
          .wrap { padding: 14px 12px 24px; }
          h1 { line-height: 1.1; }
          h2 { line-height: 1.15; }
          .muted { line-height: 1.42; }
          .card { padding: 14px; border-radius: 16px; gap: 8px; }
          .modeBtn { font-size: 13px; padding: 8px 12px; }
          .stepItem { padding: 10px; border-radius: 12px; }
          .stepBtn, .ghostBtn, .primaryBtn { min-height: 40px; font-size: 14px; padding: 8px 10px; }
        }
        @media (max-width: 560px) {
          .stepItem { flex-direction: row; align-items: flex-start; }
          .stepBtn { min-width: 82px; }
          .actions { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </main>
  );
}

export default function AdminSetupPage() {
  return (
    <Suspense fallback={<main style={{ padding: 16 }}>로딩 중...</main>}>
      <AdminSetupPageInner />
    </Suspense>
  );
}
