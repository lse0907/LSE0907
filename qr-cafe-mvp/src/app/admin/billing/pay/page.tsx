"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";

type PlanMonths = 1 | 3 | 6 | 12;
type Quote = {
  planMonths: PlanMonths; payBase: boolean; payAddon: boolean;
  baseMonthlyKrw: number; addonMonthlyKrw: number;
  baseDiscountBps: number; addonDiscountBps: number; termDiscountBps: number;
  listAmountKrw: number; finalAmountKrw: number; discountAmountKrw: number;
  baseFinalAmountKrw: number; addonFinalAmountKrw: number;
  founderBase: boolean; founderAddon: boolean; multiStore: boolean; storeSequence: number;
  vatIncluded: boolean; discountLabels: string[];
};
type Runtime = { baseStatus: string; addonStatus: string; addonEnabled: boolean; basePaidUntil: string | null; addonPaidUntil: string | null; lastPaidAt: string | null };
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
  const [payAddon, setPayAddon] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [clientKey, setClientKey] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "warning" | "error">("info");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const handledReturn = useRef("");
  const confirmButton = useRef<HTMLButtonElement>(null);

  const refreshRuntime = useCallback(async () => {
    if (!storeId) return;
    const [storeRes, baseRes, addonRes, paymentRes, keyRes] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle(),
      supabase.from("store_billing").select("base_plan_status,paid_until").eq("store_id", storeId).maybeSingle(),
      supabase.from("store_addons").select("prepay_addon_status,addon_paid_until,prepay_enabled").eq("store_id", storeId).maybeSingle(),
      supabase.from("billing_payments").select("paid_at").eq("store_id", storeId).eq("status", "paid").order("paid_at", { ascending: false }).limit(1).maybeSingle(),
      fetch(`/api/billing/platform-client-key?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" }),
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
  }, [storeId]);

  const loadQuote = useCallback(async (prepare = false) => {
    if (!storeId || (!payBase && !payAddon)) { setQuote(null); return null; }
    if (!prepare) setQuoteLoading(true);
    const response = await fetch("/api/billing/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, planMonths, payBase, payAddon, prepare }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (!prepare) { setMessage(String(result.message || "결제 금액을 계산하지 못했습니다.")); setMessageKind("error"); }
      setQuoteLoading(false);
      return null;
    }
    setQuote(result.quote as Quote);
    setQuoteLoading(false);
    return result as { quote: Quote; orderId?: string };
  }, [payAddon, payBase, planMonths, storeId]);

  useEffect(() => {
    if (!storeId) { router.replace("/admin"); return; }
    setCurrentStoreId(storeId);
    void refreshRuntime();
  }, [refreshRuntime, router, storeId]);

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
    setMessage(cancelled ? "결제가 취소되었습니다. 카드가 승인되지 않았다면 다시 시도할 수 있습니다." : `${failMessage || "결제가 완료되지 않았습니다."} 카드 승인 여부를 먼저 확인해 주세요.`);
    setMessageKind(cancelled ? "info" : "error");
  }, [failCode, failMessage]);

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
    if (!clientKey) { setMessage("구독 결제 설정이 완료되지 않았습니다. 고객센터에 문의해 주세요."); setMessageKind("error"); return; }
    setPaying(true); setConfirmOpen(false); setMessage("결제창을 준비하고 있습니다."); setMessageKind("info");
    try {
      const prepared = await loadQuote(true);
      if (!prepared?.orderId || !prepared.quote) throw new Error("서버 결제 견적을 준비하지 못했습니다.");
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

  const statusLabel = (status: string) => status === "active" ? "이용 중" : status === "trialing" ? "무료 체험" : status === "past_due" ? "결제 필요" : "미이용";

  return (
    <main className="billingWrap">
      <AdminPageHeader title="구독 결제" description="이용할 기능과 기간을 선택하고 최종 결제 금액을 확인하세요." storeId={storeId} storeName={storeName} eyebrow="RION ORDER · BILLING" actions={<button className="secondaryButton" onClick={() => router.push(`/admin/billing?store=${encodeURIComponent(storeId)}`)}>결제 설정으로</button>} />

      {message ? <section className={`resultBanner ${messageKind}`} role="status"><strong>{messageKind === "success" ? "결제 완료" : messageKind === "warning" ? "처리 상태 확인 중" : messageKind === "error" ? "확인이 필요합니다" : "안내"}</strong><span>{message}</span></section> : null}

      <section className="statusPanel">
        <div><span>기본 구독</span><strong>{statusLabel(runtime.baseStatus)}</strong><small>만료 {dateText(runtime.basePaidUntil)}</small></div>
        <div><span>선결제 옵션</span><strong>{statusLabel(runtime.addonStatus)} · {runtime.addonEnabled ? "기능 켜짐" : "기능 꺼짐"}</strong><small>만료 {dateText(runtime.addonPaidUntil)}</small></div>
        <div><span>최근 결제</span><strong>{dateText(runtime.lastPaidAt)}</strong><small>모든 가격은 부가세 포함입니다.</small></div>
      </section>

      <section className="stepCard"><div className="stepHeading"><span>01</span><div><h2>이용할 기능을 선택하세요</h2><p>기본 구독과 온라인 선결제 옵션을 필요한 만큼 선택할 수 있습니다.</p></div></div>
        <div className="productGrid">
          <button type="button" className={`productCard ${payBase ? "selected" : ""}`} aria-pressed={payBase} onClick={() => setPayBase((v) => !v)}>
            <span className="checkMark">{payBase ? "✓" : "+"}</span><span className="productTag">매장 운영 필수</span><h3>기본 구독</h3><strong className="price">월 {money(quote?.baseMonthlyKrw || 14900)}</strong><ul><li>QR 주문과 실시간 접수</li><li>메뉴·옵션·직원 관리</li><li>매장 운영 통계</li></ul>
          </button>
          <button type="button" className={`productCard ${payAddon ? "selected" : ""}`} aria-pressed={payAddon} onClick={() => setPayAddon((v) => !v)}>
            <span className="checkMark">{payAddon ? "✓" : "+"}</span><span className="productTag option">선택 옵션</span><h3>온라인 선결제</h3><strong className="price">월 {money(quote?.addonMonthlyKrw || 5000)}</strong><ul><li>고객 카드 결제</li><li>주문·결제 상태 연동</li><li>결제 취소 지원</li></ul>
          </button>
        </div>
      </section>

      <section className="stepCard"><div className="stepHeading"><span>02</span><div><h2>이용 기간을 선택하세요</h2><p>장기 이용 시 최대 15% 할인됩니다. 창립 멤버 상품에는 더 큰 40% 혜택이 우선 적용됩니다.</p></div></div>
        <div className="periodGrid">{PERIODS.map((period) => <button key={period.months} type="button" className={planMonths === period.months ? "period selected" : "period"} onClick={() => setPlanMonths(period.months)}><strong>{period.label}</strong><span>{period.discount}</span>{period.months === 12 ? <em>가장 큰 일반 혜택</em> : null}</button>)}</div>
      </section>

      <section className="checkoutGrid">
        <article className="benefitPanel"><span className="eyebrow">YOUR BENEFITS</span><h2>적용된 혜택</h2>{quoteLoading ? <p>혜택을 계산하고 있습니다...</p> : quote?.discountLabels.length ? <ul>{quote.discountLabels.map((label) => <li key={label}>✓ {label}</li>)}</ul> : <p>현재 선택에는 기본 가격이 적용됩니다.</p>}{quote?.founderBase || quote?.founderAddon ? <div className="founderBadge">창립 멤버<br/><strong>베타 테스트에 함께해 주셔서 감사합니다.</strong></div> : null}{quote?.multiStore ? <div className="multiBadge">추가 매장 {quote.storeSequence}호점 혜택 적용</div> : null}</article>
        <article className="summaryPanel"><h2>결제 요약</h2>
          <div className="summaryRow"><span>정상 금액</span><span>{money(quote?.listAmountKrw || 0)}</span></div>
          <div className="summaryRow discount"><span>총 할인</span><span>-{money(quote?.discountAmountKrw || 0)}</span></div>
          {payBase ? <div className="summaryRow detail"><span>기본 구독 {planMonths}개월</span><span>{money(quote?.baseFinalAmountKrw || 0)}</span></div> : null}
          {payAddon ? <div className="summaryRow detail"><span>선결제 옵션 {planMonths}개월</span><span>{money(quote?.addonFinalAmountKrw || 0)}</span></div> : null}
          <div className="summaryTotal"><span>최종 결제 금액<small>부가세 포함</small></span><strong>{quoteLoading ? "계산 중" : money(quote?.finalAmountKrw || 0)}</strong></div>
          <button className="payButton" type="button" disabled={paying || quoteLoading || !quote || (!payBase && !payAddon)} onClick={() => setConfirmOpen(true)}>{paying ? "결제창 준비 중..." : `${money(quote?.finalAmountKrw || 0)} 결제하기`}</button>
          <button className="cancelLink" type="button" onClick={() => router.push(`/admin/billing/cancel?store=${encodeURIComponent(storeId)}`)}>최근 결제 취소·환불</button>
          <p className="policyText">결제한 기간은 현재 남은 기간 뒤에 이어서 추가됩니다. 결제 직후 10분 이내에는 최근 결제를 전체 취소할 수 있습니다.</p>
        </article>
      </section>

      {confirmOpen && quote ? <div className="modalBackdrop" role="presentation" onMouseDown={() => !paying && setConfirmOpen(false)}><section className="confirmModal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}><span className="eyebrow">FINAL CHECK</span><h2 id="confirm-title">구독 결제를 진행할까요?</h2><div className="confirmAmount">{money(quote.finalAmountKrw)}</div><p>{storeName} · {planMonths}개월 · 부가세 포함</p><div className="confirmLines">{quote.discountLabels.map((label) => <span key={label}>✓ {label}</span>)}</div><p className="warningText">결제창을 닫은 뒤 카드 승인 문자를 받았다면 중복 결제하지 말고 결과를 먼저 확인해 주세요.</p><div className="modalActions"><button className="secondaryButton" onClick={() => setConfirmOpen(false)} disabled={paying}>돌아가기</button><button ref={confirmButton} className="payButton" onClick={() => void startPayment()} disabled={paying}>{paying ? "준비 중..." : "결제 진행"}</button></div></section></div> : null}
    </main>
  );
}

const css = `
  :root{--ink:#172033;--muted:#697386;--line:#e4e8ef;--brand:#2457d6;--brand-dark:#173f9f;--soft:#f4f7ff;--success:#067647;--warning:#b54708;--error:#b42318}*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:var(--ink);font-family:Arial,"Noto Sans KR",sans-serif}.billingWrap{width:min(1120px,100%);margin:auto;padding:28px 20px 80px;display:grid;gap:18px}.billingHeader{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:10px 4px}.billingHeader h1{font-size:34px;letter-spacing:-1.2px;margin:5px 0}.billingHeader p,.stepHeading p{margin:0;color:var(--muted);line-height:1.6}.eyebrow{color:var(--brand);font-size:11px;font-weight:900;letter-spacing:1.7px}.headerActions{display:flex;gap:8px}.secondaryButton,.payButton,.cancelLink{min-height:46px;border-radius:12px;font-weight:800;cursor:pointer}.secondaryButton{border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 16px}.resultBanner{display:grid;gap:4px;border-radius:14px;padding:15px 18px;border:1px solid}.resultBanner.success{background:#ecfdf3;border-color:#abefc6;color:var(--success)}.resultBanner.warning{background:#fffaeb;border-color:#fedf89;color:var(--warning)}.resultBanner.error{background:#fef3f2;border-color:#fecdca;color:var(--error)}.resultBanner.info{background:var(--soft);border-color:#c7d7fe;color:var(--brand-dark)}.statusPanel{display:grid;grid-template-columns:repeat(3,1fr);background:#182238;color:#fff;border-radius:18px;padding:18px}.statusPanel>div{display:grid;gap:6px;padding:4px 18px;border-right:1px solid #344054}.statusPanel>div:last-child{border:0}.statusPanel span,.statusPanel small{color:#b8c2d7}.statusPanel strong{font-size:18px}.stepCard,.benefitPanel,.summaryPanel{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(16,24,40,.04)}.stepHeading{display:flex;gap:13px;align-items:flex-start;margin-bottom:18px}.stepHeading>span{display:grid;place-items:center;width:35px;height:35px;border-radius:11px;background:var(--brand);color:#fff;font-weight:900}.stepHeading h2,.benefitPanel h2,.summaryPanel h2{font-size:19px;margin:4px 0 5px}.productGrid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.productCard{position:relative;text-align:left;border:1px solid var(--line);background:#fff;border-radius:16px;padding:20px;color:var(--ink);cursor:pointer;transition:.18s}.productCard:hover{transform:translateY(-2px);border-color:#a8bcf5}.productCard.selected{border:2px solid var(--brand);padding:19px;background:linear-gradient(145deg,#fff,#f4f7ff)}.checkMark{position:absolute;right:16px;top:16px;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#edf1f7;color:#667085;font-weight:900}.selected .checkMark{background:var(--brand);color:#fff}.productTag{display:inline-block;background:#eef4ff;color:var(--brand-dark);border-radius:999px;padding:5px 8px;font-size:11px;font-weight:800}.productTag.option{background:#f3f0ff;color:#6941c6}.productCard h3{font-size:20px;margin:16px 0 5px}.price{font-size:17px}.productCard ul{margin:16px 0 0;padding-left:18px;color:var(--muted);line-height:1.8;font-size:13px}.periodGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.period{position:relative;min-height:92px;border:1px solid var(--line);background:#fff;border-radius:14px;display:grid;align-content:center;gap:6px;color:var(--ink);cursor:pointer}.period span{color:var(--muted);font-size:12px}.period em{position:absolute;top:-9px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#182238;color:#fff;border-radius:999px;padding:4px 8px;font-size:10px;font-style:normal}.period.selected{border:2px solid var(--brand);background:var(--soft);color:var(--brand-dark)}.checkoutGrid{display:grid;grid-template-columns:.85fr 1.15fr;gap:18px}.benefitPanel ul{padding:0;list-style:none;display:grid;gap:11px;color:var(--success);font-weight:700}.benefitPanel p{color:var(--muted)}.founderBadge,.multiBadge{margin-top:16px;border-radius:14px;padding:15px}.founderBadge{background:linear-gradient(135deg,#172033,#344054);color:#fff;line-height:1.6}.multiBadge{background:#eff8ff;color:#175cd3;font-weight:800}.summaryPanel{display:grid;gap:12px}.summaryRow{display:flex;justify-content:space-between}.summaryRow.discount{color:var(--success);font-weight:800}.summaryRow.detail{font-size:13px;color:var(--muted)}.summaryTotal{display:flex;align-items:end;justify-content:space-between;border-top:1px solid var(--line);padding-top:16px}.summaryTotal span{display:grid;font-weight:800}.summaryTotal small{color:var(--muted);font-size:11px;margin-top:4px}.summaryTotal strong{font-size:28px;letter-spacing:-1px}.payButton{border:0;background:var(--brand);color:#fff;padding:0 18px;font-size:15px}.payButton:hover{background:var(--brand-dark)}.payButton:disabled,.secondaryButton:disabled{opacity:.55;cursor:not-allowed}.cancelLink{border:0;background:transparent;color:var(--error)}.policyText{font-size:12px;color:var(--muted);line-height:1.55;margin:0}.modalBackdrop{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.62);display:grid;place-items:center;padding:18px}.confirmModal{width:min(460px,100%);background:#fff;border-radius:20px;padding:24px;box-shadow:0 28px 90px rgba(0,0,0,.28)}.confirmModal h2{margin:7px 0}.confirmAmount{font-size:34px;font-weight:900;margin:18px 0 5px}.confirmModal>p{color:var(--muted)}.confirmLines{display:grid;gap:7px;background:#f7f9fc;border-radius:12px;padding:13px;color:var(--success);font-size:13px}.warningText{border-left:3px solid #f79009;padding-left:11px;font-size:12px;line-height:1.6}.modalActions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.modalActions .payButton{width:100%}@media(max-width:760px){.billingWrap{padding:18px 13px 110px}.billingHeader{align-items:flex-start;display:grid}.billingHeader h1{font-size:28px}.headerActions{width:100%}.headerActions button{flex:1}.statusPanel{grid-template-columns:1fr;padding:11px}.statusPanel>div{border-right:0;border-bottom:1px solid #344054;padding:12px}.productGrid,.checkoutGrid{grid-template-columns:1fr}.periodGrid{grid-template-columns:1fr 1fr}.stepCard,.benefitPanel,.summaryPanel{padding:17px}.summaryPanel{position:sticky;bottom:8px;z-index:10;box-shadow:0 15px 45px rgba(16,24,40,.18)}.summaryRow.detail,.policyText,.summaryPanel h2{display:none}.summaryTotal strong{font-size:23px}.modalBackdrop{align-items:end;padding:10px}.confirmModal{border-radius:20px 20px 12px 12px}.productCard{min-height:220px}}`;

const compactResponsiveCss = `
  @media (min-width:761px) and (max-width:1023px){.billingWrap{padding:22px 18px 64px;gap:14px}.billingHeader h1{font-size:30px}.stepCard,.benefitPanel,.summaryPanel{padding:18px}.productCard{padding:17px}.productCard.selected{padding:16px}.productCard ul{margin-top:11px}.period{min-height:78px}.statusPanel{padding:14px}}
  @media (max-width:760px){.billingWrap{padding:14px 12px 92px;gap:11px}.billingHeader{gap:12px;padding:2px}.billingHeader h1{font-size:26px;margin:3px 0}.billingHeader p{font-size:13px}.headerActions .secondaryButton{min-height:42px;padding:0 10px;font-size:12px}.statusPanel{padding:7px;border-radius:14px}.statusPanel>div{grid-template-columns:92px 1fr auto;align-items:center;gap:7px;padding:9px 7px}.statusPanel>div span,.statusPanel>div strong,.statusPanel>div small{font-size:12px}.statusPanel>div strong{text-align:left}.stepCard,.benefitPanel,.summaryPanel{padding:14px;border-radius:15px}.stepHeading{gap:9px;margin-bottom:12px}.stepHeading>span{width:30px;height:30px}.stepHeading h2{font-size:17px;margin-top:2px}.stepHeading p{font-size:12px}.productGrid{gap:9px}.productCard,.productCard.selected{min-height:0;padding:14px 48px 13px 14px}.productCard h3{font-size:17px;margin:10px 0 3px}.productCard .price{font-size:15px}.productCard ul{margin:8px 0 0;padding-left:16px;line-height:1.5;font-size:11px}.productCard ul li:nth-child(n+2){display:none}.checkMark{right:13px;top:50%;transform:translateY(-50%)}.periodGrid{gap:7px}.period{min-height:68px}.period em{position:static;transform:none;justify-self:center;padding:2px 6px}.benefitPanel{padding-bottom:10px}.benefitPanel h2{font-size:16px}.benefitPanel ul{gap:6px;font-size:12px}.founderBadge,.multiBadge{margin-top:8px;padding:10px;font-size:12px}.summaryPanel{position:static;box-shadow:0 8px 24px rgba(16,24,40,.08)}.summaryPanel h2,.summaryRow.detail,.policyText{display:flex}.summaryPanel .payButton{position:fixed;left:12px;right:12px;bottom:max(10px,env(safe-area-inset-bottom));z-index:50;box-shadow:0 10px 28px rgba(36,87,214,.35)}.summaryTotal strong{font-size:22px}}
  @media (max-width:479px){.eyebrow{font-size:9px}.billingHeader h1{font-size:24px}.statusPanel>div{grid-template-columns:82px 1fr}.statusPanel>div small{display:none}.productTag{font-size:9px}.period strong{font-size:13px}.period span{font-size:10px}.checkoutGrid{gap:9px}}
`;

const billingStyles = `${css}${compactResponsiveCss}`;

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
