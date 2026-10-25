"use client";

import { useEffect, useRef, useState } from "react";
import { applyGroup, Category, Draft, duplicateMenus, exampleDraft, groupValid, markReviewed, Menu, menuIssues, menuValid, needsNameReview, needsScopeReview, OptionGroup, orderCheck, registrationState, reviewTasks, scopeReviewApplies, selectCategory, validPrice } from "./draftModel";
import styles from "./preview.module.css";
import { draftStorageKey, isDraft, parseSavedDraft, PendingEdit, SavedDraft } from "./draftStorage";
import AdminCompatibilityCheck from "./AdminCompatibilityCheck";
import { csvFileIssue, decodeCsv } from "./sourceFiles";
import AnalysisLauncher from "./AnalysisLauncher";
import AnalysisReview from "./NewAnalysisReview";
import { comparisonExample } from "./analysisReview";
import SourceEvidence, { ConnectedMenus } from "./SourceEvidence";
import { qualityExampleDraft, qualityExamplePhoto } from "./qualityExample";

type Photo = { id: string; name: string; url: string };
type CsvSource = { id: string; name: string; text: string; encoding: string };
type Editor = { kind: "menu" | "category" | "group" | "options" | "bulk" | "tasks" | "source" | "approval" | "analysis"; id: string };
function readPhoto(file: File): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, url: String(reader.result) });
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
const won = (price: string | number) => validPrice(String(price)) ? `${Number(price).toLocaleString("ko-KR")}원` : "가격 확인 필요";

export default function MenuSetupPreview({ storeId = "", registrationEnabled = false, integrated = false }: { storeId?: string; registrationEnabled?: boolean; integrated?: boolean }) {
  const DRAFT_STORAGE_KEY = `${draftStorageKey(storeId)}${integrated ? ":admin" : ""}`;
  const CANDIDATE_STORAGE_KEY = `${DRAFT_STORAGE_KEY}:candidate`;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [csvFiles, setCsvFiles] = useState<CsvSource[]>([]);
  const [fileError, setFileError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [candidate, setCandidate] = useState<Draft | null>(null);
  const [candidateConfirmed, setCandidateConfirmed] = useState(false);
  const [candidateStorageError, setCandidateStorageError] = useState("");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourceZoom, setSourceZoom] = useState(100);
  const [sourceView, setSourceView] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<Draft[]>([]);
  const [categoryId, setCategoryId] = useState("category-0");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editDraft, setEditDraft] = useState<Draft | null>(null);
  const [reviewSession, setReviewSession] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [bulkGroup, setBulkGroup] = useState("temperature");
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [reading, setReading] = useState(false);
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [discardRequested, setDiscardRequested] = useState(false);
  const [pendingEditor, setPendingEditor] = useState<Editor | null>(null);
  const [restartRequested, setRestartRequested] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const sheetBody = useRef<HTMLDivElement>(null);
  const returnScroll = useRef(0);
  const bodyLock = useRef<{ overflow: string } | null>(null);
  const analysisRevision = useRef(0);
  const comparisonBaseline = useRef("");
  useEffect(() => { analysisRevision.current++; }, [draft, editDraft, photos, csvFiles]);
  useEffect(() => {
    if (!registering) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [registering]);
  const dirty = !!draft && !!editDraft && JSON.stringify(draft) !== JSON.stringify(editDraft);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const saved = parseSavedDraft(raw);
        if (saved) setSavedDraft(saved);
        else setStorageError("저장된 초안을 읽지 못했습니다. 새 예시로 다시 시작할 수 있습니다.");
      }
      const rawCandidate = localStorage.getItem(CANDIDATE_STORAGE_KEY);
      if (rawCandidate) {
        try { const savedCandidate: unknown = JSON.parse(rawCandidate); if (isDraft(savedCandidate)) setCandidate(savedCandidate); else setCandidateStorageError("새 결과를 복원하지 못했습니다. 기존 초안은 유지됩니다."); }
        catch { setCandidateStorageError("새 결과를 복원하지 못했습니다. 기존 초안은 유지됩니다."); }
      }
    } catch { setStorageError("이 브라우저에서는 자동 저장을 사용할 수 없습니다. 페이지를 닫으면 작업이 사라질 수 있습니다."); }
    setStorageReady(true);
  }, [DRAFT_STORAGE_KEY, CANDIDATE_STORAGE_KEY]);
  useEffect(() => {
    if (!storageReady || !draft) return;
    const pendingEdit: PendingEdit | undefined = dirty && editDraft && editor && (editor.kind === "menu" || editor.kind === "category" || editor.kind === "group")
      ? { kind: editor.kind, id: editor.id, draft: editDraft } : undefined;
    const saved: SavedDraft = { version: 1, savedAt: new Date().toISOString(), draft, pendingEdit };
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(saved));
      setSavedAt(saved.savedAt); setStorageError("");
    } catch { setStorageError("자동 저장에 실패했습니다. 저장 공간·브라우저 설정을 확인하고, 이 페이지를 닫지 마세요."); }
  }, [draft, editDraft, dirty, editor, storageReady, DRAFT_STORAGE_KEY]);
  useEffect(() => {
    if (!storageReady) return;
    try {
      if (candidate) localStorage.setItem(CANDIDATE_STORAGE_KEY, JSON.stringify(candidate));
      else localStorage.removeItem(CANDIDATE_STORAGE_KEY);
    } catch { setCandidateStorageError("새 결과를 기기에 보관하지 못했습니다. 확인 전 페이지를 닫지 마세요."); }
  }, [candidate, storageReady, CANDIDATE_STORAGE_KEY]);
  useEffect(() => {
    if ((!draft && !candidate) || (!storageError && !candidateStorageError)) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, candidate, storageError, candidateStorageError]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (editor && dialog.current && !dialog.current.open) {
      returnScroll.current = window.scrollY;
      bodyLock.current = { overflow: document.body.style.overflow };
      document.body.style.overflow = "hidden";
      dialog.current.showModal();
    }
    if (!editor) {
      if (dialog.current?.open) dialog.current.close();
      if (bodyLock.current) {
        document.body.style.overflow = bodyLock.current.overflow;
        bodyLock.current = null;
        const top = returnScroll.current;
        requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
      }
    }
  }, [editor]);
  useEffect(() => {
    const viewport = window.visualViewport;
    function resize() {
      const height = viewport?.height ?? window.innerHeight;
      dialog.current?.style.setProperty("--sheet-height", `${height}px`);
      dialog.current?.style.setProperty("--keyboard-inset", `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`);
    }
    resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize);
      if (bodyLock.current) { document.body.style.overflow = bodyLock.current.overflow; bodyLock.current = null; }
    };
  }, []);

  const state = draft ? registrationState(draft) : null;
  const currentCategory = draft?.categories.find((item) => item.id === categoryId);
  const visibleMenus = draft?.menus.filter((menu) => (categoryId === "all" || menu.categoryId === categoryId)
    && menu.name.toLowerCase().includes(query.trim().toLowerCase()) && (!onlyIssues || menuIssues(menu, draft).length > 0)) || [];
  const pageCount = Math.max(1, Math.ceil(visibleMenus.length / 6));
  const currentPage = Math.min(page, pageCount - 1);
  const pageMenus = visibleMenus.slice(currentPage * 6, (currentPage + 1) * 6);
  const workingDraft = editDraft ?? draft;
  const currentMenu = workingDraft?.menus.find((menu) => editor?.kind === "menu" && menu.id === editor.id);
  const currentGroup = workingDraft?.groups.find((group) => editor?.kind === "group" && group.id === editor.id);
  const editCategory = workingDraft?.categories.find((category) => editor?.kind === "category" && category.id === editor.id);
  const order = currentMenu && workingDraft ? orderCheck(currentMenu, workingDraft, selections) : null;
  const tasks = draft ? reviewTasks(draft) : [];
  const canApply = !!workingDraft && (currentMenu ? !currentMenu.selected || menuValid(currentMenu, workingDraft) : currentGroup ? groupValid(currentGroup, workingDraft) && !needsScopeReview(currentGroup, workingDraft) : !!editCategory?.name.trim());
  const showEvidence = !!draft && !!(currentMenu || currentGroup) && !sourceView;
  const result = registered ? registrationState(registered) : null;

  function commit(next: Draft) {
    if (!draft) return;
    setHistory((previous) => [...previous.slice(-19), draft]); setDraft(next);
    setApproved(false); setRegistered(null); setMessage("");
  }
  function menuPatch(id: string, fields: Partial<Menu>) { setEditDraft((current) => current ? { ...current, menus: current.menus.map((menu) => menu.id === id ? { ...menu, ...fields } : menu) } : current); }
  function categoryPatch(id: string, fields: Partial<Category>) { setEditDraft((current) => current ? { ...current, categories: current.categories.map((category) => category.id === id ? { ...category, ...fields } : category) } : current); }
  function groupPatch(id: string, fields: Partial<OptionGroup>) { setEditDraft((current) => current ? { ...current, groups: current.groups.map((group) => group.id === id ? { ...group, ...fields } : group) } : current); }
  function openEditor(next: Editor, discard = false) {
    if (dirty && !discard) { setPendingEditor(next); setDiscardRequested(true); return; }
    setDiscardRequested(false); setPendingEditor(null); setEditDraft(draft ? structuredClone(draft) : null); setEditor(next); setSelections({}); setEditing(next.kind === "menu" && draft?.source === "ai"); setReviewSession(null); setSourceView(false);
  }
  function closeEditor() { setDiscardRequested(false); setPendingEditor(null); setEditor(null); setEditDraft(null); setEditing(false); setReviewSession(null); setSourceView(false); }
  function requestCloseEditor() { if (registering) { setMessage("저장 결과 확인 중입니다. 잠시만 기다려주세요."); return; } setPendingEditor(null); if (dirty) setDiscardRequested(true); else closeEditor(); }
  function resumeDraft() {
    if (!savedDraft) return;
    setDraft(savedDraft.draft); setSavedDraft(null); setApproved(false); setRegistered(null);
    setCategoryId("all"); setQuery(""); setOnlyIssues(false); setPage(0);
    if (savedDraft.pendingEdit) {
      const pending = savedDraft.pendingEdit;
      setEditDraft(pending.draft); setEditor({ kind: pending.kind, id: pending.id }); setEditing(pending.kind === "menu");
      setMessage("수정 중이던 내용도 복원했습니다. ‘수정 적용’을 눌러야 초안에 반영됩니다.");
    } else setMessage("이 기기에 저장한 초안을 이어갑니다. 최종 승인은 다시 확인해주세요.");
  }
  function restartDraft() {
    if (integrated) {
      try { localStorage.removeItem(DRAFT_STORAGE_KEY); localStorage.removeItem(CANDIDATE_STORAGE_KEY); }
      catch { setStorageError("초안을 지우지 못했습니다. 기존 작업을 유지합니다."); return; }
      setCandidate(null); setEditor(null); setEditDraft(null); setMessage("");
    }
    setDraft(integrated ? null : exampleDraft()); setSavedDraft(null); setHistory([]); setApproved(false); setRegistered(null);
    setCategoryId("category-0"); setQuery(""); setOnlyIssues(false); setPage(0); setRestartRequested(false);
  }
  function acceptAnalysis(next: Draft, revision: number) {
    if (dirty || revision !== analysisRevision.current) { setMessage("분석 중 작업 내용이 바뀌어 새 결과를 적용하지 않았습니다. 현재 초안은 유지합니다."); return; }
    setCandidate(next); openCandidate();
  }
  function openCandidate() {
    comparisonBaseline.current = JSON.stringify(draft ?? savedDraft?.draft ?? null);
    setCandidateConfirmed(false); openEditor({ kind: "analysis", id: "" });
  }
  function applyCandidate() {
    const previous = draft ?? savedDraft?.draft ?? null;
    if (!candidate || (previous && !candidateConfirmed)) return;
    if (comparisonBaseline.current !== JSON.stringify(previous)) { setCandidateConfirmed(false); comparisonBaseline.current = JSON.stringify(previous); setMessage("기존 초안이 바뀌었습니다. 차이를 다시 확인해주세요."); return; }
    // Persist the promoted draft before removing the separately saved candidate.
    // If storage fails, keep both the current draft and candidate available.
    try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), draft: candidate } satisfies SavedDraft)); }
    catch { setCandidateStorageError("새 결과를 저장하지 못했습니다. 기존 초안과 새 결과를 유지했습니다."); return; }
    setCandidateStorageError("");
    setHistory((items) => previous ? [...items.slice(-19), previous] : items);
    setDraft(candidate); setSavedDraft(null); setCandidate(null); setApproved(false); setRegistered(null);
    setCategoryId("all"); setQuery(""); setOnlyIssues(false); setPage(0); closeEditor();
    setMessage("새 결과를 초안으로 적용했습니다. 실제 메뉴 등록은 아직 하지 않았습니다.");
  }
  function startReview(task = tasks[0]) {
    if (!task) return;
    openEditor({ kind: task.kind, id: task.id }); setEditing(task.kind === "menu");
    setReviewSession({ done: 0, total: tasks.length });
  }
  function applyEdits() {
    if (!editDraft || !canApply) return;
    if (JSON.stringify(editDraft) !== JSON.stringify(draft)) { commit(editDraft); setMessage("수정을 초안에 적용했습니다. 되돌리기로 취소할 수 있습니다."); }
    if (reviewSession) {
      const next = reviewTasks(editDraft)[0];
      if (next) {
        setEditDraft(structuredClone(editDraft)); setEditor({ kind: next.kind, id: next.id }); setEditing(next.kind === "menu");
        setSelections({}); setReviewSession({ done: reviewSession.done + 1, total: reviewSession.total });
        sheetBody.current?.scrollTo({ top: 0, behavior: "instant" }); return;
      }
      setMessage("필수 확인 항목을 모두 처리했습니다. 메뉴판을 살펴보고 최종 승인해주세요.");
    }
    closeEditor();
  }
  function openMenu(id: string) { openEditor({ kind: "menu", id }); }
  function undo() {
    const previous = history.at(-1); if (!previous) return;
    setDraft(previous); setHistory((items) => items.slice(0, -1)); setApproved(false); setRegistered(null); setMessage("직전 변경을 되돌렸습니다.");
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files); setMessage(""); setFileError("");
    if (incoming.some((file) => !file.type.startsWith("image/") || file.size > 10 * 1024 * 1024)) { setFileError("사진 파일을 선택해주세요. 미리보기는 1장당 10MB까지 지원합니다."); return; }
    setReading(true);
    try { const loaded = await Promise.all(incoming.map(readPhoto)); setPhotos((items) => [...items, ...loaded]); if (draft) setMessage("원본 사진만 추가했습니다. 예시 초안이나 수정 내용은 바뀌지 않습니다."); }
    catch { setFileError("사진을 읽지 못했습니다. 다른 파일로 다시 시도해주세요."); }
    finally { setReading(false); }
  }
  async function uploadCsv(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files); setFileError("");
    const issue = incoming.map((file) => csvFileIssue(file.name, file.size)).find(Boolean);
    if (issue) { setFileError(issue); return; }
    setReading(true);
    try {
      const loaded = await Promise.all(incoming.map(async (file) => {
        const decoded = decodeCsv(await file.arrayBuffer());
        if (!decoded.text.trim() || decoded.text.includes("\u0000")) throw new Error("invalid CSV");
        return { id: crypto.randomUUID(), name: file.name, ...decoded };
      }));
      setCsvFiles((items) => [...items, ...loaded]);
      if (draft) setMessage("CSV 자료만 추가했습니다. 예시 초안과 수정 내용은 유지됩니다.");
    } catch { setFileError("CSV 내용을 읽지 못했습니다. 파일 형식과 문자 인코딩을 확인해주세요."); }
    finally { setReading(false); }
  }
  const photoInputs = <div className={styles.sourceChoices}>
    <label className={styles.sourceChoice}><strong>이미지 선택</strong><span>메뉴판 사진·휴대폰 캡처</span><input type="file" accept="image/*" multiple disabled={reading} aria-label="메뉴판 이미지 선택" onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} /></label>
    <label className={styles.sourceChoice}><strong>직접 촬영</strong><span>메뉴판을 카메라로 촬영</span><input type="file" accept="image/*" capture="environment" disabled={reading} aria-label="메뉴판 직접 촬영" onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} /></label>
    <label className={styles.sourceChoice}><strong>CSV 첨부</strong><span>기존 서비스에서 내려받은 파일</span><input type="file" accept=".csv,text/csv" multiple disabled={reading} aria-label="메뉴 CSV 첨부" onChange={(event) => { void uploadCsv(event.target.files); event.target.value = ""; }} /></label>
  </div>;
  const sourceSummary = <div className={styles.sourceSummary}><span>이미지 {photos.length}장 · CSV {csvFiles.length}개</span>{reading && <span role="status">자료 읽는 중…</span>}{fileError && <p className={styles.issue} role="alert">{fileError}</p>}{csvFiles.map((file) => <article key={file.id} className={styles.csvItem}><div><strong>{file.name}</strong><button className={styles.textButton} onClick={() => setCsvFiles((items) => items.filter((item) => item.id !== file.id))} aria-label={`${file.name} 제외`}>제외</button></div><details><summary>파일 내용 일부 확인 · {file.encoding}</summary><pre>{file.text.slice(0, 600)}{file.text.length > 600 ? "\n…" : ""}</pre></details></article>)}</div>;
  const analysisLauncher = <AnalysisLauncher integrated={integrated} boundStoreId={storeId} sources={[...photos.filter((photo) => photo.id !== "quality-example").map((photo) => ({ name: photo.name, kind: "image" as const, content: photo.url })), ...csvFiles.map((file) => ({ name: file.name, kind: "csv" as const, content: file.text }))]} existing={!!draft || !!savedDraft} locked={dirty || reading || analyzing || !!candidate} onResult={acceptAnalysis} onBegin={() => { setAnalyzing(true); return analysisRevision.current; }} onFinish={() => setAnalyzing(false)} />;
  const sourcePanel = <section className={styles.sourcePanel} aria-label="원본 자료 확인">{!photos.length && !csvFiles.length && draft && <p className={styles.muted}>원본은 다시 첨부해주세요. 저장한 초안은 그대로 유지됩니다.</p>}{photoInputs}{sourceSummary}
    {photos.length > 0 ? <><label>원본 선택<select value={Math.min(sourceIndex, photos.length - 1)} onChange={(event) => { setSourceIndex(Number(event.target.value)); setSourceZoom(100); }}>{photos.map((photo, index) => <option key={photo.id} value={index}>{index + 1}. {photo.name}</option>)}</select></label><label>확대 {sourceZoom}%<input type="range" min="100" max="250" step="25" value={sourceZoom} onChange={(event) => setSourceZoom(Number(event.target.value))} /></label><div className={styles.sourceImage}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photos[Math.min(sourceIndex, photos.length - 1)].url} style={{ width: `${sourceZoom}%` }} alt="확인할 원본 메뉴판" /></div></> : <p>메뉴판 사진을 선택하면 확대해서 확인할 수 있습니다.</p>}
    {analysisLauncher}
  </section>;

  return <main className={`${styles.page} ${draft ? styles.reviewPage : ""}`}><div className={styles.shell}>
    {!integrated && <aside className={styles.compactNotice}>{draft?.notes?.[0]?.startsWith("검증용 가상 예시") ? "검증용 가상 예시 · 실제 AI 결과 아님" : draft?.source === "ai" ? "AI 초안 · 실제 메뉴 등록 전" : draft ? "가상 메뉴 예시" : "미리보기"}</aside>}
    {!integrated && storeId && <p className={styles.muted}>대상 매장 · {storeId} — 초안은 이 매장용으로 따로 보관합니다.</p>}
    {draft?.notes?.length ? <details className={styles.upload}><summary>AI가 확인을 요청한 내용 {draft.notes.length}건</summary><ul>{draft.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details> : null}
    {storageError && <p className={styles.issue} role="alert">{storageError}</p>}
    {candidateStorageError && <p className={styles.issue} role="alert">{candidateStorageError}</p>}
    {candidate && <section className={`${styles.upload} ${styles.resumeCard}`} aria-label="미적용 분석 결과"><strong>확인할 새 결과 {candidate.menus.length}개</strong><button className={styles.primary} onClick={openCandidate}>새 결과 확인</button></section>}
    {!draft && savedDraft && <section className={`${styles.upload} ${styles.resumeCard}`} aria-label="저장한 초안"><strong>저장된 초안 {savedDraft.draft.menus.length}개</strong><button className={styles.secondary} onClick={resumeDraft}>이어서 하기</button></section>}
    {draft && <div className={styles.saveNotice}><span role="status">{storageError ? "기기 저장 실패" : savedAt ? "이 기기에 자동 저장됨" : "기기에 저장 중"}</span><button className={styles.textButton} onClick={() => setRestartRequested(true)}>{integrated ? "새 자료로 시작" : "새 예시로 시작"}</button></div>}
    {restartRequested && <section className={styles.upload} aria-label="초안 다시 시작 확인"><p>{integrated ? "저장한 초안과 수정 내용을 지우고 새 자료로 시작할까요?" : "저장한 초안과 수정 내용을 지우고 새 예시로 시작할까요?"} 되돌릴 수 없습니다.</p><div className={styles.actions}><button className={styles.secondary} onClick={() => setRestartRequested(false)}>기존 작업 유지</button><button className={styles.primary} onClick={restartDraft}>초안 지우고 새로 시작</button></div></section>}
    {!draft && !integrated && <header className={styles.header}><h1>메뉴판으로 한 번에 설정</h1><p>메뉴판 사진이나 기존 서비스의 CSV를 올려주세요.</p></header>}
    {!draft && <section className={styles.upload}>
      {photoInputs}{sourceSummary}
        {!!photos.length && <div className={styles.thumbnails}>{photos.map((photo, index) => <div key={photo.id}><button onClick={() => { setSourceIndex(index); openEditor({ kind: "source", id: "" }); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt={`원본 메뉴판 ${index + 1}`} /></button><span>{photo.name}</span><button className={styles.textButton} onClick={() => { setPhotos((items) => items.filter((item) => item.id !== photo.id)); setSourceIndex(0); }}>제외</button></div>)}</div>}
      {analysisLauncher}
      <details className={styles.otherMethods}><summary>도움말</summary><p>자료는 여러 개 첨부할 수 있습니다. 이미지와 CSV 원본은 새로고침 후 다시 첨부해주세요. 메뉴 사진은 등록 후 추가할 수 있습니다.</p><p>초안은 이 브라우저에만 저장되며, 되돌리기 기록과 최종 승인은 복원하지 않습니다.</p></details>
    </section>}
    {!integrated && <details className={styles.devSettings}><summary>개발 미리보기 도구</summary><p>아직 실제 메뉴 등록은 연결하지 않았습니다. 아래는 첨부 내용과 무관한 가상 메뉴 예시입니다.</p><button className={styles.secondary} disabled={reading || analyzing || !storageReady} onClick={() => savedDraft || draft ? setRestartRequested(true) : restartDraft()}>자료 없이 60개 메뉴 예시 보기</button><button className={styles.secondary} disabled={dirty || analyzing || !!candidate} onClick={() => { setCandidate(comparisonExample(draft ?? savedDraft?.draft ?? exampleDraft())); openCandidate(); }}>재분석 비교 예시</button><button className={styles.secondary} disabled={dirty || reading || analyzing || !!candidate} onClick={() => { if (!photos.length) setPhotos([qualityExamplePhoto()]); setCandidate(qualityExampleDraft()); openCandidate(); }}>원본 대조 가상 예시</button><p>기존 직접 입력·매장 복사·템플릿은 실제 마법사 통합 때 연결합니다.</p></details>}
    {draft && state && <>
      <section className={styles.workspace}>
        <div className={styles.workspaceHead}><div><h2>우리 매장 메뉴판</h2><p>카테고리 {draft.categories.length}개 · 메뉴 {draft.menus.length}개 · 옵션 {draft.groups.length}개</p></div><button className={styles.secondary} onClick={() => openEditor({ kind: "source", id: "" })}>원본·자료</button></div>
        <div className={styles.reviewBar}><span>{state.pending ? `확인할 설정 ${state.pending}건` : "필수 누락 없음 · 최종 확인 가능"}</span><div><button disabled={!tasks.length} onClick={() => startReview()}>한 항목씩 확인</button><button onClick={() => openEditor({ kind: "tasks", id: "" })}>확인 목록</button></div></div>
        {draft.source === "ai" && <p className={styles.hint}>자동 검사는 일부 오류만 찾습니다. 원본의 메뉴명·가격도 확인해주세요.</p>}
        <div className={styles.toolbar}><label className={styles.search}>메뉴 검색<input value={query} placeholder="메뉴 이름 검색" onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label><label className={styles.categorySelect}>카테고리<select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(0); }}><option value="all">전체 {draft.menus.length}개</option>{draft.categories.map((category) => <option key={category.id} value={category.id}>{category.name || "이름 확인 필요"} · {draft.menus.filter((menu) => menu.categoryId === category.id).length}개</option>)}</select></label></div>
        <div className={styles.toolsRow}><button className={styles.textButton} onClick={() => openEditor({ kind: "options", id: "" })}>옵션 {draft.groups.length}개</button><button className={styles.textButton} onClick={() => { setBulkIds(visibleMenus.filter((menu) => menu.selected).map((menu) => menu.id)); openEditor({ kind: "bulk", id: "" }); }}>묶음 연결</button><button className={styles.textButton} disabled={!history.length} onClick={undo}>되돌리기</button><label className={styles.check}><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.target.checked); setCategoryId("all"); setQuery(""); setPage(0); }} />확인 필요만</label></div>
        <div>
          <div className={styles.board}><div className={styles.boardHead}><div><h3>{currentCategory?.name || "전체 메뉴"}</h3><span>전체 {visibleMenus.length}개 · 6개씩 보기</span></div>{currentCategory && <button className={styles.textButton} onClick={() => openEditor({ kind: "category", id: currentCategory.id })}>카테고리 수정</button>}</div>
            <div className={styles.menuGrid}>{pageMenus.map((menu) => {
              const issues = menuIssues(menu, draft);
              const otherIssues = issues.filter((issue) => issue !== "가격 확인" && !menu.groupIds.some((id) => issue === `${draft.groups.find((group) => group.id === id)?.name} 설정 확인`));
              return <button key={menu.id} className={`${styles.menuCard} ${!menu.selected ? styles.excluded : ""}`} onClick={() => openMenu(menu.id)} aria-label={`${menu.name || "이름 없음"} 메뉴 확인`}>
                <span className={styles.cardTop}><strong>{menu.name || "이름 없음"}</strong><span>{won(menu.price)}</span></span>
                <span className={styles.optionTags}>{categoryId === "all" && <span>{draft.categories.find((category) => category.id === menu.categoryId)?.name || "카테고리 확인 필요"}</span>}{!menu.selected && <span>보류</span>}{menu.groupIds.length ? menu.groupIds.map((id) => { const group = draft.groups.find((item) => item.id === id); return <span key={id}>{group?.name || "옵션"} {group && !groupValid(group, draft) ? "확인 필요" : group?.required === "yes" ? "필수" : group?.required === "no" ? "선택" : "확인 필요"}</span>; }) : "옵션 없음"}</span>
                {!!otherIssues.length && <span className={styles.issue}>{otherIssues.join(" · ")}</span>}
                <span className={styles.cardAction}>확인·수정 ↗</span>
              </button>;
            })}</div>
            {!visibleMenus.length && <div className={styles.empty}><p>{onlyIssues && !query ? "이 범위에서 확인할 설정이 없습니다." : "조건에 맞는 메뉴가 없습니다. 검색어나 필터를 바꿔주세요."}</p>{onlyIssues && <button className={styles.secondary} onClick={() => setOnlyIssues(false)}>필터 해제하고 메뉴 보기</button>}</div>}
          </div>
        </div>
      </section>
      <section className={styles.fixedBar} aria-label="초안 최종 승인"><nav className={styles.pagination} aria-label="메뉴 페이지"><button className={styles.secondary} disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); window.scrollTo({ top: 0, behavior: "instant" }); }}>이전</button><span>{currentPage + 1} / {pageCount}쪽 · {visibleMenus.length}개 중 {pageMenus.length}개 표시</span><button className={styles.secondary} disabled={currentPage >= pageCount - 1} onClick={() => { setPage(currentPage + 1); window.scrollTo({ top: 0, behavior: "instant" }); }}>다음</button></nav><div className={styles.finalActions}><div><strong>{state.menus.length}개 등록 예정</strong><span>보류 {draft.menus.length - state.menus.length}개 · 사진은 나중에</span></div><button className={styles.primary} onClick={() => openEditor({ kind: "approval", id: "" })}>최종 확인</button></div></section>
    </>}
    {message && <p className={styles.status} role="status">{message}</p>}
    <dialog ref={dialog} className={`${styles.dialog} ${showEvidence ? styles.evidenceDialog : ""}`} onCancel={(event) => { event.preventDefault(); requestCloseEditor(); }} onClose={closeEditor} aria-labelledby="editor-title">
      <div className={styles.dialogHead}><h2 id="editor-title">{sourceView || editor?.kind === "source" ? "원본 자료" : editor?.kind === "analysis" ? "새 결과 확인" : editor?.kind === "menu" ? currentMenu?.name || "메뉴" : editor?.kind === "category" ? "카테고리 수정" : editor?.kind === "group" ? "옵션 수정" : editor?.kind === "bulk" ? "옵션 묶음 연결" : editor?.kind === "tasks" ? "확인할 항목" : editor?.kind === "approval" ? "최종 확인" : "옵션 전체 보기"}</h2>{(currentMenu || currentGroup) && <button className={styles.secondary} onClick={() => setSourceView(!sourceView)}>{sourceView ? "수정으로" : "원본"}</button>}<button autoFocus className={styles.secondary} onClick={requestCloseEditor}>닫기</button></div>
      {discardRequested && <section className={styles.discardNotice} role="alert" aria-label="수정 내용 확인"><strong>아직 적용하지 않은 수정이 있어요.</strong><p>이번 수정만 버릴까요? 이미 적용한 초안은 유지됩니다.</p><div className={styles.actions}><button className={styles.primary} onClick={() => { setDiscardRequested(false); setPendingEditor(null); }}>계속 수정</button><button className={styles.secondary} onClick={() => pendingEditor ? openEditor(pendingEditor, true) : closeEditor()}>{pendingEditor ? "이번 수정 버리고 이동" : "이번 수정 버리고 닫기"}</button></div></section>}
      <div ref={sheetBody} className={styles.sheetBody}>
      {reviewSession && !sourceView && <p className={styles.reviewProgress}>확인 {Math.min(reviewSession.done + 1, reviewSession.total)} / {reviewSession.total} · 적용하면 다음 항목으로 이어집니다.</p>}
      <div className={showEvidence ? styles.evidenceLayout : undefined}><div className={styles.editorContent}>
      {(sourceView || editor?.kind === "source") && sourcePanel}
      {editor?.kind === "analysis" && candidate && <AnalysisReview key={JSON.stringify(candidate)} before={draft ?? savedDraft?.draft ?? null} after={candidate} />}
      {editor?.kind === "tasks" && <div className={styles.optionList}>{tasks.length ? tasks.map((task) => <button key={`${task.kind}-${task.id}`} onClick={() => startReview(task)}><strong>{task.title}</strong><span>{task.description} →</span></button>) : <p>남은 필수 확인 사항이 없습니다.</p>}</div>}
      {draft && state && editor?.kind === "approval" && <section className={styles.approval}><h3>이 구성으로 등록할까요?</h3><p>카테고리 {state.categories.length}개 · 메뉴 {state.menus.length}개 · 옵션 {state.groups.length}개 연결</p><p>보류 {draft.menus.length - state.menus.length}개 · 기존 메뉴 변경 없음</p>{state.pending > 0 && <p className={styles.issue}>확인할 설정 {state.pending}건이 남았습니다.</p>}<label className={styles.check}><input type="checkbox" checked={approved} disabled={registering} onChange={(event) => setApproved(event.target.checked)} /> 메뉴판의 가격·카테고리·옵션 연결을 최종 확인했습니다.</label>{!integrated && (!storeId || !registrationEnabled) && <button className={styles.primary} disabled={!approved || !state.canRegister || reading} onClick={() => { if (approved && state.canRegister) { setRegistered(structuredClone(draft)); setMessage("실제 DB 저장 없이 승인 결과만 표시했습니다."); } }}>승인 후 등록 결과 보기 · 예시</button>}{registered && result && <div className={styles.success} aria-live="polite"><h3>승인한 설정의 등록 결과 예시</h3><p>메뉴 {result.menus.length}개 연결 준비 완료 · 실제 저장 없음</p><p>상품 사진은 기존 메뉴 관리에서 추가·촬영하는 단계입니다. 이 미리보기에서는 카메라를 실행하지 않습니다.</p></div>}{(!storeId || !registrationEnabled) && <p className={styles.muted}>현재 실제 저장은 비활성 상태입니다. 관리자에 반영되지 않습니다.</p>}</section>}
      {draft && state && editor?.kind === "approval" && <AdminCompatibilityCheck integrated={integrated} key={`${storeId}:${JSON.stringify(draft)}:${approved}`} storeId={storeId} draft={draft} enabled={approved && state.canRegister && !reading} registrationEnabled={registrationEnabled} onSaving={setRegistering} />}
      {registered && editor?.kind === "approval" && <aside className={styles.notice}>다음은 QR 주문 확인 단계입니다. 승인한 메뉴·카테고리·옵션 설정은 반복하지 않고, 메뉴 사진은 나중에 추가합니다. 이 미리보기는 실제 초기설정 진행률을 변경하지 않습니다.</aside>}
      {editor?.kind === "approval" && draft?.notes?.length ? <section className={styles.notice}><strong>최종 승인 전에 확인해주세요</strong><ul>{draft.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section> : null}
      {draft && currentMenu && !sourceView && <>
        {workingDraft && duplicateMenus(currentMenu, workingDraft).length > 1 && <section className={styles.reviewWarning}><strong>같은 카테고리에 같은 이름이 있어요.</strong><p>원본과 비교해 이름을 고치거나, 실제로 같은 이름인지 확인해주세요.</p>{editing && <label className={styles.check}><input type="checkbox" checked={!needsNameReview(currentMenu, workingDraft)} onChange={(event) => setEditDraft((current) => current ? markReviewed(current, "menu", currentMenu.id, event.target.checked) : current)} />원본에서도 같은 이름인 별도 메뉴입니다.</label>}</section>}
        <div className={styles.dialogTabs}><button aria-pressed={!editing} onClick={() => { setEditing(false); setSelections({}); }}>주문처럼 확인</button><button aria-pressed={editing} onClick={() => setEditing(true)}>메뉴 수정</button></div>
        {!editing ? <><p className={styles.menuPrice}>기본 {won(currentMenu.price)}</p><p className={styles.muted}>주문 동작 예시입니다. 실제 주문·결제는 발생하지 않습니다.</p>
          {currentMenu.groupIds.map((id) => { const group = draft.groups.find((item) => item.id === id); return group ? <fieldset key={id} className={styles.orderGroup}><legend>{group.name} · {group.required === "yes" ? "필수" : group.required === "no" ? "선택" : "조건 확인 필요"} · 최대 {group.max}개</legend>{group.items.map((item) => <label key={item.id} className={styles.choice}><span><input type="checkbox" checked={(selections[id] || []).includes(item.id)} onChange={(event) => setSelections((previous) => ({ ...previous, [id]: event.target.checked ? Number(group.max) === 1 ? [item.id] : [...(previous[id] || []), item.id] : (previous[id] || []).filter((value) => value !== item.id) }))} />{item.name}</span><span>+{won(currentMenu.prices[item.id] ?? item.price)}</span></label>)}<button className={styles.textButton} onClick={() => openEditor({ kind: "group", id })}>이 옵션 설정 수정</button></fieldset> : <p key={id} className={styles.issue}>연결된 옵션을 확인해주세요.</p>; })}
          {!currentMenu.groupIds.length && <p>연결 옵션 없음</p>}
          <div className={styles.total}><span>선택 후 최종 금액</span><strong>{menuIssues(currentMenu, draft).length ? "설정 확인 필요" : won(order?.total ?? "")}</strong></div>
          {!!order?.errors.length && <ul className={styles.issue}>{order.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>}
        </> : <div className={styles.form}>
          <p className={styles.muted}>‘수정 적용’을 눌러야 초안에 반영됩니다. 적용 전 내용도 이 기기에 임시 보관하며, 닫을 때 버릴지 확인합니다.</p>
          <label>메뉴명<input value={currentMenu.name} onChange={(event) => menuPatch(currentMenu.id, { name: event.target.value })} /></label><label>기본 가격 (원)<input inputMode="numeric" value={currentMenu.price} onChange={(event) => menuPatch(currentMenu.id, { price: event.target.value })} /></label><label>카테고리 이동<select value={currentMenu.categoryId} onChange={(event) => menuPatch(currentMenu.id, { categoryId: event.target.value })}>{draft.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <details className={styles.optionDetails}><summary>옵션 연결·메뉴별 요금 수정</summary>{draft.groups.filter((group) => group.scope === "common" || group.menuId === currentMenu.id).map((group) => <div key={group.id} className={styles.connection}><label className={styles.check}><input type="checkbox" checked={currentMenu.groupIds.includes(group.id)} onChange={(event) => menuPatch(currentMenu.id, { groupIds: event.target.checked ? [...currentMenu.groupIds, group.id] : currentMenu.groupIds.filter((id) => id !== group.id) })} />{group.name} · {group.scope === "common" ? "공통" : "전용"}</label>
            {currentMenu.groupIds.includes(group.id) && group.items.map((item) => <label key={item.id} className={styles.override}>{item.name} · 메뉴별 추가 요금<input inputMode="numeric" aria-label={`${currentMenu.name} ${item.name} 추가 요금`} placeholder={`기본 ${won(item.price)} 사용`} value={currentMenu.prices[item.id] ?? ""} onChange={(event) => { const prices = { ...currentMenu.prices }; if (event.target.value === "") delete prices[item.id]; else prices[item.id] = event.target.value; menuPatch(currentMenu.id, { prices }); }} /></label>)}
          </div>)}<p className={styles.muted}>메뉴별 추가 요금을 비우면 옵션 기본 요금을 사용합니다.</p></details><label className={styles.check}><input type="checkbox" checked={currentMenu.selected} onChange={(event) => menuPatch(currentMenu.id, { selected: event.target.checked })} /> 이 메뉴를 승인 시 등록합니다 (해제하면 보류)</label>
          {!!menuIssues(currentMenu, draft).length && <p className={styles.issue}>{menuIssues(currentMenu, draft).join(" · ")}</p>}
        </div>}
      </>}
      {draft && editCategory && !sourceView && <div className={styles.form}><label>카테고리 이름<input value={editCategory.name} onChange={(event) => categoryPatch(editCategory.id, { name: event.target.value })} /></label><p>이 카테고리의 메뉴 {draft.menus.filter((menu) => menu.categoryId === editCategory.id).length}개에 함께 표시됩니다.</p><p className={styles.muted}>메뉴 이동은 해당 메뉴의 ‘메뉴 수정’에서 할 수 있습니다.</p></div>}
      {draft && editor?.kind === "options" && <div className={styles.optionList}>{draft.groups.map((group) => <button key={group.id} onClick={() => openEditor({ kind: "group", id: group.id })}><strong>{group.name} · {group.scope === "common" ? "공통" : "전용"}</strong><span>{draft.menus.filter((menu) => menu.groupIds.includes(group.id)).length}개 메뉴 연결 · {groupValid(group, draft) ? "수정하기" : "확인 필요"}</span></button>)}</div>}
      {draft && currentGroup && !sourceView && <div className={styles.form}>
        {workingDraft && scopeReviewApplies(currentGroup, workingDraft) && <section className={styles.reviewWarning}><strong>제공하는 사이즈를 원본과 확인해주세요.</strong><p>빈 가격 칸에 사이즈를 잘못 연결했을 수 있습니다. 자동으로 오류를 확정한 것은 아닙니다.</p><label className={styles.check}><input type="checkbox" checked={!needsScopeReview(currentGroup, workingDraft)} onChange={(event) => setEditDraft((current) => current ? markReviewed(current, "group", currentGroup.id, event.target.checked) : current)} />연결 메뉴와 사이즈 제공 범위를 원본과 확인했습니다.</label></section>}
        <aside className={styles.notice}>연결 메뉴 {draft.menus.filter((menu) => menu.groupIds.includes(currentGroup.id)).length}개에 함께 적용됩니다. 메뉴별 추가 요금은 유지합니다.</aside>
        {currentGroup.suggested && <p className={styles.issue}>AI 제안 예시 · 필수/선택 여부는 메뉴판에서 확정할 수 없어 확인이 필요합니다.</p>}
        <label>필수 선택<select value={currentGroup.required} onChange={(event) => groupPatch(currentGroup.id, { required: event.target.value as OptionGroup["required"], suggested: false })}><option value="">확인 필요</option><option value="yes">필수</option><option value="no">선택</option></select></label><label>최대 선택 수<input inputMode="numeric" value={currentGroup.max} onChange={(event) => groupPatch(currentGroup.id, { max: event.target.value })} /></label>
        <p className={styles.muted}>{currentGroup.items.map((item) => `${item.name} +${won(item.price)}`).join(" / ")}</p>
        <details className={styles.optionDetails} open={!currentGroup.name.trim() || currentGroup.items.some((item) => !item.name.trim() || !validPrice(item.price))}><summary>옵션 이름·항목·추가 요금 수정</summary><label className={styles.groupName}>옵션 그룹명<input value={currentGroup.name} onChange={(event) => groupPatch(currentGroup.id, { name: event.target.value })} /></label>
        {currentGroup.items.map((item) => <div key={item.id} className={styles.optionFields}><label>옵션 항목명<input value={item.name} onChange={(event) => groupPatch(currentGroup.id, { items: currentGroup.items.map((value) => value.id === item.id ? { ...value, name: event.target.value } : value) })} /></label><label>기본 추가 요금 (원)<input inputMode="numeric" value={item.price} onChange={(event) => groupPatch(currentGroup.id, { items: currentGroup.items.map((value) => value.id === item.id ? { ...value, price: event.target.value } : value) })} /></label></div>)}
        </details>
        <p className={styles.muted}>최소 선택은 필수일 때 1개, 선택일 때 0개입니다. 전용 옵션은 지정 메뉴에만 연결합니다.</p>{!groupValid(currentGroup, draft) && <p className={styles.issue}>항목·추가 요금·선택 조건을 확인해주세요.</p>}
        <ConnectedMenus key={currentGroup.id} menus={workingDraft?.menus.filter((menu) => menu.selected && menu.groupIds.includes(currentGroup.id)) || []} onOpen={(id) => openEditor({ kind: "menu", id })} />
      </div>}
      {draft && editor?.kind === "bulk" && <div className={styles.form}>
        <p>카테고리를 통째로 선택하고, 펼쳐서 예외 메뉴만 제외하세요. 등록 제외 메뉴는 대상에 포함하지 않습니다.</p>
        <label>연결할 공통 옵션<select value={bulkGroup} onChange={(event) => setBulkGroup(event.target.value)}>{draft.groups.filter((group) => group.scope === "common").map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <div className={styles.actions}><button className={styles.secondary} onClick={() => setBulkIds(draft.menus.filter((menu) => menu.selected).map((menu) => menu.id))}>전체 선택</button><button className={styles.secondary} onClick={() => setBulkIds([])}>전체 해제</button></div>
        <div className={styles.categoryBulk}>{draft.categories.map((category) => {
          const menus = draft.menus.filter((menu) => menu.selected && menu.categoryId === category.id);
          const selectedCount = menus.filter((menu) => bulkIds.includes(menu.id)).length;
          const allSelected = menus.length > 0 && selectedCount === menus.length;
          return <article key={category.id}><div className={styles.bulkCategoryHead}><strong>{category.name || "이름 없음"} <span>{selectedCount}/{menus.length}개</span></strong><button className={styles.secondary} disabled={!menus.length} onClick={() => setBulkIds((ids) => selectCategory(draft, ids, category.id, !allSelected))}>{category.name || "카테고리"} 전체 {allSelected ? "해제" : "선택"}</button></div>
            <details><summary>{category.name || "카테고리"} 예외 메뉴 선택·제외</summary><div className={styles.exceptionList}>{menus.map((menu) => <label key={menu.id} className={styles.check}><input type="checkbox" checked={bulkIds.includes(menu.id)} onChange={(event) => setBulkIds((ids) => event.target.checked ? [...new Set([...ids, menu.id])] : ids.filter((id) => id !== menu.id))} />{menu.name}{menu.groupIds.includes(bulkGroup) ? " · 이미 연결됨" : ""}</label>)}{!menus.length && <p>등록할 메뉴가 없습니다.</p>}</div></details>
          </article>;
        })}</div>
        <aside className={styles.notice}>{bulkIds.length}개 메뉴 선택 · 신규 연결 {draft.menus.filter((menu) => bulkIds.includes(menu.id) && !menu.groupIds.includes(bulkGroup)).length}개 · 이미 연결된 메뉴는 유지합니다. 기존 메뉴별 추가 요금도 유지합니다.</aside>
      </div>}
      </div>{showEvidence && <SourceEvidence photos={photos} onAttach={() => setSourceView(true)} />}</div>
      </div>
      {editor?.kind === "analysis" && candidate && <footer className={styles.editFooter}>
        {(draft || savedDraft) && <label className={styles.check}><input type="checkbox" checked={candidateConfirmed} onChange={(event) => setCandidateConfirmed(event.target.checked)} />기존 초안 대신 새 결과를 사용합니다.</label>}
        <div className={styles.editActions}><button className={styles.secondary} onClick={() => { setCandidate(null); closeEditor(); setMessage("새 결과는 사용하지 않았습니다. 기존 초안은 유지됩니다."); }}>{draft || savedDraft ? "기존 초안 유지" : "결과 사용 안 함"}</button><button className={styles.primary} disabled={!!(draft || savedDraft) && !candidateConfirmed} onClick={applyCandidate}>새 결과로 검토</button></div>
      </footer>}
      {draft && editor?.kind === "bulk" && <footer className={styles.editFooter}><strong>{bulkIds.length}개 메뉴 선택</strong><div className={styles.editActions}><button className={styles.secondary} onClick={closeEditor}>취소</button><button className={styles.primary} disabled={!bulkIds.length || !draft.menus.some((menu) => bulkIds.includes(menu.id) && !menu.groupIds.includes(bulkGroup))} onClick={() => { commit(applyGroup(draft, bulkGroup, bulkIds)); closeEditor(); setMessage(`${bulkIds.length}개 메뉴에 옵션 연결을 적용했습니다. 되돌리기로 취소할 수 있습니다.`); }}>선택한 메뉴에 연결</button></div></footer>}
      {!sourceView && (editCategory || currentGroup || (currentMenu && editing)) && <footer className={styles.editFooter}><p>수정 내용을 확인한 뒤 적용해주세요.</p>{currentGroup && <strong>연결 메뉴 {draft?.menus.filter((menu) => menu.groupIds.includes(currentGroup.id)).length}개에 함께 적용</strong>}<div className={styles.editActions}><button className={styles.secondary} onClick={requestCloseEditor}>취소</button><button className={styles.primary} disabled={!canApply} onClick={applyEdits}>{reviewSession ? editDraft && reviewTasks(editDraft).length ? "적용하고 다음" : "적용하고 완료" : "수정 적용"}</button></div></footer>}
    </dialog>
  </div></main>;
}
