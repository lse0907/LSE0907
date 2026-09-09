"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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

function money(value: number) {
  return `${Math.max(0, value || 0).toLocaleString()}원`;
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

function AiBriefContent() {
  const params = useSearchParams();
  const storeId = (params.get("store") || getCurrentStoreId() || "").trim();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState("");

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

  const meta = useMemo(() => (brief ? stageMeta(brief.stage) : null), [brief]);

  return <main className="aiBriefPage">
    <style>{styles}</style>
    <AdminPageHeader title="RION Insight AI 브리핑" description="주문 흐름의 사실과 AI 해석, 다음 관찰 포인트를 구분해 안내합니다." storeId={storeId} eyebrow="RION INSIGHT" />
    {!storeId ? <section className="aiNotice" role="alert">먼저 관리자 홈에서 매장을 선택해 주세요.</section> : null}
    {storeId && !brief && !error ? <section className="aiLoading" aria-live="polite"><span /><div><strong>AI 브리핑을 준비하고 있습니다.</strong><p>선택한 매장의 주문 흐름만 확인하고 있습니다.</p></div></section> : null}
    {error ? <section className="aiNotice" role="alert">{error}</section> : null}
    {brief && meta ? <>
      <section className="aiHero" aria-labelledby="ai-headline"><div><span className="aiEyebrow"><AiIcon name="sparkle" />AI STATUS</span><h2 id="ai-headline">{brief.headline}</h2><p>{meta.description}</p></div><span className="aiStage">{meta.label}</span></section>
      <section className="aiMetrics" aria-label="오늘의 매장 신호"><article><span>오늘 주문</span><strong>{brief.todayOrders.toLocaleString()}건</strong><small>오늘 접수된 주문</small></article><article><span>오늘 매출</span><strong>{money(brief.todaySales)}</strong><small>취소 주문 제외</small></article><article><span>수집 주문</span><strong>{brief.totalOrders.toLocaleString()}건</strong><small>이 매장 분석 기준</small></article></section>
      <div className="aiGrid">
        <section className="aiPanel"><div className="aiPanelHeading"><span className="aiPanelIcon fact"><AiIcon name="fact" /></span><div><h2>확인된 사실</h2><p>기록된 주문 데이터로 확인한 내용입니다.</p></div></div><p className="aiFact">{brief.fact}</p><div className="aiEvidence"><span>분석 기준</span><strong>최근 8주 주문 기록 · 신뢰도 {brief.confidence === "medium" ? "중간" : "초기"}</strong></div>{brief.hypothesis ? <div className="aiHypothesis"><strong>가능한 원인</strong><p>{brief.hypothesis}</p></div> : null}</section>
        <section className="aiPanel"><div className="aiPanelHeading"><span className="aiPanelIcon proposal"><AiIcon name="proposal" /></span><div><h2>이번 주 제안</h2><p>AI가 매장을 대신 변경하지 않는 관찰 제안입니다.</p></div></div><div className="aiProposal">{brief.recommendation || "현재는 데이터 수집을 우선합니다. 충분한 기록이 쌓이면, 비교 근거와 함께 실행 가능한 제안을 드립니다."}</div><div className="aiSafety"><AiIcon name="shield" /><span>메뉴·가격·쿠폰·주문 설정은 점주 승인 없이는 변경되지 않습니다.</span></div></section>
      </div>
    </> : null}
  </main>;
}

const styles = `
.aiBriefPage{max-width:1120px;margin:0 auto;padding:16px;display:grid;gap:14px;color:#182641}.aiHero{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:23px 24px;border:1px solid #173c75;border-radius:18px;background:linear-gradient(128deg,#10284f 0%,#1c477f 100%);box-shadow:0 12px 28px rgba(19,51,101,.15);color:#fff}.aiHero>div{min-width:0}.aiEyebrow{display:inline-flex;align-items:center;gap:6px;margin-bottom:10px;color:#a9ceff;font-size:11px;font-weight:900;letter-spacing:.1em}.aiEyebrow svg{width:15px;height:15px}.aiHero h2{margin:0;font-size:clamp(21px,2.5vw,28px);line-height:1.3;letter-spacing:-.035em}.aiHero p{max-width:680px;margin:9px 0 0;color:#d7e5fa;font-size:13px;font-weight:650;line-height:1.55}.aiStage{flex:0 0 auto;border:1px solid #cae1ff;border-radius:999px;background:#eef6ff;color:#174e94;padding:7px 10px;font-size:11px;font-weight:900;white-space:nowrap}.aiMetrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.aiMetrics article{min-height:108px;padding:16px;border:1px solid #dbe5f2;border-radius:15px;background:#fff;box-shadow:0 6px 16px rgba(33,61,105,.045)}.aiMetrics span{display:block;color:#6a7890;font-size:12px;font-weight:800}.aiMetrics strong{display:block;margin-top:7px;color:#172b4c;font-size:clamp(21px,2.4vw,27px);letter-spacing:-.035em}.aiMetrics small{display:block;margin-top:5px;color:#8794a8;font-size:11px;font-weight:650}.aiGrid{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:14px}.aiPanel{min-width:0;border:1px solid #dbe5f2;border-radius:17px;background:#fff;padding:20px;box-shadow:0 6px 16px rgba(33,61,105,.045)}.aiPanelHeading{display:flex;align-items:flex-start;gap:10px}.aiPanelIcon{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;flex:0 0 auto}.aiPanelIcon svg{width:17px;height:17px}.aiPanelIcon.fact{background:#e9f2ff;color:#235da9}.aiPanelIcon.proposal{background:#edf4ff;color:#1b528f}.aiPanelHeading h2{margin:0;color:#1c2d48;font-size:16px;letter-spacing:-.02em}.aiPanelHeading p{margin:4px 0 0;color:#728199;font-size:12px;font-weight:650;line-height:1.45}.aiFact{margin:18px 0 0;padding-left:13px;border-left:3px solid #3d7ad2;color:#334a6c;font-size:14px;font-weight:700;line-height:1.7}.aiEvidence{display:grid;gap:4px;margin-top:17px;padding-top:14px;border-top:1px solid #e8edf5}.aiEvidence span{color:#7a879b;font-size:11px;font-weight:800}.aiEvidence strong{color:#405574;font-size:12px;line-height:1.45}.aiHypothesis{margin-top:14px;padding:12px 13px;border-radius:11px;background:#f7f9fc;color:#52647f}.aiHypothesis strong{font-size:12px;color:#2d466b}.aiHypothesis p{margin:5px 0 0;font-size:12px;font-weight:650;line-height:1.6}.aiProposal{margin-top:18px;padding:14px;border:1px solid #cfe0fb;border-radius:12px;background:#f1f6ff;color:#315074;font-size:13px;font-weight:700;line-height:1.65}.aiSafety{display:flex;align-items:flex-start;gap:7px;margin-top:13px;color:#718098;font-size:11px;font-weight:650;line-height:1.55}.aiSafety svg{width:15px;height:15px;flex:0 0 auto;margin-top:1px}.aiNotice,.aiLoading{border:1px solid #dbe5f2;border-radius:15px;background:#fff;padding:17px;color:#51647f;font-size:13px;font-weight:700}.aiLoading{display:flex;align-items:center;gap:12px}.aiLoading>span{width:21px;height:21px;border:3px solid #d9e6f8;border-top-color:#245fae;border-radius:50%;animation:aiSpin .8s linear infinite}.aiLoading strong{color:#243c60}.aiLoading p{margin:3px 0 0;color:#718098;font-size:12px;font-weight:650}@keyframes aiSpin{to{transform:rotate(360deg)}}@media(max-width:720px){.aiBriefPage{padding:12px;gap:11px}.aiHero{padding:18px;display:block;border-radius:16px}.aiStage{display:inline-block;margin-top:13px}.aiMetrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.aiMetrics article{min-height:96px;padding:13px}.aiMetrics article:last-child{grid-column:1/-1}.aiGrid{grid-template-columns:1fr;gap:11px}.aiPanel{padding:16px;border-radius:15px}.aiFact{margin-top:15px;font-size:13px}.aiProposal{margin-top:15px}}@media(prefers-reduced-motion:reduce){.aiLoading>span{animation-duration:1.8s}}
`;

export default function AdminAiBriefPage() {
  return <Suspense fallback={<main className="aiBriefPage"><p>AI 브리핑을 준비하고 있습니다.</p></main>}><AiBriefContent /></Suspense>;
}
