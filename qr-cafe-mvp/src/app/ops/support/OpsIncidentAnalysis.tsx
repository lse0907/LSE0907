"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Ticket = {
  id: number;
  store_id: string;
  store_name?: string;
  title: string;
  body: string | null;
  category: string;
  priority: string;
  status: string;
  created_at: string;
};

const formatDate = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const riskLabel: Record<string, string> = { low: "낮음", medium: "보통", high: "높음" };

export default function OpsIncidentAnalysis() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState("");
  const [plan, setPlan] = useState("");
  const [risk, setRisk] = useState("medium");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/ops/support", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok || !data?.ok) { setNotice(data?.message || "오류 접수 목록을 불러오지 못했습니다."); return; }
    const incidentRows = (data.tickets || []).filter((ticket: Ticket) => ["incident", "bug"].includes(ticket.category));
    setTickets(incidentRows);
    setSelectedId((current) => current && incidentRows.some((ticket: Ticket) => ticket.id === current) ? current : incidentRows[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { void load(); });
    return () => window.cancelAnimationFrame(frame);
  }, [load]);
  const selected = useMemo(() => tickets.find((ticket) => ticket.id === selectedId) || null, [tickets, selectedId]);

  const requestApproval = async () => {
    if (!selected || evidence.trim().length < 10 || plan.trim().length < 10) return;
    setSaving(true);
    setNotice("");
    const response = await fetch("/api/ops/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        requestType: "incident_analysis",
        storeId: selected.store_id,
        sourceKind: "support_ticket",
        sourceReference: `ticket:${selected.id}:incident-plan:v1`,
        title: `장애 수정 계획 검토 · #${selected.id} ${selected.title}`,
        changeSummary: evidence.trim(),
        proposedAction: plan.trim(),
        riskLevel: risk,
      }),
    });
    const data = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok || !data?.ok) { setNotice(data?.message || "승인함에 보낼 수 없습니다."); return; }
    setNotice("수정 계획을 승인함에 등록했습니다. 승인만으로 코드·DB·환불은 실행되지 않습니다.");
  };

  return <section className="card incidentDesk">
    <div className="panelHeader incidentHeader">
      <div><span className="incidentEyebrow">AI INCIDENT REVIEW</span><div className="sectionTitle">AI 장애 분석</div><p>오류 접수의 근거와 수정 계획을 검토한 뒤, 승인함으로 보냅니다.</p></div>
      <button className="btn" onClick={() => void load()} disabled={loading}>새로고침</button>
    </div>
    <div className="safetyStrip"><strong>자동 실행 없음</strong><span>승인 후에도 브랜치 생성, 코드·DB 변경, 배포는 별도 검증과 실행 승인이 필요합니다.</span></div>
    {notice ? <p className="incidentNotice" role="status">{notice}</p> : null}
    <div className="incidentGrid">
      <article className="incidentList">
        <div className="incidentListTitle"><strong>오류 접수</strong><small>{loading ? "불러오는 중…" : `${tickets.length}건`}</small></div>
        {tickets.map((ticket) => <button key={ticket.id} className={`incidentTicket ${selected?.id === ticket.id ? "selected" : ""}`} onClick={() => { setSelectedId(ticket.id); setEvidence(""); setPlan(""); setNotice(""); }}>
          <span>{ticket.store_name || "매장명 확인 중"}</span><b>#{ticket.id} {ticket.title}</b><small>{ticket.priority === "urgent" ? "긴급" : "오류 신고"} · {formatDate(ticket.created_at)}</small>
        </button>)}
        {!loading && !tickets.length ? <p className="incidentEmpty">검토할 오류 접수가 없습니다.</p> : null}
      </article>
      <article className="incidentDetail">
        {!selected ? <div className="incidentEmpty"><strong>오류 접수를 선택하세요.</strong><p>접수 내용과 안전한 수정 계획을 검토할 수 있습니다.</p></div> : <>
          <div className="incidentCase"><div><span className="caseMeta">{selected.store_name || "매장명 확인 중"} · 문의 #{selected.id}</span><h3>{selected.title}</h3></div><span className="pill">{selected.status === "in_progress" ? "처리 중" : "접수됨"}</span></div>
          <div className="caseSource"><span>점주가 남긴 오류 정보</span><p>{selected.body || "추가 설명이 없습니다."}</p></div>
          <div className="analysisState"><strong>AI 분석 연결 전</strong><p>OpenAI 연결 전에는 분석 결과를 생성하지 않습니다. 아래에 운영자가 확인한 근거와 수정 계획을 기록하면, 승인형 절차로 안전하게 이어집니다.</p></div>
          <label className="incidentField"><span>확인 근거 <em>필수</em></span><textarea className="textarea" maxLength={1000} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="재현 조건, 오류 메시지, 영향 범위 등 확인한 사실만 적어 주세요." /></label>
          <label className="incidentField"><span>수정·검증 계획 <em>필수</em></span><textarea className="textarea" maxLength={1000} value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="예: 재현 테스트 → 별도 브랜치에서 수정안 작성 → Preview 검증 → PR 준비" /></label>
          <div className="incidentFoot"><label>위험도<select className="select" value={risk} onChange={(event) => setRisk(event.target.value)}>{Object.entries(riskLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="btn primary" disabled={saving || evidence.trim().length < 10 || plan.trim().length < 10} onClick={() => void requestApproval()}>{saving ? "등록 중…" : "수정 계획 승인함으로 보내기"}</button></div>
        </>}
      </article>
    </div>
    <style jsx>{`
      .incidentDesk{padding:22px}.incidentHeader{margin-bottom:13px}.incidentEyebrow{display:block;margin-bottom:7px;color:#3770b7;font-size:10px;font-weight:900;letter-spacing:.13em}.incidentHeader .sectionTitle{font-size:22px}.incidentHeader p{margin:6px 0 0;color:#687a92;font-size:13px;font-weight:650}.safetyStrip{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border:1px solid #bed3ee;border-radius:11px;background:#f2f7fe;color:#3a5677;font-size:12px;line-height:1.55}.safetyStrip strong{flex:0 0 auto;color:#143d6b}.incidentNotice{margin:12px 0 0;padding:11px 13px;border:1px solid #b8d5f6;border-radius:10px;background:#f3f8ff;color:#24578e;font-size:12px;font-weight:750}.incidentGrid{display:grid;grid-template-columns:minmax(220px,.75fr) minmax(0,1.45fr);gap:16px;margin-top:16px}.incidentList,.incidentDetail{min-width:0}.incidentList{padding-right:14px;border-right:1px solid #e4ebf3}.incidentListTitle{display:flex;justify-content:space-between;align-items:center;margin:2px 0 9px;color:#263d5d;font-size:13px}.incidentListTitle small,.caseMeta{color:#76869a;font-size:11px;font-weight:700}.incidentTicket{display:grid;gap:5px;width:100%;margin-top:7px;padding:12px;border:1px solid #dfe7f0;border-radius:11px;background:#fff;text-align:left;box-shadow:none}.incidentTicket:hover,.incidentTicket.selected{border-color:#8bb4e8;background:#f4f8ff}.incidentTicket span{color:#52739c;font-size:10px;font-weight:900}.incidentTicket b{overflow:hidden;color:#203652;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.incidentTicket small{color:#718198;font-size:10px;font-weight:700}.incidentCase{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding-bottom:13px;border-bottom:1px solid #e7edf5}.incidentCase h3{margin:5px 0 0;color:#172b47;font-size:18px;letter-spacing:-.025em}.caseSource{margin-top:14px;padding:12px 13px;border-radius:11px;background:#f6f8fb}.caseSource span{color:#4a6381;font-size:11px;font-weight:900}.caseSource p{margin:6px 0 0;color:#3a4d66;font-size:13px;line-height:1.65;white-space:pre-wrap}.analysisState{margin-top:12px;padding:12px 13px;border-left:3px solid #70a6df;border-radius:0 10px 10px 0;background:#f2f7fd}.analysisState strong{color:#24558e;font-size:12px}.analysisState p{margin:5px 0 0;color:#536b88;font-size:12px;line-height:1.55}.incidentField{display:block;margin-top:14px}.incidentField span{display:block;margin-bottom:7px;color:#2d4563;font-size:12px;font-weight:900}.incidentField em{margin-left:5px;color:#2f72b7;font-size:10px;font-style:normal}.incidentField .textarea{min-height:90px;margin:0}.incidentFoot{display:flex;justify-content:space-between;align-items:end;gap:12px;margin-top:13px}.incidentFoot label{display:grid;gap:5px;color:#526a87;font-size:11px;font-weight:800}.incidentFoot .select{min-width:110px;margin:0}.incidentEmpty{display:grid;place-content:center;min-height:220px;margin:0;color:#5e7087;text-align:center}.incidentEmpty p{max-width:250px;margin:8px auto 0;font-size:12px;line-height:1.6}@media(max-width:760px){.incidentDesk{padding:16px}.incidentGrid{grid-template-columns:1fr}.incidentList{padding:0 0 14px;border-right:0;border-bottom:1px solid #e4ebf3}.incidentFoot{display:grid}.incidentFoot .select,.incidentFoot .btn{width:100%}.safetyStrip{display:grid;gap:3px}}
    `}</style>
  </section>;
}
