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
                  <button disabled={saving || locked} onClick={() => onGoStep(row.step, row.href)}>
                    {done ? "다시 열기" : "바로 가기"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="actions">
            <button disabled={saving} onClick={onSkipForNow}>
              나중에 하기
            </button>
            <button disabled={saving || isCompleted || !canFinalize || !allStepsConfirmed} onClick={() => setConfirmOpen(true)}>
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
                  <button disabled={saving} onClick={() => setConfirmOpen(false)}>취소</button>
                  <button className={!canFinalize || !allStepsConfirmed ? "btnDisabledLike" : ""} disabled={saving || !canFinalize || !allStepsConfirmed} onClick={onComplete}>최종 완료</button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <style jsx>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 16px; }
        .muted { color: #6b7280; }
        .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; }
        ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
        .stepItem { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .progressWrap { height: 8px; border-radius: 999px; background: #f3f4f6; overflow: hidden; margin: 8px 0; }
        .progressFill { height: 100%; background: #111827; border-radius: 999px; transition: width .2s ease; }
        button { padding: 8px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; }
        .error { color: #b91c1c; margin-top: 8px; }
        .modePicker { display:flex; gap:8px; flex-wrap:wrap; margin:6px 0; }
        .modeBtn { padding:6px 10px; border-radius:999px; border:1px solid #d1d5db; background:#fff; font-size:12px; font-weight:800; }
        .modeBtnOn { background:#111827; border-color:#111827; color:#fff; }
        .warnBox {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #b91c1c;
          border-radius: 10px;
          padding: 10px;
          display: grid;
          gap: 4px;
          font-size: 13px;
          font-weight: 800;
        }
        .btnDisabledLike {
          opacity: .5;
          cursor: not-allowed;
        }
        .confirmOverlay {
          position: fixed;
          inset: 0;
          background: rgba(17, 24, 39, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 50;
        }
        .confirmCard {
          width: 100%;
          max-width: 460px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 14px;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.2);
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
