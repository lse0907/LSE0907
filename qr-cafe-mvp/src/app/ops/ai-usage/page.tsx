"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import RionBrand from "@/app/components/RionBrand";
import OpsIcon from "../_components/OpsIcon";

type StoreUsage = {
  storeId: string; storeName: string; ownerEmail: string | null; betaStatus: string; aiEnabled: boolean;
  todayCalls: number; monthCalls: number; todayCost: number; monthCost: number; blocked: number; failed: number;
  lastOccurredAt: string | null; dailyAnalysisLimit: number | null; monthlyAnalysisLimit: number | null;
  dailyCostLimitWon: number; monthlyCostLimitWon: number; monthCostRate: number | null;
};
type Payload = {
  ok?: boolean; message?: string; canControl?: boolean;
  summary?: { todayCalls: number; monthCalls: number; todayCost: number; monthCost: number; monthlyLimitWon: number; blockedCount: number; failedCount: number; activeStores: number };
  stores?: StoreUsage[];
};

const money = (value: number) => `${Math.round(value || 0).toLocaleString()}원`;
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { hour12: false }) : "아직 없음";
const betaLabel = (value: string) => ({ enrolled: "베타 이용 중", suspended: "중지됨", ended: "종료", not_enrolled: "미참여" } as Record<string, string>)[value] || value;

export default function OpsAiUsagePage({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<Payload>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<StoreUsage | null>(null);
  const [reason, setReason] = useState("");
  const [limits, setLimits] = useState({ dailyAnalysisLimit: "", monthlyAnalysisLimit: "", dailyCostLimitWon: "", monthlyCostLimitWon: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/ops/ai-usage", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as Payload;
    if (!response.ok || !payload.ok) setMessage(payload.message || "AI 운영 정보를 불러오지 못했습니다.");
    else { setData(payload); setMessage(""); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (store: StoreUsage) => {
    setSelected(store); setReason("");
    setLimits({ dailyAnalysisLimit: store.dailyAnalysisLimit?.toString() || "", monthlyAnalysisLimit: store.monthlyAnalysisLimit?.toString() || "", dailyCostLimitWon: store.dailyCostLimitWon ? String(store.dailyCostLimitWon) : "", monthlyCostLimitWon: store.monthlyCostLimitWon ? String(store.monthlyCostLimitWon) : "" });
  };
  const submit = async (action: "enable" | "disable" | "set_limit") => {
    if (!selected) return;
    if (!reason.trim()) { setMessage("변경 사유를 입력해 주세요."); return; }
    setBusy(true);
    const response = await fetch("/api/ops/ai-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: selected.storeId, action, reason, ...limits }) });
    const payload = (await response.json().catch(() => ({}))) as Payload;
    if (!response.ok || !payload.ok) setMessage(payload.message || "AI 설정을 저장하지 못했습니다.");
    else { setSelected(null); await load(); }
    setBusy(false);
  };
  const summary = data.summary;
  const attention = useMemo(() => (data.stores || []).filter((row) => !row.aiEnabled || row.blocked > 0 || row.failed > 0 || (row.monthCostRate || 0) >= 80), [data.stores]);

  return <main className={`aiOps ${embedded ? "embedded" : ""}`}>
    {!embedded ? <header className="topbar"><div className="brand"><RionBrand product inverse /><span>AI OPERATIONS</span></div><nav><Link href="/ops"><OpsIcon name="home" />OPS 홈</Link><button onClick={() => void load()} disabled={loading}><OpsIcon name="refresh" />{loading ? "불러오는 중" : "새로고침"}</button></nav></header> : null}
    {message ? <p className="message">{message}</p> : null}
    <section className="metrics" aria-label="AI 운영 요약">
      <article><span>오늘 호출</span><b>{(summary?.todayCalls || 0).toLocaleString()}회</b><small>오늘 발생한 AI 분석 요청</small></article>
      <article><span>이번 달 예상 비용</span><b>{money(summary?.monthCost || 0)}</b><small>{summary?.monthlyLimitWon ? `플랫폼 한도 ${money(summary.monthlyLimitWon)}` : "플랫폼 한도 미설정"}</small></article>
      <article className={summary?.blockedCount ? "warn" : ""}><span>차단된 요청</span><b>{(summary?.blockedCount || 0).toLocaleString()}건</b><small>한도 또는 OPS 중지로 실행되지 않음</small></article>
      <article className={summary?.failedCount ? "danger" : ""}><span>오류 호출</span><b>{(summary?.failedCount || 0).toLocaleString()}건</b><small>주문·결제에는 영향을 주지 않음</small></article>
    </section>
    <section className="notice"><div><strong>{attention.length ? `${attention.length}개 매장을 확인해 주세요` : "현재 확인이 필요한 AI 경고가 없습니다"}</strong><p>{attention.length ? "중지, 오류, 차단 또는 월 비용 한도 80% 이상인 매장을 우선 표시합니다." : "AI 비용과 오류 상태가 안정적입니다."}</p></div><span className={attention.length ? "badge attention" : "badge"}>{attention.length ? "확인 필요" : "정상"}</span></section>
    <section className="panel"><div className="panelHead"><div><span className="eyebrow">STORE CONTROL</span><h2>매장별 사용 현황</h2></div><p>{data.canControl ? "한도 변경과 중지·재개는 사유를 남기며 기록됩니다." : "현재 계정은 조회 전용입니다."}</p></div>
      <div className="tableWrap"><table><thead><tr><th>매장 / 점주</th><th>상태</th><th>오늘</th><th>이번 달</th><th>월 비용 한도</th><th>마지막 분석</th><th></th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="empty">AI 운영 정보를 불러오고 있습니다.</td></tr> : (data.stores || []).length ? (data.stores || []).map((row) => <tr key={row.storeId}><td><strong>{row.storeName}</strong><small>{row.ownerEmail || "점주 계정 미확인"}</small></td><td><span className={`status ${row.aiEnabled ? "on" : "off"}`}>{row.aiEnabled ? betaLabel(row.betaStatus) : "AI 중지"}</span>{row.failed ? <em>오류 {row.failed}</em> : row.blocked ? <em>차단 {row.blocked}</em> : null}</td><td><strong>{row.todayCalls}회</strong><small>{money(row.todayCost)}</small></td><td><strong>{row.monthCalls}회</strong><small>{money(row.monthCost)}</small></td><td><strong>{row.monthlyCostLimitWon ? money(row.monthlyCostLimitWon) : "미설정"}</strong><small>{row.monthCostRate === null ? "한도를 설정해 주세요" : `${row.monthCostRate}% 사용`}</small></td><td><small>{dateTime(row.lastOccurredAt)}</small></td><td>{data.canControl ? <button className="detailBtn" onClick={() => open(row)}>관리</button> : <span className="viewOnly">조회</span>}</td></tr>) : <tr><td colSpan={7} className="empty">아직 AI 사용 기록 또는 베타 매장이 없습니다.</td></tr>}</tbody></table></div>
    </section>
    {selected ? <div className="backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true" aria-label={`${selected.storeName} AI 관리`}><button className="close" onClick={() => setSelected(null)} aria-label="닫기">×</button><span className="eyebrow">STORE AI CONTROL</span><h2>{selected.storeName}</h2><p className="owner">{selected.ownerEmail || "점주 계정 미확인"}</p><div className="current"><span>현재 상태</span><b>{selected.aiEnabled ? betaLabel(selected.betaStatus) : "AI 중지"}</b><small>이번 달 {selected.monthCalls}회 · {money(selected.monthCost)}</small></div><div className="fields"><label>하루 분석 횟수<input inputMode="numeric" value={limits.dailyAnalysisLimit} onChange={(event) => setLimits({ ...limits, dailyAnalysisLimit: event.target.value })} placeholder="예: 1" /></label><label>월 분석 횟수<input inputMode="numeric" value={limits.monthlyAnalysisLimit} onChange={(event) => setLimits({ ...limits, monthlyAnalysisLimit: event.target.value })} placeholder="예: 31" /></label><label>하루 비용 한도(원)<input inputMode="numeric" value={limits.dailyCostLimitWon} onChange={(event) => setLimits({ ...limits, dailyCostLimitWon: event.target.value })} placeholder="미설정" /></label><label>월 비용 한도(원)<input inputMode="numeric" value={limits.monthlyCostLimitWon} onChange={(event) => setLimits({ ...limits, monthlyCostLimitWon: event.target.value })} placeholder="미설정" /></label></div><label className="reason">변경 사유<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="예: 베타 매장 월 예산 조정" /></label><div className="actions"><button className="save" disabled={busy} onClick={() => void submit("set_limit")}>한도 저장</button>{selected.aiEnabled ? <button className="stop" disabled={busy} onClick={() => void submit("disable")}>AI 중지</button> : <button className="start" disabled={busy} onClick={() => void submit("enable")}>AI 다시 허용</button>}</div><p className="safety">중지하면 새 AI 호출만 막습니다. 주문·결제·기존 통계에는 영향을 주지 않습니다.</p></aside></div> : null}
    <style jsx>{`
      .aiOps{min-height:100dvh;padding:24px clamp(16px,4vw,48px) 72px;background:#f2f5fa;color:#172033}.aiOps.embedded{min-height:0;padding:0;background:transparent}.topbar{display:flex;justify-content:space-between;align-items:center;padding:19px 22px;border-radius:20px;background:linear-gradient(135deg,#102b58,#09172c);color:#fff;box-shadow:0 18px 45px rgba(15,31,61,.2)}.brand,.topbar nav{display:flex;align-items:center;gap:16px}.brand span{padding-left:16px;border-left:1px solid rgba(255,255,255,.25);color:#a9c8fb;font-size:10px;font-weight:950;letter-spacing:.14em}.topbar nav{gap:8px}.topbar a,.topbar button{min-height:40px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:850;text-decoration:none}.topbar svg{width:15px;height:15px}.hero{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:30px 0 18px}.embedded .hero{margin-top:0}.eyebrow{display:flex;align-items:center;gap:6px;color:#2b63ad;font-size:10px;font-weight:950;letter-spacing:.14em}.eyebrow :global(svg){width:14px;height:14px}.hero h1{margin:7px 0;font-size:31px;letter-spacing:-.05em}.hero p{margin:0;color:#667085}.heroStatus{display:grid;min-width:128px;padding:16px;border:1px solid #dce4ef;border-radius:16px;background:#fff;text-align:center}.heroStatus b{font-size:27px;color:#173e73}.heroStatus span{color:#718096;font-size:11px}.message{padding:13px 15px;border-radius:12px;background:#fff1f2;color:#a31337}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metrics article,.notice,.panel{border:1px solid #dce4ef;border-radius:18px;background:#fff;box-shadow:0 14px 34px rgba(15,35,66,.05)}.metrics article{min-height:110px;padding:18px;display:grid;gap:5px}.metrics span{color:#64748b;font-size:12px;font-weight:850}.metrics b{font-size:23px;letter-spacing:-.04em}.metrics small{color:#8793a4;font-size:11px}.metrics .warn{border-color:#f6cf72;background:#fffaf0}.metrics .danger{border-color:#ffc1ca;background:#fff6f7}.notice{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0;padding:16px 18px}.notice strong{font-size:15px}.notice p{margin:5px 0 0;color:#718096;font-size:12px}.badge{padding:7px 10px;border-radius:999px;background:#ecfdf3;color:#166534;font-size:11px;font-weight:900;white-space:nowrap}.badge.attention{background:#fff4dd;color:#9a6300}.panel{overflow:hidden}.panelHead{display:flex;justify-content:space-between;align-items:end;gap:18px;padding:20px 20px 15px;border-bottom:1px solid #e5ebf2}.panelHead h2{margin:5px 0 0;font-size:20px}.panelHead p{max-width:300px;margin:0;color:#718096;font-size:11px;line-height:1.5;text-align:right}.tableWrap{overflow:auto}table{width:100%;min-width:850px;border-collapse:collapse}th,td{padding:14px 16px;border-bottom:1px solid #edf1f5;text-align:left;vertical-align:middle}th{background:#f8fafc;color:#64748b;font-size:10px;font-weight:900;letter-spacing:.04em}td strong,td small{display:block}td strong{font-size:13px}td small{margin-top:4px;color:#758195;font-size:11px}td em{display:block;margin-top:5px;color:#b45309;font-size:10px;font-style:normal;font-weight:900}.status{display:inline-flex;padding:5px 7px;border-radius:999px;font-size:10px;font-weight:900}.status.on{background:#ecfdf3;color:#166534}.status.off{background:#fff1f2;color:#a31337}.detailBtn{padding:8px 10px;border:1px solid #bfd0e6;border-radius:9px;background:#f5f9ff;color:#174f91;font-size:11px;font-weight:900}.viewOnly{color:#8793a4;font-size:11px}.empty{padding:34px 20px;border:1px dashed #cbd7e6;border-radius:12px;background:#f8fafc;color:#718096;text-align:center;line-height:1.55}.backdrop{position:fixed;z-index:20;inset:0;background:rgba(9,23,44,.42);display:flex;justify-content:flex-end}.drawer{position:relative;width:min(100%,470px);height:100%;box-sizing:border-box;overflow:auto;padding:32px;background:#fff;box-shadow:-20px 0 50px rgba(15,31,61,.18)}.close{position:absolute;top:17px;right:18px;width:34px;height:34px;border:0;border-radius:9px;background:#eef2f7;color:#40506a;font-size:25px}.drawer h2{margin:8px 0 3px;font-size:26px;letter-spacing:-.045em}.owner{margin:0;color:#718096;font-size:13px}.current{display:grid;gap:5px;margin:24px 0;padding:15px;border:1px solid #d7e3f2;border-radius:14px;background:#f6faff}.current span,.current small{color:#718096;font-size:11px}.current b{color:#173e73}.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.fields label,.reason{display:grid;gap:6px;color:#40506a;font-size:11px;font-weight:900}.fields input,.reason textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d6dfea;border-radius:10px;background:#fff;font:inherit}.reason{margin-top:14px}.reason textarea{min-height:92px;resize:vertical}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.actions button{min-height:45px;border:0;border-radius:10px;font-weight:900}.save{background:#173e73;color:#fff}.stop{background:#fff1f2;color:#a31337}.start{background:#ecfdf3;color:#166534}.safety{margin:14px 0 0;color:#718096;font-size:11px;line-height:1.55}@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.aiOps{padding:12px 10px 50px}.aiOps.embedded{padding:0}.topbar{align-items:flex-start;flex-direction:column;gap:14px}.brand{align-items:flex-start;flex-direction:column;gap:8px}.brand span{padding:0;border:0}.topbar nav{width:100%;justify-content:flex-end}.hero{align-items:start}.heroStatus{display:none}.hero h1{font-size:27px}.metrics{grid-template-columns:1fr 1fr;gap:8px}.metrics article{min-height:96px;padding:13px}.metrics b{font-size:19px}.notice{align-items:start;flex-direction:column}.panelHead{align-items:start;flex-direction:column}.panelHead p{text-align:left}.drawer{width:100%;padding:26px 18px}.fields{grid-template-columns:1fr}.actions{grid-template-columns:1fr}}
    `}</style>
  </main>;
}
