"use client";
import { useEffect, useState } from "react";
type Stats = { total: number | null; applications: number | null; message?: string };
export default function OpsBetaVisitStats({ roundId, preview }: { roundId: number; preview?: Stats }) {
  const [stats, setStats] = useState<Stats | null>(preview || null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/ops/beta-visits?roundId=${roundId}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || "조회 실패");
        if (!controller.signal.aborted) { setStats(payload); setError(""); }
      } catch { if (!controller.signal.aborted) setError("통계를 불러오지 못했습니다."); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [roundId, preview]);
  const display = (value: number | null | undefined, unit: string) => value == null ? "—" : `${value.toLocaleString("ko-KR")}${unit}`;
  return <div className="roundStats" aria-label="현재 모집 조회 및 신청 수" title={error || stats?.message || "해당 모집 차수 누적 집계 · 같은 탭 30분 내 새로고침 중복 제외"}>
    <span>조회 <b>{display(stats?.total, "회")}</b></span><i aria-hidden="true">·</i><span>신청 <b>{display(stats?.applications, "건")}</b></span>
    {error || stats?.message ? <small role="status">일부 통계 확인 필요</small> : !stats ? <small role="status">불러오는 중…</small> : null}
    <style jsx>{`.roundStats{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:5px;color:#597565;font-size:12px}.roundStats b{margin-left:4px;font-size:15px;color:#173d29;font-variant-numeric:tabular-nums}.roundStats i{font-style:normal;color:#b3c9ba}.roundStats small{font-size:11px;color:#7b6b44}`}</style>
  </div>;
}
