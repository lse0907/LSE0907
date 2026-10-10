import { notFound } from "next/navigation";
import OpsBetaRecruitmentRounds from "@/app/ops/beta-applications/OpsBetaRecruitmentRounds";
export const dynamic = "force-dynamic";
export default function PreviewBetaVisits() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <main style={{ padding: "28px", background: "#f3f6fb", minHeight: "100vh", color: "#173253" }}>
    <p>개발 전용 디자인 미리보기 · 조회 126회와 신청 6건은 예시입니다.</p>
    <OpsBetaRecruitmentRounds preview={{ round: { id: 1, title: "1차 베타 테스터 모집", status: "open", public_message: "", updated_at: "2026-10-10" }, total: 126, applications: 6 }} />
    <style>{`.card{padding:20px;border:1px solid #dbe5f1;border-radius:16px;background:#fff}.sectionTitle{font-size:18px;font-weight:700}.panelHeader p{font-size:12px;color:#708198}.btn{border:1px solid #cad7e8;border-radius:10px;background:#fff;color:#173253}.btn:disabled{opacity:.55}`}</style>
  </main>;
}
