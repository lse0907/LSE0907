"use client";

import { useCallback, useEffect, useState } from "react";

type Ticket = { id: number; store_id: string; store_name?: string; title: string; body: string | null; status: string; priority: string; category: string; created_at: string };
type Event = { id: number; actor_kind: "owner" | "ops" | "system" | "ai"; event_type: string; body: string | null; created_at: string };
type Attachment = { id: number; original_filename: string; content_type: string; byte_size: number; created_at: string };
type Detail = { ticket: Ticket; events: Event[]; attachments: Attachment[] };

const statusLabel: Record<string, string> = { open: "접수됨", in_progress: "처리 중", resolved: "답변 완료", closed: "종료" };
const categoryLabel: Record<string, string> = { howto: "사용·설정", inquiry: "사용·설정", billing: "결제·구독", incident: "오류 신고", bug: "오류 신고" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const byteLabel = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;

export default function OpsSupportDesk() {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/ops/support", { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) { setMessage(data?.message || "문의 목록을 불러오지 못했습니다."); return; }
    setRows(data.tickets || []);
  }, []);

  const selectTicket = async (ticketId: number) => {
    setMessage("");
    const response = await fetch(`/api/ops/support?ticketId=${ticketId}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) { setMessage(data?.message || "문의 상세 내용을 불러오지 못했습니다."); return; }
    setSelected({ ticket: data.ticket, events: data.events || [], attachments: data.attachments || [] });
    setReply("");
    setStatus("");
  };

  const save = async () => {
    if (!selected || (!reply.trim() && !status)) return;
    setBusy(true);
    const response = await fetch("/api/ops/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: selected.ticket.id, status, reply }) });
    const data = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok || !data?.ok) { setMessage(data?.message || "답변을 저장하지 못했습니다."); return; }
    setMessage("답변과 처리 이력을 저장했습니다.");
    await Promise.all([load(), selectTicket(selected.ticket.id)]);
  };

  const openAttachment = async (attachmentId: number) => {
    setOpeningId(attachmentId);
    const response = await fetch(`/api/ops/support/attachment?attachmentId=${attachmentId}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    setOpeningId(null);
    if (!response.ok || !data?.url) { setMessage(data?.message || "첨부 파일을 열지 못했습니다."); return; }
    window.open(data.url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => { void load(); }, [load]);

  return <section className="card supportDesk">
    <div className="panelHeader">
      <div><div className="sectionTitle">문의·장애 처리함</div><p>점주 문의와 오류 자료를 확인하고, 답변·처리 상태를 기록합니다.</p></div>
      <button className="btn" onClick={() => void load()}>새로고침</button>
    </div>
    {message ? <p className="supportNotice" role="status">{message}</p> : null}
    <div className="ticketShell supportDeskGrid">
      <article className="supportListPanel">
        <div className="supportPanelHeading"><div><div className="sectionTitle">문의 목록</div><p>최근 접수 순 · {rows.length}건</p></div></div>
        <div className="ticketList">{rows.map((row) => <button key={row.id} className={`ticket ${selected?.ticket.id === row.id ? "selectedTicket" : ""}`} onClick={() => void selectTicket(row.id)}>
          <div className="ticketTop"><strong>{row.store_name || row.store_id}</strong><span className={`pill supportStatus ${row.status}`}>{statusLabel[row.status] || row.status}</span></div>
          <b>{row.title}</b><p className="ticketExcerpt">{row.body || "추가 설명 없음"}</p>
          <small>{categoryLabel[row.category] || row.category} · {dateLabel(row.created_at)}</small>
        </button>)}{!rows.length ? <p className="emptyState">아직 접수된 문의가 없습니다.</p> : null}</div>
      </article>
      <article className="ticketDetail supportDetailPanel">
        {!selected ? <div className="supportEmpty"><strong>문의 하나를 선택하세요.</strong><p>내용, 첨부 자료, 이전 처리 이력을 확인한 뒤 답변을 남길 수 있습니다.</p></div> : <>
          <div className="supportDetailHeader"><div><p className="supportMeta">{selected.ticket.store_name || selected.ticket.store_id} · #{selected.ticket.id}</p><h3>{selected.ticket.title}</h3><p className="supportMeta">{categoryLabel[selected.ticket.category] || selected.ticket.category} · {dateLabel(selected.ticket.created_at)}</p></div><span className={`pill supportStatus ${selected.ticket.status}`}>{statusLabel[selected.ticket.status] || selected.ticket.status}</span></div>
          <div className="supportBody">{selected.ticket.body || "추가 설명이 없습니다."}</div>
          {selected.attachments.length ? <div className="supportBlock"><div className="supportBlockTitle">첨부 자료 <small>비공개 · 열람 링크 60초</small></div><div className="supportAttachments">{selected.attachments.map((attachment) => <button key={attachment.id} className="supportAttachment" onClick={() => void openAttachment(attachment.id)} disabled={openingId === attachment.id}><span>이미지</span><b>{attachment.original_filename}</b><small>{byteLabel(attachment.byte_size)} · {openingId === attachment.id ? "여는 중…" : "열기"}</small></button>)}</div></div> : null}
          <div className="supportBlock"><div className="supportBlockTitle">처리 이력</div><ol className="supportTimeline">{selected.events.map((event) => <li key={event.id}><span className={`supportActor ${event.actor_kind}`}>{event.actor_kind === "ops" ? "OPS" : event.actor_kind === "owner" ? "점주" : event.actor_kind === "ai" ? "AI" : "시스템"}</span><div><p>{event.body || "처리 상태가 변경되었습니다."}</p><small>{dateLabel(event.created_at)}</small></div></li>)}{!selected.events.length ? <li><div><p>아직 처리 이력이 없습니다.</p></div></li> : null}</ol></div>
          <div className="supportReply"><label htmlFor="ops-support-reply">점주에게 보낼 답변</label><textarea id="ops-support-reply" className="textarea" value={reply} maxLength={5000} onChange={(event) => setReply(event.target.value)} placeholder="처리 결과와 다음 안내를 명확히 적어 주세요."/><div className="supportReplyFoot"><select className="select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">상태 유지</option><option value="in_progress">처리 중으로 변경</option><option value="resolved">답변 완료로 변경</option><option value="closed">종료로 변경</option></select><button className="btn primary" disabled={busy || (!reply.trim() && !status)} onClick={() => void save()}>{busy ? "저장 중…" : "답변 저장"}</button></div></div>
        </>}
      </article>
    </div>
    <style jsx>{`
      .supportDeskGrid{margin-top:16px}.supportNotice{margin:14px 0 0;padding:11px 13px;border:1px solid #bad4fa;border-radius:11px;background:#f3f8ff;color:#28568d;font-size:12px;font-weight:750}.supportListPanel{min-width:0}.supportPanelHeading{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px}.supportPanelHeading p,.supportMeta{margin:4px 0 0;color:#6d7d92;font-size:11px;font-weight:700}.ticket{display:grid;gap:6px;text-align:left}.ticket b{color:#1a2940;font-size:13px}.ticket small{color:#718198;font-size:10px;font-weight:700}.supportStatus{font-size:10px}.supportStatus.open{background:#eaf2ff;color:#1d5ca1}.supportStatus.in_progress{background:#fff3d9;color:#9a5a00}.supportStatus.resolved,.supportStatus.closed{background:#e9f8ef;color:#227448}.supportDetailHeader{display:flex;justify-content:space-between;gap:12px;align-items:start;padding-bottom:15px;border-bottom:1px solid #e7edf5}.supportDetailHeader h3{margin:6px 0 0;color:#162a45;font-size:18px;letter-spacing:-.025em}.supportBody{margin:16px 0;padding:13px 14px;border-radius:11px;background:#f6f8fb;color:#35465e;font-size:13px;line-height:1.7;white-space:pre-wrap}.supportBlock{margin-top:18px}.supportBlockTitle{color:#253a57;font-size:12px;font-weight:900}.supportBlockTitle small{margin-left:6px;color:#77879a;font-size:10px;font-weight:700}.supportAttachments{display:grid;gap:7px;margin-top:9px}.supportAttachment{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 11px;border:1px solid #dce5f0;border-radius:10px;background:#fff;color:#26415f;box-shadow:none;text-align:left}.supportAttachment span{padding:4px 6px;border-radius:6px;background:#eaf2ff;color:#2e66a4;font-size:9px;font-weight:900}.supportAttachment b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.supportAttachment small{color:#718198;font-size:10px;font-weight:800}.supportTimeline{display:grid;gap:10px;margin:10px 0 0;padding:0;list-style:none}.supportTimeline li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start}.supportTimeline p{margin:0;color:#43546b;font-size:12px;line-height:1.55;white-space:pre-wrap}.supportTimeline small{color:#8290a1;font-size:10px}.supportActor{padding:4px 6px;border-radius:6px;background:#eef2f7;color:#5e7087;font-size:9px;font-weight:900}.supportActor.ops{background:#e9f1fd;color:#285c99}.supportActor.store{background:#edf9f0;color:#347252}.supportReply{margin-top:20px;padding-top:16px;border-top:1px solid #e7edf5}.supportReply label{color:#253a57;font-size:12px;font-weight:900}.supportReply .textarea{margin-top:8px}.supportReplyFoot{display:flex;justify-content:space-between;gap:9px;margin-top:9px}.supportReplyFoot .select{margin:0;max-width:210px}.supportReplyFoot .btn{min-width:104px}.supportEmpty{display:grid;place-content:center;min-height:260px;text-align:center}.supportEmpty strong{color:#304866}.supportEmpty p{max-width:260px;margin:8px auto 0;color:#718198;font-size:12px;line-height:1.6}@media(max-width:760px){.supportReplyFoot{display:grid}.supportReplyFoot .select{max-width:none}.supportReplyFoot .btn{width:100%}.supportDetailHeader h3{font-size:16px}}`}</style>
  </section>;
}
