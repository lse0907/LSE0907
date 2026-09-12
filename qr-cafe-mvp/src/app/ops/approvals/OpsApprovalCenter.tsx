"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalStatus = "pending" | "on_hold" | "approved" | "rejected" | "cancelled" | "completed";
type ApprovalRequest = {
  id: string; store_id: string | null; store_name: string; request_type: string; source_kind: string; source_reference: string;
  title: string; change_summary: string; proposed_action: string; risk_level: "low" | "medium" | "high"; execution_kind: "manual_only";
  status: ApprovalStatus; reviewed_at: string | null; decision_note: string | null; created_at: string; updated_at: string;
};

const labels: Record<ApprovalStatus, string> = { pending: "승인 대기", on_hold: "보류", approved: "승인 기록", rejected: "반려", cancelled: "취소", completed: "완료" };
const typeLabels: Record<string, string> = { support_action: "문의 조치", refund_review: "환불 검토", subscription_review: "구독 검토", business_verification: "사업자 인증", incident_analysis: "장애 분석" };
const timeLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

export default function OpsApprovalCenter() {
  const [rows, setRows] = useState<ApprovalRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [ready, setReady] = useState(true);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<"on_hold" | "approved" | "rejected" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMessage("");
    const response = await fetch(`/api/ops/approvals?status=${filter}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) { setMessage(data?.message || "승인함을 불러오지 못했습니다."); return; }
    const requests = (data.requests || []) as ApprovalRequest[];
    setReady(data.ready !== false);
    setRows(requests);
    setSelectedId((current) => requests.some((row) => row.id === current) ? current : requests[0]?.id || "");
    if (data.message) setMessage(data.message);
  }, [filter]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const heldCount = rows.filter((row) => row.status === "on_hold").length;

  const chooseDecision = (next: "on_hold" | "approved" | "rejected") => {
    setDecision(next);
    setNote("");
    setMessage("");
  };

  const saveDecision = async () => {
    if (!selected || !decision || !note.trim()) return;
    setBusy(true);
    const response = await fetch("/api/ops/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", requestId: selected.id, decision, note }) });
    const data = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok || !data?.ok) { setMessage(data?.message || "승인 기록을 저장하지 못했습니다."); return; }
    setDecision("");
    setNote("");
    setMessage("결정과 사유를 감사 이력에 기록했습니다. 이 작업으로 실제 조치가 자동 실행되지는 않습니다.");
    await load();
  };

  return <section className="card approvalCenter">
    <header className="approvalHeader">
      <div><p className="approvalEyebrow">AI SAFETY DESK</p><h2>승인함</h2><p>AI의 제안은 검토 기록으로만 들어옵니다. 승인해도 환불·권한·코드 변경은 자동으로 실행되지 않습니다.</p></div>
      <div className="approvalSummary"><div><strong>{pendingCount}</strong><span>승인 대기</span></div><div><strong>{heldCount}</strong><span>보류</span></div></div>
    </header>
    <div className="approvalToolbar"><div className="approvalFilters" role="group" aria-label="승인함 표시 범위"><button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>처리 필요</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>전체 이력</button></div><button className="btn approvalRefresh" onClick={() => void load()}>새로고침</button></div>
    {message ? <p className={`approvalNotice ${ready ? "" : "waiting"}`} role="status">{message}</p> : null}
    {!ready ? <div className="approvalSetup"><strong>승인함 데이터 연결 준비 중</strong><p>이 화면의 구조는 준비됐습니다. 다음 별도 단계에서 로컬 DB 검증과 원격 반영을 마치면 실제 제안이 쌓입니다.</p></div> : <div className="approvalGrid">
      <div className="approvalList" aria-label="승인 요청 목록">{rows.map((row) => <button key={row.id} className={`approvalRow ${selected?.id === row.id ? "selected" : ""}`} onClick={() => { setSelectedId(row.id); setDecision(""); setNote(""); }}>
        <div className="approvalRowTop"><span className={`approvalPill ${row.status}`}>{labels[row.status]}</span><span className={`risk ${row.risk_level}`}>{row.risk_level === "high" ? "높음" : row.risk_level === "medium" ? "보통" : "낮음"}</span></div><b>{row.title}</b><p>{row.store_name} · {typeLabels[row.request_type] || row.request_type}</p><small>{timeLabel(row.created_at)}</small>
      </button>)}{!rows.length ? <div className="approvalEmpty"><strong>{filter === "open" ? "처리할 승인 요청이 없습니다." : "아직 승인 이력이 없습니다."}</strong><p>AI가 중요 조치를 제안하더라도, 이곳에서 사람이 먼저 검토하고 기록합니다.</p></div> : null}</div>
      <article className="approvalDetail">{!selected ? <div className="approvalEmpty detailEmpty"><strong>승인 요청을 선택하세요.</strong><p>검토 근거와 제안 조치를 확인한 뒤, 보류·반려·승인을 기록할 수 있습니다.</p></div> : <>
        <div className="approvalDetailHead"><div><p className="approvalMeta">{selected.store_name} · {typeLabels[selected.request_type] || selected.request_type}</p><h3>{selected.title}</h3><p className="approvalMeta">출처: {selected.source_kind} #{selected.source_reference}</p></div><span className={`approvalPill ${selected.status}`}>{labels[selected.status]}</span></div>
        <section><h4>검토 이유</h4><p>{selected.change_summary}</p></section><section><h4>제안 조치</h4><p>{selected.proposed_action}</p></section>
        <div className="safetyGuard"><strong>자동 실행 없음</strong><span>승인 기록만 남기며, 환불·구독·권한·코드·DB 변경은 이 화면에서 실행할 수 없습니다.</span></div>
        {selected.decision_note ? <div className="decisionHistory"><strong>이전 결정</strong><p>{selected.decision_note}</p>{selected.reviewed_at ? <small>{timeLabel(selected.reviewed_at)}</small> : null}</div> : null}
        {["pending", "on_hold"].includes(selected.status) ? <div className="approvalActions"><div className="approvalActionButtons"><button className="btn" onClick={() => chooseDecision("on_hold")}>보류</button><button className="btn danger" onClick={() => chooseDecision("rejected")}>반려</button><button className="btn primary" onClick={() => chooseDecision("approved")}>승인 기록</button></div>{decision ? <div className="decisionForm"><label htmlFor="approval-note">{decision === "approved" ? "승인 사유" : decision === "rejected" ? "반려 사유" : "보류 사유"}</label><textarea id="approval-note" className="textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="결정한 이유와 다음 확인 사항을 간결하게 남겨 주세요."/><div><p>이 기록은 수정·삭제할 수 없는 감사 이력으로 남습니다.</p><button className="btn primary" disabled={busy || !note.trim()} onClick={() => void saveDecision()}>{busy ? "기록 중…" : "결정 기록"}</button></div></div> : null}</div> : null}
      </>}</article>
    </div>}
    <style jsx>{`
      .approvalCenter{padding:0;overflow:hidden}.approvalHeader{display:flex;justify-content:space-between;gap:20px;padding:24px 26px;background:linear-gradient(125deg,#102849,#235395);color:#fff}.approvalEyebrow{margin:0;color:#9dcbff;font-size:10px;font-weight:900;letter-spacing:.12em}.approvalHeader h2{margin:6px 0 4px;font-size:25px;letter-spacing:-.035em}.approvalHeader>div>p:last-child{max-width:620px;margin:0;color:#d8e8ff;font-size:12px;font-weight:650;line-height:1.6}.approvalSummary{display:flex;align-self:center;border:1px solid rgba(255,255,255,.24);border-radius:14px;background:rgba(6,27,61,.24);overflow:hidden}.approvalSummary div{display:grid;min-width:83px;padding:11px 14px;text-align:center}.approvalSummary div+div{border-left:1px solid rgba(255,255,255,.2)}.approvalSummary strong{font-size:21px}.approvalSummary span{margin-top:2px;color:#cae1ff;font-size:10px;font-weight:750}.approvalToolbar{display:flex;justify-content:space-between;align-items:center;padding:15px 20px 0}.approvalFilters{display:flex;gap:4px;padding:4px;border:1px solid #dbe5f2;border-radius:10px;background:#f5f8fc}.approvalFilters button{min-height:30px;padding:0 11px;border:0;border-radius:7px;background:transparent;color:#60728a;font-size:11px;font-weight:850;box-shadow:none}.approvalFilters button.active{background:#173e73;color:#fff}.approvalRefresh{min-height:34px;font-size:11px}.approvalNotice{margin:12px 20px 0;padding:10px 12px;border:1px solid #b8d5ff;border-radius:10px;background:#f4f8ff;color:#285b98;font-size:11px;font-weight:750}.approvalNotice.waiting{border-color:#edd39a;background:#fffaf0;color:#8b5c09}.approvalSetup,.approvalEmpty{padding:28px;text-align:center}.approvalSetup strong,.approvalEmpty strong{color:#243a59}.approvalSetup p,.approvalEmpty p{max-width:390px;margin:8px auto 0;color:#708097;font-size:12px;line-height:1.6}.approvalGrid{display:grid;grid-template-columns:minmax(250px,.78fr) minmax(0,1.45fr);gap:0;margin-top:15px;border-top:1px solid #e1e9f2}.approvalList{display:grid;align-content:start;max-height:590px;overflow:auto;border-right:1px solid #e1e9f2;background:#f7f9fc}.approvalRow{display:grid;gap:6px;padding:15px 16px;border:0;border-bottom:1px solid #e3eaf3;border-radius:0;background:transparent;box-shadow:none;text-align:left}.approvalRow.selected{background:#edf5ff;box-shadow:inset 3px 0 #2160ac}.approvalRowTop{display:flex;justify-content:space-between;align-items:center}.approvalRow b{color:#203653;font-size:13px;line-height:1.4}.approvalRow p,.approvalRow small{margin:0;color:#718198;font-size:10px;font-weight:700}.approvalPill,.risk{display:inline-flex;width:max-content;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:900}.approvalPill.pending{background:#e8f1ff;color:#215c9e}.approvalPill.on_hold{background:#fff2d7;color:#975800}.approvalPill.approved{background:#e8f7ed;color:#267348}.approvalPill.rejected,.risk.high{background:#fff0f1;color:#b3444b}.risk.medium{background:#fff5e2;color:#a06a00}.risk.low{background:#e8f5ff;color:#2870a5}.approvalDetail{min-width:0;padding:22px 24px}.approvalDetailHead{display:flex;justify-content:space-between;gap:12px;align-items:start;padding-bottom:15px;border-bottom:1px solid #e4ebf3}.approvalDetailHead h3{margin:5px 0;color:#1d324f;font-size:19px;letter-spacing:-.03em}.approvalMeta{margin:0;color:#6d8099;font-size:11px;font-weight:750}.approvalDetail section{margin-top:18px}.approvalDetail h4{margin:0 0 7px;color:#254263;font-size:11px}.approvalDetail section p,.decisionHistory p{margin:0;color:#40536c;font-size:13px;line-height:1.65;white-space:pre-wrap}.safetyGuard{display:grid;gap:4px;margin-top:18px;padding:12px 13px;border:1px solid #bcd7f6;border-radius:11px;background:#f3f8ff}.safetyGuard strong{color:#245e9f;font-size:11px}.safetyGuard span{color:#486382;font-size:11px;line-height:1.55}.decisionHistory{margin-top:17px;padding:12px;border-radius:10px;background:#f6f8fb}.decisionHistory strong{color:#405976;font-size:11px}.decisionHistory small{display:block;margin-top:5px;color:#8794a4;font-size:10px}.approvalActions{margin-top:20px;padding-top:17px;border-top:1px solid #e4ebf3}.approvalActionButtons{display:flex;justify-content:flex-end;gap:7px}.approvalActionButtons .danger{color:#ad4048;border-color:#e5b9bd;background:#fff}.decisionForm{margin-top:13px;padding:13px;border:1px solid #c9d9ec;border-radius:12px;background:#f8fbff}.decisionForm label{color:#284b71;font-size:11px;font-weight:900}.decisionForm textarea{min-height:82px;margin-top:7px}.decisionForm>div{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px}.decisionForm p{margin:0;color:#718198;font-size:10px;line-height:1.45}.detailEmpty{display:grid;min-height:310px;place-content:center}@media(max-width:760px){.approvalHeader{display:grid;padding:20px}.approvalHeader h2{font-size:22px}.approvalSummary{justify-self:stretch}.approvalSummary div{flex:1}.approvalToolbar{padding:12px 14px 0}.approvalGrid{grid-template-columns:1fr}.approvalList{max-height:300px;border-right:0;border-bottom:1px solid #e1e9f2}.approvalDetail{padding:18px}.approvalActionButtons{display:grid;grid-template-columns:repeat(3,1fr)}.approvalActionButtons .btn{padding-inline:4px}.decisionForm>div{align-items:end}.decisionForm p{max-width:170px}}
    `}</style>
  </section>;
}
