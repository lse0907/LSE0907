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

function BillingPayForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [baseApproved, setBaseApproved] = useState(false);
  const [addonApproved, setAddonApproved] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [planMonths, setPlanMonths] = useState<1 | 3 | 6 | 12>(1);
  const [payBase, setPayBase] = useState(true);
  const [payAddon, setPayAddon] = useState(true);
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
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
    const [baseRes, addonRes, paymentRes] = await Promise.all([
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

    setBaseApproved(String(baseRes.data?.base_plan_status || "inactive") === "active");
    setAddonApproved(String(addonRes.data?.prepay_addon_status || "inactive") === "active");
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

  const totalAmount = useMemo(() => {
    const unit = (payBase ? runtime.basePrice : 0) + (payAddon ? runtime.addonPrice : 0);
    return unit * planMonths;
  }, [payAddon, payBase, planMonths, runtime.addonPrice, runtime.basePrice]);

  const onSaveApproval = async () => {
    setSaveMsg("");
    const nowIso = new Date().toISOString();
    const [baseRes, addonRes] = await Promise.all([
      supabase.from("store_billing").upsert({ store_id: storeId, base_plan_status: baseApproved ? "active" : "inactive", updated_at: nowIso }, { onConflict: "store_id" }),
      supabase.from("store_addons").upsert({ store_id: storeId, prepay_addon_status: addonApproved ? "active" : "inactive", updated_at: nowIso }, { onConflict: "store_id" }),
    ]);

    if (baseRes.error || addonRes.error) {
      setSaveMsg(`테스트 승인 저장 실패: ${baseRes.error?.message || addonRes.error?.message}`);
      return;
    }

    setSaveMsg("테스트 승인 저장 완료");
    await refreshRuntime();
  };

  const onApplyTestPayment = async () => {
    setPayMsg("");
    if (!payBase && !payAddon) {
      setPayMsg("기본 또는 옵션 중 하나 이상 선택해 주세요.");
      return;
    }

    setPaying(true);
    const suffix = `${Date.now()}`;
    const orderId = `bill_${storeId}_${suffix}`;
    const paymentKey = `test_pay_${suffix}`;
    const note = `관리자 테스트 결제 ${planMonths}개월`;

    const { error } = await supabase.rpc("apply_store_billing_payment", {
      p_store_id: storeId,
      p_plan_months: planMonths,
      p_base_paid: payBase,
      p_addon_paid: payAddon,
      p_payment_key: paymentKey,
      p_order_id: orderId,
      p_amount_krw: totalAmount,
      p_note: note,
    });

    if (error) {
      setPayMsg(`결제 반영 실패: ${error.message}`);
      setPaying(false);
      return;
    }

    await refreshRuntime();
    setPayMsg(`결제 반영 완료 ✅ (${planMonths}개월 / ${totalAmount.toLocaleString()}원)`);
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

  return (
    <section className="card">
      <div className="pill">결제 대상 매장: {storeName} ({storeId})</div>

      <h2 className="h2">테스트 승인 체크</h2>
      <div className="payGrid">
        <label className="toggleRow">
          <input type="checkbox" checked={baseApproved} onChange={(e) => setBaseApproved(e.target.checked)} />
          <span>기본 구독 테스트 승인</span>
        </label>

        <label className="toggleRow">
          <input type="checkbox" checked={addonApproved} onChange={(e) => setAddonApproved(e.target.checked)} />
          <span>선결재 옵션 테스트 승인</span>
        </label>
      </div>
      <div className="row">
        <button className="btn" type="button" onClick={onSaveApproval}>승인 상태 저장</button>
        {saveMsg ? <span className="muted">{saveMsg}</span> : null}
      </div>

      <h2 className="h2">기간형 결제 테스트 (owner 전용)</h2>
      <p className="muted">옵션도 기간제로 계산됩니다. 총액 = 개월수 × (기본 + 옵션선택금액)</p>

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
        <div className="muted">최근 결제일자: {fmt(runtime.lastPaidAt)}</div>
        <div className="muted">최근 사용기간: {fmt(runtime.lastPaidAt)} ~ {fmt(runtime.lastAfterPaidUntil)} ({runtime.lastPlanMonths ?? "-"}개월 결제)</div>
        <div className="muted">최근 결제 기준 남은일자: {remainDays == null ? "-" : `${remainDays}일`}</div>
        <div className="muted">기본 상태: {runtime.baseStatus} / 기본 만료일: {fmt(runtime.basePaidUntil)} (최근 {runtime.baseMonths ?? "-"}개월)</div>
        <div className="muted">옵션 상태: {runtime.addonStatus} / 옵션 만료일: {fmt(runtime.addonPaidUntil)} (최근 {runtime.addonMonths ?? "-"}개월)</div>
      </div>

      <div className="row">
        <button className="btn primary" type="button" onClick={onApplyTestPayment} disabled={paying}>
          {paying ? "반영 중..." : "결제 반영 테스트 실행"}
        </button>
        {payMsg ? <span className="muted">{payMsg}</span> : null}
      </div>
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
          <button className="btn" type="button" onClick={() => router.back()}>
            관리자 홈
          </button>
        </div>
      </header>

      {storeId ? <BillingPayForm key={storeId} storeId={storeId} storeName={storeName} /> : null}
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
`;

export default function AdminBillingPayPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminBillingPayPageInner />
    </Suspense>
  );
}
