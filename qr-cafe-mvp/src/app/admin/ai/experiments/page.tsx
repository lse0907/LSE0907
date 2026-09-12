"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { fetchStoreProfileFromDb } from "@/app/lib/storeProfile";

type Experiment = { id: string; source_brief_id: string; title: string; change_summary: string; duration_days: number; success_metric: string; success_threshold: string; guardrail_metric: string; status: "proposal" | "active" | "stopped" | "completed" | "stable" | "rejected"; result_status: "success" | "failed" | "inconclusive" | null; result_summary: string | null; started_at: string | null; ended_at: string | null; updated_at: string };
type Brief = { id: string; headline: string; recommendation: string | null; period_start: string };

const statusText: Record<Experiment["status"], string> = { proposal: "검토 전", active: "적용 중", stopped: "적용 중지", completed: "결과 확인", stable: "운영 기준", rejected: "보류" };

function ExperimentPageContent() {
  const params = useSearchParams();
  const storeId = (params.get("store") || getCurrentStoreId() || "").trim();
  const [storeName, setStoreName] = useState(() => storeId ? "매장 정보 확인 중" : "");
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [proposal, setProposal] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [confirmStart, setConfirmStart] = useState<Experiment | null>(null);
  const [confirmStop, setConfirmStop] = useState<Experiment | null>(null);
  const [complete, setComplete] = useState<Experiment | null>(null);
  const [resultStatus, setResultStatus] = useState<"success" | "failed" | "inconclusive">("inconclusive");
  const [resultSummary, setResultSummary] = useState("현재 기록만으로는 효과를 단정하기 어렵습니다. 추가 관찰이 필요합니다.");

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [experimentsRes, briefsRes] = await Promise.all([
        fetch(`/api/admin/ai-experiments?store=${encodeURIComponent(storeId)}`, { cache: "no-store" }),
        fetch(`/api/admin/ai-brief-history?store=${encodeURIComponent(storeId)}&period=weekly`, { cache: "no-store" }),
      ]);
      const [experimentBody, briefBody] = await Promise.all([experimentsRes.json().catch(() => null), briefsRes.json().catch(() => null)]);
      if (!experimentsRes.ok || !experimentBody?.ok) throw new Error(String(experimentBody?.message || "AI 운영 제안을 불러오지 못했습니다."));
      setExperiments(experimentBody.experiments || []);
      const used = new Set((experimentBody.experiments || []).map((item: Experiment) => item.source_brief_id));
      const next = Array.isArray(briefBody?.briefs) ? briefBody.briefs.find((item: Brief) => item.recommendation && !used.has(item.id)) : null;
      setProposal(next || null);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "AI 운영 제안을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;
    if (!storeId) return () => { active = false; };
    void fetchStoreProfileFromDb(storeId)
      .then((profile) => {
        if (active) setStoreName(profile?.storeName || "매장");
      })
      .catch(() => {
        if (active) setStoreName("매장");
      });

    return () => { active = false; };
  }, [storeId]);

  const act = async (payload: Record<string, unknown>, success: string) => {
    if (!storeId || busy) return;
    setBusy(String(payload.experimentId || payload.briefId || "action"));
    try {
      const response = await fetch("/api/admin/ai-experiments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: storeId, ...payload }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(String(body?.message || "처리하지 못했습니다."));
      setConfirmStart(null); setConfirmStop(null); setComplete(null); await load(); setMessage(success);
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리하지 못했습니다."); }
    finally { setBusy(""); }
  };

  return <main className="experimentPage"><style>{styles}</style><AdminPageHeader title="AI 운영 제안" description="주문 흐름을 분석해, 지금 검토할 만한 매장 운영 선택지를 제안합니다." storeId={storeId} storeName={storeName} eyebrow="RION ORDER AI" />
    {!storeId ? <p className="notice">먼저 관리자 홈에서 매장을 선택해 주세요.</p> : null}
    {message ? <p className="message" role="status">{message}</p> : null}
    <section className="safety"><span>✓</span><div><b>자동 변경 없음</b><p>AI 제안은 내용을 확인하고 점주가 직접 적용할 때만 진행됩니다.</p></div></section>
    {loading ? <section className="card empty">AI 운영 제안을 확인하고 있습니다.</section> : null}
    {!loading && proposal ? <section className="card proposal"><div className="head"><div><span className="eyebrow">AI OPERATION PROPOSAL</span><h2>이번 주 운영 제안</h2><p>아직 매장에는 아무 변경도 적용되지 않았습니다.</p></div><span className="badge">검토 전</span></div><h3>{proposal.headline}</h3><p className="summary">{proposal.recommendation}</p><div className="rules"><span><b>적용 기간</b>7일</span><span><b>확인 기준</b>같은 시간대 주문 흐름</span><span><b>주의할 점</b>취소율 상승 없음</span></div><div className="actions"><button disabled={Boolean(busy)} onClick={() => void act({ action: "create", briefId: proposal.id }, "AI 운영 제안을 검토 항목으로 저장했습니다.")}>제안 검토 시작</button><button className="plain" type="button">이번에는 보류</button></div></section> : null}
    {!loading && !proposal && !experiments.length && !message ? <section className="card empty emptyWithGuide"><Image className="emptyGuide" src="/brand/rio-ai-guide-transparent.png" alt="" aria-hidden="true" width={76} height={76} /><div><b>AI가 제안할 만큼의 주문 기록을 모으고 있어요.</b><p>주문 흐름이 쌓이면, 매장 운영에 도움이 되는 제안을 이곳에서 확인할 수 있습니다.</p></div></section> : null}
    {!loading && experiments.map((item) => <section className="card experiment" key={item.id}><div className="head"><div><span className="eyebrow">AI OPERATION RECORD</span><h2>{item.title}</h2></div><span className={`badge ${item.status}`}>{statusText[item.status]}</span></div><p className="summary">{item.change_summary}</p><div className="rules"><span><b>적용 기간</b>{item.duration_days}일</span><span><b>확인 기준</b>{item.success_metric}</span><span><b>주의할 점</b>{item.guardrail_metric}</span></div>{item.status === "active" ? <p className="activeInfo">적용 중인 제안은 언제든 중지할 수 있습니다. 중지 기록은 남고, 초기 범위에서는 시스템에서 되돌릴 설정이 없습니다.</p> : null}{item.status === "completed" && item.result_summary ? <p className="result"><b>{item.result_status === "success" ? "도움 됨" : item.result_status === "failed" ? "효과 없음" : "추가 관찰"}</b>{item.result_summary}</p> : null}<div className="actions">{item.status === "proposal" ? <button disabled={busy === item.id} onClick={() => setConfirmStart(item)}>내용 확인 후 적용</button> : null}{item.status === "active" ? <><button className="plain" disabled={busy === item.id} onClick={() => { setComplete(item); setResultStatus("inconclusive"); setResultSummary("현재 기록만으로는 효과를 단정하기 어렵습니다. 추가 관찰이 필요합니다."); }}>결과 기록</button><button className="danger" disabled={busy === item.id} onClick={() => setConfirmStop(item)}>적용 중지</button></> : null}{item.status === "completed" && item.result_status === "success" ? <button disabled={busy === item.id} onClick={() => void act({ action: "mark_stable", experimentId: item.id }, "도움이 확인된 운영 방식을 기준으로 관리합니다.")}>운영 기준으로 관리</button> : null}</div></section>)}
    {confirmStart ? <div className="backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="제안 적용 최종 확인"><span className="eyebrow">FINAL CHECK</span><h2>이 제안을 적용할까요?</h2><p>{confirmStart.change_summary}</p><ul><li>적용 기간: {confirmStart.duration_days}일</li><li>확인 기준: {confirmStart.success_metric}</li><li>중지하면 기록을 남기고 바로 종료합니다.</li></ul><strong>AI는 이 확인으로 매장 설정을 자동 변경하지 않습니다.</strong><div className="actions"><button className="plain" onClick={() => setConfirmStart(null)}>돌아가기</button><button disabled={busy === confirmStart.id} onClick={() => void act({ action: "approve_and_start", experimentId: confirmStart.id }, "점주의 적용 결정을 기록했습니다.")}>적용 시작</button></div></section></div> : null}
    {confirmStop ? <div className="backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="제안 적용 중지"><span className="eyebrow">STOP & RECORD</span><h2>적용을 중지할까요?</h2><p>적용 상태는 중지로 기록됩니다. 초기 범위에는 자동 변경이 없으므로, 시스템에서 되돌릴 설정은 없습니다.</p><div className="actions"><button className="plain" onClick={() => setConfirmStop(null)}>계속 적용</button><button className="danger" disabled={busy === confirmStop.id} onClick={() => void act({ action: "stop_and_rollback", experimentId: confirmStop.id, confirmStop: true }, "적용을 중지하고 기록을 남겼습니다.")}>중지 기록 남기기</button></div></section></div> : null}
    {complete ? <div className="backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="제안 결과 기록"><span className="eyebrow">RESULT REVIEW</span><h2>적용 결과를 기록할까요?</h2><label>결과 분류<select value={resultStatus} onChange={(event) => setResultStatus(event.target.value as typeof resultStatus)}><option value="inconclusive">추가 관찰</option><option value="success">도움 됨</option><option value="failed">효과 없음</option></select></label><label>판단 메모<textarea value={resultSummary} maxLength={1000} onChange={(event) => setResultSummary(event.target.value)} /></label><div className="actions"><button className="plain" onClick={() => setComplete(null)}>돌아가기</button><button disabled={busy === complete.id || !resultSummary.trim()} onClick={() => void act({ action: "complete", experimentId: complete.id, resultStatus, resultSummary }, "적용 결과를 기록했습니다.")}>결과 저장</button></div></section></div> : null}
  </main>;
}

const styles = `.experimentPage{max-width:920px;margin:0 auto;padding:16px;display:grid;gap:12px;color:#1d2e49}.safety,.card,.notice,.message{border:1px solid #dbe5f2;border-radius:16px;background:#fff;box-shadow:0 6px 16px rgba(33,61,105,.045)}.safety{display:flex;gap:11px;padding:16px 18px;background:#f4f8ff;border-color:#cddff8}.safety>span{display:grid;place-items:center;flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:#245fae;color:#fff;font-weight:900}.safety b{font-size:13px}.safety p{margin:4px 0 0;color:#607490;font-size:12px;line-height:1.55;font-weight:650}.card{padding:18px}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.eyebrow{display:block;color:#2d69ae;font-size:10px;font-weight:900;letter-spacing:.1em}.head h2{margin:5px 0 0;font-size:18px;letter-spacing:-.035em}.head p{margin:4px 0 0;color:#71829a;font-size:12px;font-weight:650}.badge{border-radius:999px;background:#edf4ff;color:#2d5f9c;padding:6px 9px;font-size:10px;font-weight:850;white-space:nowrap}.badge.active{background:#eaf7ef;color:#287151}.badge.stopped{background:#f9eeee;color:#9e4b50}.badge.stable{background:#e8f6ed;color:#26734f}.proposal h3{margin:17px 0 0;font-size:15px}.summary{margin:7px 0 0;color:#536b8b;font-size:13px;line-height:1.6;font-weight:650}.rules{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:15px}.rules span{padding:10px;border-radius:10px;background:#f7f9fc;color:#425d80;font-size:11px;font-weight:700;line-height:1.45}.rules b{display:block;margin-bottom:3px;color:#7a899e;font-size:10px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.actions button{border:1px solid #1d4f8e;border-radius:9px;background:#1d4f8e;color:#fff;padding:9px 11px;font:800 12px inherit}.actions button:disabled{opacity:.55}.actions .plain{border-color:#d3dfed;background:#fff;color:#405c7d}.actions .danger{border-color:#ecc8cb;background:#fff7f7;color:#a04048}.experiment{border-left:4px solid #cddff8}.activeInfo,.result{margin:14px 0 0;padding:11px 12px;border-radius:10px;background:#f4f8fd;color:#586f8e;font-size:12px;line-height:1.55;font-weight:650}.result b{margin-right:7px;color:#2d5f9c}.empty{color:#657892;font-size:13px;font-weight:650;line-height:1.6}.empty p{margin:5px 0 0}.emptyWithGuide{display:flex;align-items:center;gap:14px;background:linear-gradient(135deg,#fff 0%,#f7faff 100%)}.emptyGuide{width:76px;height:76px;object-fit:contain;flex:0 0 auto}.notice,.message{padding:14px 16px;color:#4b6482;font-size:13px;font-weight:700}.message{border-color:#cfe0f7;background:#f2f7ff}.backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:18px;background:rgba(19,38,69,.45)}.modal{width:min(100%,520px);padding:22px;border-radius:17px;background:#fff;box-shadow:0 18px 50px rgba(10,28,58,.3)}.modal h2{margin:7px 0 0;font-size:20px;letter-spacing:-.04em}.modal p,.modal li{color:#5b708d;font-size:13px;line-height:1.6;font-weight:650}.modal ul{padding-left:20px}.modal strong{display:block;margin-top:14px;padding:10px;border-radius:9px;background:#f4f8fd;color:#3f5f85;font-size:12px;line-height:1.5}.modal label{display:grid;gap:6px;margin-top:14px;color:#3d5677;font-size:12px;font-weight:800}.modal select,.modal textarea{width:100%;border:1px solid #d6e0ee;border-radius:9px;padding:10px;background:#fff;color:#263f61;font:inherit}.modal textarea{min-height:94px;resize:vertical}@media(max-width:720px){.experimentPage{padding:12px}.card{padding:15px}.rules{grid-template-columns:1fr}.head{display:block}.badge{display:inline-block;margin-top:8px}.emptyWithGuide{align-items:flex-start;gap:11px}.emptyGuide{width:62px;height:62px}.backdrop{align-items:end;padding:0}.modal{width:100%;border-radius:18px 18px 0 0}.actions button{min-height:40px}}`;

export default function AdminAiExperimentsPage() { return <Suspense fallback={<main className="experimentPage"><p>AI 운영 제안을 준비하고 있습니다.</p></main>}><ExperimentPageContent /></Suspense>; }
