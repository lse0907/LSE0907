"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Announcement = { id: number; title: string; body: string; kind: "important" | "system" | "update"; audience: "owner" | "staff" | "all"; status: "draft" | "published" | "archived"; starts_at: string; ends_at: string | null; pinned: boolean; link_path: string | null; updated_at: string };
type Form = { id: number | null; title: string; body: string; kind: Announcement["kind"]; audience: Announcement["audience"]; status: Announcement["status"]; startsAt: string; endsAt: string; pinned: boolean; linkPath: string };
const blank = (): Form => ({ id: null, title: "", body: "", kind: "system", audience: "all", status: "draft", startsAt: new Date().toISOString().slice(0, 16), endsAt: "", pinned: false, linkPath: "" });
const kindLabel = (value: Announcement["kind"]) => value === "important" ? "중요 안내" : value === "update" ? "업데이트" : "시스템 알림";
const audienceLabel = (value: Announcement["audience"]) => value === "all" ? "점주·직원 모두" : value === "owner" ? "점주 관리자" : "매장 직원";
const statusLabel = (value: Announcement["status"]) => value === "published" ? "게시 중" : value === "archived" ? "보관됨" : "초안";
const localPreviewRows: Announcement[] = [
  { id: -1, title: "리온오더 베타 운영 안내", body: "베타 선정 매장은 정식 출시 전까지 무료로 이용할 수 있습니다.", kind: "important", audience: "owner", status: "published", starts_at: new Date().toISOString(), ends_at: null, pinned: true, link_path: "/admin/billing/pay", updated_at: new Date().toISOString() },
  { id: -2, title: "주문 운영 화면 업데이트", body: "직원 화면에서 주문 상태를 더 빠르게 확인할 수 있도록 개선했습니다.", kind: "update", audience: "staff", status: "draft", starts_at: new Date().toISOString(), ends_at: null, pinned: false, link_path: null, updated_at: new Date().toISOString() },
];

export default function OpsAnnouncementsDesk() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [form, setForm] = useState<Form>(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [schemaPending, setSchemaPending] = useState(false);
  const canEdit = !schemaPending;
  const load = useCallback(async () => {
    setLoading(true); setMessage(""); setSchemaPending(false);
    try {
      const response = await fetch("/api/ops/announcements", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === "OPS_ANNOUNCEMENT_SCHEMA_PENDING") {
          setSchemaPending(true);
          setRows([]);
          setMessage(data.message || "운영 알림 저장소를 준비 중입니다.");
          return;
        }
        throw new Error(data.message || "운영 알림을 불러오지 못했습니다.");
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        setRows(localPreviewRows);
        setMessage("로컬 미리보기 데이터입니다. 저장은 마이그레이션 적용 후 사용할 수 있습니다.");
      } else setMessage(error instanceof Error ? error.message : "운영 알림을 불러오지 못했습니다.");
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => rows.find((row) => row.id === form.id) || null, [form.id, rows]);
  const edit = (row: Announcement) => setForm({ id: row.id, title: row.title, body: row.body, kind: row.kind, audience: row.audience, status: row.status, startsAt: row.starts_at.slice(0, 16), endsAt: row.ends_at ? row.ends_at.slice(0, 16) : "", pinned: row.pinned, linkPath: row.link_path || "" });
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/ops/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "운영 알림을 저장하지 못했습니다.");
      setForm(blank()); setMessage("운영 알림을 저장했습니다."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "운영 알림을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  return <section className="announcementDesk card" aria-label="운영 알림 관리">
    <div className="announcementIntro"><div><span>OPERATIONS NOTICE</span><h2>운영 알림 관리</h2><p>점주와 직원에게 필요한 안내만 게시합니다. 주문과 무관한 내부 메모는 포함하지 마세요.</p></div><button className="btn" type="button" disabled={!canEdit} onClick={() => { setForm(blank()); setMessage(""); }}>새 알림 작성</button></div>
    {schemaPending ? <p className="announcementSetup"><strong>저장소 준비 필요</strong><span>공지 기능의 데이터베이스 마이그레이션을 적용하면 기존 화면에서 바로 작성·게시할 수 있습니다.</span></p> : null}
    <div className="announcementDeskGrid">
      <div className="announcementList" aria-live="polite">
        {loading ? <p className="announcementEmpty">목록을 불러오는 중입니다.</p> : rows.length === 0 ? <p className="announcementEmpty">작성된 운영 알림이 없습니다.</p> : rows.map((row) => <button type="button" key={row.id} className={selected?.id === row.id ? "announcementRow selected" : "announcementRow"} onClick={() => edit(row)}><span className={`noticeStatus ${row.status}`}>{statusLabel(row.status)}</span><strong>{row.title}</strong><small>{kindLabel(row.kind)} · {audienceLabel(row.audience)}</small><time>{new Date(row.updated_at).toLocaleDateString("ko-KR")}</time></button>)}
      </div>
      <form className="announcementForm" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="formHead"><h3>{form.id ? "운영 알림 수정" : "새 운영 알림"}</h3><span>{form.status === "published" ? "게시 전 수신 범위를 다시 확인하세요." : "초안으로 저장한 뒤 게시할 수 있습니다."}</span></div>
        <label>제목<input value={form.title} maxLength={100} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="예: 주문 화면 업데이트 안내" required /></label>
        <label>안내 내용<textarea value={form.body} maxLength={1000} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="수신자가 알아야 할 내용과 필요한 행동을 간결하게 작성하세요." required /></label>
        <div className="announcementSelects"><label>알림 분류<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Announcement["kind"] })}><option value="important">중요 안내</option><option value="system">시스템 알림</option><option value="update">업데이트</option></select></label><label>수신 대상<select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value as Announcement["audience"] })}><option value="all">점주·직원 모두</option><option value="owner">점주 관리자만</option><option value="staff">매장 직원만</option></select></label></div>
        <div className="announcementSelects"><label>게시 상태<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Announcement["status"] })}><option value="draft">초안</option><option value="published">게시</option><option value="archived">보관</option></select></label><label>게시 시작<input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} required /></label></div>
        <div className="announcementSelects"><label>게시 종료 (선택)<input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label><label>연결 경로 (선택)<input value={form.linkPath} maxLength={300} onChange={(event) => setForm({ ...form, linkPath: event.target.value })} placeholder="/admin/billing" /></label></div>
        <label className="pinCheck"><input type="checkbox" checked={form.pinned} onChange={(event) => setForm({ ...form, pinned: event.target.checked })} />알림 목록 상단에 고정</label>
        {message ? <p className="formMessage">{message}</p> : null}
        <button className="btn primary announcementSave" type="submit" disabled={!canEdit || saving}>{saving ? "저장 중..." : form.status === "published" ? "게시 내용 저장" : "알림 저장"}</button>
      </form>
    </div>
    <style jsx>{`
      .announcementDesk{display:grid;gap:18px}.announcementIntro{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:1px solid #e7edf5}.announcementIntro span{color:#2563eb;font-size:10px;font-weight:950;letter-spacing:.11em}.announcementIntro h2{margin:5px 0;color:#14213d;font-size:21px}.announcementIntro p{max-width:640px;margin:0;color:#64748b;font-size:13px;line-height:1.55}.announcementSetup{display:flex;gap:8px;align-items:baseline;margin:0;padding:12px 14px;border:1px solid #f4ce88;border-radius:11px;background:#fff9eb;color:#7b510d;font-size:12px;line-height:1.5}.announcementSetup strong{white-space:nowrap}.announcementDeskGrid{display:grid;grid-template-columns:minmax(270px,.72fr) minmax(0,1.28fr);gap:16px}.announcementList{display:grid;align-content:start;gap:8px}.announcementRow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 8px;align-items:center;padding:13px;border:1px solid #e1e8f2;border-radius:12px;background:#fff;color:#1b2a43;text-align:left;cursor:pointer}.announcementRow:hover,.announcementRow.selected{border-color:#93c5fd;background:#f8fbff}.announcementRow strong{min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.announcementRow small{grid-column:1 / 3;color:#64748b;font-size:11px}.announcementRow time{grid-column:3;grid-row:1 / 3;color:#8a98ab;font-size:10px}.noticeStatus{padding:4px 6px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:9px;font-weight:900}.noticeStatus.published{background:#ecfdf5;color:#047857}.noticeStatus.archived{background:#f3f4f6;color:#6b7280}.announcementEmpty{margin:0;padding:28px 16px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;text-align:center;font-size:12px}.announcementForm{display:grid;gap:11px;padding:17px;border:1px solid #dbe7f5;border-radius:14px;background:#f8fbff}.formHead{display:grid;gap:3px}.formHead h3{margin:0;color:#14213d;font-size:16px}.formHead span{color:#64748b;font-size:11px;line-height:1.45}.announcementForm label{display:grid;gap:6px;color:#41536e;font-size:11px;font-weight:850}.announcementForm input,.announcementForm textarea,.announcementForm select{width:100%;border:1px solid #cbd8e8;border-radius:9px;background:#fff;color:#172744;font:inherit;font-size:12px;padding:9px 10px}.announcementForm textarea{min-height:88px;resize:vertical;line-height:1.5}.announcementSelects{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.pinCheck{display:flex!important;align-items:center;gap:8px}.pinCheck input{width:16px!important;height:16px;padding:0!important}.formMessage{margin:0;padding:9px 10px;border:1px solid #bfdbfe;border-radius:9px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:800}.announcementSave{justify-self:end;min-width:132px}@media(max-width:800px){.announcementDeskGrid{grid-template-columns:1fr}.announcementIntro{display:grid}.announcementIntro .btn{width:100%}}@media(max-width:520px){.announcementSelects{grid-template-columns:1fr}.announcementSetup{display:grid;gap:3px}.announcementSave{width:100%}}
    `}</style>
  </section>;
}
