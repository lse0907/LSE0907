"use client";

import { useMemo, useState } from "react";

type RefundItem = { id: string; name: string; qty: number; price: number; optionTotal?: number; lineTotal?: number };

export function PartialRefundModal({
  storeId,
  order,
  onClose,
  onCompleted,
}: {
  storeId: string;
  order: { id: string; displayNo: string; items: RefundItem[] };
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("고객 요청");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selected = useMemo(() => order.items
    .map((item) => ({ item, quantity: Math.min(item.qty, Math.max(0, Math.round(quantities[item.id] || 0))) }))
    .filter((row) => row.quantity > 0), [order.items, quantities]);
  const amount = selected.reduce((sum, row) => sum + (Number(row.item.price || 0) + Number(row.item.optionTotal || 0)) * row.quantity, 0);

  const submit = async () => {
    if (!selected.length || submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/orders/partial-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          orderId: order.id,
          reason,
          items: selected.map(({ item, quantity }) => ({ orderItemId: item.id, quantity })),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(String(result?.message || "부분 환불을 처리하지 못했습니다."));
      setMessage(String(result.message || `${Number(result.refundAmount || 0).toLocaleString()}원 부분 환불이 접수되었습니다.`));
      onCompleted();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "부분 환불을 처리하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="partialBackdrop" role="dialog" aria-modal="true" aria-labelledby="partial-refund-title">
      <section className="partialCard">
        <header><div><small>AFTER SERVICE</small><h3 id="partial-refund-title">부분 환불</h3><p>주문 {order.displayNo}</p></div><button type="button" onClick={onClose}>닫기</button></header>
        <div className="partialItems">
          {order.items.map((item) => (
            <label key={item.id}>
              <span><b>{item.name}</b><small>최대 {item.qty}개 · {(Number(item.price || 0) + Number(item.optionTotal || 0)).toLocaleString()}원</small></span>
              <input type="number" min="0" max={item.qty} value={quantities[item.id] || 0} onChange={(event) => setQuantities((prev) => ({ ...prev, [item.id]: Math.min(item.qty, Math.max(0, Math.round(Number(event.target.value || 0)))) }))} />
            </label>
          ))}
        </div>
        <label className="partialReason"><span>사유</span><select value={reason} onChange={(event) => setReason(event.target.value)}><option>고객 요청</option><option>품질 문제</option><option>누락·오배송</option><option>매장 사정</option><option>기타</option></select></label>
        <div className="partialSummary"><span>선택 금액</span><strong>{amount.toLocaleString()}원</strong><small>실제 환불액은 포인트·쿠폰을 다시 계산해 확정됩니다.</small></div>
        {message ? <p className="partialMessage" role="status">{message}</p> : null}
        <footer><button type="button" onClick={onClose}>닫기</button><button type="button" className="primary" disabled={!selected.length || submitting} onClick={() => void submit()}>{submitting ? "처리 중" : "부분 환불"}</button></footer>
      </section>
      <style jsx>{`
        .partialBackdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:16px;background:rgba(15,23,42,.62)}
        .partialCard{width:min(560px,100%);max-height:calc(100dvh - 32px);overflow:auto;padding:18px;border-radius:20px;background:#fff;color:#0f172a;box-shadow:0 24px 70px rgba(0,0,0,.28);display:grid;gap:14px}
        header,footer,.partialSummary{display:flex;align-items:center;justify-content:space-between;gap:12px}header h3,header p{margin:3px 0}header small{color:#1d4ed8;font-weight:900}button,select,input{min-height:42px;border:1px solid #cbd5e1;border-radius:11px;background:#fff;padding:0 12px;font:inherit;font-weight:800}button{cursor:pointer}.primary{background:#173e73;color:#fff;border-color:#173e73}.primary:disabled{opacity:.5;cursor:not-allowed}
        .partialItems{display:grid;gap:8px}.partialItems label{display:grid;grid-template-columns:minmax(0,1fr) 76px;align-items:center;gap:12px;padding:11px;border:1px solid #e2e8f0;border-radius:13px}.partialItems span{display:grid;gap:4px}.partialItems small,.partialSummary small{color:#64748b;font-size:12px}.partialItems input{text-align:center;width:100%}.partialReason{display:grid;gap:6px}.partialSummary{align-items:end;padding:12px;border-radius:13px;background:#f1f5f9;flex-wrap:wrap}.partialSummary strong{font-size:20px}.partialSummary small{width:100%}.partialMessage{margin:0;padding:10px 12px;border-radius:11px;background:#eff6ff;color:#1d4ed8;font-weight:800}footer button{flex:1}
        @media(max-width:520px){.partialBackdrop{padding:0;align-items:end}.partialCard{max-height:92dvh;border-radius:20px 20px 0 0;padding:15px}.partialItems label{grid-template-columns:minmax(0,1fr) 66px}}
      `}</style>
    </div>
  );
}
