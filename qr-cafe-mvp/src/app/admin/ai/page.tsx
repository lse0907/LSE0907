"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import { getCurrentStoreId } from "@/app/lib/currentStore";

type Brief = {
  stage: "data_waiting" | "data_collection" | "observation";
  headline: string;
  totalOrders: number;
  todayOrders: number;
  todaySales: number;
  confidence: "low" | "medium";
  fact: string;
  hypothesis: string | null;
  recommendation: string | null;
};

type BriefPeriod = "daily" | "weekly" | "monthly";

type StoredBrief = {
  id: string;
  brief_period: BriefPeriod;
  period_start: string;
  period_end: string;
  headline: string;
  summary: string;
  brief_status: string;
  data_confidence: "insufficient" | "low" | "medium" | "high";
  generated_at: string;
  source_order_count: number;
  source_sales_won: number;
};

type BriefFeedback = {
  brief_id: string;
  rating: "helpful" | "neutral" | "unhelpful";
  reason_code: string | null;
  note: string | null;
  updated_at: string;
};

function money(value: number) {
  return `${Math.max(0, value || 0).toLocaleString()}원`;
}

function periodLabel(period: BriefPeriod) {
  return period === "daily" ? "일간" : period === "weekly" ? "주간" : "월간";
}

function historyDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}

function AiIcon({ name }: { name: "sparkle" | "fact" | "proposal" | "shield" }) {
  const paths = {
    sparkle: <><path d="m12 2 1.2 4.2L17.5 7.5l-4.3 1.2L12 13l-1.2-4.3-4.3-1.2 4.3-1.3L12 2Z" /><path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></>,
    fact: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.5" /><path d="M12 16h.01" /></>,
    proposal: <><path d="M8.4 18.5h7.2" /><path d="M9 21h6" /><path d="M8.7 15.7A6.5 6.5 0 1 1 15.3 15.7c-.8.7-1.3 1.5-1.4 2.3h-3.8c-.1-.8-.6-1.6-1.4-2.3Z" /></>,
    shield: <><path d="M12 3.2 4.8 6v5.1c0 4.5 2.9 7.7 7.2 9.2 4.3-1.5 7.2-4.7 7.2-9.2V6L12 3.2Z" /><path d="m9.4 11.8 1.7 1.7 3.7-3.7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function stageMeta(stage: Brief["stage"]) {
  if (stage === "data_waiting") return { label: "데이터 대기", description: "첫 주문을 기다리고 있습니다." };
  if (stage === "data_collection") return { label: "데이터 수집 중", description: "기록을 쌓아 분석의 신뢰도를 높이는 단계입니다." };
  return { label: "초기 관찰", description: "주문 흐름을 비교해 살펴보는 단계입니다." };
}

function nextStepFor(stage: Brief["stage"], recommendation: string | null) {
  if (stage === "data_waiting") return { title: "첫 주문이 들어오면 알려드릴게요", body: "지금은 별도로 설정할 일이 없습니다. 첫 주문부터 이 매장만의 기록을 차근차근 쌓습니다.", label: "기록 시작 전" };
  if (stage === "data_collection") return { title: "평소처럼 운영해 주세요", body: "주문 기록이 쌓이면 매장 흐름의 변화와 확인해 볼 일을 근거와 함께 알려드립니다.", label: "기록 수집 중" };
  return { title: "이번 주 제안을 확인해 보세요", body: recommendation || "매장 흐름을 바탕으로 확인해 볼 한 가지를 준비했습니다.", label: "관찰 제안" };
}

function AiBriefContent() {
  const params = useSearchParams();
  const storeId = (params.get("store") || getCurrentStoreId() || "").trim();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");
  const [historyPeriod, setHistoryPeriod] = useState<BriefPeriod>("daily");
  const [history, setHistory] = useState<StoredBrief[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [feedbackByBrief, setFeedbackByBrief] = useState<Record<string, BriefFeedback>>({});
  const [feedbackBusy, setFeedbackBusy] = useState("");
  const [unhelpfulBriefId, setUnhelpfulBriefId] = useState("");

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    fetch(`/api/admin/ai-brief?store=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload?.brief) throw new Error(String(payload?.message || "AI 브리핑을 불러오지 못했습니다."));
        return payload.brief as Brief;
      })
      .then((nextBrief) => {
        setError("");
        setBrief(nextBrief);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setBrief(null);
          setError(reason instanceof Error ? reason.message : "AI 브리핑을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const controller = new AbortController();
    fetch(`/api/admin/ai-brief-history?store=${encodeURIComponent(storeId)}&period=${historyPeriod}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload?.briefs)) throw new Error("AI 브리핑 기록을 불러오지 못했습니다.");
        return payload.briefs as StoredBrief[];
      })
      .then((nextHistory) => setHistory(nextHistory))
      .catch(() => {
        if (!controller.signal.aborted) setHistory([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [historyPeriod, storeId]);

  useEffect(() => {
    if (!storeId || !history.length) return;
    const controller = new AbortController();
    fetch(`/api/admin/ai-brief-feedback?store=${encodeURIComponent(storeId)}&briefs=${encodeURIComponent(history.map((item) => item.id).join(","))}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload.feedback)) throw new Error("AI_BRIEF_FEEDBACK_LOAD_FAILED");
        return payload.feedback as BriefFeedback[];
      })
      .then((items) => { if (!controller.signal.aborted) setFeedbackByBrief(Object.fromEntries(items.map((item) => [item.brief_id, item]))); })
      .catch(() => { if (!controller.signal.aborted) setFeedbackByBrief({}); });
    return () => controller.abort();
  }, [history, storeId]);

  const saveFeedback = async (briefId: string, rating: BriefFeedback["rating"], reasonCode: string | null = null) => {
    if (!storeId || feedbackBusy) return;
    setFeedbackBusy(briefId);
    try {
      const response = await fetch("/api/admin/ai-brief-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: storeId, briefId, rating, reasonCode }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload.feedback) throw new Error(String(payload?.message || "평가를 저장하지 못했습니다."));
      setFeedbackByBrief((current) => ({ ...current, [briefId]: { ...payload.feedback, brief_id: briefId } }));
      setUnhelpfulBriefId("");
    } finally { setFeedbackBusy(""); }
  };

  const meta = useMemo(() => (brief ? stageMeta(brief.stage) : null), [brief]);
  const nextStep = useMemo(() => (brief ? nextStepFor(brief.stage, brief.recommendation) : null), [brief]);

  return <main className="aiBriefPage">
    <style>{styles}</style>
    <AdminPageHeader title="RION Insight AI 브리핑" description="주문 흐름의 사실과 AI 해석, 다음 관찰 포인트를 구분해 안내합니다." storeId={storeId} eyebrow="RION INSIGHT" />
    {!storeId ? <section className="aiNotice" role="alert">먼저 관리자 홈에서 매장을 선택해 주세요.</section> : null}
    {storeId && !brief && !error ? <section className="aiLoading" aria-live="polite"><span /><div><strong>AI 브리핑을 준비하고 있습니다.</strong><p>선택한 매장의 주문 흐름만 확인하고 있습니다.</p></div><Image className="aiLoadingGuide" src="/brand/rio-ai-guide-transparent.png" alt="AI 브리핑을 준비하는 리오" width={72} height={72} sizes="72px" priority /></section> : null}
    {error ? <section className="aiNotice" role="alert">{error}</section> : null}
    {brief && meta ? <>
      <section className="aiHero" aria-labelledby="ai-headline"><div><span className="aiEyebrow"><AiIcon name="sparkle" />RION INSIGHT</span><h2 id="ai-headline">{brief.headline}</h2><p>{meta.description}</p></div><div className="aiHeroSide"><span className="aiStage">{meta.label}</span>{brief.stage !== "observation" ? <Image className="aiGuide" src="/brand/rio-ai-guide-transparent.png" alt="주문 기록을 정리하는 리오" width={106} height={106} sizes="106px" priority /> : null}</div></section>
      {nextStep ? <section className="aiNext" aria-label="지금 확인할 내용"><span className="aiNextIcon"><AiIcon name="proposal" /></span><div><span className="aiSectionLabel">지금 확인할 내용</span><h2>{nextStep.title}</h2><p>{nextStep.body}</p></div><div className="aiNextActions"><span className="aiNextLabel">{nextStep.label}</span><Link href={`/admin/ai/experiments?store=${encodeURIComponent(storeId)}`} className="aiExperimentLink">실험 관리</Link></div></section> : null}
      <details className="aiDetails"><summary><span><span className="aiDetailsIcon"><AiIcon name="fact" /></span><span><b>매장 현황과 분석 근거</b><small>오늘의 주문 현황과 AI가 확인한 내용을 볼 수 있어요.</small></span></span><span className="aiDetailsHint">펼쳐 보기</span></summary><div className="aiDetailsBody"><section className="aiMetrics" aria-label="오늘의 매장 신호"><span><b>오늘 주문</b><strong>{brief.todayOrders.toLocaleString()}건</strong></span><i /><span><b>오늘 매출</b><strong>{money(brief.todaySales)}</strong></span><i /><span><b>수집 주문</b><strong>{brief.totalOrders.toLocaleString()}건</strong></span></section><div className="aiInsight"><div className="aiPanelHeading"><span className="aiPanelIcon fact"><AiIcon name="fact" /></span><div><h2>AI가 확인한 내용</h2><p>기록된 주문 데이터로 확인한 사실입니다.</p></div></div><p className="aiFact">{brief.fact}</p><div className="aiEvidence"><span>분석 기준</span><strong>최근 8주 주문 기록 · 신뢰도 {brief.confidence === "medium" ? "중간" : "초기"}</strong></div>{brief.hypothesis ? <div className="aiHypothesis"><strong>가능한 원인</strong><p>{brief.hypothesis}</p></div> : null}<div className="aiSafety"><AiIcon name="shield" /><span>AI는 메뉴·가격·쿠폰·주문 설정을 직접 바꾸지 않습니다.</span></div></div></div></details>
      <details className="aiHistory" aria-label="지난 AI 브리핑"><summary><span><b>지난 브리핑</b><small>일간·주간·월간으로 저장된 안내를 다시 볼 수 있어요.</small></span><span className="aiDetailsHint">이력 보기</span></summary><div className="aiHistoryBody">
        <div className="aiHistoryHead"><div><h2>지난 브리핑</h2><p>생성 당시의 데이터와 안내 내용을 다시 확인할 수 있습니다.</p></div><span>매장별 기록</span></div>
        <div className="aiHistoryTabs" role="tablist" aria-label="브리핑 기간">
          {(["daily", "weekly", "monthly"] as BriefPeriod[]).map((period) => <button key={period} type="button" role="tab" aria-selected={historyPeriod === period} className={historyPeriod === period ? "active" : ""} onClick={() => { setHistoryLoading(true); setHistoryPeriod(period); }}>{periodLabel(period)}</button>)}
        </div>
        {historyLoading ? <p className="aiHistoryEmpty">브리핑 기록을 확인하고 있습니다.</p> : null}
        {!historyLoading && history.length < 1 ? <p className="aiHistoryEmpty">저장된 {periodLabel(historyPeriod)} 브리핑이 생기면 이곳에서 다시 볼 수 있습니다.</p> : null}
        {!historyLoading && history.map((item) => {
          const feedback = feedbackByBrief[item.id];
          const isChoosingReason = unhelpfulBriefId === item.id;
          return <article className="aiHistoryRow" key={item.id}><time>{historyDate(item.period_start)}</time><div><strong>{item.headline}</strong><p>{item.summary}</p><div className="aiFeedback" aria-label="브리핑 평가"><div><b>이 브리핑이 도움이 됐나요?</b><span>평가는 다음 브리핑을 개선하는 데만 사용됩니다.</span></div>{feedback ? <p className="aiFeedbackSaved">{feedback.rating === "helpful" ? "도움 됐어요" : feedback.rating === "neutral" ? "보통이에요" : "도움이 안 됐어요"} · 평가 저장됨</p> : <div className="aiFeedbackChoices"><button type="button" disabled={feedbackBusy === item.id} onClick={() => saveFeedback(item.id, "helpful")}>도움 됐어요</button><button type="button" disabled={feedbackBusy === item.id} onClick={() => saveFeedback(item.id, "neutral")}>보통이에요</button><button type="button" disabled={feedbackBusy === item.id} onClick={() => setUnhelpfulBriefId(isChoosingReason ? "" : item.id)}>도움이 안 됐어요</button></div>}{isChoosingReason && !feedback ? <div className="aiFeedbackReasons"><span>가장 가까운 이유를 선택해 주세요.</span><button type="button" onClick={() => saveFeedback(item.id, "unhelpful", "need_evidence")}>근거 수치가 부족해요</button><button type="button" onClick={() => saveFeedback(item.id, "unhelpful", "not_actionable")}>실행하기 어려워요</button><button type="button" onClick={() => saveFeedback(item.id, "unhelpful", "not_relevant")}>매장 상황과 달라요</button></div> : null}</div></div><span className="aiHistoryStatus">{item.data_confidence === "high" || item.data_confidence === "medium" ? "관찰 완료" : "데이터 수집"}</span></article>;
        })}
      </div></details>
    </> : null}
  </main>;
}

const styles = `
.aiBriefPage{max-width:920px;margin:0 auto;padding:16px;display:grid;gap:12px;color:#182641}.aiHero{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 24px;border:1px solid #173c75;border-radius:18px;background:linear-gradient(128deg,#10284f 0%,#1c477f 100%);box-shadow:0 12px 28px rgba(19,51,101,.15);color:#fff}.aiHero>div{min-width:0}.aiHeroSide{display:flex;align-items:flex-end;flex-direction:column;gap:8px}.aiGuide{display:block;object-fit:contain;filter:drop-shadow(0 8px 12px rgba(3,17,46,.25))}.aiEyebrow,.aiSectionLabel{display:inline-flex;align-items:center;gap:6px;color:#a9ceff;font-size:10px;font-weight:900;letter-spacing:.1em}.aiEyebrow{margin-bottom:9px}.aiEyebrow svg{width:14px;height:14px}.aiHero h2{margin:0;font-size:clamp(21px,2.5vw,28px);line-height:1.3;letter-spacing:-.035em}.aiHero p{max-width:600px;margin:8px 0 0;color:#d7e5fa;font-size:13px;font-weight:650;line-height:1.55}.aiStage{border:1px solid #cae1ff;border-radius:999px;background:#eef6ff;color:#174e94;padding:7px 10px;font-size:11px;font-weight:900;white-space:nowrap}.aiNext{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:12px;align-items:center;padding:17px 18px;border:1px solid #c7dcfa;border-radius:16px;background:#f3f7ff}.aiNextIcon,.aiDetailsIcon,.aiPanelIcon{display:grid;place-items:center;flex:0 0 auto;border-radius:12px}.aiNextIcon{width:40px;height:40px;background:#dceaff;color:#1e5aa4}.aiNextIcon svg,.aiDetailsIcon svg{width:19px;height:19px}.aiNext h2{margin:4px 0 0;color:#1c3357;font-size:16px;letter-spacing:-.025em}.aiNext p{margin:5px 0 0;color:#536a8c;font-size:12px;font-weight:650;line-height:1.55}.aiNextLabel{border-radius:999px;background:#fff;color:#2f609d;padding:6px 9px;font-size:11px;font-weight:850;white-space:nowrap}.aiDetails,.aiHistory{border:1px solid #dbe5f2;border-radius:16px;background:#fff;box-shadow:0 6px 16px rgba(33,61,105,.045)}.aiDetails summary,.aiHistory summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;cursor:pointer;list-style:none}.aiDetails summary::-webkit-details-marker,.aiHistory summary::-webkit-details-marker{display:none}.aiDetails summary>span:first-child{display:flex;align-items:center;gap:10px}.aiDetailsIcon{width:32px;height:32px;background:#e9f2ff;color:#235da9}.aiDetails b,.aiHistory summary b{display:block;color:#263e60;font-size:14px}.aiDetails small,.aiHistory summary small{display:block;margin-top:3px;color:#77869a;font-size:11px;font-weight:650;line-height:1.4}.aiDetailsHint{color:#52729a;font-size:11px;font-weight:850;white-space:nowrap}.aiDetails[open] summary,.aiHistory[open] summary{border-bottom:1px solid #e8edf5}.aiDetailsBody,.aiHistoryBody{padding:16px 18px 18px}.aiMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.aiMetrics article{padding:13px;border:1px solid #e0e9f5;border-radius:12px;background:#fafcff}.aiMetrics span{display:block;color:#6a7890;font-size:11px;font-weight:800}.aiMetrics strong{display:block;margin-top:6px;color:#172b4c;font-size:21px;letter-spacing:-.035em}.aiMetrics small{display:block;margin-top:4px;color:#8794a8;font-size:10px;font-weight:650}.aiInsight{margin-top:12px;padding:16px;border:1px solid #e0e9f5;border-radius:13px}.aiPanelHeading{display:flex;align-items:flex-start;gap:10px}.aiPanelIcon{width:32px;height:32px;background:#e9f2ff;color:#235da9}.aiPanelIcon svg{width:16px;height:16px}.aiPanelHeading h2{margin:0;color:#1c2d48;font-size:14px}.aiPanelHeading p{margin:3px 0 0;color:#728199;font-size:11px;font-weight:650;line-height:1.45}.aiFact{margin:15px 0 0;padding-left:12px;border-left:3px solid #3d7ad2;color:#334a6c;font-size:13px;font-weight:700;line-height:1.65}.aiEvidence{display:grid;gap:4px;margin-top:14px;padding-top:12px;border-top:1px solid #e8edf5}.aiEvidence span{color:#7a879b;font-size:10px;font-weight:800}.aiEvidence strong{color:#405574;font-size:11px;line-height:1.45}.aiHypothesis{margin-top:12px;padding:11px 12px;border-radius:10px;background:#f7f9fc;color:#52647f}.aiHypothesis strong{font-size:11px;color:#2d466b}.aiHypothesis p{margin:4px 0 0;font-size:11px;font-weight:650;line-height:1.6}.aiSafety{display:flex;align-items:flex-start;gap:7px;margin-top:12px;color:#718098;font-size:11px;font-weight:650;line-height:1.5}.aiSafety svg{width:14px;height:14px;flex:0 0 auto;margin-top:1px}.aiHistoryHead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.aiHistoryHead h2{margin:0;color:#1c2d48;font-size:15px}.aiHistoryHead p{margin:4px 0 0;color:#728199;font-size:11px;font-weight:650;line-height:1.45}.aiHistoryHead>span{color:#6d7e96;font-size:11px;font-weight:800;white-space:nowrap}.aiHistoryTabs{display:flex;gap:7px;margin-top:14px;padding-bottom:11px;border-bottom:1px solid #e8edf5}.aiHistoryTabs button{border:1px solid #d5e0ee;border-radius:999px;background:#fff;color:#60718b;padding:7px 11px;font:inherit;font-size:12px;font-weight:800}.aiHistoryTabs button.active{border-color:#1c4b89;background:#1c4b89;color:#fff}.aiHistoryEmpty{margin:0;padding:15px 0 1px;color:#718098;font-size:12px;font-weight:650}.aiHistoryRow{display:grid;grid-template-columns:70px minmax(0,1fr) auto;gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid #edf1f6}.aiHistoryRow:last-child{border-bottom:0;padding-bottom:0}.aiHistoryRow time{color:#315070;font-size:12px;font-weight:800}.aiHistoryRow strong{display:block;color:#2b405f;font-size:13px;line-height:1.45}.aiHistoryRow p{margin:3px 0 0;color:#77869a;font-size:12px;font-weight:650;line-height:1.45}.aiHistoryStatus{border-radius:999px;background:#edf7f1;color:#287151;padding:5px 8px;font-size:10px;font-weight:800;white-space:nowrap}.aiFeedback{display:grid;gap:8px;margin-top:13px;padding-top:12px;border-top:1px solid #e8edf5}.aiFeedback>div:first-child{display:grid;gap:3px}.aiFeedback b{color:#314b6f;font-size:12px}.aiFeedback span{color:#77869a;font-size:11px;font-weight:650;line-height:1.45}.aiFeedbackChoices,.aiFeedbackReasons{display:flex;flex-wrap:wrap;gap:6px}.aiFeedbackChoices button,.aiFeedbackReasons button{border:1px solid #d5e0ee;border-radius:8px;background:#fff;color:#395475;padding:7px 9px;font:inherit;font-size:11px;font-weight:800}.aiFeedbackChoices button:hover,.aiFeedbackReasons button:hover{border-color:#1d579e;color:#1d579e}.aiFeedbackChoices button:disabled{opacity:.55}.aiFeedbackReasons{align-items:center;padding:9px 10px;border-radius:9px;background:#f4f8fd}.aiFeedbackReasons>span{width:100%;color:#46627f}.aiFeedbackSaved{color:#287151!important;font-size:11px!important;font-weight:800!important}.aiNotice,.aiLoading{border:1px solid #dbe5f2;border-radius:15px;background:#fff;padding:17px;color:#51647f;font-size:13px;font-weight:700}.aiLoading{display:flex;align-items:center;gap:12px}.aiLoading>span{width:21px;height:21px;border:3px solid #d9e6f8;border-top-color:#245fae;border-radius:50%;animation:aiSpin .8s linear infinite}.aiLoading strong{color:#243c60}.aiLoading p{margin:3px 0 0;color:#718098;font-size:12px;font-weight:650}.aiLoadingGuide{width:58px;height:58px;object-fit:contain;margin-left:auto;filter:drop-shadow(0 5px 8px rgba(34,62,104,.12))}@keyframes aiSpin{to{transform:rotate(360deg)}}@media(max-width:720px){.aiBriefPage{padding:12px;gap:10px}.aiHero{position:relative;display:block;min-height:150px;padding:17px 102px 17px 18px;border-radius:16px}.aiHeroSide{position:absolute;top:14px;right:15px;display:block}.aiGuide{position:absolute;top:31px;right:0;width:74px;height:74px}.aiNext{grid-template-columns:36px minmax(0,1fr);padding:15px}.aiNextIcon{width:36px;height:36px}.aiNextLabel{grid-column:2;justify-self:start}.aiDetails summary,.aiHistory summary{padding:14px 15px}.aiDetailsBody,.aiHistoryBody{padding:14px 15px 16px}.aiMetrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.aiMetrics article:last-child{grid-column:1/-1}.aiHistoryHead{display:block}.aiHistoryHead>span{display:block;margin-top:6px}.aiHistoryRow{grid-template-columns:61px minmax(0,1fr);gap:9px}.aiHistoryStatus{grid-column:2;justify-self:start}.aiFeedbackChoices button,.aiFeedbackReasons button{min-height:34px}}@media(prefers-reduced-motion:reduce){.aiLoading>span{animation-duration:1.8s}}
/* Dense values are supporting evidence, not three dashboard cards. */
.aiMetrics{display:flex;align-items:center;gap:13px;padding:11px 13px;border:1px solid #e0e9f5;border-radius:12px;background:#fafcff}.aiMetrics>span{display:grid;gap:3px;min-width:0;flex:1}.aiMetrics b{color:#6a7890;font-size:10px;font-weight:800}.aiMetrics strong{margin:0;color:#172b4c;font-size:16px;letter-spacing:-.03em;white-space:nowrap}.aiMetrics i{width:1px;height:28px;background:#dfe8f4}.aiMetrics article{display:none}@media(max-width:720px){.aiMetrics{gap:8px;padding:10px}.aiMetrics strong{font-size:14px}.aiMetrics i{height:24px}}
.aiNextActions{display:grid;justify-items:end;gap:6px}.aiExperimentLink{color:#245b9d;font-size:11px;font-weight:850;text-decoration:none}.aiExperimentLink:hover{text-decoration:underline}@media(max-width:720px){.aiNextActions{grid-column:2;justify-items:start}.aiNextLabel{grid-column:auto}}
`;

export default function AdminAiBriefPage() {
  return <Suspense fallback={<main className="aiBriefPage"><p>AI 브리핑을 준비하고 있습니다.</p></main>}><AiBriefContent /></Suspense>;
}
