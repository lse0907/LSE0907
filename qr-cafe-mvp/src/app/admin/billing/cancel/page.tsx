"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type BillingPaymentRow = {
  id: number;
  paid_at: string;
  amount_krw: number | null;
  status: string;
  plan_months: number | null;
  base_paid: boolean;
  addon_paid: boolean;
  before_paid_until: string | null;
  after_paid_until: string | null;
  order_id: string | null;
};

const CANCEL_WINDOW_MINUTES = 10;
const REASON_OPTIONS = [
  { code: "mistake", label: "실수 결제" },
  { code: "duplicate", label: "중복 결제" },
  { code: "no_use", label: "사용 계획 변경" },
  { code: "price", label: "요금 부담" },
  { code: "other", label: "기타" },
] as const;

function BillingCancelPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(() => {
    const queryStore = (sp.get("store") || "").trim();
    const savedStore = (getCurrentStoreId() || "").trim();
    return queryStore || savedStore;
  }, [sp]);
  const [storeName, setStoreName] = useState("-");
  const [rows, setRows] = useState<BillingPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reasonCode, setReasonCode] = useState<(typeof REASON_OPTIONS)[number]["code"]>("mistake");
  const [reasonDetail, setReasonDetail] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const canCancel = (row: BillingPaymentRow) => {
    if (row.status !== "paid") return { ok: false, reason: "이미 취소/환불 또는 실패 상태입니다." };
    const paidAtMs = new Date(row.paid_at).getTime();
    if (!Number.isFinite(paidAtMs)) return { ok: false, reason: "결제 시간 정보가 유효하지 않습니다." };
    const diffMin = Math.floor((nowMs - paidAtMs) / 60000);
    if (diffMin > CANCEL_WINDOW_MINUTES) return { ok: false, reason: `결제 후 ${CANCEL_WINDOW_MINUTES}분이 지나 즉시 취소가 불가합니다.` };
    return { ok: true, reason: "" };
  };

  const loadPayments = async () => {
    if (!storeId) return;
    setLoading(true);
    setMsg("");
    const [storeRes, payRes] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle(),
      supabase
        .from("billing_payments")
        .select("id, paid_at, amount_krw, status, plan_months, base_paid, addon_paid, before_paid_until, after_paid_until, order_id")
        .eq("store_id", storeId)
        .order("paid_at", { ascending: false })
        .limit(30),
    ]);

    if (storeRes.error || payRes.error) {
      setMsg(`결제 이력 로드 실패: ${storeRes.error?.message || payRes.error?.message || "알 수 없는 오류"}`);
      setLoading(false);
      return;
    }

    setStoreName(String(storeRes.data?.store_name || "").trim() || storeId);
    const nextRows = (payRes.data || []) as BillingPaymentRow[];
    setRows(nextRows);
    setSelectedId((prev) => prev ?? nextRows.find((r) => canCancel(r).ok)?.id ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
    const timer = setTimeout(() => {
      void loadPayments();
    }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, storeId]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const selected = rows.find((r) => r.id === selectedId) || null;
  const selectedCheck = selected ? canCancel(selected) : { ok: false, reason: "취소할 결제건을 선택해 주세요." };
  const fmtPaymentStatus = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "paid") return "지불";
    if (s === "canceled" || s === "cancelled") return "해지";
    if (s === "refunded") return "환불";
    if (s === "failed") return "실패";
    return status || "-";
  };

  const onSubmitCancel = async () => {
    if (!selected) {
      setMsg("취소할 결제건을 선택해 주세요.");
      return;
    }
    if (!selectedCheck.ok) {
      setMsg(selectedCheck.reason);
      return;
    }
    if (!reasonCode) {
      setMsg("취소 사유를 선택해 주세요.");
      return;
    }
    if (reasonCode === "other" && !reasonDetail.trim()) {
      setMsg("기타 사유는 상세 내용을 입력해 주세요.");
      return;
    }

    setCanceling(true);
    setMsg("");
    const reasonLabel = REASON_OPTIONS.find((x) => x.code === reasonCode)?.label || "기타";
    const reason = `${reasonLabel}${reasonDetail.trim() ? `: ${reasonDetail.trim()}` : ""}`;
    const res = await fetch("/api/payments/toss/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId: selected.id,
        storeId,
        pgMode: "platform",
        reason,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      setMsg(`즉시 취소 실패: ${String(json?.message || "알 수 없는 오류")}`);
      setCanceling(false);
      return;
    }

    setMsg("즉시 취소(환불) 처리 완료 ✅");
    setReasonCode("mistake");
    setReasonDetail("");
    await loadPayments();
    setCanceling(false);
  };

  return (
    <main className="wrap">
      <style jsx global>{css}</style>
      <header className="topbar">
        <h1 className="h1">구독 해지/취소</h1>
        <div className="row">
          <button className="btn" type="button" onClick={() => router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`)}>
            구독 결제
          </button>
          <button className="btn" type="button" onClick={() => router.push("/admin")}>
            관리자 홈
          </button>
        </div>
      </header>

      <section className="card">
        <div className="pill">{storeName} ({storeId})</div>
        <p className="warn">결제 직후 {CANCEL_WINDOW_MINUTES}분 이내 결제건만 즉시 취소(환불) 가능합니다.</p>
        <p className="warn">기간이 소요된 결제 건의 취소/환불은 지원센터로 문의해 주세요.</p>
        {msg ? <p className="muted">{msg}</p> : null}
      </section>

      <section className="card">
        <h2 className="h2">결제/구독 목록</h2>
        {loading ? <p className="muted">로딩 중...</p> : null}
        {!loading && rows.length === 0 ? <p className="muted">결제 이력이 없습니다.</p> : null}
        {!loading && rows.length > 0 ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>선택</th>
                  <th>결제일시</th>
                  <th>구독</th>
                  <th>상태</th>
                  <th>해지가능</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const check = canCancel(row);
                  const paidAt = new Date(row.paid_at);
                  const paidDate = Number.isFinite(paidAt.getTime()) ? paidAt.toLocaleDateString("ko-KR") : "-";
                  const paidTime = Number.isFinite(paidAt.getTime())
                    ? paidAt.toLocaleTimeString("ko-KR", { hour12: false })
                    : "-";
                  return (
                    <tr key={row.id} className={selectedId === row.id ? "sel" : ""}>
                      <td>
                        <input type="radio" checked={selectedId === row.id} onChange={() => setSelectedId(row.id)} />
                      </td>
                      <td className="cellNowrap">
                        <div>{paidDate}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{paidTime}</div>
                      </td>
                      <td>
                        {row.base_paid ? "기본" : ""}{row.base_paid && row.addon_paid ? " + " : ""}{row.addon_paid ? "옵션" : ""}
                        <div className="muted">{Number(row.amount_krw || 0).toLocaleString()}원 / {row.plan_months || "-"}개월</div>
                      </td>
                      <td className="cellNowrap">{fmtPaymentStatus(row.status)}</td>
                      <td className="cellNowrap">
                        {check.ok ? <span className="ok">가능</span> : <span className="warn">불가</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 className="h2">취소 사유 선택</h2>
        <div className="chips">
          {REASON_OPTIONS.map((opt) => (
            <button key={opt.code} type="button" className={reasonCode === opt.code ? "chip active" : "chip"} onClick={() => setReasonCode(opt.code)}>
              {opt.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>상세 내용</span>
          <textarea
            className="input"
            rows={4}
            placeholder={reasonCode === "other" ? "기타 사유를 자세히 입력해 주세요(필수)." : "필요 시 상세 내용을 입력해 주세요."}
            value={reasonDetail}
            onChange={(e) => setReasonDetail(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn primary" type="button" onClick={onSubmitCancel} disabled={canceling || !selectedCheck.ok}>
            {canceling ? "취소 처리 중..." : "선택한 결제 즉시 취소"}
          </button>
          {!selectedCheck.ok ? <span className="muted">{selectedCheck.reason}</span> : null}
        </div>
      </section>
    </main>
  );
}

const css = `
  :root { --bg:#f7f8fc; --card:#fff; --line:#e6e8f0; --txt:#111827; --muted:#6b7280; --primary:#2563eb; --ok:#047857; --warn:#b45309; --radius:14px; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--txt); background:var(--bg); }
  .wrap { max-width:1000px; margin:0 auto; padding:16px; display:grid; gap:12px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .h1 { margin:0; font-size:22px; font-weight:900; }
  .h2 { margin:0 0 8px; font-size:16px; font-weight:900; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:14px; display:grid; gap:10px; }
  .pill { border:1px solid #dbeafe; background:#eff6ff; color:#1e3a8a; border-radius:999px; padding:4px 8px; font-weight:800; font-size:12px; width:fit-content; }
  .muted { color:var(--muted); margin:0; font-size:13px; }
  .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .btn { border:1px solid var(--line); background:#fff; color:var(--txt); border-radius:10px; padding:10px 12px; font-weight:800; cursor:pointer; }
  .btn.primary { background:var(--primary); color:#fff; border-color:var(--primary); }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { border-bottom:1px solid #eef2f7; padding:8px; text-align:left; vertical-align:top; }
  tr.sel { background:#eff6ff; }
  .ok { color:var(--ok); font-weight:800; }
  .warn { color:var(--warn); font-weight:800; font-size:12px; }
  .tableWrap { overflow:auto; max-height:52vh; min-height:240px; border:1px solid #eef2f7; border-radius:10px; }
  .cellNowrap { white-space:nowrap; }
  thead th { position:sticky; top:0; background:#fff; z-index:1; }
  th:nth-child(1), td:nth-child(1) { width:56px; text-align:center; }
  th:nth-child(4), td:nth-child(4) { width:56px; text-align:center; }
  th:nth-child(5), td:nth-child(5) { width:76px; text-align:center; white-space:nowrap; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { border:1px solid var(--line); background:#fff; border-radius:999px; padding:8px 12px; cursor:pointer; font-weight:700; }
  .chip.active { border-color:#2563eb; background:#eff6ff; color:#1d4ed8; }
  .field { display:grid; gap:6px; }
  .input { width:100%; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; }
  @media (max-width: 640px) {
    table { font-size:12px; }
    th, td { padding:6px; }
    .tableWrap { max-height:48vh; min-height:220px; }
  }
`;

export default function BillingCancelPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <BillingCancelPageInner />
    </Suspense>
  );
}
