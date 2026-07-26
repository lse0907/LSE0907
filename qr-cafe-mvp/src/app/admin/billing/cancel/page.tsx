"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "cancelable" | "completed">("all");
  const [visibleCount, setVisibleCount] = useState(5);
  const [refundRequesting, setRefundRequesting] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const remainingMs = (row: BillingPaymentRow) => {
    const paidAtMs = new Date(row.paid_at).getTime();
    if (!Number.isFinite(paidAtMs)) return 0;
    return Math.max(0, CANCEL_WINDOW_MINUTES * 60_000 - (nowMs - paidAtMs));
  };

  const canCancel = (row: BillingPaymentRow) => {
    if (row.status !== "paid") return { ok: false, reason: "이미 취소/환불 또는 실패 상태입니다." };
    const paidAtMs = new Date(row.paid_at).getTime();
    if (!Number.isFinite(paidAtMs)) return { ok: false, reason: "결제 시간 정보가 유효하지 않습니다." };
    if (nowMs - paidAtMs >= CANCEL_WINDOW_MINUTES * 60_000) return { ok: false, reason: "취소 가능 시간이 종료되었습니다." };
    return { ok: true, reason: "" };
  };

  const formatRemaining = (row: BillingPaymentRow) => {
    const ms = remainingMs(row);
    if (!canCancel(row).ok || ms <= 0) return "취소 가능 시간 종료";
    if (ms < 60_000) return "1분 미만";
    return `${Math.ceil(ms / 60_000)}분 남음`;
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
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!confirmOpen) return;
    confirmButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !canceling) setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmOpen, canceling]);

  const selected = rows.find((r) => r.id === selectedId) || null;
  const selectedCheck = selected ? canCancel(selected) : { ok: false, reason: "취소할 결제건을 선택해 주세요." };
  const filteredRows = rows.filter((row) => {
    if (statusFilter === "cancelable") return canCancel(row).ok;
    if (statusFilter === "completed") return ["refunded", "canceled", "cancelled"].includes(row.status);
    return true;
  });
  const visibleRows = filteredRows.slice(0, visibleCount);
  const fmtPaymentStatus = (status: string) => {
    const s = String(status || "").toLowerCase();
    if (s === "paid") return "결제 완료";
    if (s === "canceling") return "취소 처리 중";
    if (s === "canceled" || s === "cancelled") return "결제 취소";
    if (s === "refunded") return "취소·환불 완료";
    if (s === "failed") return "결제 실패";
    return status || "-";
  };

  const paymentLabel = (row: BillingPaymentRow) => {
    if (row.base_paid && row.addon_paid) return "기본 구독 + 선결제 옵션";
    if (row.base_paid) return "기본 구독";
    if (row.addon_paid) return "선결제 옵션";
    return "구독 결제";
  };

  const onRequestCancel = () => {
    if (!selected || !selectedCheck.ok) {
      setMsg(selectedCheck.reason);
      return;
    }
    if (reasonCode === "other" && !reasonDetail.trim()) {
      setMsg("기타 사유는 상세 내용을 입력해 주세요.");
      return;
    }
    setMsg("");
    setConfirmOpen(true);
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
    try {
      const res = await fetch("/api/payments/toss/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: selected.id, storeId, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setMsg(String(json?.message || "환불 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."));
        setConfirmOpen(false);
        return;
      }

      setMsg("결제 취소 및 환불이 완료되었습니다. 구독 기간도 결제 전 상태로 복구되었습니다.");
      setConfirmOpen(false);
      setReasonCode("mistake");
      setReasonDetail("");
      await loadPayments();
    } catch {
      setMsg("네트워크 오류로 환불 결과를 확인하지 못했습니다. 결제 내역을 새로 확인해 주세요.");
      setConfirmOpen(false);
    } finally {
      setCanceling(false);
    }
  };

  const onRequestRefundReview = async () => {
    if (!selected || selected.status !== "paid") return;
    if (!reasonDetail.trim()) { setMsg("환불 검토 요청 사유를 입력해 주세요."); return; }
    setRefundRequesting(true);
    setMsg("");
    const reasonLabel = REASON_OPTIONS.find((x) => x.code === reasonCode)?.label || "기타";
    const response = await fetch("/api/billing/refund-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, paymentId: selected.id, reason: `${reasonLabel}: ${reasonDetail.trim()}` }),
    });
    const result = await response.json().catch(() => ({}));
    setMsg(response.ok && result?.ok
      ? result?.alreadyRequested ? "이미 접수된 환불 요청입니다. 지원센터에서 처리 상태를 확인해 주세요." : "환불 검토 요청을 접수했습니다. OPS 확인 후 지원센터에서 답변드릴게요."
      : String(result?.message || "환불 요청을 접수하지 못했습니다."));
    setRefundRequesting(false);
  };

  return (
    <main className="wrap">
      <header className="topbar">
        <div><h1 className="h1">구독 결제 내역</h1><p className="muted">결제 내역을 확인하고 취소 또는 환불을 요청할 수 있어요.</p></div>
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
        {msg ? <p className="notice" role="status">{msg}</p> : null}
      </section>

      <section className="card">
        <div className="listHeader"><h2 className="h2">결제 내역</h2><div className="chips"><button className={statusFilter === "all" ? "chip active" : "chip"} onClick={() => { setStatusFilter("all"); setVisibleCount(5); }}>전체</button><button className={statusFilter === "cancelable" ? "chip active" : "chip"} onClick={() => { setStatusFilter("cancelable"); setVisibleCount(5); }}>취소 가능</button><button className={statusFilter === "completed" ? "chip active" : "chip"} onClick={() => { setStatusFilter("completed"); setVisibleCount(5); }}>취소 완료</button></div></div>
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
                  <th>취소 가능 여부</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
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
                        {paymentLabel(row)}
                        <div className="muted">{Number(row.amount_krw || 0).toLocaleString()}원 / {row.plan_months || "-"}개월</div>
                      </td>
                      <td className="cellNowrap"><span className={`status status-${row.status}`}>{fmtPaymentStatus(row.status)}</span></td>
                      <td className="cellNowrap">
                        {check.ok ? <span className="ok">{formatRemaining(row)}</span> : <span className="warn">{row.status === "paid" ? "시간 종료" : fmtPaymentStatus(row.status)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && rows.length > 0 ? (
          <div className="mobilePayments" role="radiogroup" aria-label="취소할 구독 결제 선택">
            {visibleRows.map((row) => {
              const check = canCancel(row);
              const selectedRow = selectedId === row.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedRow}
                  className={`paymentCard ${selectedRow ? "selected" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <span className="paymentCardTop">
                    <span className={`status status-${row.status}`}>{fmtPaymentStatus(row.status)}</span>
                    <span className={check.ok ? "ok" : "warn"}>{check.ok ? formatRemaining(row) : row.status === "paid" ? "시간 종료" : fmtPaymentStatus(row.status)}</span>
                  </span>
                  <strong>{paymentLabel(row)}</strong>
                  <span>{Number(row.amount_krw || 0).toLocaleString()}원 · {row.plan_months || "-"}개월</span>
                  <span className="muted">{new Date(row.paid_at).toLocaleString("ko-KR", { hour12: false })}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {!loading && visibleRows.length === 0 ? <p className="muted">조건에 맞는 결제 내역이 없습니다.</p> : null}
        {visibleCount < filteredRows.length ? <button className="btn moreButton" type="button" onClick={() => setVisibleCount((count) => count + 10)}>이전 결제 더보기 ({filteredRows.length - visibleCount}건)</button> : null}
      </section>

      {selected && selected.status === "paid" ? <section className="card">
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
            maxLength={120}
            placeholder={reasonCode === "other" ? "기타 사유를 자세히 입력해 주세요(필수)." : "필요 시 상세 내용을 입력해 주세요."}
            value={reasonDetail}
            onChange={(e) => setReasonDetail(e.target.value)}
          />
          <span className="charCount">{reasonDetail.length} / 120자</span>
        </label>
        <div className="row">
          {selectedCheck.ok ? <button className="btn primary" type="button" onClick={onRequestCancel} disabled={canceling}>즉시 취소하기</button> : <button className="btn primary" type="button" onClick={() => void onRequestRefundReview()} disabled={refundRequesting || !reasonDetail.trim()}>{refundRequesting ? "접수 중..." : "환불 검토 요청"}</button>}
          {!selectedCheck.ok ? <span className="muted">즉시 취소 시간이 지났습니다. 사유를 입력하면 OPS 환불 검토 요청으로 접수됩니다.</span> : null}
        </div>
      </section> : null}

      {confirmOpen && selected ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => !canceling && setConfirmOpen(false)}>
          <section
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
            aria-describedby="cancel-confirm-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="cancel-confirm-title" className="h2">결제 취소를 확정할까요?</h2>
            <p id="cancel-confirm-description" className="muted">환불이 완료되면 이 결제로 연장된 구독 기간이 결제 전 상태로 복구됩니다.</p>
            <dl className="summaryList">
              <div><dt>매장</dt><dd>{storeName}</dd></div>
              <div><dt>취소 대상</dt><dd>{paymentLabel(selected)}</dd></div>
              <div><dt>환불 금액</dt><dd>{Number(selected.amount_krw || 0).toLocaleString()}원</dd></div>
              <div><dt>취소 사유</dt><dd>{REASON_OPTIONS.find((x) => x.code === reasonCode)?.label}{reasonDetail.trim() ? ` · ${reasonDetail.trim()}` : ""}</dd></div>
            </dl>
            <div className="modalActions">
              <button className="btn" type="button" onClick={() => setConfirmOpen(false)} disabled={canceling}>돌아가기</button>
              <button ref={confirmButtonRef} className="btn danger" type="button" onClick={onSubmitCancel} disabled={canceling}>
                {canceling ? "취소 처리 중..." : "취소 및 환불 확정"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

const css = `
  :root { --bg:#f7f8fc; --card:#fff; --line:#e6e8f0; --txt:#111827; --muted:#6b7280; --primary:#2563eb; --ok:#047857; --warn:#b45309; --danger:#dc2626; --radius:14px; }
  * { box-sizing:border-box; }
  body { margin:0; color:var(--txt); background:var(--bg); }
  .wrap { color-scheme:light; color:var(--txt); max-width:1000px; margin:0 auto; padding:16px; display:grid; gap:12px; }
  .topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; }
  .h1 { margin:0; font-size:22px; font-weight:900; }
  .h2 { margin:0 0 8px; font-size:16px; font-weight:900; }
  .card { color:var(--txt); background:var(--card); border:1px solid var(--line); border-radius:var(--radius); padding:14px; display:grid; gap:10px; }
  .pill { border:1px solid #dbeafe; background:#eff6ff; color:#1e3a8a; border-radius:999px; padding:4px 8px; font-weight:800; font-size:12px; width:fit-content; }
  .muted { color:var(--muted); margin:0; font-size:13px; }
  .notice { margin:0; border-radius:10px; background:#eff6ff; color:#1e40af; padding:10px 12px; font-size:13px; font-weight:700; }
  .row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .btn { border:1px solid var(--line); background:#fff; color:var(--txt); border-radius:10px; padding:10px 12px; font-weight:800; cursor:pointer; }
  .btn.primary { background:var(--primary); color:#fff; border-color:var(--primary); }
  .btn.danger { background:var(--danger); color:#fff; border-color:var(--danger); }
  .btn:disabled { background:#f3f4f6; border-color:#e5e7eb; color:#6b7280; opacity:1; cursor:not-allowed; }
  .btn.primary:disabled, .btn.danger:disabled { background:#d1d5db; border-color:#d1d5db; color:#4b5563; }
  .btn:focus-visible, .chip:focus-visible, .paymentCard:focus-visible, .input:focus-visible { outline:3px solid rgba(37,99,235,.28); outline-offset:2px; }
  table { color:var(--txt); width:100%; border-collapse:collapse; font-size:13px; }
  input[type="radio"] { width:18px; height:18px; accent-color:var(--primary); }
  th, td { border-bottom:1px solid #eef2f7; padding:8px; text-align:left; vertical-align:top; }
  tr.sel { background:#eff6ff; }
  .ok { color:var(--ok); font-weight:800; }
  .warn { color:var(--warn); font-weight:800; font-size:12px; }
  .status { display:inline-flex; align-items:center; min-height:24px; border-radius:999px; padding:3px 8px; font-size:12px; font-weight:800; background:#f3f4f6; color:#4b5563; }
  .status-paid { background:#ecfdf5; color:#047857; }
  .status-canceling { background:#fff7ed; color:#c2410c; }
  .status-refunded, .status-canceled, .status-cancelled { background:#f3f4f6; color:#4b5563; }
  .status-failed { background:#fef2f2; color:#b91c1c; }
  .tableWrap { overflow:auto; max-height:52vh; min-height:240px; border:1px solid #eef2f7; border-radius:10px; }
  .listHeader { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .listHeader .h2 { margin:0; }
  .moreButton { justify-self:center; min-width:220px; }
  .cellNowrap { white-space:nowrap; }
  thead th { position:sticky; top:0; background:#fff; z-index:1; }
  th:nth-child(1), td:nth-child(1) { width:56px; text-align:center; }
  th:nth-child(4), td:nth-child(4) { width:56px; text-align:center; }
  th:nth-child(5), td:nth-child(5) { width:76px; text-align:center; white-space:nowrap; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { color:var(--txt); border:1px solid var(--line); background:#fff; border-radius:999px; padding:8px 12px; cursor:pointer; font-weight:700; }
  .chip.active { border-color:#2563eb; background:#eff6ff; color:#1d4ed8; }
  .field { display:grid; gap:6px; }
  .input { color:var(--txt); caret-color:var(--primary); background:#fff; width:100%; border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; }
  .input::placeholder { color:#6b7280; opacity:1; }
  .charCount { justify-self:end; color:var(--muted); font-size:12px; }
  .mobilePayments { display:none; }
  .modalBackdrop { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:20px; background:rgba(15,23,42,.56); }
  .modal { color:var(--txt); color-scheme:light; width:min(100%, 460px); border:1px solid var(--line); border-radius:16px; background:#fff; box-shadow:0 24px 64px rgba(15,23,42,.24); padding:20px; display:grid; gap:16px; }
  .summaryList { margin:0; display:grid; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; }
  .summaryList > div { display:grid; grid-template-columns:90px 1fr; gap:12px; padding:10px 12px; border-bottom:1px solid #eef2f7; }
  .summaryList > div:last-child { border-bottom:0; }
  .summaryList dt { color:var(--muted); font-size:13px; }
  .summaryList dd { margin:0; text-align:right; font-size:13px; font-weight:800; overflow-wrap:anywhere; }
  .modalActions { display:flex; justify-content:flex-end; gap:8px; }
  @media (max-width: 640px) {
    .wrap { padding:12px; }
    .topbar { align-items:flex-start; flex-direction:column; }
    .topbar .row, .topbar .btn { width:100%; }
    .topbar .btn { flex:1; }
    .tableWrap { display:none; }
    .mobilePayments { display:grid; gap:10px; }
    .paymentCard { color-scheme:light; width:100%; display:grid; gap:7px; text-align:left; border:1px solid var(--line); border-radius:12px; background:#fff; color:var(--txt); padding:12px; cursor:pointer; }
    .paymentCard.selected { border:2px solid var(--primary); padding:11px; background:#eff6ff; }
    .paymentCardTop { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .modalBackdrop { padding:12px; align-items:end; }
    .modal { border-radius:18px 18px 12px 12px; padding:18px; }
    .modalActions { display:grid; grid-template-columns:1fr 1fr; }
    .modalActions .btn { width:100%; }
  }
`;

export default function BillingCancelPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <Suspense fallback={<main className="wrap"><div className="card"><p className="muted">로딩 중...</p></div></main>}>
        <BillingCancelPageInner />
      </Suspense>
    </>
  );
}
