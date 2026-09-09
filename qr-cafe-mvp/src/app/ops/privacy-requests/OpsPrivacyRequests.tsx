"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RionBrand from "@/app/components/RionBrand";
import OpsIcon from "../_components/OpsIcon";
import { availablePrivacyActions, isPrivacyExecution, privacyActions, privacyStatuses, privacyTypes, validatePrivacyInput, type PrivacyRequest, type PrivacyDetail } from "@/app/lib/privacyRequests";
import styles from "./privacy.module.css";

const sampleRequests: PrivacyRequest[] = [
  { id: "10000000-0000-0000-0000-000000000001", subject_user_id: "20000000-0000-0000-0000-000000000001", audience: "customer", request_type: "deletion", status: "in_review", requested_at: "2026-09-03T01:10:00Z", updated_at: "2026-09-03T01:20:00Z", decision_summary: "선택 전화번호 삭제 요청을 검토 중입니다.", request_detail: { note: "고객 프로필에 등록한 선택 전화번호를 삭제해 주세요." } },
  { id: "10000000-0000-0000-0000-000000000002", subject_user_id: "20000000-0000-0000-0000-000000000002", audience: "owner", request_type: "access", status: "received", requested_at: "2026-09-03T02:00:00Z", updated_at: "2026-09-03T02:00:00Z", decision_summary: null, request_detail: { note: "사업자 계정의 이름과 등록 연락처를 확인하고 싶습니다." } },
  { id: "10000000-0000-0000-0000-000000000003", subject_user_id: "20000000-0000-0000-0000-000000000003", audience: "customer", request_type: "correction", status: "in_review", requested_at: "2026-09-03T03:00:00Z", updated_at: "2026-09-03T03:00:00Z", decision_summary: "정정할 정보를 확인 중입니다.", request_detail: { note: "고객 프로필 이름을 테스트 회원으로 정정해 주세요." } },
  { id: "10000000-0000-0000-0000-000000000004", subject_user_id: "20000000-0000-0000-0000-000000000004", audience: "owner", request_type: "restriction", status: "partially_completed", requested_at: "2026-09-03T04:00:00Z", updated_at: "2026-09-03T04:00:00Z", decision_summary: "마케팅 수신은 중단했습니다. 계약 관련 정보 처리 범위는 추가 검토 중입니다.", request_detail: { note: "마케팅과 계약 관련 정보 처리를 중단하고 싶습니다." } },
];
const formatDate = (value: string) => new Date(value).toLocaleString("ko-KR", { hour12: false });
const audienceLabel = (value: string) => value === "customer" ? "고객 서비스" : "사업자 서비스";

export default function OpsPrivacyRequests({ preview = false, embedded = false }: { preview?: boolean; embedded?: boolean }) {
  const [samples, setSamples] = useState(sampleRequests);
  const [rows, setRows] = useState<PrivacyRequest[]>([]);
  const [filter, setFilter] = useState("open");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PrivacyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [action, setAction] = useState("");
  const [summary, setSummary] = useState("");
  const [value, setValue] = useState("");
  const [resolvesRequest, setResolvesRequest] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        if (preview) {
          setRows(samples.filter((row) => filter === "all" || (filter === "open" ? availablePrivacyActions(row).length > 0 : row.status === filter)));
          setHasMore(false);
        } else {
          const response = await fetch(`/api/ops/privacy-requests?status=${filter}&page=${page}`, { cache: "no-store", signal: controller.signal });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.message || "요청을 불러오지 못했습니다.");
          setRows(payload.requests); setHasMore(payload.hasMore);
        }
      } catch (error) {
        if (!controller.signal.aborted) { setRows([]); setMessage(error instanceof Error ? error.message : "목록 조회에 실패했습니다."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [filter, page, preview, revision, samples]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadDetail() {
      setDetail(null); setConfirming(false); setAction(""); setSummary(""); setValue(""); setResolvesRequest(false);
      if (!selectedId) return;
      setDetailLoading(true);
      try {
        if (preview) {
          const request = samples.find((row) => row.id === selectedId);
          if (request) setDetail({ request, events: [{ id: 1, event_type: "rights_request_received", actor_type: "subject", actor_user_id: request.subject_user_id, occurred_at: request.requested_at, metadata: {} }] });
        } else {
          const response = await fetch(`/api/ops/privacy-requests?requestId=${selectedId}`, { cache: "no-store", signal: controller.signal });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload.message || "상세 조회에 실패했습니다.");
          setDetail(payload);
        }
      } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "상세 조회에 실패했습니다."); }
      finally { if (!controller.signal.aborted) setDetailLoading(false); }
    }
    void loadDetail();
    return () => controller.abort();
  }, [selectedId, preview, revision, samples]);

  useEffect(() => {
    if (!confirming) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) setConfirming(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirming, busy]);

  function prepare() {
    const problem = validatePrivacyInput(action, summary, value);
    if (problem) { setMessage(problem); return; }
    setMessage(""); setConfirming(true);
  }
  async function processRequest() {
    if (!detail || busy || !availablePrivacyActions(detail.request).includes(action)) return;
    const problem = validatePrivacyInput(action, summary, value);
    if (problem) { setMessage(problem); setConfirming(false); return; }
    setBusy(true);
    try {
      if (preview) {
        const status = action === "review" ? "in_review" : action === "identity_required" ? "identity_verification_required" : action === "reject" ? "rejected" : resolvesRequest ? "completed" : "partially_completed";
        setSamples((current) => current.map((row) => row.id === detail.request.id ? { ...row, status, decision_summary: `[미리보기] ${summary}`, updated_at: new Date().toISOString() } : row));
        setMessage("미리보기 상태만 변경했습니다. 실제 정보나 요청은 변경하지 않았습니다.");
      } else {
        const response = await fetch("/api/ops/privacy-requests", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: detail.request.id, expectedVersion: detail.request.updated_at, action, summary, value, resolvesRequest }) });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || "처리에 실패했습니다. 최신 상태를 확인하세요.");
        setMessage("처리 결과와 이력을 저장했습니다. 회원 화면에서 안내를 확인할 수 있습니다.");
        setRevision((current) => current + 1);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리 결과를 확인하지 못했습니다. 새로고침 후 상태를 확인해 주세요."); }
    finally { setBusy(false); setConfirming(false); }
  }

  const request = detail?.request;
  const choices = request ? availablePrivacyActions(request) : [];
  const execution = Boolean(action) && isPrivacyExecution(action);
  return <main className={`${styles.page} ${embedded ? styles.embedded : ""}`}>
    {!embedded ? <header className={styles.header}><RionBrand product inverse /><nav><Link href="/ops"><OpsIcon name="home" />OPS 홈</Link><button disabled={busy} onClick={() => { setMessage(""); setRevision((current) => current + 1); }}><OpsIcon name="refresh" />새로고침</button></nav></header> : null}
    {preview && <p className={styles.preview}>디자인·동작 미리보기 · 가상 요청만 표시합니다. 실제 DB 조회·처리는 하지 않습니다.</p>}
    <nav className={styles.filters} aria-label="요청 상태 필터">{[["open", "처리할 요청"], ["completed", "완료"], ["rejected", "처리 제한"], ["all", "전체"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} disabled={busy} className={filter === key ? styles.selected : ""} onClick={() => { setFilter(key); setPage(0); setSelectedId(null); }}>{label}</button>)}</nav>
    {message && <p role="status" className={styles.message}>{message}</p>}
    <div className={styles.layout}>
      <section className={styles.list} aria-label="개인정보 요청 목록"><div className={styles.listHead}><h2>요청 목록</h2><small>{loading ? "불러오는 중" : `${rows.length}건 표시`}</small></div>
        {loading ? <p className={styles.empty}>요청을 불러오고 있습니다.</p> : rows.length ? rows.map((row) => <button key={row.id} disabled={busy} aria-pressed={selectedId === row.id} className={`${styles.row} ${selectedId === row.id ? styles.activeRow : ""}`} onClick={() => { setSelectedId(row.id); setMessage(""); }}><span className={styles.rowMeta}>{audienceLabel(row.audience)}<span className={styles.badge}>{privacyStatuses[row.status] || row.status}</span></span><strong>{privacyTypes[row.request_type]}</strong><small>회원 {row.subject_user_id?.slice(0, 8)} · 요청 {row.id.slice(-6)}</small><time>{formatDate(row.requested_at)}</time></button>) : <p className={styles.empty}>해당 상태의 요청이 없습니다.</p>}
        {!preview && <div className={styles.pagination}><button disabled={page === 0 || loading || busy} onClick={() => { setPage(page - 1); setSelectedId(null); }}>이전</button><span>{page + 1} 페이지</span><button disabled={!hasMore || loading || busy} onClick={() => { setPage(page + 1); setSelectedId(null); }}>다음</button></div>}
      </section>
      <section className={styles.detail} aria-label="요청 상세">{detailLoading ? <p className={styles.empty}>상세 내용을 불러오고 있습니다.</p> : request ? <>
        <div className={styles.detailHead}><small>{audienceLabel(request.audience)} · 요청 {request.id.slice(-6)}</small><h2>{privacyTypes[request.request_type]}</h2><span className={styles.badge}>{privacyStatuses[request.status] || request.status}</span></div>
        <dl className={styles.meta}><div><dt>회원 식별번호</dt><dd>{request.subject_user_id}</dd></div><div><dt>접수일</dt><dd>{formatDate(request.requested_at)}</dd></div></dl>
        <section className={styles.requestNote}><h3>회원 요청</h3><p>{request.request_detail?.note || "추가 설명이 없습니다. 처리 범위를 먼저 확인해 주세요."}</p></section>
        {request.decision_summary && <section className={styles.result}><h3>현재 회원 안내</h3><p>{request.decision_summary}</p></section>}
        {choices.length ? <fieldset disabled={busy} className={styles.form}><legend>검토 및 처리</legend>
          <p className={styles.hint}>실제 처리 전 ‘검토 중’ 상태가 필요합니다. 지원 범위 밖의 요청은 검토 상태로 유지하고 필요한 절차를 안내하세요.</p>
          <label>처리 방법<select value={action} onChange={(event) => { setAction(event.target.value); setValue(""); setResolvesRequest(false); }}><option value="">처리 방법 선택</option>{choices.map((key) => <option key={key} value={key}>{privacyActions[key].label}</option>)}</select></label>
          {action && <p className={styles.scope}>{privacyActions[action].description}</p>}
          {action.startsWith("correct_customer_") && <label>정정할 {action.endsWith("name") ? "이름" : "전화번호"}<input value={value} maxLength={action.endsWith("name") ? 80 : 24} onChange={(event) => setValue(event.target.value)} autoComplete="off" /></label>}
          <label>회원에게 전달할 안내<textarea value={summary} maxLength={1000} onChange={(event) => setSummary(event.target.value)} placeholder="처리한 범위와 남은 사항 또는 제한 사유를 구체적으로 안내하세요." /></label>
          <small className={styles.hint}>회원에게 그대로 표시됩니다. 비밀번호·주민등록번호·내부 메모는 입력하지 마세요.</small>
          {execution && <label className={styles.coverage}><input type="checkbox" checked={resolvesRequest} onChange={(event) => setResolvesRequest(event.target.checked)} /><span>이 처리로 회원이 요청한 전체 범위가 해결되는지 확인했습니다.<small>선택하지 않으면 ‘일부 처리’로 남아 추가 검토할 수 있습니다.</small></span></label>}
          <button className={styles.primary} disabled={!action || busy} onClick={prepare}>처리 내용 확인</button>
        </fieldset> : <p className={styles.scope}>종결된 요청입니다. 중복 처리는 할 수 없습니다.</p>}
        <details className={styles.history}><summary>접수·처리 이력 (최근 {detail.events.length}건)</summary><ol>{detail.events.map((event) => <li key={event.id}><b>{event.metadata.action ? privacyActions[event.metadata.action]?.label || "처리 기록" : event.event_type === "ops_privacy_viewed" ? "OPS 상세 조회" : "요청 접수·시스템 기록"}</b><small>{formatDate(event.occurred_at)} · {event.actor_type === "ops" ? `OPS ${event.actor_user_id?.slice(0, 8) || "-"}` : event.actor_type === "subject" ? "회원" : "시스템"}</small>{event.metadata.to_status && <span>{privacyStatuses[event.metadata.to_status] || event.metadata.to_status}</span>}</li>)}</ol></details>
      </> : <div className={styles.empty}><h2>검토할 요청을 선택하세요</h2><p>요청 내용과 현재 처리 상태를 확인할 수 있습니다.</p></div>}</section>
    </div>
    {confirming && request && <div className={styles.backdrop} onKeyDown={(event) => {
      if (event.key === "Tab") { const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"); const first = buttons[0]; const last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}><section role="dialog" aria-modal="true" aria-labelledby="ops-privacy-confirm" className={styles.modal}><small>처리 전 최종 확인</small><h2 id="ops-privacy-confirm">{privacyActions[action].label}</h2><p>{audienceLabel(request.audience)} · 회원 {request.subject_user_id?.slice(0, 8)}</p><p>{privacyActions[action].description}</p>{value && <p>정정 값: <b>{value}</b></p>}<blockquote>{summary}</blockquote>{execution && <p>처리 후 상태: <b>{resolvesRequest ? "완료" : "일부 처리"}</b></p>}<div><button autoFocus disabled={busy} onClick={() => setConfirming(false)}>취소</button><button className={styles.primary} disabled={busy} onClick={() => void processRequest()}>{busy ? "처리 중…" : preview ? "미리보기 처리" : "처리 실행"}</button></div></section></div>}
  </main>;
}
