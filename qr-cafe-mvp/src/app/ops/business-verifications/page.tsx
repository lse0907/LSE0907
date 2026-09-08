"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import RionBrand from "@/app/components/RionBrand";
import OpsIcon from "../_components/OpsIcon";

type RequestRow = {
  id: string;
  status: string;
  applicant_role: string;
  business_phone: string;
  submitted_at: string | null;
  review_note: string | null;
  business_document_url: string | null;
  delegation_document_url: string | null;
  business_entities: { legal_name?: string; business_number?: string; representative_name?: string; business_type?: string; opening_date?: string; registered_address?: string } | null;
};

export default function OpsBusinessVerificationsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [filter, setFilter] = useState("submitted");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/ops/business-verifications?status=${encodeURIComponent(filter)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; requests?: RequestRow[] };
    if (!response.ok || !payload.ok) setMessage(payload.message || "인증 요청을 불러오지 못했습니다.");
    else { setRows(payload.requests || []); setMessage(""); }
    setLoading(false);
  }, [filter]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const review = async (decision: string) => {
    if (!selected) return;
    setBusy(true);
    const response = await fetch("/api/ops/business-verifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: selected.id, decision, note }) });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!response.ok || !payload.ok) setMessage(payload.message || "심사 결과를 저장하지 못했습니다.");
    else { setSelected(null); setNote(""); await load(); }
    setBusy(false);
  };

  return (
    <main className="opsReview">
      <header><div><RionBrand product inverse /><span>BUSINESS VERIFICATION</span></div><nav className="opsHeaderActions"><Link href="/ops"><OpsIcon name="home" />OPS 홈</Link><button onClick={() => void load()}><OpsIcon name="refresh" />새로고침</button></nav></header>
      <section className="title"><div><span>OPS REVIEW</span><h1>사업자 인증 심사</h1><p>사업체 정보와 신청 권한을 확인한 뒤 매장 생성 권한을 승인합니다.</p></div><div className="summary"><b>{rows.length}</b><small>현재 표시된 요청</small></div></section>
      <nav className="filters">{[["submitted","검토 대기"],["changes_requested","보완 요청"],["approved","승인 완료"],["rejected","거절"],["all","전체"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</nav>
      {message ? <p className="message">{message}</p> : null}
      <section className="content">
        <div className="requestList">{loading ? <p className="empty">요청을 불러오고 있습니다.</p> : rows.length ? rows.map((row) => <button key={row.id} className={selected?.id === row.id ? "request active" : "request"} onClick={() => { setSelected(row); setNote(row.review_note || ""); }}><span className={`status ${row.status}`}>{statusLabel(row.status)}</span><strong>{row.business_entities?.legal_name || "사업체명 확인 필요"}</strong><small>{row.business_entities?.business_number || "-"} · {row.applicant_role === "representative" ? "대표자" : "위임 담당자"}</small><time>{formatDate(row.submitted_at)}</time></button>) : <p className="empty">해당 상태의 인증 요청이 없습니다.</p>}</div>
        <aside className="detail">{selected ? <><div className="detailHead"><span>신청 상세</span><h2>{selected.business_entities?.legal_name}</h2><p>{selected.business_entities?.business_number}</p></div><dl><div><dt>대표자</dt><dd>{selected.business_entities?.representative_name || "-"}</dd></div><div><dt>사업자 유형</dt><dd>{businessTypeLabel(selected.business_entities?.business_type)}</dd></div><div><dt>개업일</dt><dd>{selected.business_entities?.opening_date || "-"}</dd></div><div><dt>사업자 주소</dt><dd>{selected.business_entities?.registered_address || "-"}</dd></div><div><dt>신청자 권한</dt><dd>{selected.applicant_role === "representative" ? "대표자 본인" : "위임받은 담당자"}</dd></div><div><dt>업무용 연락처</dt><dd>{selected.business_phone}</dd></div></dl><div className="documents"><b>제출 증빙</b><div>{selected.business_document_url ? <a href={selected.business_document_url} target="_blank" rel="noreferrer">사업자등록증 열기</a> : <span>사업자등록증 없음</span>}{selected.applicant_role === "authorized_manager" ? selected.delegation_document_url ? <a href={selected.delegation_document_url} target="_blank" rel="noreferrer">위임 증빙 열기</a> : <span>위임 증빙 없음</span> : null}</div><small>보안을 위해 링크는 5분 후 만료됩니다.</small></div><label>OPS 검토 메모<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="보완 또는 거절 시 구체적인 사유를 입력하세요." /></label><div className="reviewActions"><button className="reject" disabled={busy} onClick={() => void review("reject")}>거절</button><button className="change" disabled={busy} onClick={() => void review("changes_requested")}>보완 요청</button><button className="approve" disabled={busy} onClick={() => void review("approve")}>인증 승인</button></div><p className="manualNote">초기 운영에서는 승인 전에 OPS가 업무용 연락처를 수동 확인합니다.</p></> : <div className="emptyDetail"><b>검토할 요청을 선택하세요.</b><p>왼쪽 목록에서 사업체를 선택하면 상세정보와 처리 버튼이 표시됩니다.</p></div>}</aside>
      </section>
      <style jsx>{`
        .opsReview{min-height:100dvh;padding:24px clamp(16px,4vw,48px) 70px;background:#f2f5fa;color:#172033}header{display:flex;align-items:center;justify-content:space-between;padding:19px 22px;border-radius:20px;background:linear-gradient(135deg,#102b58,#09172c);color:#fff;box-shadow:0 18px 45px rgba(15,31,61,.2)}header>div{display:flex;align-items:center;gap:18px}header span{padding-left:18px;border-left:1px solid rgba(255,255,255,.25);color:#a9c8fb;font-size:10px;font-weight:950;letter-spacing:.14em}header nav{display:flex;gap:8px}header a,header button{min-height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;font-size:11px;font-weight:850;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;flex:0 0 auto}header a svg,header button svg{width:15px;height:15px;flex:0 0 auto}.title{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:28px 0 18px}.title>div>span{color:#2b63ad;font-size:10px;font-weight:950;letter-spacing:.15em}.title h1{margin:7px 0;font-size:31px;letter-spacing:-.045em}.title p{margin:0;color:#667085}.summary{display:grid;min-width:120px;padding:16px;border:1px solid #dce4ef;border-radius:16px;background:#fff;text-align:center}.summary b{font-size:27px;color:#173e73}.summary small{color:#718096}.filters{display:flex;gap:7px;margin-bottom:14px;overflow:auto}.filters button{min-width:max-content;padding:9px 13px;border:1px solid #d8e1ec;border-radius:999px;background:#fff;color:#536176;font-weight:800}.filters button.active{border-color:#173e73;background:#173e73;color:#fff}.message{padding:13px 15px;border-radius:12px;background:#fff1f2;color:#a31337}.content{display:grid;grid-template-columns:minmax(280px,.8fr) minmax(430px,1.2fr);gap:14px}.requestList,.detail{min-height:560px;border:1px solid #dce4ef;border-radius:20px;background:#fff;box-shadow:0 14px 34px rgba(15,35,66,.055)}.requestList{padding:10px}.request{width:100%;display:grid;gap:5px;margin-bottom:7px;padding:15px;border:1px solid transparent;border-radius:14px;background:#f7f9fc;color:#172033;text-align:left}.request:hover,.request.active{border-color:#8eadd3;background:#eef5ff}.request strong{font-size:15px}.request small,.request time{color:#718096}.status{width:max-content;padding:4px 7px;border-radius:999px;background:#eaf2fd;color:#245797;font-size:9px;font-weight:900}.status.approved{background:#ecfdf3;color:#166534}.status.rejected{background:#fff1f2;color:#a31337}.status.changes_requested{background:#fff8e7;color:#8a5b08}.detail{padding:23px}.detailHead span{color:#2b63ad;font-size:10px;font-weight:950}.detailHead h2{margin:7px 0 3px;font-size:24px}.detailHead p{margin:0;color:#718096}dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}dl div{padding:12px;border-radius:12px;background:#f7f9fc}dt{color:#718096;font-size:10px;font-weight:850}dd{margin:5px 0 0;font-weight:800}.documents{margin:0 0 18px;padding:14px;border:1px solid #dce6f2;border-radius:13px;background:#f7fbff}.documents>div{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px}.documents a,.documents span{padding:9px 11px;border-radius:9px;background:#e8f1fd;color:#174f91;font-size:11px;font-weight:900;text-decoration:none}.documents span{background:#f2f4f7;color:#7b8493}.documents small{color:#718096}label{display:grid;gap:7px;color:#34445a;font-size:12px;font-weight:850}textarea{min-height:100px;padding:12px;border:1px solid #d4dce7;border-radius:11px;font:inherit;resize:vertical}.reviewActions{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:8px;margin-top:12px}.reviewActions button{min-height:46px;border:0;border-radius:11px;font-weight:900}.reject{background:#fff1f2;color:#a31337}.change{background:#fff8e7;color:#8a5b08}.approve{background:#173e73;color:#fff}.manualNote{color:#718096;font-size:11px}.empty,.emptyDetail{padding:28px;color:#718096;text-align:center}.emptyDetail{display:grid;place-content:center;height:100%;box-sizing:border-box}.emptyDetail p{max-width:360px;line-height:1.6}@media(max-width:850px){.content{grid-template-columns:1fr}.requestList,.detail{min-height:auto}.title{align-items:start}.summary{display:none}}@media(max-width:560px){.opsReview{padding:12px 10px 50px}header{align-items:flex-start;flex-direction:column;gap:16px}header>div{align-items:flex-start;flex-direction:column;gap:9px}header nav{width:100%;justify-content:flex-end}header span{padding:0;border:0}.title h1{font-size:27px}.content{gap:10px}dl{grid-template-columns:1fr}.detail{padding:17px}.reviewActions{grid-template-columns:1fr}.reviewActions button{min-height:48px}}
      `}</style>
      <style jsx global>{`
        .opsReview .opsHeaderActions a,
        .opsReview .opsHeaderActions button { display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:0 12px;white-space:nowrap;flex:0 0 auto; }
        .opsReview .opsHeaderActions svg { display:block;width:15px;height:15px;flex:0 0 15px; }
        @media(max-width:560px){ .opsReview .opsHeaderActions { width:100%;justify-content:flex-end; } }
      `}</style>
    </main>
  );
}

function statusLabel(status: string) { return ({ submitted: "검토 대기", changes_requested: "보완 요청", approved: "승인 완료", rejected: "거절" } as Record<string,string>)[status] || status; }
function businessTypeLabel(type?: string) { return type === "sole_proprietor" ? "개인사업자" : type === "corporation" ? "법인사업자" : "기타"; }
function formatDate(raw: string | null) { if (!raw) return "-"; return new Date(raw).toLocaleString("ko-KR", { hour12: false }); }
