"use client";
import { useEffect, useRef, useState } from "react";
import { AnalysisSource, validateSources } from "./analysisContract";
import { isDraft } from "./draftStorage";
import type { Draft } from "./draftModel";
import styles from "./preview.module.css";

export default function AnalysisLauncher({ sources, existing, locked: blocked, boundStoreId = "", integrated = false, onResult, onBegin, onFinish }: { sources: AnalysisSource[]; existing: boolean; locked: boolean; boundStoreId?: string; integrated?: boolean; onResult: (draft: Draft, revision: number) => void; onBegin: () => number; onFinish: () => void }) {
  const [storeId, setStoreId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = blocked && !busy;
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    try { setStoreId(boundStoreId || new URLSearchParams(window.location.search).get("store") || localStorage.getItem("qr_current_store_id") || ""); } catch { /* Manual development override remains available below. */ }
  }, [boundStoreId]);
  async function analyze() {
    if (inFlight.current || locked || !confirming) return;
    setError("");
    try { validateSources(sources); } catch (reason) { setError(reason instanceof Error ? reason.message : "자료를 확인해주세요."); return; }
    inFlight.current = true; setBusy(true);
    const revision = onBegin();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 110000);
    try {
      const response = await fetch(integrated ? "/api/admin/menu-setup/analyze" : "/api/preview/menu-setup/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ storeId: boundStoreId || storeId.trim(), sources, confirmExternalProcessing: true }) });
      const body = await response.json();
      if (!response.ok || body.ok !== true || !isDraft(body.draft) || body.draft.source !== "ai") throw new Error(body.message || "분석 결과를 확인하지 못했습니다.");
      onResult(body.draft, revision); setConfirming(false);
    } catch (reason) { setError(controller.signal.aborted ? "응답 대기 시간이 초과되었습니다. 기존 초안은 유지됩니다. 즉시 반복 요청하지 마세요." : reason instanceof Error ? reason.message : "분석하지 못했습니다."); }
    finally { clearTimeout(timer); inFlight.current = false; setBusy(false); onFinish(); }
  }
  return <section className={styles.analysisBox} aria-label="초안 만들기">
    {!confirming ? <><button className={styles.primary} disabled={busy || locked || !sources.length} onClick={() => { setError(""); setConfirming(true); }}>초안 만들기</button><p className={styles.actionHint}>정리된 내용을 확인한 뒤 등록합니다.</p></> : <div className={styles.analysisConfirm} aria-label="분석 전 확인">
      <strong>첨부 자료를 분석할까요?</strong>
      <p>OpenAI로 전송해 초안을 만듭니다. 개인정보는 제외해주세요.</p>
      <details><summary>처리 안내</summary><p>API 이용 비용이 발생할 수 있습니다. 실패하면 기존 초안을 유지하며 자동 재시도하지 않습니다. 실제 메뉴는 아직 등록되지 않습니다.</p></details>
      {existing && <p>기존 초안은 유지됩니다. 분석 후 새 결과를 비교합니다.</p>}
      {!storeId.trim() && <p className={styles.issue}>관리자에서 매장을 선택해주세요.</p>}
      <div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>취소</button><button className={styles.primary} disabled={busy || locked || !storeId.trim()} onClick={() => void analyze()}>{busy ? "분석 중…" : "동의하고 분석"}</button></div>
      {!integrated && <details className={styles.devSettings}><summary>개발용 연결 설정</summary><label>검증용 매장 ID<input value={storeId} disabled={busy || !!boundStoreId} onChange={(event) => setStoreId(event.target.value)} /></label><p>미리보기 전용입니다. 매장이 지정된 화면에서는 대상 매장을 바꿀 수 없습니다. 서버 키·활성화·사용 정책 설정이 필요합니다.</p></details>}
    </div>}
    {locked && <p className={styles.issue}>진행 중인 수정·새 결과 확인을 먼저 마쳐주세요.</p>}
    {error && <p className={styles.issue} role="alert">{error}</p>}
  </section>;
}
