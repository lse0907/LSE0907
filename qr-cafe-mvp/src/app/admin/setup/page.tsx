"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { clearCurrentStoreId, getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import { clearSetupProgress, getSetupProgress, type SetupProgressState } from "@/app/lib/setupProgress";

type SetupStep = 0 | 1 | 2 | 3 | 4;
type ActiveSetupStep = 1 | 2 | 3 | 4;
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
  optionItems: number;
  menus: number;
  readyMenus: number;
  optionLinkedMenus: number;
};

type StepView = {
  step: ActiveSetupStep;
  title: string;
  desc: string;
  href: string;
  noun: string;
  count: number;
  dataReady: boolean;
  confirmed: boolean;
  locked: boolean;
  lockReason: string;
  statusLabel: string;
  statusClass: "done" | "need" | "locked";
  buttonLabel: string;
};

const stepOrder: Array<{ step: ActiveSetupStep; title: string; desc: string; href: string; noun: string }> = [
  { step: 1, title: "카테고리 설정", desc: "메뉴를 나눌 분류를 만듭니다.", href: "/admin/categories", noun: "카테고리" },
  { step: 2, title: "공통옵션 설정", desc: "사이즈, 온도 등 공통옵션 그룹과 항목을 만듭니다.", href: "/admin/options", noun: "옵션 항목" },
  { step: 3, title: "메뉴 등록", desc: "판매 메뉴의 이름, 가격, 카테고리를 등록합니다.", href: "/admin/menu", noun: "판매 메뉴" },
  { step: 4, title: "주문 옵션 연결 확인", desc: "메뉴에 필요한 공통옵션이 연결되어 있는지 확인합니다.", href: "/admin/menu/option-connect", noun: "연결 메뉴" },
];

const modeOptions: Array<{ mode: SetupMode; title: string; badge: string; desc: string; note: string }> = [
  {
    mode: "manual",
    title: "직접 설정",
    badge: "추천",
    desc: "처음 설정할 때 추천합니다.",
    note: "카테고리 → 공통옵션 → 메뉴 → 주문 옵션 연결 확인 순서로 마무리합니다.",
  },
  {
    mode: "copy",
    title: "원본 복사",
    badge: "빠른 시작",
    desc: "다른 매장이 있다면 빠르게 시작할 수 있습니다.",
    note: "원본 데이터를 복사한 뒤 수정합니다.",
  },
  {
    mode: "bulk",
    title: "일괄 등록",
    badge: "대량 등록",
    desc: "메뉴가 많을 때 파일로 등록합니다.",
    note: "옵션은 직접 설정이 필요합니다.",
  },
];

function setupModeFromQuery(raw: string): SetupMode {
  if (raw === "copy" || raw === "bulk") return raw;
  return "manual";
}

function hasOptionSetupReady(counts: SetupCounts) {
  return counts.options > 0 && counts.optionItems > 0;
}

function hasMenuSetupReady(counts: SetupCounts) {
  return counts.readyMenus > 0;
}

function computeProgressStep(counts: SetupCounts): ActiveSetupStep {
  if (counts.categories < 1) return 1;
  if (!hasOptionSetupReady(counts)) return 2;
  if (!hasMenuSetupReady(counts)) return 3;
  return 4;
}

function computeCompletedSteps(counts: SetupCounts) {
  let done = 0;
  if (counts.categories > 0) done += 1;
  if (hasOptionSetupReady(counts)) done += 1;
  if (hasMenuSetupReady(counts)) done += 1;
  return done;
}

function progressStepLabel(step: ActiveSetupStep) {
  if (step === 1) return "카테고리 설정";
  if (step === 2) return "공통옵션 설정";
  if (step === 3) return "메뉴 등록";
  return "주문 옵션 연결 확인";
}

function getCountForStep(step: ActiveSetupStep, counts: SetupCounts) {
  if (step === 1) return counts.categories;
  if (step === 2) return counts.optionItems;
  if (step === 3) return counts.readyMenus;
  return counts.optionLinkedMenus;
}

function getConfirmedForStep(step: ActiveSetupStep, progressConfirm: SetupProgressState) {
  if (step === 1) return progressConfirm.step1;
  if (step === 2) return progressConfirm.step2;
  return progressConfirm.step3;
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
  const [counts, setCounts] = useState<SetupCounts>({ categories: 0, options: 0, optionItems: 0, menus: 0, readyMenus: 0, optionLinkedMenus: 0 });
  const [setupMode, setSetupMode] = useState<SetupMode>(() => setupModeFromQuery((sp.get("mode") || "").trim()));
  const [progressConfirm, setProgressConfirm] = useState<SetupProgressState>({ step1: false, step2: false, step3: false });

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, storeId]);

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

  useEffect(() => {
    if (!confirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, saving]);

  const loadCounts = async (sid: string) => {
    const [catRes, optRes, itemRes, menuRes] = await Promise.all([
      supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("store_id", sid).eq("is_active", true),
      supabase.from("option_groups").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("option_items").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("menu_items").select("id,price,is_sold_out,category_id,option_group_ids").eq("store_id", sid),
    ]);
    if (catRes.error || optRes.error || itemRes.error || menuRes.error) return null;
    const menuRows = Array.isArray(menuRes.data) ? menuRes.data : [];
    const next = {
      categories: Number(catRes.count || 0),
      options: Number(optRes.count || 0),
      optionItems: Number(itemRes.count || 0),
      menus: menuRows.length,
      readyMenus: menuRows.filter((menu) => Number(menu.price || 0) > 0 && !menu.is_sold_out && Boolean(menu.category_id)).length,
      optionLinkedMenus: menuRows.filter((menu) => Array.isArray(menu.option_group_ids) && menu.option_group_ids.length > 0).length,
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

  const saveStep = async (step: SetupStep, complete = false) => {
    if (!storeId) return;
    setSaving(true);
    setMsg("");
    const payload = {
      setup_last_step: step,
      setup_completed: complete,
      setup_completed_at: complete ? new Date().toISOString() : null,
    } as Record<string, unknown>;

    const { data: authData } = await supabase.auth.getUser();
    if (complete && authData?.user?.id) {
      payload.setup_completed_by = authData.user.id;
    }

    const { error } = await supabase.from("stores").update(payload).eq("store_id", storeId);
    if (error) {
      setMsg(`저장 실패: ${error.message}`);
      setSaving(false);
      return;
    }
    setLastStep(step);
    setDbCompleted(complete);
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
    if (!hasOptionSetupReady(latest)) {
      setMsg("초기 설정 완료 전, 옵션 그룹과 항목을 최소 1개 이상 등록해 주세요.");
      return;
    }
    if (!hasMenuSetupReady(latest)) {
      setMsg("초기 설정 완료 전, 가격이 있는 판매 메뉴를 카테고리에 연결해 주세요.");
      return;
    }
    await saveStep(4, true);
    await clearSetupProgress(storeId);
    setConfirmOpen(false);
    router.push(`/admin?store=${encodeURIComponent(storeId)}`);
  };

  const progressStep = computeProgressStep(counts);
  const optionConnectionReviewed = lastStep >= 4 || dbCompleted;
  const completedSteps = Math.min(computeCompletedSteps(counts) + (optionConnectionReviewed ? 1 : 0), 4);
  const isReady = completedSteps === 4;
  const isCompleted = dbCompleted && isReady;
  const allStepsConfirmed = progressConfirm.step1 && progressConfirm.step2 && progressConfirm.step3 && optionConnectionReviewed;
  const canGoOptions = counts.categories >= 1;
  const canGoMenus = counts.categories >= 1 && hasOptionSetupReady(counts);
  const canGoOptionConnect = canGoMenus && hasMenuSetupReady(counts);

  const stepViews: StepView[] = stepOrder.map((row) => {
    const count = getCountForStep(row.step, counts);
    const dataReady =
      row.step === 2
        ? hasOptionSetupReady(counts)
        : row.step === 3
          ? hasMenuSetupReady(counts)
          : row.step === 4
            ? hasMenuSetupReady(counts)
            : count > 0;
    const confirmed = row.step === 4 ? optionConnectionReviewed : getConfirmedForStep(row.step, progressConfirm);
    const locked = row.step === 2 ? !canGoOptions : row.step === 3 ? !canGoMenus : row.step === 4 ? !canGoOptionConnect : false;
    const lockReason =
      row.step === 2
        ? "카테고리 등록 후 진행할 수 있습니다."
        : row.step === 3
          ? "카테고리와 옵션 항목 등록 후 진행할 수 있습니다."
          : row.step === 4
            ? "메뉴 등록 후 옵션 연결을 확인할 수 있습니다."
            : "";
    const statusLabel = row.step === 4
      ? locked
        ? "잠김"
        : confirmed
          ? "확인 완료"
          : "확인 필요"
      : locked
        ? "잠김"
        : confirmed
          ? "완료 확인됨"
          : dataReady
            ? "등록됨 · 완료 확인 필요"
            : "등록 필요";
    const buttonLabel = row.step === 4
      ? locked
        ? "대기 중"
        : confirmed
          ? "다시 확인"
          : "확인하기"
      : locked
        ? "대기 중"
        : confirmed
          ? "수정/확인"
          : dataReady
            ? "확인/완료"
            : "등록하기";
    const statusClass = locked ? "locked" : confirmed ? "done" : "need";
    return { ...row, count, dataReady, confirmed, locked, lockReason, statusLabel, statusClass, buttonLabel };
  });

  const missingRequirements: string[] = [];
  if (counts.categories < 1) missingRequirements.push("카테고리를 1개 이상 등록해 주세요.");
  if (!hasOptionSetupReady(counts)) missingRequirements.push("옵션 그룹과 항목을 1개 이상 등록해 주세요.");
  if (!hasMenuSetupReady(counts)) missingRequirements.push("가격이 있는 판매 메뉴를 카테고리에 연결해 주세요.");
  if (counts.categories >= 1 && !progressConfirm.step1) missingRequirements.push("카테고리 설정 완료 버튼을 눌러주세요.");
  if (hasOptionSetupReady(counts) && !progressConfirm.step2) missingRequirements.push("공통옵션 설정 완료 버튼을 눌러주세요.");
  if (hasMenuSetupReady(counts) && !progressConfirm.step3) missingRequirements.push("메뉴 등록 완료 버튼을 눌러주세요.");
  if (hasMenuSetupReady(counts) && !optionConnectionReviewed) missingRequirements.push("주문 옵션 연결 확인 단계를 확인해 주세요.");
  const canFinalize = missingRequirements.length === 0;

  const nextStep = stepViews.find((step) => !step.locked && (!step.dataReady || !step.confirmed)) || stepViews[3];
  const nextRegisterPrompt =
    nextStep.step === 1
      ? "카테고리를 1개 이상 등록해 주세요."
      : nextStep.step === 2
        ? "옵션 그룹을 1개 이상 등록해 주세요."
        : nextStep.step === 3
          ? "메뉴를 1개 이상 등록해 주세요."
          : "메뉴별 주문 옵션 연결 상태를 확인해 주세요.";
  const nextActionText = isCompleted
    ? "초기 설정이 완료되었습니다. 이후에도 수정할 수 있습니다."
    : !nextStep.dataReady
      ? nextRegisterPrompt
      : !nextStep.confirmed
        ? `${nextStep.title}에서 확인 후 완료 버튼을 눌러주세요.`
        : "모든 데이터가 준비되었습니다. 최종 완료해 주세요.";

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

  const closeConfirm = () => {
    if (!saving) setConfirmOpen(false);
  };

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">매장 오픈 준비</p>
          <h1>초기 설정</h1>
          <p className="heroText">{storeName ? `${storeName} 매장` : "선택한 매장"}의 주문 접수에 필요한 기본 정보를 완성해 주세요.</p>
        </div>
      </header>

      {loading ? (
        <section className="card loadingCard" aria-live="polite">
          <div className="skeletonTitle" />
          <div className="skeletonLine" />
          <div className="skeletonLine short" />
          <p className="muted">매장 정보와 등록된 메뉴 데이터를 확인하고 있어요.</p>
        </section>
      ) : null}

      {!loading ? (
        <>
          <section className="summaryCard">
            <div className="summaryTop">
              <div>
                <p className="eyebrow">다음 할 일</p>
                <div className="summaryTitleRow">
                  <h2>{isCompleted ? "초기 설정 완료" : nextStep.title}</h2>
                  <span className={`statePill ${isCompleted ? "stateDone" : isReady ? "stateReady" : "stateWorking"}`}>
                    {isCompleted ? "최종 완료" : isReady ? "확정 대기" : "진행 중"}
                  </span>
                </div>
                <p className="summaryText">{nextActionText}</p>
              </div>
              {!isCompleted ? (
                <button className="primaryBtn summaryCta" disabled={saving || nextStep.locked} onClick={() => onGoStep(nextStep.step, nextStep.href)}>
                  {nextStep.buttonLabel}
                </button>
              ) : null}
            </div>
            <div
              className="progressWrap"
              role="progressbar"
              aria-label="초기 설정 진행률"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={completedSteps}
            >
              <div className="progressFill" style={{ width: `${(completedSteps / 4) * 100}%` }} />
            </div>
            <div className="summaryMeta" aria-label="현재 등록 수">
              <span>진행률 {completedSteps}/4</span>
              <span>카테고리 {counts.categories}개</span>
              <span>옵션항목 {counts.optionItems}개</span>
              <span>판매메뉴 {counts.readyMenus}개</span>
              <span>옵션연결 {counts.optionLinkedMenus}개</span>
              <span>현재 단계 {progressStepLabel(progressStep)}</span>
            </div>
            <p className="summaryCompact">
              진행률 {completedSteps}/4 · 카테고리 {counts.categories} · 옵션항목 {counts.optionItems} · 판매메뉴 {counts.readyMenus} · 옵션연결 {counts.optionLinkedMenus}
            </p>
          </section>

          {msg ? <div className="error" role="alert">{msg}</div> : null}

          <section className="card">
            <div className="sectionHead">
              <div>
                <p className="eyebrow">설정 방식</p>
                <h2 className="sectionTitleCompact">설정 방식을 선택해 주세요.</h2>
              </div>
              <span className="modeCurrent">현재: {setupMode === "manual" ? "직접 설정" : setupMode === "copy" ? "원본 복사" : "일괄 등록"}</span>
            </div>
            <div className="modeGrid" role="group" aria-label="초기 설정 방식 선택">
              {modeOptions.map((option) => (
                <button
                  key={option.mode}
                  className={`modeCard ${setupMode === option.mode ? "modeCardOn" : ""}`}
                  type="button"
                  aria-pressed={setupMode === option.mode}
                  onClick={() => setSetupMode(option.mode)}
                >
                  <span className="modeTitleRow">
                    <strong>{option.title}</strong>
                    <span className="modeBadge">{option.badge}</span>
                  </span>
                  <span>{option.desc}</span>
                  <small>{option.note}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="sectionHead">
              <div>
                <p className="eyebrow">체크리스트</p>
                <h2>진행 단계</h2>
              </div>
              <span className="modeCurrent">{allStepsConfirmed ? "모든 단계 확인 완료" : "단계 확인 필요"}</span>
            </div>
            <ul className="stepList">
              {stepViews.map((row) => (
                <li key={row.step} className={`stepItem ${row.locked ? "stepLocked" : ""}`}>
                  <div className="stepMain">
                    <div className="stepTitleRow">
                      <span className={`stepNumber ${row.statusClass}`}>{row.confirmed ? "✓" : row.step}</span>
                      <div>
                        <strong>{row.title}</strong>
                        <p className="muted">{row.desc}</p>
                      </div>
                    </div>
                    <div className="stepBadges">
                      <span>{row.noun} {row.count}개</span>
                      <span className={`statusBadge ${row.statusClass}`}>{row.statusLabel}</span>
                      {lastStep === row.step ? <span className="recentBadge">최근 방문 단계</span> : null}
                    </div>
                    {row.locked ? <p className="warnText">{row.lockReason}</p> : null}
                    {!row.locked && row.dataReady && !row.confirmed ? (
                      <p className="warnText">
                        {row.step === 4 ? "옵션이 필요 없는 메뉴는 연결하지 않아도 됩니다. 연결 상태만 확인해 주세요." : "등록 후 완료 버튼을 눌러주세요."}
                      </p>
                    ) : null}
                  </div>
                  <button className="stepBtn" type="button" disabled={saving || row.locked} onClick={() => onGoStep(row.step, row.href)}>
                    {row.buttonLabel}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card finishCard">
            <div>
              <p className="eyebrow">최종 확인</p>
              <h2 className="sectionTitleCompact">초기 매장 설정을 마무리해 주세요.</h2>
              <p className="muted finishGuide">완료 전에는 주문 화면이 제한될 수 있습니다.</p>
            </div>
            {missingRequirements.length > 0 ? (
              <div className="warnBox" role="status">
                <strong>남은 항목 {missingRequirements.length}개를 확인해 주세요.</strong>
                {missingRequirements.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
            ) : (
              <div className="successBox" role="status">모든 설정이 확인되었습니다. 완료 후 관리자 홈으로 이동합니다.</div>
            )}
            <div className="actions">
              <button className="ghostBtn" disabled={saving} onClick={onSkipForNow}>
                관리자 홈으로 나가기
              </button>
              <button className="primaryBtn" disabled={saving || isCompleted || !canFinalize} onClick={() => setConfirmOpen(true)}>
                {isCompleted ? "초기 설정 완료됨" : "초기 설정 완료"}
              </button>
            </div>
          </section>

          {confirmOpen ? (
            <div className="confirmOverlay" role="dialog" aria-modal="true" aria-labelledby="setup-confirm-title" onMouseDown={closeConfirm}>
              <div className="confirmCard" onMouseDown={(event) => event.stopPropagation()}>
                <div>
                  <p className="eyebrow">최종 완료</p>
                  <h3 id="setup-confirm-title">초기 설정을 완료할까요?</h3>
                  <p className="muted">완료 후 관리자 홈으로 이동합니다. 메뉴 설정은 나중에도 수정할 수 있습니다.</p>
                </div>
                <div className="countGrid">
                  <div><span>카테고리</span><strong>{counts.categories}개</strong></div>
                  <div><span>옵션항목</span><strong>{counts.optionItems}개</strong></div>
                  <div><span>판매메뉴</span><strong>{counts.readyMenus}개</strong></div>
                </div>
                {missingRequirements.length > 0 ? (
                  <div className="warnBox" role="alert">
                    {missingRequirements.map((text) => (
                      <p key={text}>{text}</p>
                    ))}
                  </div>
                ) : null}
                <div className="actions modalActions">
                  <button className="ghostBtn" disabled={saving} onClick={closeConfirm}>계속 수정하기</button>
                  <button className="primaryBtn" disabled={saving || !canFinalize} onClick={onComplete}>
                    {saving ? "완료 처리 중..." : "완료하고 이동"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <style jsx>{`
        .wrap { max-width: 980px; margin: 0 auto; padding: 22px 16px 34px; color: #0f172a; }
        .hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
        .eyebrow { margin: 0 0 5px; color: #2563eb; font-size: 12px; font-weight: 950; letter-spacing: .04em; text-transform: uppercase; }
        h1 { margin: 0 0 6px; font-size: clamp(27px, 4.2vw, 38px); letter-spacing: -0.03em; line-height: 1.05; }
        h2 { margin: 0; font-size: clamp(21px, 3vw, 28px); letter-spacing: -0.025em; line-height: 1.16; }
        h3 { margin: 0 0 6px; font-size: 20px; letter-spacing: -0.02em; line-height: 1.2; }
        .heroText, .summaryText, .muted { color: #475569; margin: 0; font-size: clamp(14px, 2vw, 16px); line-height: 1.48; font-weight: 650; }
        .statePill, .modeCurrent { flex: 0 0 auto; border-radius: 999px; padding: 8px 11px; font-size: 13px; font-weight: 950; border: 1px solid #cbd5e1; background: #fff; }
        .stateWorking { color: #92400e; background: #fffbeb; border-color: #fde68a; }
        .stateReady { color: #1e3a8a; background: #eff6ff; border-color: #bfdbfe; }
        .stateDone { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
        .card, .summaryCard {
          margin-top: 14px;
          background: #fff;
          border: 1px solid #dbe1ea;
          border-radius: 22px;
          padding: 20px;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
          display: grid;
          gap: 14px;
        }
        .summaryCard { border-color: #bfdbfe; background: linear-gradient(180deg, #eef5ff 0%, #ffffff 100%); }
        .summaryTop, .sectionHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
        .summaryTitleRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sectionTitleCompact { font-size: clamp(19px, 2.6vw, 25px); }
        .summaryCta { min-width: 180px; align-self: center; }
        .progressWrap { height: 12px; border-radius: 999px; background: #dbeafe; overflow: hidden; }
        .progressFill { height: 100%; background: linear-gradient(90deg, #2563eb, #0f172a); border-radius: 999px; transition: width .2s ease; }
        .summaryMeta { display: flex; flex-wrap: wrap; gap: 8px; }
        .summaryCompact { display: none; margin: 0; color: #334155; font-size: 12px; line-height: 1.35; font-weight: 900; }
        .summaryMeta span, .stepBadges span { border: 1px solid #dbe1ea; background: #f8fafc; border-radius: 999px; padding: 6px 9px; color: #334155; font-size: 12px; font-weight: 900; }
        .loadingCard { overflow: hidden; }
        .skeletonTitle, .skeletonLine { height: 18px; border-radius: 999px; background: linear-gradient(90deg, #e2e8f0, #f8fafc, #e2e8f0); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
        .skeletonTitle { width: 46%; height: 26px; }
        .skeletonLine { width: 82%; }
        .skeletonLine.short { width: 58%; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .modeGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .modeCard { text-align: left; min-height: 150px; padding: 14px; border-radius: 16px; border: 1px solid #dbe1ea; background: #fff; color: #0f172a; display: grid; align-content: start; gap: 7px; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, transform .1s ease; }
        .modeCard:hover { border-color: #93c5fd; box-shadow: 0 8px 20px rgba(37, 99, 235, .1); }
        .modeCard:active { transform: translateY(1px); }
        .modeCardOn { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); background: #eff6ff; }
        .modeTitleRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
        .modeBadge { width: fit-content; flex: 0 0 auto; border-radius: 999px; background: #dbeafe; color: #1e40af; padding: 4px 8px; font-size: 11px; font-weight: 950; }
        .modeCard strong { font-size: 17px; font-weight: 950; }
        .modeCard span:not(.modeBadge), .modeCard small { color: #475569; line-height: 1.4; font-weight: 750; }
        .modeCard small { color: #64748b; }
        .stepList { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
        .stepItem { display: flex; justify-content: space-between; align-items: center; gap: 14px; border: 1px solid #e2e8f0; border-radius: 18px; padding: 14px; background: #fff; }
        .stepLocked { background: #f8fafc; }
        .stepMain { min-width: 0; display: grid; gap: 9px; }
        .stepTitleRow { display: flex; gap: 10px; align-items: flex-start; }
        .stepTitleRow strong { display: block; font-size: 17px; line-height: 1.25; }
        .stepNumber { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 950; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
        .stepNumber.done { background: #dcfce7; color: #166534; border-color: #86efac; }
        .stepNumber.need { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
        .stepNumber.locked { background: #f1f5f9; color: #94a3b8; }
        .stepBadges { display: flex; flex-wrap: wrap; gap: 6px; }
        .statusBadge.done { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
        .statusBadge.need { color: #92400e; background: #fffbeb; border-color: #fde68a; }
        .statusBadge.locked { color: #64748b; background: #f1f5f9; }
        .warnText { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 9px 10px; margin: 0; font-size: 13px; font-weight: 850; line-height: 1.4; }
        .stepBtn, .ghostBtn, .primaryBtn {
          min-height: 44px;
          border-radius: 13px;
          font-size: 15px;
          font-weight: 950;
          padding: 10px 15px;
          border: 1px solid #cbd5e1;
          transition: background-color .15s ease, border-color .15s ease, transform .1s ease, box-shadow .15s ease;
        }
        .stepBtn, .ghostBtn { background: #fff; color: #0f172a; }
        .stepBtn { min-width: 142px; }
        .stepBtn:hover:not(:disabled), .ghostBtn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; }
        .primaryBtn { background: #0f172a; color: #fff; border-color: #0f172a; box-shadow: 0 2px 0 rgba(15,23,42,.16); }
        .primaryBtn:hover:not(:disabled) { background: #111f38; border-color: #111f38; }
        button:active:not(:disabled), .primaryBtn:active:not(:disabled) { transform: translateY(1px); }
        button:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
        .finishCard { border-color: #cbd5e1; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .error { margin-top: 12px; color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 14px; padding: 12px; font-weight: 900; line-height: 1.45; }
        .warnBox, .successBox { border-radius: 14px; padding: 12px; display: grid; gap: 6px; font-size: 14px; font-weight: 850; line-height: 1.42; }
        .warnBox { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; }
        .warnBox p { margin: 0; }
        .successBox { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; }
        .confirmOverlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.58); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
        .confirmCard { width: 100%; max-width: 540px; max-height: min(720px, calc(100dvh - 32px)); overflow: auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 22px; padding: 18px; box-shadow: 0 22px 56px rgba(0, 0, 0, 0.24); display: grid; gap: 14px; }
        .countGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .countGrid div { border: 1px solid #dbe1ea; border-radius: 14px; padding: 12px; background: #f8fafc; display: grid; gap: 4px; }
        .countGrid span { color: #64748b; font-size: 12px; font-weight: 900; }
        .countGrid strong { font-size: 20px; }
        .modalActions { grid-template-columns: .8fr 1.2fr; }

        @media (max-width: 1024px) and (orientation: landscape) {
          .wrap { max-width: 920px; padding: 14px 12px 22px; }
          .card, .summaryCard { padding: 14px; border-radius: 18px; gap: 10px; }
          h1 { font-size: 26px; }
          h2 { font-size: 22px; }
          .sectionTitleCompact { font-size: 20px; }
          .heroText, .summaryText, .muted { font-size: 14px; line-height: 1.42; }
          .modeCard { min-height: 132px; padding: 12px; }
          .stepItem { padding: 11px; gap: 10px; }
          .stepBtn, .ghostBtn, .primaryBtn { min-height: 44px; font-size: 14px; padding: 9px 12px; }
          .actions { gap: 8px; }
        }
        @media (max-width: 768px) {
          .wrap { padding: 16px 12px 28px; }
          .hero, .summaryTop, .sectionHead { flex-direction: column; align-items: stretch; }
          .statePill, .modeCurrent { width: fit-content; }
          .summaryCta { width: 100%; min-width: 0; }
          .card, .summaryCard { padding: 15px; border-radius: 18px; }
          .modeGrid { grid-template-columns: 1fr; }
          .modeCard { min-height: 0; }
          .stepItem { align-items: flex-start; }
          .stepBtn, .ghostBtn, .primaryBtn { min-height: 44px; font-size: 14px; padding: 9px 11px; }
        }

        @media (min-width: 561px) and (max-width: 768px) {
          .summaryTop,
          .sectionHead {
            flex-direction: row;
            align-items: center;
          }
          .summaryCta {
            width: auto;
            min-width: 150px;
            flex: 0 0 auto;
          }
          .modeCurrent { width: fit-content; }
          .modeGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .modeCard {
            min-height: 126px;
            padding: 12px;
          }
          .modeCard strong { font-size: 15px; }
          .modeCard span:not(.modeBadge),
          .modeCard small {
            font-size: 12px;
            line-height: 1.35;
          }
          .stepItem { align-items: center; }
          .stepBtn { min-width: 128px; }
        }
        @media (max-width: 560px) {
          .wrap { padding: 10px 10px 18px; }
          .hero { margin-bottom: 8px; gap: 8px; }
          .eyebrow { margin-bottom: 3px; font-size: 10px; }
          h1 { margin-bottom: 3px; font-size: 24px; }
          h2 { font-size: 18px; line-height: 1.12; }
          .sectionTitleCompact { font-size: 17px; }
          h3 { font-size: 18px; }
          .heroText, .summaryText, .muted { font-size: 13px; line-height: 1.34; }
          .statePill, .modeCurrent { padding: 5px 8px; font-size: 11px; }
          .card, .summaryCard { margin-top: 8px; padding: 10px; border-radius: 14px; gap: 8px; box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04); }
          .summaryTop { flex-direction: row; align-items: center; gap: 8px; }
          .summaryCta { width: auto; min-width: 82px; min-height: 40px; flex: 0 0 auto; }
          .sectionHead { flex-direction: row; align-items: center; }
          .progressWrap { height: 8px; }
          .summaryMeta { display: none; }
          .summaryCompact { display: block; }
          .sectionHead { gap: 6px; }
          .modeGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
          .modeCard { min-height: 0; padding: 8px 6px; border-radius: 999px; text-align: center; justify-items: center; gap: 0; }
          .modeTitleRow { justify-content: center; }
          .modeCard strong { font-size: 12px; line-height: 1.2; }
          .modeCard .modeBadge,
          .modeCard > span:not(.modeTitleRow),
          .modeCard small { display: none; }
          .stepList { gap: 7px; }
          .stepItem { flex-direction: row; align-items: center; gap: 8px; padding: 8px; border-radius: 12px; }
          .stepMain { gap: 5px; }
          .stepTitleRow { gap: 7px; align-items: center; }
          .stepTitleRow strong { font-size: 14px; line-height: 1.2; }
          .stepTitleRow .muted { display: none; }
          .stepNumber { width: 24px; height: 24px; font-size: 12px; }
          .stepBadges { gap: 4px; }
          .summaryMeta span, .stepBadges span { padding: 4px 6px; font-size: 10px; }
          .recentBadge { display: none; }
          .warnText { padding: 5px 7px; border-radius: 9px; font-size: 11px; line-height: 1.3; }
          .stepBtn, .ghostBtn, .primaryBtn { min-height: 40px; border-radius: 11px; font-size: 13px; padding: 8px 10px; }
          .stepBtn { width: auto; min-width: 76px; white-space: nowrap; }
          .actions, .modalActions { grid-template-columns: 1fr 1fr; gap: 7px; }
          .finishGuide { display: none; }
          .finishCard .warnBox p { display: none; }
          .warnBox, .successBox { padding: 8px 9px; border-radius: 11px; gap: 4px; font-size: 12px; }
          .error { margin-top: 8px; padding: 9px; border-radius: 11px; font-size: 13px; }
          .confirmOverlay { padding: 10px; }
          .confirmCard { border-radius: 16px; padding: 12px; gap: 10px; }
          .countGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
          .countGrid div { padding: 8px 6px; border-radius: 10px; }
          .countGrid span { font-size: 10px; }
          .countGrid strong { font-size: 15px; }
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
