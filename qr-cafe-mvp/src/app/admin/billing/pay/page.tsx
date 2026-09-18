"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import { CustomerIcon } from "@/app/_components/CustomerIcon";

type PlanMonths = 1 | 3 | 6 | 12;
type Quote = {
  planMonths: PlanMonths; payBase: boolean; payAddon: boolean;
  baseMonthlyKrw: number; addonMonthlyKrw: number;
  baseDiscountBps: number; addonDiscountBps: number; termDiscountBps: number;
  listAmountKrw: number; finalAmountKrw: number; discountAmountKrw: number;
  referralDiscountKrw: number; creditAvailableKrw: number; creditRequestedKrw: number; creditAppliedKrw: number;
  externalAmountKrw: number; baseFinalBeforeCreditKrw: number; baseExternalAmountKrw: number; addonExternalAmountKrw: number;
  baseFinalAmountKrw: number; addonFinalAmountKrw: number;
  founderBase: boolean; founderAddon: boolean; multiStore: boolean; storeSequence: number;
  vatIncluded: boolean; discountLabels: string[];
  expectedBaseStartAt: string | null; expectedBaseEndAt: string | null;
  expectedAddonStartAt: string | null; expectedAddonEndAt: string | null;
};
type Runtime = { baseStatus: string; addonStatus: string; addonEnabled: boolean; basePaidUntil: string | null; addonPaidUntil: string | null; lastPaidAt: string | null };
type CreditEntry = { id: number; entryType: string; amountKrw: number; reason: string; createdAt: string };
type CreditHistory = { availableKrw: number; entries: CreditEntry[]; pendingRewards: Array<{ id: number; holdUntil: string | null }> };
type TossFactory = (key: string) => { requestPayment: (method: "카드", params: Record<string, unknown>) => Promise<void> };

const PERIODS: Array<{ months: PlanMonths; label: string; discount: string }> = [
  { months: 1, label: "1개월", discount: "할인 없음" },
  { months: 3, label: "3개월", discount: "5% 할인" },
  { months: 6, label: "6개월", discount: "10% 할인" },
  { months: 12, label: "12개월", discount: "15% 할인" },
];
const money = (value: number) => `${Math.round(value || 0).toLocaleString()}원`;
const dateText = (iso: string | null) => {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("ko-KR") : "-";
};

function Direction() {
  return <span className="direction" aria-hidden="true"><CustomerIcon name="chevronRight" size={16} /></span>;
}

function Check() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 3.5 3.5L16 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Lock() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M7 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

function BillingPayContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(() => String(sp.get("store") || getCurrentStoreId() || "").trim(), [sp]);
  const paymentKey = String(sp.get("paymentKey") || "").trim();
  const returnedOrderId = String(sp.get("orderId") || "").trim();
  const returnedAmount = Number(sp.get("amount") || 0);
  const failCode = String(sp.get("code") || "").trim();
  const failMessage = String(sp.get("message") || "").trim();
  const [storeName, setStoreName] = useState("매장");
  const [runtime, setRuntime] = useState<Runtime>({ baseStatus: "inactive", addonStatus: "inactive", addonEnabled: false, basePaidUntil: null, addonPaidUntil: null, lastPaidAt: null });
  const [planMonths, setPlanMonths] = useState<PlanMonths>(1);
  const [payBase, setPayBase] = useState(true);
  const [payAddon, setPayAddon] = useState(false);
  const [creditToUse, setCreditToUse] = useState(0);
  const [referralCode, setReferralCode] = useState("");
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralInfoOpen, setReferralInfoOpen] = useState(false);
  const [creditHistoryOpen, setCreditHistoryOpen] = useState(false);
  const [creditHistoryLoading, setCreditHistoryLoading] = useState(true);
  const [creditHistory, setCreditHistory] = useState<CreditHistory>({ availableKrw: 0, entries: [], pendingRewards: [] });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [clientKey, setClientKey] = useState("");
  const [pgConnectionChecked, setPgConnectionChecked] = useState(false);
  const [pgReady, setPgReady] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "warning" | "error">("info");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const handledReturn = useRef("");
  const creditInitialized = useRef(false);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const refreshRuntime = useCallback(async () => {
    if (!storeId) return;
    const [storeRes, baseRes, addonRes, paymentRes, keyRes, pgRes] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle(),
      supabase.from("store_billing").select("base_plan_status,paid_until").eq("store_id", storeId).maybeSingle(),
      supabase.from("store_addons").select("prepay_addon_status,addon_paid_until,prepay_enabled").eq("store_id", storeId).maybeSingle(),
      supabase.from("billing_payments").select("paid_at").eq("store_id", storeId).eq("status", "paid").order("paid_at", { ascending: false }).limit(1).maybeSingle(),
      fetch(`/api/billing/platform-client-key?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" }),
      fetch(`/api/billing/store-pg-config?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" }),
    ]);
    setStoreName(String(storeRes.data?.store_name || storeId));
    setRuntime({
      baseStatus: String(baseRes.data?.base_plan_status || "inactive"),
      addonStatus: String(addonRes.data?.prepay_addon_status || "inactive"),
      addonEnabled: addonRes.data?.prepay_enabled === true,
      basePaidUntil: String(baseRes.data?.paid_until || "").trim() || null,
      addonPaidUntil: String(addonRes.data?.addon_paid_until || "").trim() || null,
      lastPaidAt: String(paymentRes.data?.paid_at || "").trim() || null,
    });
    const keyJson = await keyRes.json().catch(() => ({}));
    setClientKey(keyRes.ok ? String(keyJson.clientKey || "") : "");
    const pgJson = await pgRes.json().catch(() => ({}));
    const pgConfig = pgRes.ok && pgJson?.ok ? pgJson.config : null;
    setPgReady(Boolean(pgConfig?.mid && pgConfig?.clientKey && pgConfig?.hasSecret));
    setPgConnectionChecked(true);
  }, [storeId]);

  const loadCreditHistory = useCallback(async () => {
    if (!storeId) return;
    setCreditHistoryLoading(true);
    const response = await fetch(`/api/billing/credit-history?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) {
      setCreditHistory({
        availableKrw: Math.max(0, Number(result.availableKrw || 0)),
        entries: Array.isArray(result.entries) ? result.entries : [],
        pendingRewards: Array.isArray(result.pendingRewards) ? result.pendingRewards : [],
      });
    }
    setCreditHistoryLoading(false);
  }, [storeId]);

  useEffect(() => {
    if (pgConnectionChecked && !pgReady && payAddon) setPayAddon(false);
  }, [payAddon, pgConnectionChecked, pgReady]);

  const loadQuote = useCallback(async (prepare = false) => {
    if (!storeId || (!payBase && !payAddon)) { setQuote(null); return null; }
    if (!prepare) setQuoteLoading(true);
    const response = await fetch("/api/billing/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, planMonths, payBase, payAddon, creditToUse, prepare }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (!prepare) { setMessage(String(result.message || "결제 금액을 계산하지 못했습니다.")); setMessageKind("error"); }
      setQuoteLoading(false);
      return null;
    }
    const nextQuote = result.quote as Quote;
    setQuote(nextQuote);
    if (!prepare && !creditInitialized.current) {
      creditInitialized.current = true;
      const maximum = Math.min(nextQuote.creditAvailableKrw || 0, nextQuote.baseFinalBeforeCreditKrw || 0);
      if (maximum > 0) setCreditToUse(maximum);
    } else if (!prepare && creditToUse !== nextQuote.creditAppliedKrw) {
      setCreditToUse(nextQuote.creditAppliedKrw);
    }
    setQuoteLoading(false);
    return result as { quote: Quote; orderId?: string };
  }, [creditToUse, payAddon, payBase, planMonths, storeId]);

  useEffect(() => {
    if (!storeId) { router.replace("/admin"); return; }
    setCurrentStoreId(storeId);
    creditInitialized.current = false;
    const timer = window.setTimeout(() => {
      void refreshRuntime();
      void loadCreditHistory();
      void (async () => {
        const response = await fetch(`/api/billing/referral-code?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.ok) setReferralCode(String(result.referralCode || ""));
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCreditHistory, refreshRuntime, router, storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadQuote(false), 150);
    return () => window.clearTimeout(timer);
  }, [loadQuote]);

  useEffect(() => {
    if (!confirmOpen) return;
    confirmButton.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !paying) setConfirmOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirmOpen, paying]);

  useEffect(() => {
    if (!paymentKey || !returnedOrderId || returnedAmount <= 0 || handledReturn.current === returnedOrderId) return;
    handledReturn.current = returnedOrderId;
    setMessage("결제 승인과 구독 반영을 확인하고 있습니다. 완료될 때까지 다시 결제하지 마세요.");
    setMessageKind("warning");
    void (async () => {
      const response = await fetch("/api/billing/confirm-subscription-payment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId: returnedOrderId, amount: returnedAmount, storeId }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        setMessage(`결제가 완료되었습니다. ${money(returnedAmount)}이 구독에 반영되었습니다.`);
        setMessageKind("success");
        await refreshRuntime();
      } else if (response.status === 202 || String(result.code || "").includes("APPROVED")) {
        setMessage(String(result.message || "결제는 승인되었습니다. 구독 반영을 확인 중이니 다시 결제하지 마세요."));
        setMessageKind("warning");
      } else {
        setMessage(`${String(result.message || "결제 결과를 확인하지 못했습니다.")} 카드 승인 문자를 받았다면 다시 결제하지 마세요.`);
        setMessageKind("error");
      }
      router.replace(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`);
    })();
  }, [paymentKey, refreshRuntime, returnedAmount, returnedOrderId, router, storeId]);

  useEffect(() => {
    if (!failCode && !failMessage) return;
    const cancelled = /CANCEL/i.test(failCode);
    const timer = window.setTimeout(() => {
      setMessage(cancelled ? "결제가 취소되었습니다. 카드가 승인되지 않았다면 다시 시도할 수 있습니다." : `${failMessage || "결제가 완료되지 않았습니다."} 카드 승인 여부를 먼저 확인해 주세요.`);
      setMessageKind(cancelled ? "info" : "error");
      if (returnedOrderId) void fetch("/api/billing/release-payment-attempt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, orderId: returnedOrderId, reason: cancelled ? "점주 결제창 취소" : "PG 결제 실패" }),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [failCode, failMessage, returnedOrderId, storeId]);

  const loadToss = async () => {
    if ((window as unknown as { TossPayments?: TossFactory }).TossPayments) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-toss="billing"]');
      if (existing) { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", reject, { once: true }); return; }
      const script = document.createElement("script");
      script.src = "https://js.tosspayments.com/v1/payment"; script.async = true; script.dataset.toss = "billing";
      script.onload = () => resolve(); script.onerror = () => reject(new Error("토스 결제창을 불러오지 못했습니다.")); document.head.appendChild(script);
    });
  };

  const startPayment = async () => {
    setPaying(true); setConfirmOpen(false); setMessage("결제창을 준비하고 있습니다."); setMessageKind("info");
    try {
      const prepared = await loadQuote(true);
      if (!prepared?.orderId || !prepared.quote) throw new Error("서버 결제 견적을 준비하지 못했습니다.");
      if (prepared.quote.externalAmountKrw === 0) {
        const response = await fetch("/api/billing/apply-zero-payment", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeId, orderId: prepared.orderId }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(String(result.message || "크레딧 결제를 반영하지 못했습니다."));
        setMessage("크레딧 결제가 완료되어 구독 기간에 반영됐습니다.");
        setMessageKind("success");
        setPaying(false);
        await refreshRuntime();
        await loadQuote(false);
        return;
      }
      if (!clientKey) throw new Error("구독 결제 설정이 완료되지 않았습니다. 고객센터에 문의해 주세요.");
      await loadToss();
      const factory = (window as unknown as { TossPayments?: TossFactory }).TossPayments;
      if (!factory) throw new Error("토스 결제 모듈을 찾지 못했습니다.");
      const origin = window.location.origin;
      await factory(clientKey).requestPayment("카드", {
        amount: prepared.quote.finalAmountKrw, orderId: prepared.orderId,
        orderName: `${storeName} 리온오더 구독 ${planMonths}개월`, customerName: `${storeName.slice(0, 24)} 점주`,
        successUrl: `${origin}/admin/billing/pay?store=${encodeURIComponent(storeId)}`,
        failUrl: `${origin}/admin/billing/pay?store=${encodeURIComponent(storeId)}`,
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "결제 요청 중 오류가 발생했습니다."); setMessageKind("error"); setPaying(false);
    }
  };

  const issueReferralCode = async () => {
    setReferralLoading(true);
    const response = await fetch("/api/billing/referral-code", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) setReferralCode(String(result.referralCode || ""));
    else { setMessage(String(result.message || "추천코드를 발급하지 못했습니다.")); setMessageKind("error"); }
    setReferralLoading(false);
  };

  const copyReferralCode = async () => {
    if (!referralCode) return;
    await navigator.clipboard.writeText(referralCode);
    setMessage("추천코드를 복사했습니다.");
    setMessageKind("success");
  };

  const statusLabel = (status: string) => status === "active" ? "이용 중" : status === "trialing" ? "무료 체험" : status === "past_due" ? "결제 필요" : "미이용";
  const creditEntryLabel = (entryType: string) => ({
    earn: "추천 보상 적립", use: "기본 구독 결제 사용", restore: "결제 취소로 복원", release: "결제 예약 해제", revoke: "크레딧 회수", expire: "크레딧 만료", admin_adjust: "크레딧 조정",
  }[entryType] || "크레딧 변동");
  const signedCredit = (amount: number) => `${amount > 0 ? "+" : "-"}${money(Math.abs(amount))}`;

  return (
    <main className="billingWrap">
      <AdminPageHeader title="구독 결제" description="이용할 기능과 기간을 선택하고 최종 결제 금액을 확인하세요." storeId={storeId} storeName={storeName} eyebrow="RION ORDER · BILLING" actions={<button className="secondaryButton settingsLink" onClick={() => router.push(`/admin/billing?store=${encodeURIComponent(storeId)}`)}><CustomerIcon name="platform" size={16} />결제 설정</button>} />

      {message ? <section className={`resultBanner ${messageKind}`} role="status"><strong>{messageKind === "success" ? "결제 완료" : messageKind === "warning" ? "처리 상태 확인 중" : messageKind === "error" ? "확인이 필요합니다" : "안내"}</strong><span>{message}</span></section> : null}

      <section className="statusPanel">
        <div><span>기본 구독</span><strong>{statusLabel(runtime.baseStatus)}</strong><small>만료 {dateText(runtime.basePaidUntil)}</small></div>
        <div><span>선결제 옵션</span><strong>{statusLabel(runtime.addonStatus)} · {runtime.addonEnabled ? "기능 켜짐" : "기능 꺼짐"}</strong><small>만료 {dateText(runtime.addonPaidUntil)}</small></div>
        <div><span>최근 결제</span><strong>{dateText(runtime.lastPaidAt)}</strong><small>모든 가격은 부가세 포함입니다.</small></div>
      </section>

      <section className="accountBenefitPanel">
        <div className="accountBenefitCopy"><span className="eyebrow">OWNER BENEFIT</span><h2>점주 추천 혜택</h2><p>추천코드를 주변 매장 사장님께 공유하고, 함께 혜택을 받아보세요.</p><div className="benefitLinkRow"><button type="button" className="benefitInfoButton" onClick={() => setReferralInfoOpen(true)}><span>추천 혜택 안내</span><Direction /></button></div></div>
        <div className="referralBox">
          <div className="referralBoxHeading"><strong>내 추천코드</strong>{referralCode ? <span>발급 완료</span> : null}</div>
          {referralCode ? <div className="referralCodeValue"><code>{referralCode}</code><button type="button" onClick={() => void copyReferralCode()}>코드 복사</button></div> : <button className="referralIssueButton" type="button" disabled={referralLoading} onClick={() => void issueReferralCode()}>{referralLoading ? "발급 중" : "추천코드 만들기"}</button>}
          <div className="creditOverview"><div><span>보유 크레딧</span><strong>{creditHistoryLoading ? "확인 중" : money(creditHistory.availableKrw)}</strong></div><button type="button" onClick={() => setCreditHistoryOpen(true)}>크레딧 내역 <Direction /></button></div>
        </div>
      </section>

      <section className="stepCard"><div className="stepHeading"><span>01</span><div><h2>이용할 기능을 선택하세요</h2><p>기본 구독과 온라인 선결제 옵션을 필요한 만큼 선택할 수 있습니다.</p></div></div>
        <div className="productGrid">
          <button type="button" className={`productCard ${payBase ? "selected" : ""}`} aria-pressed={payBase} onClick={() => setPayBase((v) => !v)}>
            <span className="checkMark">{payBase ? "✓" : "+"}</span><span className="productTag">매장 운영 필수</span><h3>기본 구독</h3><strong className="price">월 {money(quote?.baseMonthlyKrw || 14900)}</strong><ul><li>QR 주문과 실시간 접수</li><li>메뉴·옵션·직원 관리</li><li>매장 운영 통계</li></ul>
          </button>
          {!pgConnectionChecked ? <article className="productCard locked" aria-label="온라인 선결제 연결 상태 확인 중">
            <span className="checkMark"><Lock /></span><span className="productTag option">선택 옵션</span><h3>온라인 선결제</h3><strong className="price">월 {money(quote?.addonMonthlyKrw || 5000)}</strong><p className="lockedCopy">결제 연결 상태를 확인하고 있습니다.</p>
          </article> : !pgReady ? <article className="productCard locked" aria-label="온라인 선결제 준비 필요">
            <span className="checkMark"><Lock /></span><span className="productTag option">선택 옵션</span><h3>온라인 선결제</h3><strong className="price">월 {money(quote?.addonMonthlyKrw || 5000)}</strong><p className="lockedCopy">결제대행사(PG) 연결 후 선택할 수 있습니다.</p>
          </article> : <article className={`productCard ${payAddon ? "selected" : ""}`} aria-label="온라인 선결제 옵션 선택">
            <span className="checkMark">{payAddon ? "✓" : "+"}</span><span className="productTag option">선택 옵션</span><h3>온라인 선결제</h3><strong className="price">월 {money(quote?.addonMonthlyKrw || 5000)}</strong><p className="connectedHint"><Check /> 결제대행사(PG) 연결 완료</p><button type="button" className="inlinePrepare" onClick={() => setPayAddon((v) => !v)}>{payAddon ? "선택 해제" : "선결제 옵션 선택"}</button>
          </article>}
        </div>
        <aside className="prepayGuideStrip" aria-label="온라인 선결제 시작 순서"><div className="prepayGuideHeading"><strong>온라인 선결제 시작 순서</strong>{!pgReady ? <button type="button" className="inlinePrepare" onClick={() => router.push(`/admin/billing?store=${encodeURIComponent(storeId)}`)}>결제 설정 <Direction /></button> : null}</div><ol><li className={pgReady ? "done" : ""}><i>{pgReady ? <Check /> : "1"}</i><span>결제 연결</span><b aria-hidden="true">→</b></li><li><i>2</i><span>옵션 구독</span><b aria-hidden="true">→</b></li><li><i>3</i><span>자동 활성화</span></li></ol></aside>
      </section>

      <section className="stepCard"><div className="stepHeading"><span>02</span><div><h2>이용 기간을 선택하세요</h2><p>장기 이용 시 최대 15% 할인됩니다. 베타 테스터 혜택은 40%가 우선 적용됩니다.</p></div></div>
        <div className="periodGrid">{PERIODS.map((period) => <button key={period.months} type="button" className={planMonths === period.months ? "period selected" : "period"} onClick={() => setPlanMonths(period.months)}><strong>{period.label}</strong><span>{period.discount}</span>{period.months === 12 ? <em>가장 큰 일반 혜택</em> : null}</button>)}</div>
      </section>

      <section className="checkoutGrid summaryOnly">
        <article className="summaryPanel"><h2>결제 요약</h2>
          <div className="summaryRow"><span>정상 금액</span><span>{money(quote?.listAmountKrw || 0)}</span></div>
          <div className="summaryRow discount"><span>가격 할인</span><span>-{money(quote?.discountAmountKrw || 0)}</span></div>
          {payBase ? <div className="summaryRow detail"><span>기본 구독 {planMonths}개월</span><span>{money(quote?.baseFinalAmountKrw || 0)}</span></div> : null}
          {payAddon ? <div className="summaryRow detail"><span>선결제 옵션 {planMonths}개월</span><span>{money(quote?.addonFinalAmountKrw || 0)}</span></div> : null}
          <div className={`paymentGuide ${payAddon ? "prepay" : ""}`}><strong>리온오더 추가 수수료 없음</strong><span>{payAddon ? "결제대금은 결제대행사(PG)에서 매장으로 직접 정산됩니다. PG사 계약 비용과 결제 수수료는 별도입니다." : "온라인 선결제를 사용하지 않습니다. 고객 결제는 매장 POS·카드 단말기 등 기존 결제수단으로 받습니다."}</span></div>
          {payBase && (quote?.creditAvailableKrw || 0) > 0 ? <div className="creditBox"><label htmlFor="billing-credit"><span>추천 크레딧</span><small>보유 {money(quote?.creditAvailableKrw || 0)}</small></label><p>기본 구독 결제에만 사용할 수 있습니다.</p><div><input id="billing-credit" aria-label="사용할 추천 크레딧 금액" type="number" min={0} max={Math.min(quote?.creditAvailableKrw || 0, quote?.baseFinalBeforeCreditKrw || 0)} step={100} value={creditToUse} onChange={(event) => setCreditToUse(Math.max(0, Math.min(Number(event.target.value || 0), quote?.creditAvailableKrw || 0, quote?.baseFinalBeforeCreditKrw || 0)))} /><span className="creditUnit">원 사용</span><button type="button" onClick={() => setCreditToUse(Math.min(quote?.creditAvailableKrw || 0, quote?.baseFinalBeforeCreditKrw || 0))}>전액 사용</button></div></div> : null}
          {(quote?.creditAppliedKrw || 0) > 0 ? <div className="summaryRow credit"><span>크레딧 사용</span><span>-{money(quote?.creditAppliedKrw || 0)}</span></div> : null}
          {quote?.expectedBaseEndAt || quote?.expectedAddonEndAt ? <div className="periodPreview">{quote?.expectedBaseEndAt ? <span>기본 구독 종료 <strong>{dateText(quote.expectedBaseEndAt)}</strong></span> : null}{quote?.expectedAddonEndAt ? <span>선결제 옵션 종료 <strong>{dateText(quote.expectedAddonEndAt)}</strong></span> : null}</div> : null}
          <div className="summaryTotal"><span>최종 결제 금액<small>부가세 포함</small></span><strong>{quoteLoading ? "계산 중" : money(quote?.finalAmountKrw || 0)}</strong></div>
          <button className="payButton" type="button" disabled={paying || quoteLoading || !quote || (!payBase && !payAddon)} onClick={() => setConfirmOpen(true)}>{paying ? "처리 중..." : quote?.externalAmountKrw === 0 ? "크레딧으로 결제" : `${money(quote?.finalAmountKrw || 0)} 결제하기`}</button>
          <button className="cancelLink" type="button" onClick={() => router.push(`/admin/billing/cancel?store=${encodeURIComponent(storeId)}`)}>최근 결제 취소·환불</button>
          <p className="policyText">결제한 기간은 현재 남은 기간 뒤에 이어서 추가됩니다. 결제 직후 10분 이내에는 최근 결제를 전체 취소할 수 있습니다.</p>
        </article>
      </section>

      <section className="benefitPanel postPurchaseBenefits"><span className="eyebrow">YOUR BENEFITS</span><h2>적용된 혜택</h2>{quoteLoading ? <p>혜택을 계산하고 있습니다...</p> : quote?.discountLabels.length ? <ul>{quote.discountLabels.map((label) => <li key={label}>✓ {label}</li>)}</ul> : <p>현재 선택에는 기본 가격이 적용됩니다.</p>}{quote?.founderBase || quote?.founderAddon ? <div className="founderBadge">베타 테스터<br/><strong>테스트에 함께해 주셔서 감사합니다.</strong></div> : null}{quote?.multiStore ? <div className="multiBadge">추가 매장 {quote.storeSequence}호점 혜택 적용</div> : null}</section>

      {referralInfoOpen ? <div className="modalBackdrop" role="presentation" onMouseDown={() => setReferralInfoOpen(false)}><section className="confirmModal referralModal" role="dialog" aria-modal="true" aria-labelledby="referral-info-title" onMouseDown={(event) => event.stopPropagation()}><span className="eyebrow">OWNER BENEFIT</span><h2 id="referral-info-title">추천 혜택 안내</h2><p>추천코드를 공유하면, 가입한 매장과 추천한 계정 모두 혜택을 받을 수 있습니다.</p><div className="referralBenefitGrid"><article><span>추천을 받은 매장</span><strong>첫 유료 기본 구독<br/><b>3,000원 할인</b></strong><small>가입할 때 추천코드를 입력하면 첫 결제에 자동 적용됩니다.</small></article><article><span>추천한 계정</span><strong>서비스 크레딧<br/><b>3,000원 적립</b></strong><small>첫 유료 구독 후 14일 확인기간이 지나면 적립됩니다.</small></article></div><div className="referralCreditGuide"><strong>크레딧 사용 방법</strong><p>구독 결제 화면의 <b>추천 크레딧</b>에서 금액을 입력하거나 <b>전액 사용</b>을 누르세요. 기본 구독료에만 사용할 수 있으며, 현금 전환·양도·선결제 옵션 결제에는 사용할 수 없습니다.</p></div><div className="modalActions"><button className="payButton" type="button" onClick={() => setReferralInfoOpen(false)}>확인</button></div></section></div> : null}

      {creditHistoryOpen ? <div className="modalBackdrop" role="presentation" onMouseDown={() => setCreditHistoryOpen(false)}><section className="confirmModal creditHistoryModal" role="dialog" aria-modal="true" aria-labelledby="credit-history-title" onMouseDown={(event) => event.stopPropagation()}><span className="eyebrow">SERVICE CREDIT</span><h2 id="credit-history-title">크레딧 내역</h2><p>크레딧은 기본 구독 결제에 사용할 수 있습니다.</p><div className="creditBalance"><span>현재 사용 가능</span><strong>{creditHistoryLoading ? "확인 중" : money(creditHistory.availableKrw)}</strong></div>{creditHistory.pendingRewards.length ? <section className="pendingCredit"><strong>적립 예정</strong>{creditHistory.pendingRewards.map((reward) => <span key={reward.id}>추천 보상 3,000원 · {reward.holdUntil ? `${dateText(reward.holdUntil)} 이후 확인` : "확인 후 적립"}</span>)}</section> : null}<section className="creditHistoryList"><h3>최근 내역</h3>{creditHistoryLoading ? <p>크레딧 내역을 불러오는 중입니다.</p> : creditHistory.entries.length ? creditHistory.entries.map((entry) => <article key={entry.id}><div><strong>{creditEntryLabel(entry.entryType)}</strong><span>{entry.reason} · {dateText(entry.createdAt)}</span></div><b className={entry.amountKrw > 0 ? "positive" : "negative"}>{signedCredit(entry.amountKrw)}</b></article>) : <p>아직 크레딧 변동 내역이 없습니다.</p>}</section><div className="modalActions"><button className="payButton" type="button" onClick={() => setCreditHistoryOpen(false)}>확인</button></div></section></div> : null}

      {confirmOpen && quote ? <div className="modalBackdrop" role="presentation" onMouseDown={() => !paying && setConfirmOpen(false)}><section className="confirmModal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}><span className="eyebrow">FINAL CHECK</span><h2 id="confirm-title">구독 결제를 진행할까요?</h2><div className="confirmAmount">{money(quote.finalAmountKrw)}</div><p>{storeName} · {planMonths}개월 · 부가세 포함</p><div className="confirmLines">{quote.discountLabels.map((label) => <span key={label}>✓ {label}</span>)}{quote.creditAppliedKrw > 0 ? <span>✓ 추천 크레딧 {money(quote.creditAppliedKrw)}</span> : null}</div><p className="warningText">{quote.externalAmountKrw === 0 ? "PG 결제 없이 크레딧으로 즉시 구독에 반영됩니다." : "결제창을 닫은 뒤 카드 승인 문자를 받았다면 중복 결제하지 말고 결과를 먼저 확인해 주세요."}</p><div className="modalActions"><button className="secondaryButton" onClick={() => setConfirmOpen(false)} disabled={paying}>돌아가기</button><button ref={confirmButton} className="payButton" onClick={() => void startPayment()} disabled={paying}>{paying ? "준비 중..." : quote.externalAmountKrw === 0 ? "크레딧 결제" : "결제 진행"}</button></div></section></div> : null}
    </main>
  );
}

const css = `
  :root{--ink:#172033;--muted:#697386;--line:#e4e8ef;--brand:#2457d6;--brand-dark:#173f9f;--soft:#f4f7ff;--success:#067647;--warning:#b54708;--error:#b42318}*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:var(--ink);font-family:Arial,"Noto Sans KR",sans-serif}.billingWrap{width:min(1120px,100%);margin:auto;padding:28px 20px 80px;display:grid;gap:18px}.billingHeader{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:10px 4px}.billingHeader h1{font-size:34px;letter-spacing:-1.2px;margin:5px 0}.billingHeader p,.stepHeading p{margin:0;color:var(--muted);line-height:1.6}.eyebrow{color:var(--brand);font-size:11px;font-weight:900;letter-spacing:1.7px}.headerActions{display:flex;gap:8px}.secondaryButton,.payButton,.cancelLink{min-height:46px;border-radius:12px;font-weight:800;cursor:pointer}.secondaryButton{border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 16px}.resultBanner{display:grid;gap:4px;border-radius:14px;padding:15px 18px;border:1px solid}.resultBanner.success{background:#ecfdf3;border-color:#abefc6;color:var(--success)}.resultBanner.warning{background:#fffaeb;border-color:#fedf89;color:var(--warning)}.resultBanner.error{background:#fef3f2;border-color:#fecdca;color:var(--error)}.resultBanner.info{background:var(--soft);border-color:#c7d7fe;color:var(--brand-dark)}.statusPanel{display:grid;grid-template-columns:repeat(3,1fr);background:#182238;color:#fff;border-radius:18px;padding:18px}.statusPanel>div{display:grid;gap:6px;padding:4px 18px;border-right:1px solid #344054}.statusPanel>div:last-child{border:0}.statusPanel span,.statusPanel small{color:#b8c2d7}.statusPanel strong{font-size:18px}.stepCard,.benefitPanel,.summaryPanel{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(16,24,40,.04)}.stepHeading{display:flex;gap:13px;align-items:flex-start;margin-bottom:18px}.stepHeading>span{display:grid;place-items:center;width:35px;height:35px;border-radius:11px;background:var(--brand);color:#fff;font-weight:900}.stepHeading h2,.benefitPanel h2,.summaryPanel h2{font-size:19px;margin:4px 0 5px}.productGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.productCard{position:relative;text-align:left;border:1px solid var(--line);background:#fff;border-radius:16px;padding:20px;color:var(--ink);cursor:pointer;transition:.18s}.productCard:hover{transform:translateY(-2px);border-color:#a8bcf5}.productCard.selected{border:2px solid var(--brand);padding:19px;background:linear-gradient(145deg,#fff,#f4f7ff)}.checkMark{position:absolute;right:16px;top:16px;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#edf1f7;color:#667085;font-weight:900}.selected .checkMark{background:var(--brand);color:#fff}.productTag{display:inline-block;background:#eef4ff;color:var(--brand-dark);border-radius:999px;padding:5px 8px;font-size:11px;font-weight:800}.productTag.option{background:#f3f0ff;color:#6941c6}.productCard h3{font-size:20px;margin:16px 0 5px}.price{font-size:17px}.productCard ul{margin:16px 0 0;padding-left:18px;color:var(--muted);line-height:1.8;font-size:13px}.periodGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.period{position:relative;min-height:92px;border:1px solid var(--line);background:#fff;border-radius:14px;display:grid;align-content:center;gap:6px;color:var(--ink);cursor:pointer}.period span{color:var(--muted);font-size:12px}.period em{position:absolute;top:-9px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#182238;color:#fff;border-radius:999px;padding:4px 8px;font-size:10px;font-style:normal}.period.selected{border:2px solid var(--brand);background:var(--soft);color:var(--brand-dark)}.checkoutGrid{display:grid;grid-template-columns:.85fr 1.15fr;gap:18px}.benefitPanel ul{padding:0;list-style:none;display:grid;gap:11px;color:var(--success);font-weight:700}.benefitPanel p{color:var(--muted)}.founderBadge,.multiBadge{margin-top:16px;border-radius:14px;padding:15px}.founderBadge{background:linear-gradient(135deg,#172033,#344054);color:#fff;line-height:1.6}.multiBadge{background:#eff8ff;color:#175cd3;font-weight:800}.summaryPanel{display:grid;gap:12px}.summaryRow{display:flex;justify-content:space-between}.summaryRow.discount{color:var(--success);font-weight:800}.summaryRow.detail{font-size:13px;color:var(--muted)}.summaryTotal{display:flex;align-items:end;justify-content:space-between;border-top:1px solid var(--line);padding-top:16px}.summaryTotal span{display:grid;font-weight:800}.summaryTotal small{color:var(--muted);font-size:11px;margin-top:4px}.summaryTotal strong{font-size:28px;letter-spacing:-1px}.payButton{border:0;background:var(--brand);color:#fff;padding:0 18px;font-size:15px}.payButton:hover{background:var(--brand-dark)}.payButton:disabled,.secondaryButton:disabled{opacity:.55;cursor:not-allowed}.cancelLink{border:0;background:transparent;color:var(--error)}.policyText{font-size:12px;color:var(--muted);line-height:1.55;margin:0}.modalBackdrop{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.62);display:grid;place-items:center;padding:18px}.confirmModal{width:min(460px,100%);background:#fff;border-radius:20px;padding:24px;box-shadow:0 28px 90px rgba(0,0,0,.28)}.confirmModal h2{margin:7px 0}.confirmAmount{font-size:34px;font-weight:900;margin:18px 0 5px}.confirmModal>p{color:var(--muted)}.confirmLines{display:grid;gap:7px;background:#f7f9fc;border-radius:12px;padding:13px;color:var(--success);font-size:13px}.warningText{border-left:3px solid #f79009;padding-left:11px;font-size:12px;line-height:1.6}.modalActions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.modalActions .payButton{width:100%}@media(max-width:760px){.billingWrap{padding:18px 13px 110px}.billingHeader{align-items:flex-start;display:grid}.billingHeader h1{font-size:28px}.headerActions{width:100%}.headerActions button{flex:1}.statusPanel{grid-template-columns:1fr;padding:11px}.statusPanel>div{border-right:0;border-bottom:1px solid #344054;padding:12px}.productGrid,.checkoutGrid{grid-template-columns:1fr}.periodGrid{grid-template-columns:1fr 1fr}.stepCard,.benefitPanel,.summaryPanel{padding:17px}.summaryPanel{position:sticky;bottom:8px;z-index:10;box-shadow:0 15px 45px rgba(16,24,40,.18)}.summaryRow.detail,.policyText,.summaryPanel h2{display:none}.summaryTotal strong{font-size:23px}.modalBackdrop{align-items:end;padding:10px}.confirmModal{border-radius:20px 20px 12px 12px}.productCard{min-height:220px}}`;

const compactResponsiveCss = `
  .referralBox{margin-top:16px;display:grid;gap:10px;border:1px solid #d5e0f0;border-radius:14px;padding:13px 14px;background:#fff}.referralBoxHeading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}.referralBoxHeading span{border-radius:999px;background:#ecfdf3;color:var(--success);padding:3px 7px;font-size:10px;font-weight:850}.referralCodeValue{display:flex;align-items:center;justify-content:space-between;gap:10px}.referralBox code{font-size:17px;font-weight:900;letter-spacing:1.5px;color:var(--brand-dark)}.referralBox button,.creditBox button{border:1px solid #b8c8df;border-radius:9px;background:#fff;color:var(--brand-dark);min-height:34px;padding:0 10px;font-weight:800;cursor:pointer}.referralIssueButton{width:fit-content;background:var(--brand)!important;border-color:var(--brand)!important;color:#fff!important;padding:0 13px!important}.creditBox{display:grid;gap:8px;border:1px solid #c7d7fe;background:var(--soft);border-radius:12px;padding:12px}.creditBox label{display:flex;justify-content:space-between;font-weight:800}.creditBox label small{color:var(--muted)}.creditBox>div{display:grid;grid-template-columns:1fr auto;gap:8px}.creditBox input{width:100%;min-height:38px;border:1px solid #b8c8df;border-radius:9px;padding:0 10px;font-weight:800}.summaryRow.credit{color:var(--brand-dark);font-weight:800}.periodPreview{display:grid;gap:5px;background:#f8fafc;border-radius:10px;padding:10px;font-size:12px;color:var(--muted)}.periodPreview span{display:flex;justify-content:space-between}.periodPreview strong{color:var(--ink)}.productCard.locked{border-style:dashed;background:#fafbfc;opacity:.86}.lockedHint{display:block;margin-top:10px;color:#9a6700;font-size:11px;line-height:1.5}.paymentGuide{display:grid;gap:4px;border:1px solid #d9e4f2;border-radius:11px;background:#f7faff;padding:11px;color:#31537a;font-size:12px;line-height:1.55}.paymentGuide strong{color:#174d8d;font-size:13px}.paymentGuide.prepay{border-color:#b8e0c8;background:#effaf4;color:#17633b}.paymentGuide.prepay strong{color:#126137}
  @media (min-width:761px) and (max-width:1023px){.billingWrap{padding:22px 18px 64px;gap:14px}.billingHeader h1{font-size:30px}.stepCard,.benefitPanel,.summaryPanel{padding:18px}.productCard{padding:17px}.productCard.selected{padding:16px}.productCard ul{margin-top:11px}.period{min-height:78px}.statusPanel{padding:14px}}
  @media (max-width:760px){.billingWrap{padding:14px 12px 92px;gap:11px}.billingHeader{gap:12px;padding:2px}.billingHeader h1{font-size:26px;margin:3px 0}.billingHeader p{font-size:13px}.headerActions .secondaryButton{min-height:42px;padding:0 10px;font-size:12px}.statusPanel{padding:7px;border-radius:14px}.statusPanel>div{grid-template-columns:92px 1fr auto;align-items:center;gap:7px;padding:9px 7px}.statusPanel>div span,.statusPanel>div strong,.statusPanel>div small{font-size:12px}.statusPanel>div strong{text-align:left}.stepCard,.benefitPanel,.summaryPanel{padding:14px;border-radius:15px}.stepHeading{gap:9px;margin-bottom:12px}.stepHeading>span{width:30px;height:30px}.stepHeading h2{font-size:17px;margin-top:2px}.stepHeading p{font-size:12px}.productGrid{gap:9px}.productCard,.productCard.selected{min-height:0;padding:14px 48px 13px 14px}.productCard h3{font-size:17px;margin:10px 0 3px}.productCard .price{font-size:15px}.productCard ul{margin:8px 0 0;padding-left:16px;line-height:1.5;font-size:11px}.productCard ul li:nth-child(n+2){display:none}.checkMark{right:13px;top:50%;transform:translateY(-50%)}.periodGrid{gap:7px}.period{min-height:68px}.period em{position:static;transform:none;justify-self:center;padding:2px 6px}.benefitPanel{padding-bottom:10px}.benefitPanel h2{font-size:16px}.benefitPanel ul{gap:6px;font-size:12px}.founderBadge,.multiBadge{margin-top:8px;padding:10px;font-size:12px}.summaryPanel{position:static;box-shadow:0 8px 24px rgba(16,24,40,.08)}.summaryPanel h2,.summaryRow.detail,.policyText{display:flex}.summaryPanel .payButton{position:fixed;left:12px;right:12px;bottom:max(10px,env(safe-area-inset-bottom));z-index:50;box-shadow:0 10px 28px rgba(36,87,214,.35)}.summaryTotal strong{font-size:22px}}
  @media (max-width:479px){.eyebrow{font-size:9px}.billingHeader h1{font-size:24px}.statusPanel>div{grid-template-columns:82px 1fr}.statusPanel>div small{display:none}.productTag{font-size:9px}.period strong{font-size:13px}.period span{font-size:10px}.checkoutGrid{gap:9px}}
`;

const subscriptionPreviewOverrides = `
  .settingsLink{display:inline-flex;align-items:center;justify-content:center;gap:7px}.settingsLink svg{color:var(--brand-dark)}
  .checkoutGrid{align-items:start}.prepayInfoPanel{gap:7px;border-color:#d7e2f3;border-radius:16px;padding:16px 18px;background:#f8faff;box-shadow:none}.prepayInfoPanel h2{font-size:17px;margin:2px 0}.prepayInfoPanel .conditions{gap:7px;margin:6px 0}.prepayInfoPanel .conditions span{gap:8px;font-size:12px}.prepayInfoPanel .conditions i{width:21px;height:21px;font-size:10px}.prepayInfoPanel .conditions i svg{width:13px}
  .prepayGuideStrip{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;margin-top:14px;padding:12px 14px;border-top:1px solid #dce6f5;background:#f8faff}.prepayGuideTitle{display:grid;gap:3px}.prepayGuideTitle span{color:var(--brand);font-size:9px;font-weight:900;letter-spacing:1.2px}.prepayGuideTitle strong{font-size:13px}.prepayGuideStrip ol{display:flex;align-items:center;justify-content:center;gap:0;margin:0;padding:0;list-style:none}.prepayGuideStrip li{display:flex;align-items:center;gap:6px;color:#62708a;font-size:12px;font-weight:800;white-space:nowrap}.prepayGuideStrip li+li:before{content:"→";margin:0 12px;color:#a0aec0;font-weight:500}.prepayGuideStrip li i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#e9eef6;color:#526581;font-size:10px;font-style:normal}.prepayGuideStrip li.done{color:var(--success)}.prepayGuideStrip li.done i{background:#e7f8ee;color:var(--success)}.prepayGuideStrip li i svg{width:13px}.prepayGuideStrip .inlinePrepare{min-height:32px;white-space:nowrap}.checkoutGrid.summaryOnly{display:flex;justify-content:flex-end}.checkoutGrid.summaryOnly .summaryPanel{width:min(100%,680px)}
  .prepayGuideStrip{display:grid;grid-template-columns:1fr;gap:8px;margin-top:14px;padding:12px 0 0;border-top:1px solid #dce6f5;background:transparent}.prepayGuideHeading{display:flex;align-items:center;justify-content:space-between;gap:12px}.prepayGuideHeading strong{font-size:13px}.prepayGuideStrip ol{justify-content:flex-start;gap:0}.prepayGuideStrip li{gap:5px;color:#62708a;font-size:12px}.prepayGuideStrip li+li:before{content:none}.prepayGuideStrip li b{margin:0 13px;color:#98a6ba;font-size:13px;font-weight:500}.prepayGuideStrip li i{width:20px;height:20px}.prepayGuideStrip .inlinePrepare{min-height:28px}
  .referralModal{width:min(520px,100%)}.referralBenefitGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0 10px}.referralBenefitGrid article{display:grid;gap:6px;border:1px solid #d7e2f3;border-radius:13px;padding:14px;background:#f8faff}.referralBenefitGrid span{color:#526581;font-size:11px;font-weight:850}.referralBenefitGrid strong{font-size:15px;line-height:1.45}.referralBenefitGrid b{color:var(--brand-dark)}.referralBenefitGrid small{color:var(--muted);font-size:11px;line-height:1.5}.referralCreditGuide{border-radius:12px;padding:13px 14px;background:#f7f9fc;color:#506078;font-size:12px;line-height:1.6}.referralCreditGuide strong{color:var(--ink);font-size:13px}.referralCreditGuide p{margin:5px 0 0!important;color:#506078!important}.referralCreditGuide b{color:var(--brand-dark)}
  .accountBenefitPanel{grid-template-columns:minmax(0,1fr) minmax(240px,.78fr) minmax(168px,.48fr)}.benefitLinkRow{margin-top:9px}.creditOverview{display:grid;align-content:center;gap:5px;min-height:100%;padding:12px 2px}.creditOverview>span{color:#697386;font-size:11px;font-weight:850}.creditOverview>strong{font-size:21px;letter-spacing:-.5px}.creditOverview button{display:inline-flex;align-items:center;gap:5px;width:fit-content;min-height:30px;padding:0;border:0;background:transparent;color:var(--brand-dark);font:inherit;font-size:12px;font-weight:900;cursor:pointer}.creditOverview .direction{display:grid;place-items:center}.creditOverview .direction svg{width:14px}.creditHistoryModal{width:min(540px,100%);max-height:min(720px,calc(100vh - 28px));overflow:auto}.creditBalance{display:flex;align-items:end;justify-content:space-between;margin:16px 0 10px;padding:15px;border-radius:14px;background:linear-gradient(135deg,#eef4ff,#f8faff)}.creditBalance span{color:#526581;font-size:12px;font-weight:800}.creditBalance strong{color:var(--brand-dark);font-size:26px;letter-spacing:-1px}.pendingCredit{display:grid;gap:5px;margin:10px 0;padding:12px 14px;border:1px solid #f8d38b;border-radius:12px;background:#fffaeb}.pendingCredit strong{color:#9a6700;font-size:13px}.pendingCredit span{color:#7a5a17;font-size:12px}.creditHistoryList{margin-top:17px}.creditHistoryList h3{margin:0 0 8px;font-size:14px}.creditHistoryList>p{margin:0;padding:17px 0;color:var(--muted);font-size:13px;text-align:center}.creditHistoryList article{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.creditHistoryList article div{display:grid;gap:4px}.creditHistoryList article strong{font-size:13px}.creditHistoryList article span{color:var(--muted);font-size:11px}.creditHistoryList article b{font-size:14px;white-space:nowrap}.creditHistoryList .positive{color:var(--success)}.creditHistoryList .negative{color:var(--ink)}
  .creditBox p{margin:0;color:#667085;font-size:11px}.creditBox>div{grid-template-columns:minmax(0,1fr) auto auto}.creditUnit{align-self:center;color:#526581;font-size:12px;font-weight:800}
  .accountBenefitPanel{grid-template-columns:minmax(0,1fr) minmax(290px,.9fr)}.referralBox .creditOverview{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:0;margin-top:2px;padding:11px 0 0;border-top:1px solid #e5ebf4}.referralBox .creditOverview>div{display:grid;gap:3px}.referralBox .creditOverview>span{font-size:11px}.referralBox .creditOverview>strong{font-size:18px}.referralBox .creditOverview button{min-height:28px}.referralModal .modalActions,.creditHistoryModal .modalActions{display:flex;justify-content:center}.referralModal .modalActions .payButton,.creditHistoryModal .modalActions .payButton{width:min(180px,100%)}
  .accountBenefitPanel{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.78fr) auto;align-items:center;gap:18px;background:linear-gradient(135deg,#f7faff,#fff);border:1px solid #d7e2f3;border-radius:18px;padding:18px 20px;box-shadow:0 10px 30px rgba(16,24,40,.03)}.accountBenefitPanel h2{margin:4px 0;font-size:18px}.accountBenefitPanel p{margin:0;color:var(--muted);font-size:13px;line-height:1.5}.accountBenefitPanel .referralBox{margin:0}.benefitInfoButton{display:inline-flex;align-items:center;flex:0 0 auto;gap:6px;min-height:34px;padding:0;border:0;background:transparent;color:var(--brand-dark);font:inherit;font-size:12px;font-weight:900;line-height:1;white-space:nowrap;cursor:pointer}.benefitInfoButton>span{display:block;line-height:1}.benefitInfoButton:hover .direction{transform:translateX(2px)}.benefitInfoButton .direction{flex:0 0 15px}.benefitInfoButton .direction svg{width:15px}
  .stepCard,.benefitPanel,.prepayInfoPanel,.summaryPanel{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(16,24,40,.04)}
  .stepHeading h2,.benefitPanel h2,.prepayInfoPanel h2,.summaryPanel h2{font-size:19px;margin:4px 0 5px}
  .productCard{cursor:default}.productCard.selected{padding:19px}.checkMark svg{width:16px}.lockedCopy,.connectedHint{margin:16px 0 10px;color:#687386;font-size:12px;font-weight:750}.connectedHint{display:flex;align-items:center;gap:5px;color:var(--success)}.connectedHint svg{width:15px}
  .inlinePrepare{display:inline-flex;align-items:center;gap:6px;min-height:42px;padding:0;border:0;background:transparent;color:var(--brand-dark);font:inherit;font-size:12px;font-weight:900;cursor:pointer}.direction{display:grid;place-items:center;transition:transform .18s ease}.direction svg{width:15px;height:15px}.inlinePrepare:hover .direction{transform:translateX(2px)}
  .prepayInfoPanel{display:grid;align-content:start}.conditions{display:grid;gap:9px;margin:16px 0}.conditions span{display:flex;align-items:center;gap:9px;color:#59677e;font-size:13px;font-weight:750}.conditions i{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:#eef2f7;font-size:11px;font-style:normal}.conditions i svg{width:14px}.conditions .done{color:var(--success)}
  .postPurchaseBenefits{display:grid;grid-template-columns:1fr auto;align-items:start;gap:10px}.postPurchaseBenefits .eyebrow{grid-column:1/-1}.postPurchaseBenefits h2{margin:0}.postPurchaseBenefits ul{margin:0}.postPurchaseBenefits .founderBadge,.postPurchaseBenefits .multiBadge{margin:0}.postPurchaseBenefits .referralBox{margin:0;min-width:310px}
  @media(max-width:760px){.accountBenefitPanel{grid-template-columns:1fr;padding:14px;border-radius:15px;gap:10px}.accountBenefitPanel .referralBox{min-width:0}.benefitInfoButton{justify-self:start;min-height:34px}.stepCard,.benefitPanel,.prepayInfoPanel,.summaryPanel{padding:14px;border-radius:15px}.prepayGuideStrip{grid-template-columns:1fr;gap:9px;margin-top:10px;padding:11px 0 0;background:transparent;border-top:1px solid #e5ebf4}.prepayGuideTitle{display:flex;align-items:center;gap:7px}.prepayGuideTitle strong{font-size:12px}.prepayGuideStrip ol{justify-content:flex-start}.prepayGuideStrip li{display:grid;justify-items:center;gap:4px;flex:1;font-size:10px;text-align:center;white-space:normal}.prepayGuideStrip li+li:before{position:absolute;margin:0;transform:translateX(-50%);color:#a0aec0}.prepayGuideStrip .inlinePrepare{justify-self:start}.checkoutGrid.summaryOnly{display:block}.checkoutGrid.summaryOnly .summaryPanel{width:100%}.referralBenefitGrid{gap:8px;margin:14px 0 8px}.referralBenefitGrid article{padding:11px}.referralCreditGuide{padding:11px;font-size:11px}.productCard,.productCard.selected{min-height:0;padding:14px 48px 13px 14px}.productCard.selected{padding:13px 48px 12px 13px}.lockedCopy,.connectedHint{margin:9px 0 6px}.inlinePrepare{min-height:34px}.postPurchaseBenefits{grid-template-columns:1fr}.postPurchaseBenefits .referralBox{min-width:0}}
  @media(max-width:760px){.prepayGuideStrip{gap:7px;margin-top:10px;padding:10px 0 0}.prepayGuideHeading strong{font-size:12px}.prepayGuideStrip ol{display:flex;justify-content:flex-start;gap:0}.prepayGuideStrip li{display:flex;align-items:center;justify-items:initial;gap:4px;flex:initial;font-size:11px;text-align:left;white-space:nowrap}.prepayGuideStrip li b{margin:0 8px;font-size:12px}.prepayGuideStrip .inlinePrepare{justify-self:auto;min-height:28px}.referralBox .creditOverview{padding-top:10px}.creditHistoryModal{max-height:calc(100vh - 20px)}.creditBalance{margin:13px 0 9px;padding:13px}.creditHistoryList article{padding:11px 0}.creditHistoryList article span{max-width:230px}.creditHistoryList article b{font-size:13px}}
`;

const billingStyles = `${css}${compactResponsiveCss}${subscriptionPreviewOverrides}`;

export default function BillingPayPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: billingStyles }} />
      <Suspense fallback={<main className="billingWrap"><section className="stepCard">구독 정보를 불러오고 있습니다...</section></main>}>
        <BillingPayContent />
      </Suspense>
    </>
  );
}
