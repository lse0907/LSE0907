"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "./draftModel";
import { draftStorageKey } from "./draftStorage";
import styles from "./preview.module.css";

export default function AdminCompatibilityCheck({ storeId, draft, enabled, registrationEnabled = false, integrated = false, onSaving }: { storeId: string; draft: Draft; enabled: boolean; registrationEnabled?: boolean; integrated?: boolean; onSaving: (saving: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [deferred, setDeferred] = useState<string[]>([]);
  const [compatible, setCompatible] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const fingerprint = JSON.stringify(draft);
  const requestKey = `${draftStorageKey(storeId)}${integrated ? ":admin" : ""}:import-request`;
  const realDraft = draft.source === "ai" && !draft.notes?.some((note) => note.startsWith("검증용 가상 예시"));
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(requestKey);
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending.fingerprint === fingerprint && typeof pending.requestId === "string" && /^[0-9a-f-]{36}$/i.test(pending.requestId)) setPendingId(pending.requestId);
    } catch { /* A new save must persist its request ID successfully before any POST. */ }
  }, [requestKey, fingerprint]);
  async function check() {
    if (busy || inFlight.current || !enabled || !storeId) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage(""); setDeferred([]); setCompatible(false);
    try {
      const response = await fetch(integrated ? "/api/admin/menu-setup/compatibility" : "/api/preview/menu-setup/compatibility", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, draft, confirmed: true }), signal: request.signal });
      const result = await response.json();
      if (request.signal.aborted) return;
      setMessage(typeof result.message === "string" ? result.message : "점검 결과를 확인하지 못했습니다.");
      setCompatible(response.ok && result.ok === true && result.compatible === true);
      if (response.ok && Array.isArray(result.deferredGroups)) setDeferred(result.deferredGroups.filter((name: unknown): name is string => typeof name === "string"));
    } catch {
      if (!request.signal.aborted) setMessage("연결을 확인해주세요. 기존 설정은 변경하지 않았습니다.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  async function save() {
    if (inFlight.current || busy || !enabled || !registrationEnabled || !realDraft || !storeId || (!compatible && !pendingId) || saved) return;
    // Persist BEFORE sending. Never create a second request ID after an unknown result.
    let requestId = pendingId;
    try {
      const raw = localStorage.getItem(requestKey);
      const previous = raw ? JSON.parse(raw) : null;
      if (previous && previous.fingerprint !== fingerprint) {
        setMessage("다른 초안의 등록 요청 기록이 있습니다. 먼저 관리자에서 등록 여부를 확인해주세요."); return;
      }
      if (previous) {
        if (typeof previous.requestId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(previous.requestId)) {
          setMessage("저장한 요청 기록을 확인하지 못했습니다. 관리자에서 등록 여부를 먼저 확인해주세요."); return;
        }
        requestId = previous.requestId;
      }
      if (!requestId) requestId = crypto.randomUUID();
      localStorage.setItem(requestKey, JSON.stringify({ requestId, fingerprint }));
    } catch { setMessage("요청 기록을 기기에 보관하지 못해 저장을 시작하지 않았습니다. 브라우저 저장 공간을 확인해주세요."); return; }
    setPendingId(requestId); inFlight.current = true; setSaving(true); onSaving(true); setMessage("");
    const request = new AbortController(); const timer = setTimeout(() => request.abort(), 30000);
    try {
      const response = await fetch(integrated ? "/api/admin/menu-setup/register" : "/api/preview/menu-setup/register", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ storeId, draft, requestId, confirmed: true }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        if (result.notSaved === true) {
          try { localStorage.removeItem(requestKey); setPendingId(""); } catch { /* Keep durable record if clearing fails. */ }
        }
        throw new Error(result.message || "저장 결과를 확인하지 못했습니다.");
      }
      if (result.result?.storeId !== storeId || !Number.isInteger(result.result?.menus) || result.result.menus < 1) throw new Error("저장 결과를 확인하지 못했습니다.");
      setSaved(true); setMessage(`메뉴 ${result.result.menus}개 등록을 확인했습니다. 메뉴 사진은 관리자에서 추가할 수 있습니다.`);
    } catch (error) {
      setMessage(request.signal.aborted ? "응답을 받지 못했습니다. 새 요청을 만들지 않고 같은 요청으로 결과를 다시 확인해주세요."
        : error instanceof Error ? error.message : "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.");
    } finally { clearTimeout(timer); inFlight.current = false; setSaving(false); onSaving(false); }
  }
  return <section className={styles.notice} aria-label="관리자 연결 점검">
    <strong>{saved ? "관리자 등록 완료" : "관리자 연결 점검"}</strong>
    {storeId ? <><p>대상 매장: {storeId} · 기존 설정이 있으면 등록 연결을 차단합니다.</p>
      {!saved && <button className={styles.secondary} disabled={!enabled || busy || saving} onClick={check}>{busy ? "점검 중…" : "관리자 호환성 확인 · 읽기 전용"}</button>}
      {!saved && registrationEnabled && realDraft && (compatible || pendingId) && <><p>확인한 초안을 실제 관리자에 저장합니다. QR 확인은 등록 후 진행합니다.</p>
        <button className={styles.primary} disabled={!enabled || busy || saving} onClick={save}>{saving ? "등록 결과 확인 중…" : pendingId ? "같은 요청으로 등록 결과 확인" : "이 매장에 메뉴 등록"}</button></>}
      {!registrationEnabled && <p>실제 저장은 비활성 상태입니다.</p>}
      {registrationEnabled && !realDraft && <p>가상 예시는 실제 등록할 수 없습니다.</p>}
    </>
      : <p>매장이 지정되지 않은 예시입니다. 실제 관리자 연결 점검은 매장을 지정한 후 가능합니다.</p>}
    {message && <p role="status">{message}</p>}
    {deferred.length > 0 && <p>연결되지 않아 등록 대상에서 빠진 옵션: {deferred.join(" · ")}</p>}
    {saved && <div className={styles.actions}><a className={styles.primary} href={`/admin/setup?store=${encodeURIComponent(storeId)}`}>초기설정·QR 확인</a><a className={styles.secondary} href={`/admin/menu?store=${encodeURIComponent(storeId)}`}>메뉴·사진 수정</a></div>}
  </section>;
}
