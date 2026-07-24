"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type BillingRuntimeStatus = {
  basePaidUntil: string | null;
  addonPaidUntil: string | null;
  basePrice: number;
  addonPrice: number;
  baseMonths: number | null;
  addonMonths: number | null;
  baseStatus: string;
  addonStatus: string;
  lastPaidAt: string | null;
  lastAfterPaidUntil: string | null;
  lastPlanMonths: number | null;
};

type BillingPayFormProps = {
  storeId: string;
  storeName: string;
  paymentKey: string;
  orderId: string;
  amount: number;
  failCode: string;
  failMessage: string;
  onConsumeReturnParams: () => void;
  onGoCancelPage: () => void;
};

type BillingPending = {
  storeId: string;
  planMonths: 1 | 3 | 6 | 12;
  payBase: boolean;
  payAddon: boolean;
  amount: number;
  createdAt: number;
};

const BILLING_PENDING_KEY = "qrCafeBillingPending";
const BILLING_PENDING_TTL_MS = 30 * 60 * 1000;
type TossPaymentParams = {
  amount: number;
  orderId: string;
  orderName: string;
  customerName: string;
  successUrl: string;
  failUrl: string;
};
type TossPaymentsInstance = {
  requestPayment: (method: "카드", params: TossPaymentParams) => Promise<void>;
};
type TossPaymentsFactory = (clientKey: string) => TossPaymentsInstance;

function BillingPayForm({ storeId, storeName, paymentKey, orderId, amount, failCode, failMessage, onConsumeReturnParams, onGoCancelPage }: BillingPayFormProps) {
  const [planMonths, setPlanMonths] = useState<1 | 3 | 6 | 12>(1);
  const [payBase, setPayBase] = useState(true);
  const [payAddon, setPayAddon] = useState(true);
  const [paying, setPaying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [addonToggling, setAddonToggling] = useState(false);
  const [addonFeatureMsg, setAddonFeatureMsg] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pgClientKey, setPgClientKey] = useState("");
  const [handledPaymentOrderId, setHandledPaymentOrderId] = useState("");
  const failReasonLabel = useMemo(() => {
    const code = (failCode || "").toUpperCase();
    if (!code) return "";
    if (code.includes("USER_CANCEL")) return "사용자가 결제를 취소했어요.";
    if (code.includes("INVALID")) return "결제 요청 정보가 올바르지 않습니다.";
    if (code.includes("PAY_PROCESS_CANCELED")) return "결제가 취소되었습니다.";
    return "결제 승인에 실패했습니다.";
  }, [failCode]);

  const [runtime, setRuntime] = useState<BillingRuntimeStatus>({
    basePaidUntil: null,
    addonPaidUntil: null,
    basePrice: 8900,
    addonPrice: 5000,
    baseMonths: null,
    addonMonths: null,
    baseStatus: "inactive",
    addonStatus: "inactive",
    lastPaidAt: null,
    lastAfterPaidUntil: null,
    lastPlanMonths: null,
  });

  const refreshRuntime = useCallback(async () => {
    const [baseRes, addonRes, paymentRes, pgRes] = await Promise.all([
      supabase.from("store_billing").select("paid_until, current_plan_months, base_price_krw, base_plan_status").eq("store_id", storeId).maybeSingle(),
      supabase
        .from("store_addons")
        .select("addon_paid_until, current_plan_months, prepay_addon_price_krw, prepay_addon_status")
        .eq("store_id", storeId)
        .maybeSingle(),
      supabase
        .from("billing_payments")
        .select("paid_at, after_paid_until, plan_months")
        .eq("store_id", storeId)
        .eq("status", "paid")
        .order("paid_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("platform_pg_config").select("client_key").eq("id", 1).maybeSingle(),
    ]);

    setRuntime({
      basePaidUntil: String(baseRes.data?.paid_until || "").trim() || null,
      addonPaidUntil: String(addonRes.data?.addon_paid_until || "").trim() || null,
      basePrice: Math.max(0, Number(baseRes.data?.base_price_krw || 8900)),
      addonPrice: Math.max(0, Number(addonRes.data?.prepay_addon_price_krw || 5000)),
      baseMonths: Number.isFinite(Number(baseRes.data?.current_plan_months)) ? Number(baseRes.data?.current_plan_months) : null,
      addonMonths: Number.isFinite(Number(addonRes.data?.current_plan_months)) ? Number(addonRes.data?.current_plan_months) : null,
      baseStatus: String(baseRes.data?.base_plan_status || "inactive"),
      addonStatus: String(addonRes.data?.prepay_addon_status || "inactive"),
      lastPaidAt: String(paymentRes.data?.paid_at || "").trim() || null,
      lastAfterPaidUntil: String(paymentRes.data?.after_paid_until || "").trim() || null,
      lastPlanMonths: Number.isFinite(Number(paymentRes.data?.plan_months)) ? Number(paymentRes.data?.plan_months) : null,
    });
    setPgClientKey(String(pgRes.data?.client_key || "").trim());
  }, [storeId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshRuntime();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshRuntime]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!paymentKey || !orderId || !Number.isFinite(amount) || amount <= 0) return;
    if (handledPaymentOrderId === orderId) return;

    let cancelled = false;

    (async () => {
      setHandledPaymentOrderId(orderId);
      setPayMsg("결제 승인 확인 중...");

      const rawPending = sessionStorage.getItem(`${BILLING_PENDING_KEY}:${orderId}`);
      const pending = rawPending ? (JSON.parse(rawPending) as BillingPending) : null;
      if (!pending || pending.storeId !== storeId) {
        setPayMsg("결제 대기 정보가 없어 승인 반영을 진행할 수 없습니다. 다시 결제해 주세요.");
        onConsumeReturnParams();
        return;
      }
      if (Date.now() - Number(pending.createdAt || 0) > BILLING_PENDING_TTL_MS) {
        sessionStorage.removeItem(`${BILLING_PENDING_KEY}:${orderId}`);
        setPayMsg("결제 대기 정보가 만료되었습니다. 다시 결제해 주세요.");
        onConsumeReturnParams();
        return;
      }

      const confirmRes = await fetch("/api/payments/toss/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount,
          storeId,
          pgMode: "platform",
        }),
      });

      const confirmJson = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok || !confirmJson?.ok) {
        if (cancelled) return;
        setPayMsg(`토스 승인 실패: ${String(confirmJson?.message || "알 수 없는 오류")}`);
        onConsumeReturnParams();
        return;
      }

      const { error } = await supabase.rpc("apply_store_billing_payment", {
        p_store_id: storeId,
        p_plan_months: pending.planMonths,
        p_base_paid: pending.payBase,
        p_addon_paid: pending.payAddon,
        p_payment_key: paymentKey,
        p_order_id: orderId,
        p_amount_krw: amount,
        p_note: `플랫폼 PG 결제 ${pending.planMonths}개월`,
      });

      if (error) {
        if (cancelled) return;
        setPayMsg(`결제 반영 실패: ${error.message}`);
        onConsumeReturnParams();
        return;
      }

      sessionStorage.removeItem(`${BILLING_PENDING_KEY}:${orderId}`);
      await refreshRuntime();
      if (!cancelled) {
        setPayMsg(`결제 승인 및 반영 완료 ✅ (${pending.planMonths}개월 / ${amount.toLocaleString()}원)`);
        onConsumeReturnParams();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [amount, handledPaymentOrderId, onConsumeReturnParams, orderId, paymentKey, refreshRuntime, storeId]);

  const totalAmount = useMemo(() => {
    const unit = (payBase ? runtime.basePrice : 0) + (payAddon ? runtime.addonPrice : 0);
    return unit * planMonths;
  }, [payAddon, payBase, planMonths, runtime.addonPrice, runtime.basePrice]);

  const isAddonSubscribed = useMemo(() => {
    const paidUntilMs = runtime.addonPaidUntil ? new Date(runtime.addonPaidUntil).getTime() : NaN;
    const hasRemaining = Number.isFinite(paidUntilMs) && paidUntilMs > nowMs;
    return hasRemaining || runtime.addonStatus === "active";
  }, [nowMs, runtime.addonPaidUntil, runtime.addonStatus]);

  const addonFeatureEnabled = runtime.addonStatus === "active";
  const canToggleAddonFeature = addonFeatureEnabled || isAddonSubscribed;
  const canAddonOnlyPayment = useMemo(() => {
    const paidUntilMs = runtime.basePaidUntil ? new Date(runtime.basePaidUntil).getTime() : NaN;
    const hasRemaining = Number.isFinite(paidUntilMs) && paidUntilMs > nowMs;
    return hasRemaining || runtime.baseStatus === "active";
  }, [nowMs, runtime.basePaidUntil, runtime.baseStatus]);

  const onToggleAddonFeature = async (enabled: boolean) => {
    if (!enabled && addonFeatureEnabled) {
      const ok = window.confirm("선결제 기능을 해제하시겠습니까?");
      if (!ok) return;
    }
    if (enabled && !isAddonSubscribed) {
      setAddonFeatureMsg("옵션 구독이 활성 상태일 때만 기능을 켤 수 있습니다.");
      return;
    }
    setAddonFeatureMsg("");
    setAddonToggling(true);
    const { error } = await supabase
      .from("store_addons")
      .upsert(
        {
          store_id: storeId,
          prepay_addon_status: enabled ? "active" : "inactive",
          addon_paid_until: runtime.addonPaidUntil,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "store_id" }
      );
    if (error) {
      setAddonFeatureMsg(`옵션 기능 상태 변경 실패: ${error.message}`);
      setAddonToggling(false);
      return;
    }
    setAddonFeatureMsg(enabled ? "옵션 기능을 켰습니다." : "옵션 기능을 껐습니다.");
    await refreshRuntime();
    setAddonToggling(false);
  };

  const loadTossScript = () =>
    new Promise<void>((resolve, reject) => {
      const existingFactory = (window as unknown as { TossPayments?: TossPaymentsFactory }).TossPayments;
      if (typeof window !== "undefined" && existingFactory) {
        resolve();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>('script[data-toss="billing"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("토스 스크립트 로드 실패")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://js.tosspayments.com/v1/payment";
      script.async = true;
      script.dataset.toss = "billing";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("토스 결제 스크립트를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });

  const onRequestPayment = () => {
    setPayMsg("");
    if (!payBase && !payAddon) {
      setPayMsg("기본 또는 옵션 중 하나 이상 선택해 주세요.");
      return;
    }
    if (!payBase && payAddon && !canAddonOnlyPayment) {
      setPayMsg("옵션 단독 결제는 기본 기능 구독이 활성 상태일 때만 가능합니다.");
      return;
    }
    if (!pgClientKey) {
      setPayMsg("현재 구독 결제 설정이 완료되지 않았습니다. 리온오더 고객센터에 문의해 주세요.");
      return;
    }
    setConfirmOpen(true);
  };

  const onStartPayment = async () => {
    setPayMsg("");
    if (!payBase && !payAddon) {
      setPayMsg("기본 또는 옵션 중 하나 이상 선택해 주세요.");
      return;
    }
    if (!payBase && payAddon && !canAddonOnlyPayment) {
      setPayMsg("옵션 단독 결제는 기본 기능 구독이 활성 상태일 때만 가능합니다.");
      return;
    }
    if (!pgClientKey) {
      setPayMsg("현재 구독 결제 설정이 완료되지 않았습니다. 리온오더 고객센터에 문의해 주세요.");
      return;
    }

    setPaying(true);
    try {
      const orderId = `bill_${storeId}_${Date.now()}`;
      const pending: BillingPending = {
        storeId,
        planMonths,
        payBase,
        payAddon,
        amount: totalAmount,
        createdAt: Date.now(),
      };
      sessionStorage.setItem(`${BILLING_PENDING_KEY}:${orderId}`, JSON.stringify(pending));

      await loadTossScript();
      const tossFactory = (window as unknown as { TossPayments?: TossPaymentsFactory }).TossPayments;
      if (!tossFactory) throw new Error("토스 결제 객체를 찾을 수 없습니다.");
      const tossPayments = tossFactory(pgClientKey);
      const base = window.location.origin;
      const successUrl = `${base}/admin/billing/pay?store=${encodeURIComponent(storeId)}&billing=1`;
      const failUrl = `${base}/admin/billing/pay?store=${encodeURIComponent(storeId)}&billing=1`;

      await tossPayments.requestPayment("카드", {
        amount: totalAmount,
        orderId,
        orderName: `${storeName} 구독 ${planMonths}개월`,
        customerName: `${(storeName || "매장").slice(0, 24)} 점주`,
        successUrl,
        failUrl,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setPayMsg(`결제 요청 실패: ${message}`);
      setPaying(false);
      return;
    }

    setPaying(false);
  };

  const fmt = (iso: string | null) => {
    if (!iso) return "-";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return iso;
    return new Date(t).toLocaleString("ko-KR", { hour12: false });
  };

  const calcRemainDays = (iso: string | null) => {
    if (!iso) return null;
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return null;
    const diff = target - nowMs;
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const remainDays = calcRemainDays(runtime.lastAfterPaidUntil);
  const fmtStatusKo = (status: string) => {
    const key = String(status || "").toLowerCase();
    if (key === "active") return "활성";
    if (key === "inactive") return "비활성";
    if (key === "past_due") return "결제필요";
    if (key === "trialing") return "체험중";
    return status || "-";
  };

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 className="h2" style={{ margin: 0 }}>리온오더 구독 결제(점주용)</h2>
        <div className="pill" style={{ padding: "4px 8px", fontSize: 12 }}>{storeName} ({storeId})</div>
      </div>

      <div className="card" style={{ gap: 8 }}>
        <div style={{ fontWeight: 900 }}>구독/결제 상태</div>
        <div className="muted">최근 결제일자: {fmt(runtime.lastPaidAt)}</div>
        <div className="muted">기본 기능: {fmtStatusKo(runtime.baseStatus)} / 만료일: {fmt(runtime.basePaidUntil)} (남은 {calcRemainDays(runtime.basePaidUntil) ?? "-"}일)</div>
        <div className="muted">옵션 기능: {fmtStatusKo(runtime.addonStatus)} / 만료일: {fmt(runtime.addonPaidUntil)} (남은 {calcRemainDays(runtime.addonPaidUntil) ?? "-"}일)</div>
        <label className="toggleRow">
          <input
            type="checkbox"
            checked={addonFeatureEnabled}
            disabled={!canToggleAddonFeature || addonToggling}
            onChange={(e) => {
              void onToggleAddonFeature(e.target.checked);
            }}
          />
          <span>선결제 옵션 사용 설정</span>
        </label>
        {!isAddonSubscribed ? (
          <div className="muted">옵션 구독이 활성 상태일 때만 기능을 켤 수 있습니다.</div>
        ) : null}
        {addonFeatureMsg ? <div className="muted">{addonFeatureMsg}</div> : null}
      </div>

      <div className="benefitCard">
        <div className="benefitTitle">구독 기능 안내</div>
        <p className="benefitText"><b>기본 구독</b>: QR 주문, 메뉴 관리, 직원 주문 처리</p>
        <p className="benefitText"><b>선결제 옵션</b>: 고객 온라인 결제</p>
      </div>

      <div className="payGrid">
        <label className="toggleRow">
          <input type="checkbox" checked={payBase} onChange={(e) => setPayBase(e.target.checked)} />
          <span>기본 구독 결제 포함 ({runtime.basePrice.toLocaleString()}원/월)</span>
        </label>

        <label className="toggleRow">
          <input type="checkbox" checked={payAddon} onChange={(e) => setPayAddon(e.target.checked)} />
          <span>선결제 옵션 결제 포함 ({runtime.addonPrice.toLocaleString()}원/월)</span>
        </label>
      </div>

      <label className="field">
        <span>결제 개월 수</span>
        <select className="input" value={planMonths} onChange={(e) => setPlanMonths(Number(e.target.value) as 1 | 3 | 6 | 12)}>
          <option value={1}>1개월</option>
          <option value={3}>3개월</option>
          <option value={6}>6개월</option>
          <option value={12}>12개월</option>
        </select>
      </label>

      <div className="card" style={{ gap: 6 }}>
        <div className="muted">예상 결제금액</div>
        <div style={{ fontWeight: 900, fontSize: 20 }}>{totalAmount.toLocaleString()}원</div>
        <div className="muted">최근 결제 기준 남은일자: {remainDays == null ? "-" : `${remainDays}일`}</div>
      </div>

      <div className="row">
        <button className="btn primary" type="button" onClick={onRequestPayment} disabled={paying}>
          {paying ? "결제창 준비 중..." : "구독 결제"}
        </button>
        <button className="btn" type="button" onClick={onGoCancelPage} style={{ color: "#dc2626", borderColor: "#fecaca" }}>
          최근 결제 취소
        </button>
        {(payMsg || failCode || failMessage) ? (
          <span className="muted">
            {payMsg || `${failReasonLabel || "결제 실패"} ${failCode ? `[${failCode}]` : ""} ${failMessage || ""}`.trim()}
          </span>
        ) : null}
        {(failCode || failMessage) ? (
          <button className="btn" type="button" onClick={onConsumeReturnParams}>다시 시도</button>
        ) : null}
      </div>

      {confirmOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="billing-confirm-title">
          <div className="modalCard">
            <h3 id="billing-confirm-title" className="modalTitle">구독 결제를 진행할까요?</h3>
            <div className="confirmList">
              {payBase ? <div className="confirmRow"><span>기본 구독 {planMonths}개월</span><b>{(runtime.basePrice * planMonths).toLocaleString()}원</b></div> : null}
              {payAddon ? <div className="confirmRow"><span>선결제 옵션 {planMonths}개월</span><b>{(runtime.addonPrice * planMonths).toLocaleString()}원</b></div> : null}
            </div>
            <div className="confirmTotal"><span>총 결제금액</span><b>{totalAmount.toLocaleString()}원</b></div>
            <p className="muted">결제 후 선택한 이용권 기간이 연장됩니다.</p>
            <div className="modalActions">
              <button className="btn" type="button" onClick={() => setConfirmOpen(false)} disabled={paying}>취소</button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  void onStartPayment();
                }}
                disabled={paying}
              >
                {paying ? "결제창 준비 중..." : "결제 진행"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AdminBillingPayPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => {
    const queryStore = (sp.get("store") || "").trim();
    const savedStore = (getCurrentStoreId() || "").trim();
    return queryStore || savedStore;
  }, [sp]);
  const [storeName, setStoreName] = useState("-");

  const paymentKey = String(sp.get("paymentKey") || "").trim();
  const orderId = String(sp.get("orderId") || "").trim();
  const amount = Number(sp.get("amount") || 0);
  const failCode = String(sp.get("code") || "").trim();
  const failMessage = String(sp.get("message") || "").trim();

  const consumeReturnParams = useCallback(() => {
    if (!storeId) return;
    router.replace(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`);
  }, [router, storeId]);
  const goCancelPage = useCallback(() => {
    if (!storeId) return;
    router.push(`/admin/billing/cancel?store=${encodeURIComponent(storeId)}`);
  }, [router, storeId]);

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, storeId]);

  useEffect(() => {
    if (!storeId) return;
    (async () => {
      const { data } = await supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle();
      const name = String(data?.store_name || "").trim();
      setStoreName(name || storeId);
    })();
  }, [storeId]);

  return (
    <main className="wrap">
      <style jsx global>{css}</style>
      <header className="topbar">
        <h1 className="h1">매장 결제/구독</h1>
        <div className="row">
          <button className="btn" type="button" onClick={() => router.push(`/admin/billing?store=${encodeURIComponent(storeId)}`)}>
            PG 설정
          </button>
          <button className="btn" type="button" onClick={() => router.push("/admin")}>
            관리자 홈
          </button>
        </div>
      </header>

      {storeId ? (
        <BillingPayForm
          key={storeId}
          storeId={storeId}
          storeName={storeName}
          paymentKey={paymentKey}
          orderId={orderId}
          amount={amount}
          failCode={failCode}
          failMessage={failMessage}
          onConsumeReturnParams={consumeReturnParams}
          onGoCancelPage={goCancelPage}
        />
      ) : null}
    </main>
  );
}

const css = `
  :root { --bg:#f7f8fc; --card:#fff; --line:#e6e8f0; --txt:#111827; --muted:#6b7280; --primary:#2563eb; --radius:14px; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--txt); background:var(--bg); }
  .wrap { max-width:860px; margin:0 auto; padding:16px; display:grid; gap:12px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .h1 { margin:0; font-size:22px; font-weight:900; }
  .h2 { margin:0 0 8px; font-size:16px; font-weight:900; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:14px; display:grid; gap:10px; }
  .muted { color:var(--muted); margin:0; font-size:13px; }
  .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .btn { border:1px solid var(--line); background:#fff; color:var(--txt); border-radius:10px; padding:10px 12px; font-weight:800; cursor:pointer; }
  .btn.primary { background:var(--primary); color:#fff; border-color:var(--primary); }
  .btn:disabled { opacity:.6; cursor:not-allowed; }
  .field { display:grid; gap:6px; }
  .input { width:100%; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; }
  .payGrid { display:grid; gap:8px; }
  .toggleRow { display:flex; align-items:center; gap:8px; font-weight:700; }
  .benefitCard { border:1px solid #dbeafe; background:#eff6ff; border-radius:12px; padding:12px; display:grid; gap:6px; }
  .benefitTitle { color:#1d4ed8; font-size:13px; font-weight:900; }
  .benefitText { margin:0; color:#1e3a8a; font-size:13px; line-height:1.45; }
  .modalBackdrop { position:fixed; inset:0; z-index:80; display:grid; place-items:center; padding:16px; background:rgba(15,23,42,.48); }
  .modalCard { width:min(420px, 100%); border:1px solid var(--line); border-radius:18px; background:#fff; padding:16px; display:grid; gap:12px; box-shadow:0 24px 80px rgba(15,23,42,.24); }
  .modalTitle { margin:0; font-size:18px; font-weight:900; }
  .confirmList { display:grid; gap:8px; }
  .confirmRow, .confirmTotal { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .confirmTotal { border-top:1px solid var(--line); padding-top:10px; font-weight:900; }
  .confirmTotal b { font-size:20px; }
  .modalActions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
  @media (max-width:640px) {
    .topbar { align-items:flex-start; flex-direction:column; }
    .btn { min-height:42px; }
  }
`;

export default function AdminBillingPayPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminBillingPayPageInner />
    </Suspense>
  );
}
