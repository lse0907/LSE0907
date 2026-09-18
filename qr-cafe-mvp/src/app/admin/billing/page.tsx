"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import { BillingSettings, maskToken } from "@/app/lib/billingSettings";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import { CustomerIcon } from "@/app/_components/CustomerIcon";
import previewStyles from "./design-preview/page.module.css";

type SaveMode = "db" | "unsynced";
type SavedPgView = {
  mid: string;
  clientKey: string;
  hasSecret: boolean;
  updatedAt: string | null;
};

type LoadedBillingSettings = BillingSettings & {
  hasPgSecret: boolean;
};

type PrepayFeatureState = {
  enabled: boolean;
  canEnable: boolean;
  baseActive: boolean;
  addonActive: boolean;
  pgReady: boolean;
  blockedReasons: string[];
};

const EMPTY_BILLING: BillingSettings = {
  baseApproved: false,
  addonApproved: false,
  pgMid: "",
  pgClientKey: "",
  pgSecretKey: "",
  updatedAt: null,
};

type PgSetupStage = "disconnected" | "reviewed";

function Direction() { return <span className={previewStyles.direction} aria-hidden="true"><CustomerIcon name="chevronRight" size={16} /></span>; }
function Check() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 3.5 3.5L16 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function Lock() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M7 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>; }

async function loadBillingFromDb(storeId: string): Promise<LoadedBillingSettings | null> {
  try {
    const response = await fetch(`/api/billing/store-pg-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    const result = (await response.json()) as {
      ok?: boolean;
      config?: { mid?: string; clientKey?: string; hasSecret?: boolean; updatedAt?: string | null } | null;
    };
    if (!response.ok || !result.ok || !result.config) return null;

    return {
      baseApproved: false,
      addonApproved: false,
      pgMid: String(result.config.mid || ""),
      pgClientKey: String(result.config.clientKey || ""),
      pgSecretKey: "",
      hasPgSecret: Boolean(result.config.hasSecret),
      updatedAt: Number.isFinite(new Date(String(result.config.updatedAt || "")).getTime())
        ? new Date(String(result.config.updatedAt || "")).getTime()
        : null,
    };
  } catch {
    return null;
  }
}

async function saveBillingToDb(storeId: string, form: BillingSettings): Promise<boolean> {
  try {
    const response = await fetch("/api/billing/store-pg-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        mid: form.pgMid,
        clientKey: form.pgClientKey,
        secretKey: form.pgSecretKey,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function BillingForm({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [form, setForm] = useState<BillingSettings>(EMPTY_BILLING);
  const [savedPg, setSavedPg] = useState<SavedPgView | null>(null);
  const [saveBadge, setSaveBadge] = useState<"idle" | "saved" | "error">("idle");
  const [saveMode, setSaveMode] = useState<SaveMode>("unsynced");
  const [loading, setLoading] = useState(true);
  const [featureState, setFeatureState] = useState<PrepayFeatureState | null>(null);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [featureMessage, setFeatureMessage] = useState("");
  const [costGuideOpen, setCostGuideOpen] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [suspendConfirmOpen, setSuspendConfirmOpen] = useState(false);
  const [estimatedSales, setEstimatedSales] = useState(3000000);
  const [pgSetupStage, setPgSetupStage] = useState<PgSetupStage>("disconnected");

  const loadFeatureState = useCallback(async () => {
    const response = await fetch(`/api/billing/prepay-enabled?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) setFeatureState(result.state as PrepayFeatureState);
  }, [storeId]);

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
          hasSecret: dbData.hasPgSecret,
          updatedAt: dbData.updatedAt ? new Date(dbData.updatedAt).toISOString() : null,
        });
        setSaveMode("db");
      } else {
        setForm(EMPTY_BILLING);
        setSavedPg(null);
        setSaveMode("unsynced");
      }
      setLoading(false);
      await loadFeatureState();
    })();
    return () => {
      mounted = false;
    };
  }, [loadFeatureState, storeId]);

  const activationReady = useMemo(
    () => !!form.pgMid && !!form.pgClientKey && (!!form.pgSecretKey || !!savedPg?.hasSecret),
    [form, savedPg?.hasSecret],
  );
  const pgStage = activationReady ? "connected" : pgSetupStage;
  const setupStep = pgStage === "connected" ? 4 : pgStage === "reviewed" ? 3 : 1;
  const estimatedPgFee = Math.round(estimatedSales * 0.034);

  const onSave = async () => {
    const savedToDb = await saveBillingToDb(storeId, form);
    if (savedToDb) {
      const latest = await loadBillingFromDb(storeId);
      if (latest) {
        setSavedPg({
          mid: latest.pgMid,
          clientKey: latest.pgClientKey,
          hasSecret: latest.hasPgSecret,
          updatedAt: latest.updatedAt ? new Date(latest.updatedAt).toISOString() : null,
        });
      }
      setForm((prev) => ({ ...prev, pgSecretKey: "" }));
      setSaveMode("db");
      setSaveBadge("saved");
      setConnectionModalOpen(false);
      setTimeout(() => setSaveBadge("idle"), 1400);
      await loadFeatureState();
      return;
    }

    setSaveMode("unsynced");
    setSaveBadge("error");
    setTimeout(() => setSaveBadge("idle"), 2000);
  };

  const onToggleFeature = async () => {
    if (!featureState) return;
    const nextEnabled = !featureState.enabled;
    setFeatureSaving(true);
    setFeatureMessage("");
    const response = await fetch("/api/billing/prepay-enabled", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId, enabled: nextEnabled }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) setFeatureMessage(String(result?.message || "기능 상태를 변경하지 못했습니다."));
    else {
      setFeatureState(result.state as PrepayFeatureState);
      setFeatureMessage(nextEnabled ? "고객 온라인 선결제를 켰습니다." : "고객 온라인 선결제를 껐습니다. 구독 기간은 유지됩니다.");
    }
    setFeatureSaving(false);
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
      {!featureState?.enabled ? <section className={`${previewStyles.setupHero} ${pgStage === "connected" ? previewStyles.complete : ""}`}>
        <div><b>{pgStage === "connected" ? "연결 완료" : pgStage === "reviewed" ? "연결 진행 중" : "결제 연결 필요"}</b><h2>{pgStage === "connected" ? "온라인 선결제를 사용할 준비가 되었습니다" : pgStage === "reviewed" ? "결제정보를 연결해 주세요" : "온라인 선결제를 설정하세요"}</h2><p>{pgStage === "connected" ? "구독 페이지에서 선결제 옵션을 선택하면 바로 사용할 수 있습니다." : pgStage === "reviewed" ? "계약정보의 라이브 키를 입력하면 연결 상태를 확인합니다." : "결제 연결을 완료한 뒤 선결제 옵션을 선택할 수 있습니다."}</p></div>
        <aside><span>현재 연결 지원 결제대행사(PG)</span><strong>토스페이먼츠</strong><small>다른 결제대행사(PG) 연결은 운영 상황에 맞춰 검토합니다.</small></aside>
      </section> : null}

      {saveBadge === "error" ? <section className="card warningCard"><p className="warn">연결 정보를 저장하지 못했습니다. 입력 정보와 네트워크 상태를 확인해 주세요.</p></section> : null}

      {featureState?.enabled ? <>
        <section className="activeSummaryCard">
          <div className="activeSummaryHeader"><div><h2>온라인 선결제</h2><p>고객이 온라인으로 결제할 수 있습니다.</p></div><span className="activeStatePill"><i />사용 중</span></div>
          <div className="activeSummaryRows">
            <div><span>결제 연결</span><b>연결됨</b></div>
            <div><span>선결제 옵션</span><b>구독 이용 중</b></div>
            <div className="paymentControl"><span>고객 온라인 결제</span><div><b className="statusGood">사용 중</b><button className="compactToggle" type="button" role="switch" aria-label="고객 온라인 결제 중지" aria-checked="true" disabled={featureSaving} onClick={() => setSuspendConfirmOpen(true)}>{featureSaving ? "변경 중" : "중지"}</button></div></div>
          </div>
          <p className="activeSettlementLine">결제대금은 결제대행사(PG)에서 매장으로 직접 정산되며, <strong>리온오더 추가 수수료는 없습니다.</strong></p>
          <div className="activeTools"><button type="button" onClick={() => router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`)}>구독 결제 <Direction /></button><button type="button" onClick={() => setCostGuideOpen(true)}>비용 안내 <Direction /></button><button type="button" onClick={() => setConnectionModalOpen(true)}>연결 정보 변경 <Direction /></button></div>
        </section>
      </> : <>
      <ol className={previewStyles.progress} aria-label="온라인 선결제 설정 순서">{[[1,"비용 확인"],[2,"가입·심사"],[3,"결제정보 연결"],[4,"준비 완료"]].map(([number,label]) => <li key={number} className={`${Number(number) < setupStep ? previewStyles.pDone : ""} ${Number(number) === setupStep ? previewStyles.pCurrent : ""}`}><span>{Number(number) < setupStep ? <Check /> : number}</span><strong>{label}</strong></li>)}</ol>

      <section className={previewStyles.setupGrid}>
        <article className={previewStyles.action}>
          {pgStage === "connected" ? <><span className={previewStyles.eyebrow}>READY</span><h2>선결제 기능을 구독할 수 있습니다</h2><p>연결된 결제정보는 주문 결제 승인과 취소에 안전하게 사용됩니다.</p><div className={previewStyles.connected}><span>결제대행사(PG)<strong>토스페이먼츠</strong></span><span>MID<strong>{savedPg?.mid ? maskToken(savedPg.mid) : "-"}</strong></span><span>연결 확인<strong>정상</strong></span></div><div className={previewStyles.actions}><button className={previewStyles.primary} type="button" onClick={() => router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`)}>선결제 옵션 구독하기 <Direction /></button><button className={previewStyles.secondary} type="button" onClick={() => setConnectionModalOpen(true)}>연결정보 관리</button></div></> : pgStage === "reviewed" ? <><span className={previewStyles.eyebrow}>STEP 03</span><h2>결제대행사(PG) 계약정보를 연결하세요</h2><p>계약 완료 후 결제대행사(PG) 개발자센터에서 라이브 MID와 API 키를 확인할 수 있습니다.</p><div className={previewStyles.keyGuide}><span><i>1</i>라이브 MID</span><span><i>2</i>Client Key</span><span><i>3</i>Secret Key</span></div><div className={previewStyles.actions}><button className={previewStyles.primary} type="button" onClick={() => setConnectionModalOpen(true)}>결제정보 연결하기 <Direction /></button><a className={previewStyles.secondary} href="https://docs.tosspayments.com/reference/using-api/api-keys" target="_blank" rel="noreferrer">키 확인 방법</a></div></> : <><span className={previewStyles.eyebrow}>STEP 01</span><h2>결제대행사(PG) 가입과 연결을 준비하세요</h2><p>현재 리온오더에서 지원하는 결제대행사(PG)는 토스페이먼츠입니다. 가맹점 계약이 완료되면 결제정보를 연결할 수 있습니다.</p><div className={previewStyles.actions}><a className={previewStyles.primary} href="https://www.tosspayments.com/" target="_blank" rel="noreferrer" onClick={() => setPgSetupStage("reviewed")}>결제대행사(PG) 가입 안내 <Direction /></a><button className={previewStyles.secondary} type="button" onClick={() => setCostGuideOpen(true)}>결제대행사(PG) 비용 안내</button></div><small>다른 결제대행사(PG) 연결은 서비스 운영 상황과 점주 요구를 바탕으로 추가 여부를 검토합니다.</small></>}
        </article>
        <aside className={previewStyles.cost}><div className={previewStyles.costTitle}><div><span className={previewStyles.eyebrow}>PG COST</span><h2>결제대행사(PG) 비용 안내</h2></div></div><p>결제대행사(PG) 가입비·연 관리비·결제 수수료는 결제 수단과 계약 조건에 따라 달라집니다. 리온오더 구독료와는 별도입니다.</p><button className={previewStyles.secondary} type="button" onClick={() => setCostGuideOpen(true)}>결제대행사(PG) 비용 안내 <Direction /></button></aside>
      </section>
      <section className={previewStyles.notice}><Lock /><div><strong>결제대금은 결제대행사(PG)에서 매장으로 직접 정산합니다.</strong><span>리온오더는 구독료 외 결제 금액에 대한 <em>추가 수수료를 부과하지 않습니다.</em></span></div></section>

      {activationReady ? <>
      <section className="card featureCard">
        <div className="featureHeader"><div><div className="featureTitleRow"><h2 className="h2">고객 온라인 선결제</h2><span className={featureState?.enabled ? "stateBadge on" : "stateBadge"}>{featureState?.enabled ? "사용 중" : "사용 안 함"}</span></div><p className="muted">기능을 꺼도 이미 결제한 선결제 옵션의 구독 기간은 유지됩니다.</p></div><button className={featureState?.enabled ? "switchButton on" : "switchButton"} type="button" role="switch" aria-checked={featureState?.enabled === true} disabled={featureSaving || (!featureState?.enabled && !featureState?.canEnable)} onClick={() => void onToggleFeature()}><span />{featureSaving ? "저장 중" : featureState?.enabled ? "ON" : "OFF"}</button></div>
        {!featureState?.addonActive && activationReady ? <div className="subscriptionPrompt"><div><strong>연결 설정을 완료했습니다</strong><span>선결제 옵션을 구독하면 고객 온라인 결제를 사용할 수 있습니다.</span></div><button className="btn primary" type="button" onClick={() => router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`)}>선결제 옵션 구독하기</button></div> : null}
        {!featureState?.canEnable && !featureState?.enabled && featureState?.addonActive ? <div className="requirementBox"><strong>선결제를 켜기 전 확인할 사항</strong>{featureState?.blockedReasons.map((reason) => <span key={reason}>• {reason}</span>)}</div> : null}{featureMessage ? <p className={featureState?.enabled ? "ok" : "warn"} role="status">{featureMessage}</p> : null}
      </section>

      <section className="card savedConnection"><h2 className="h2">현재 연결 정보</h2><div><span>PG사</span><strong>토스페이먼츠</strong></div><div><span>MID</span><strong>{savedPg?.mid || "연결 전"}</strong></div><div><span>Client Key</span><strong>{savedPg?.clientKey ? maskToken(savedPg.clientKey) : "연결 전"}</strong></div><div><span>Secret Key</span><strong>{savedPg?.hasSecret ? "등록됨" : "연결 전"}</strong></div><p className={activationReady ? "ok" : "warn"}>{activationReady ? "연결 정보를 확인했습니다." : "MID·Client Key·Secret Key를 모두 입력해 저장하면 연결 상태를 확인합니다."}</p></section>
      </> : null}
      </>}

      {suspendConfirmOpen ? <div className={previewStyles.backdrop} role="presentation" onMouseDown={() => setSuspendConfirmOpen(false)}><section className={previewStyles.modal} role="dialog" aria-modal="true" aria-labelledby="suspend-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className={previewStyles.eyebrow}>ONLINE PAYMENT</span><h2 id="suspend-title">고객 온라인 결제를 중지할까요?</h2></div><button type="button" aria-label="닫기" onClick={() => setSuspendConfirmOpen(false)}>×</button></header><p>중지 후에는 고객이 새 주문을 온라인으로 결제할 수 없습니다.</p><div className={previewStyles.reminder}><strong>그대로 유지되는 항목</strong><span>이미 승인된 주문 · 결제대행사(PG) 연결 정보 · 선결제 옵션 구독</span></div><div className={previewStyles.reminder}><strong>구독 기간은 계속 경과합니다</strong><span>이 기능을 중지해도 선결제 옵션의 남은 이용 기간은 멈추거나 연장되지 않습니다.</span></div><p>이 작업은 선결제 옵션 구독을 해지하거나 결제·환불을 처리하지 않습니다. 다시 사용하려면 이 페이지에서 온라인 결제를 켜면 됩니다.</p><footer><button className={previewStyles.secondary} type="button" onClick={() => setSuspendConfirmOpen(false)}>유지하기</button><button className={previewStyles.primary} type="button" disabled={featureSaving} onClick={() => { setSuspendConfirmOpen(false); void onToggleFeature(); }}>{featureSaving ? "변경 중" : "결제 중지"}</button></footer></section></div> : null}
      {costGuideOpen ? <div className={previewStyles.backdrop} role="presentation" onMouseDown={() => setCostGuideOpen(false)}><section className={previewStyles.modal} role="dialog" aria-modal="true" aria-labelledby="pg-cost-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className={previewStyles.eyebrow}>PG COST GUIDE</span><h2 id="pg-cost-title">결제대행사(PG사) 예상 비용</h2></div><button type="button" aria-label="닫기" onClick={() => setCostGuideOpen(false)}>×</button></header><label className={previewStyles.calc}><span>월 선결제 예상 매출</span><input type="number" min="0" step="100000" value={estimatedSales} onChange={(event) => setEstimatedSales(Math.max(0, Number(event.target.value || 0)))} /></label><div className={previewStyles.salesPresets}>{[1000000, 3000000, 5000000].map((value) => <button key={value} type="button" className={estimatedSales === value ? previewStyles.presetSelected : ""} aria-pressed={estimatedSales === value} onClick={() => setEstimatedSales(value)}>{value / 10000}만 원</button>)}</div><section className={previewStyles.costBreakdown}><article className={previewStyles.variableCost}><span>결제할 때마다</span><strong>월 {estimatedPgFee.toLocaleString("ko-KR")}원</strong><small>예상 PG사 결제 수수료 · 일반 카드 3.4% 단순 계산</small></article><article><span>가입할 때만 · 최초 1회</span><strong>가입비 220,000원</strong><small>PG사 가맹점 계약을 시작할 때 한 번만 발생합니다. 매월 반복되지 않습니다.</small></article><article><span>12개월마다 · 연 1회</span><strong>연 관리비 110,000원</strong><small>PG사 서비스를 유지하는 동안 1년에 한 번 발생합니다. 매월 청구되지 않습니다.</small></article></section><section className={previewStyles.costTiming}><div><strong>1년 차(첫해)</strong><span>가입비 1회 + 연 관리비 1회</span></div><div><strong>2년 차부터</strong><span>연 관리비 1회</span></div><p>12개월 기준 비교용 월 환산: 첫해 약 27,500원 · 2년 차부터 약 9,200원<br/><b>실제 월 청구가 아닌 비교용 계산입니다.</b></p></section><div className={`${previewStyles.reminder} ${previewStyles.feePromise}`}><strong>리온오더 추가 수수료 없음</strong><span>위 비용은 PG사 계약 비용이며, 실제 수수료는 계약 조건과 결제 수단에 따라 달라질 수 있습니다.</span></div><footer><button className={previewStyles.secondary} type="button" onClick={() => setCostGuideOpen(false)}>닫기</button><a className={previewStyles.primary} href="https://www.tosspayments.com/about/fee" target="_blank" rel="noreferrer">PG사 공식 요금 확인</a></footer></section></div> : null}
      {connectionModalOpen ? <div className={previewStyles.backdrop} role="presentation" onMouseDown={() => setConnectionModalOpen(false)}><section className={previewStyles.modal} role="dialog" aria-modal="true" aria-labelledby="connection-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className={previewStyles.eyebrow}>PAYMENT CONNECTION</span><h2 id="connection-title">토스 결제정보 연결</h2></div><button type="button" aria-label="닫기" onClick={() => setConnectionModalOpen(false)}>×</button></header><div className={previewStyles.form}><label><span>라이브 MID</span><input value={form.pgMid} onChange={(event) => setForm((previous) => ({ ...previous, pgMid: event.target.value }))} placeholder="토스페이먼츠 계약 MID" /></label><label><span>라이브 Client Key</span><input value={form.pgClientKey} onChange={(event) => setForm((previous) => ({ ...previous, pgClientKey: event.target.value }))} placeholder="live_gck_ 또는 live_ck_" /><small>Client Key와 Secret Key는 같은 계약의 한 쌍이어야 합니다.</small></label><label><span>라이브 Secret Key</span><input type="password" value={form.pgSecretKey} onChange={(event) => setForm((previous) => ({ ...previous, pgSecretKey: event.target.value }))} placeholder="live_gsk_ 또는 live_sk_" /><small>브라우저에 다시 표시하지 않고 서버에서 안전하게 확인합니다.</small></label></div><div className={previewStyles.valid}><span><Check />테스트/라이브 구분</span><span><Check />키 위치 확인</span><span><Check />동일 계약 조합</span></div><footer><button className={previewStyles.secondary} type="button" onClick={() => setConnectionModalOpen(false)}>다음에 하기</button><button className={previewStyles.primary} type="button" onClick={() => void onSave()}>연결 확인</button></footer></section></div> : null}

    </>
  );
}

function AdminBillingPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeName, setStoreName] = useState("");

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

  useEffect(() => {
    let mounted = true;
    if (!storeId) return;
    void supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle().then(({ data }) => {
      if (mounted) setStoreName(String(data?.store_name || "").trim());
    });
    return () => { mounted = false; };
  }, [storeId]);

  return (
    <main className="wrap">
      <style jsx global>{css}</style>

      <AdminPageHeader title="온라인 결제 설정" description="고객 선결제를 위한 결제 연결과 사용 상태를 관리합니다." storeId={storeId} storeName={storeName} eyebrow="ONLINE PAYMENT" />

      {storeId ? <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}><BillingForm key={storeId} storeId={storeId} /></Suspense> : null}
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
    /* The approved billing preview uses these tokens for its action controls. */
    --ink: #172033;
    --brand: #2457d6;
    --dark: #173f9f;
    --navy: #182238;
    --soft: #f4f7ff;
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
  .featureCard { border-color:#c7d7fe; background:linear-gradient(135deg,#fff,#f5f8ff); }
  .featureHeader { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .featureTitleRow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .featureTitleRow .h2 { margin:0; }
  .stateBadge { border-radius:999px; padding:4px 8px; background:#f2f4f7; color:#667085; font-size:11px; font-weight:900; }
  .stateBadge.on { background:#ecfdf3; color:#047857; }
  .switchButton { width:82px; min-height:42px; border:0; border-radius:999px; background:#98a2b3; color:#fff; display:flex; align-items:center; gap:7px; padding:5px 10px 5px 5px; font-weight:900; cursor:pointer; flex:none; }
  .switchButton span { width:32px; height:32px; border-radius:50%; background:#fff; box-shadow:0 2px 5px rgba(0,0,0,.18); }
  .switchButton.on { background:#2563eb; flex-direction:row-reverse; padding:5px 5px 5px 10px; }
  .switchButton:disabled { opacity:.5; cursor:not-allowed; }
  .requirementBox { display:grid; gap:5px; border-radius:12px; background:#fff7ed; color:#9a3412; padding:12px; font-size:12px; }
  .paymentHero { display:grid; grid-template-columns:minmax(0,1fr) 290px; gap:22px; align-items:center; padding:25px; border:1px solid #cbdcf5; border-radius:18px; background:linear-gradient(120deg,#f8fbff,#edf5ff); }.paymentHero > div { display:grid; gap:6px; }.paymentHero h2 { margin:0; color:#152f5c; font-size:24px; letter-spacing:-.045em; }.paymentHero p { margin:0; color:#60708a; font-size:13px; line-height:1.6; }.heroStatus { width:fit-content; border-radius:999px; padding:5px 9px; background:#e7f0ff; color:#1c5a9e; font-size:11px; font-weight:900; }.paymentHero aside { display:grid; gap:5px; padding:15px 16px; border:1px solid #d3e0f2; border-radius:13px; background:rgba(255,255,255,.76); }.paymentHero aside span,.paymentHero aside small { color:#667085; font-size:11px; line-height:1.5; }.paymentHero aside strong { color:#173f7b; font-size:16px; }
  .connectionSteps { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; padding:8px; border:1px solid #e2e9f3; border-radius:14px; background:#fff; }.connectionSteps span { display:flex; align-items:center; gap:7px; min-height:39px; padding:7px 9px; border-radius:9px; color:#667085; font-size:12px; font-weight:800; }.connectionSteps span.current { background:#f4f8ff; color:#245b9f; }.connectionSteps span.done { color:#17633b; }.connectionSteps b { display:grid; place-items:center; width:21px; height:21px; border-radius:50%; background:#e9eff7; color:#61708a; font-size:11px; }.connectionSteps .current b { background:#245b9f; color:#fff; }.connectionSteps .done b { background:#dff5e7; color:#17633b; }
  .paymentGrid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(270px,.65fr); gap:12px; align-items:start; }.connectionCard,.pgCost { padding:20px; }.connectionCard .eyebrow,.pgCost .eyebrow { color:#2c63a4; font-size:10px; font-weight:900; letter-spacing:.1em; }.connectionCard .h2,.pgCost .h2 { margin:0; color:#172f58; font-size:19px; }.connectionCard .links { margin-top:2px; }.connectionCard .field { margin-top:2px; }.keyGrid { display:grid; gap:11px; }.input { min-height:46px; border-color:#d7e0ec; }.pgCost { gap:14px; border-color:#d5e2f2; background:linear-gradient(160deg,#fff,#f8fbff); }.pgCost .btn { min-height:44px; color:#174d8d; border-color:#b5cbe7; background:#fff; }.savedConnection { grid-template-columns:repeat(4,1fr); align-items:center; }.savedConnection .h2,.savedConnection p { grid-column:1/-1; }.savedConnection > div { display:grid; gap:4px; padding:10px; border-radius:10px; background:#f8fafc; color:#697586; font-size:11px; }.savedConnection > div strong { color:#2b3f5b; font-size:13px; overflow:hidden; text-overflow:ellipsis; }
  .activeOverview { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:20px 24px; border:1px solid #b9e3ca; border-radius:18px; background:linear-gradient(120deg,#f5fdf8,#eef9f2); }
  .activeOverview h2 { margin:0; color:#123b2b; font-size:22px; letter-spacing:-.04em; }.activeOverview p { margin:7px 0 0; color:#4b6357; font-size:13px; }.activeStatePill{display:inline-flex;align-items:center;gap:7px;min-height:34px;border-radius:999px;padding:0 12px;background:#e1f5e8;color:#087443;font-size:12px;font-weight:900;white-space:nowrap}.activeStatePill i{width:7px;height:7px;border-radius:50%;background:currentColor}
  .activeGrid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; align-items:stretch; }.activeStatus,.activeActions,.activeSettlement { padding:18px; gap:11px; }.activeStatus .h2,.activeActions .h2,.activeSettlement .h2 { margin:0; font-size:17px; }.activeStatus small{color:#697586;font-size:11px;line-height:1.5}.compactState{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;border-top:1px solid #edf0f5;border-bottom:1px solid #edf0f5;color:#667085;font-size:12px}.compactState b{color:#263d5c}.compactState .statusGood{color:#087443}.compactToggle{min-height:28px;border:0;border-radius:999px;padding:0 9px;background:#137143;color:#fff;font:inherit;font-size:11px;font-weight:900;cursor:pointer}.compactToggle:disabled{opacity:.65;cursor:not-allowed}.activeSettlement{background:linear-gradient(145deg,#fafcff,#f3f7ff)}.activeSettlement p{margin:0;color:#52647e;font-size:12px;line-height:1.55}.activeSettlement strong{color:#174d8d;font-size:13px}.activeActions{grid-column:1/-1;grid-template-columns:auto minmax(0,1fr) auto;align-items:center}.activeActions .btn { width:fit-content; min-height:38px; color:#174d8d; border-color:#b7cce7; background:#f7fbff; }.connectionDetails { border-top:1px solid #e5e9ef; padding-top:14px; }.connectionDetails summary { color:#344054; font-size:13px; font-weight:900; cursor:pointer; list-style:none; }.connectionDetails summary::after { content:"⌄"; margin-left:8px; color:#667085; }.connectionDetails[open] summary { margin-bottom:14px; }.connectionDetails[open] summary::after { content:"⌃"; }.connectionDetails .keyGrid { display:grid; gap:11px; }.connectionDetails .row { margin-top:13px; flex-wrap:wrap; }
  .activeSummaryCard{display:grid;gap:0;border:1px solid #d8e4f2;border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(16,24,40,.04);overflow:hidden}.activeSummaryHeader{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;background:linear-gradient(135deg,#f7faff,#fff)}.activeSummaryHeader h2{margin:4px 0 2px;color:#172f58;font-size:20px;letter-spacing:-.04em}.activeSummaryHeader p{margin:0;color:#667085;font-size:12px}.activeSummaryRows{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #e9eef5}.activeSummaryRows>div{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:58px;padding:0 18px;border-right:1px solid #e9eef5;color:#667085;font-size:12px}.activeSummaryRows>div:last-child{border-right:0}.activeSummaryRows b{color:#174d8d;font-size:12px}.activeSummaryRows .statusGood{color:#087443}.paymentControl>div{display:flex;align-items:center;gap:7px}.compactToggle{min-height:29px;border:1px solid #f0b9b9;border-radius:9px;padding:0 9px;background:#fff;color:#b42318;font:inherit;font-size:11px;font-weight:900;cursor:pointer}.compactToggle:disabled{opacity:.65;cursor:not-allowed}.activeSettlementLine{margin:0;padding:12px 18px;border-top:1px solid #e9eef5;background:#f8faff;color:#52647e;font-size:12px;line-height:1.5}.activeSettlementLine strong{color:#174d8d}.activeTools{display:flex;align-items:center;gap:16px;padding:11px 18px;border-top:1px solid #e9eef5}.activeTools button{display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0;border:0;background:transparent;color:#174d8d;font:inherit;font-size:12px;font-weight:900;cursor:pointer}.activeTools .direction{display:grid;place-items:center}.activeTools .direction svg{width:14px}
  .subscriptionPrompt { display:flex; align-items:center; justify-content:space-between; gap:14px; border:1px solid #c7d7fe; border-radius:12px; background:#f4f7ff; padding:13px; }.subscriptionPrompt div { display:grid; gap:4px; }.subscriptionPrompt strong { color:#173f9f; font-size:13px; }.subscriptionPrompt span { color:#50627d; font-size:12px; }.subscriptionPrompt .btn { flex:none; min-height:42px; }
  @media (max-width: 700px) {
    .wrap { padding:12px; gap:10px; }
    .card { padding:14px; border-radius:15px; }
    .grid2 {
      grid-template-columns: 1fr;
    }
    .featureHeader { align-items:flex-start; }
    .paymentHero { grid-template-columns:1fr; padding:19px; gap:15px; }.paymentHero h2 { font-size:20px; }.connectionSteps { grid-template-columns:1fr 1fr; }.connectionSteps span { min-height:36px; }.paymentGrid { grid-template-columns:1fr; }.connectionCard,.pgCost { padding:16px; }.savedConnection { grid-template-columns:1fr 1fr; }.activeOverview { display:grid; padding:18px; gap:14px; }.activeOverview h2 { font-size:19px; }.activeStatePill{justify-self:start}.activeGrid { grid-template-columns:1fr; }.activeStatus,.activeActions,.activeSettlement { padding:17px; }.activeActions{grid-template-columns:1fr}.activeActions .actionButtons{display:flex;flex-wrap:wrap}.activeSummaryHeader{align-items:flex-start;padding:16px}.activeSummaryHeader h2{font-size:18px}.activeSummaryRows{grid-template-columns:1fr}.activeSummaryRows>div{min-height:52px;padding:0 16px;border-right:0;border-bottom:1px solid #e9eef5}.activeSummaryRows>div:last-child{border-bottom:0}.activeSettlementLine{padding:11px 16px}.activeTools{gap:14px;flex-wrap:wrap;padding:10px 16px}.activeTools button{min-height:30px}.subscriptionPrompt { display:grid; }.subscriptionPrompt .btn { width:100%; }
  }
`;
export default function AdminBillingPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminBillingPageInner />
    </Suspense>
  );
}
