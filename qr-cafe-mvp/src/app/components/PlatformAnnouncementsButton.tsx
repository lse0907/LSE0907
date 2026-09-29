"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Audience = "owner" | "staff";
type Announcement = { id: number; title: string; body: string; kind: "important" | "system" | "update"; starts_at: string; pinned: boolean; link_path: string | null; updated_at: string };

const previewRows: Announcement[] = [
  { id: -1, title: "리온오더 베타 운영 안내", body: "베타 선정 매장은 정식 출시 전까지 기본 기능과 온라인 선결제를 무료로 이용할 수 있습니다.", kind: "important", starts_at: new Date().toISOString(), pinned: true, link_path: null, updated_at: new Date().toISOString() },
  { id: -2, title: "운영 알림을 이곳에서 확인하세요", body: "서비스 업데이트와 주문 운영에 영향을 주는 안내를 간결하게 알려드립니다.", kind: "system", starts_at: new Date().toISOString(), pinned: false, link_path: null, updated_at: new Date().toISOString() },
];

function label(kind: Announcement["kind"]) {
  if (kind === "important") return "중요 안내";
  if (kind === "update") return "업데이트";
  return "시스템 알림";
}

function dateText(raw: string) {
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "";
}

export default function PlatformAnnouncementsButton({ storeId, audience }: { storeId: string; audience: Audience }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [seenAt, setSeenAt] = useState("");
  const storageKey = useMemo(() => `rion:platform-announcements:${audience}:${storeId}`, [audience, storeId]);
  const newest = rows.reduce((latest, row) => !latest || new Date(row.updated_at).getTime() > new Date(latest).getTime() ? row.updated_at : latest, "");
  const hasUnread = Boolean(newest && (!seenAt || new Date(newest).getTime() > new Date(seenAt).getTime()));

  useEffect(() => {
    void Promise.resolve().then(() => setSeenAt(window.localStorage.getItem(storageKey) || ""));
    const controller = new AbortController();
    fetch(`/api/platform/announcements?storeId=${encodeURIComponent(storeId)}&audience=${audience}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || "운영 알림을 불러오지 못했습니다.");
        setRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch((reason) => {
        if (reason?.name === "AbortError") return;
        if (process.env.NODE_ENV !== "production") setRows(previewRows);
        else setError(reason instanceof Error ? reason.message : "운영 알림을 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [audience, storeId, storageKey]);

  const show = () => {
    setOpen(true);
    if (newest) {
      const timestamp = new Date().toISOString();
      setSeenAt(timestamp);
      window.localStorage.setItem(storageKey, timestamp);
    }
  };

  return <>
    <button className="platformAnnouncementTrigger" type="button" onClick={show} aria-label={hasUnread ? "읽지 않은 운영 알림 있음" : "운영 알림 열기"}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      <span>운영 알림</span>{hasUnread ? <b>N</b> : null}
    </button>
    {open ? <div className="platformAnnouncementLayer" role="presentation" onMouseDown={() => setOpen(false)}>
      <section className="platformAnnouncementPanel" role="dialog" aria-modal="true" aria-label="운영 알림" onMouseDown={(event) => event.stopPropagation()}>
        <div className="platformAnnouncementHead"><div><span>RION ORDER</span><h2>운영 알림</h2></div><button type="button" onClick={() => setOpen(false)} aria-label="운영 알림 닫기">×</button></div>
        <p className="platformAnnouncementIntro">주문 운영에 필요한 안내와 서비스 업데이트를 확인하세요.</p>
        <div className="platformAnnouncementList">
          {loading ? <p className="platformAnnouncementEmpty">알림을 불러오는 중입니다.</p> : error ? <p className="platformAnnouncementEmpty">{error}</p> : rows.length === 0 ? <p className="platformAnnouncementEmpty">새 운영 알림이 없습니다.</p> : rows.map((row) => <article key={row.id} className={row.pinned ? "platformAnnouncementItem pinned" : "platformAnnouncementItem"}>
            <div className="platformAnnouncementMeta"><span className={`kind ${row.kind}`}>{label(row.kind)}</span><time>{dateText(row.starts_at)}</time></div>
            <h3>{row.title}</h3><p>{row.body}</p>
            {row.link_path?.startsWith("/") ? <Link href={row.link_path} onClick={() => setOpen(false)}>자세히 보기 <span>›</span></Link> : null}
          </article>)}
        </div>
      </section>
    </div> : null}
    <style jsx>{`
      .platformAnnouncementTrigger{position:relative;min-height:40px;padding:9px 12px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #dce4f0;border-radius:12px;background:#fff;color:#14213d;font:inherit;font-size:12px;font-weight:850;line-height:1.2;white-space:nowrap;cursor:pointer;box-shadow:0 3px 10px rgba(30,55,90,.06)}
      .platformAnnouncementTrigger:hover{border-color:#afc2dc;background:#f8fbff}.platformAnnouncementTrigger svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.platformAnnouncementTrigger b{position:absolute;right:-5px;top:-6px;min-width:16px;height:16px;padding:0 4px;display:grid;place-items:center;border:2px solid #fff;border-radius:999px;background:#2563eb;color:#fff;font-size:9px;line-height:1}
      .platformAnnouncementLayer{position:fixed;z-index:80;inset:0;background:rgba(15,31,61,.32);display:flex;justify-content:flex-end}.platformAnnouncementPanel{width:min(420px,100%);height:100%;overflow:auto;padding:24px;border-left:1px solid #dce4f0;background:#f8fafc;box-shadow:-18px 0 44px rgba(15,31,61,.16)}.platformAnnouncementHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.platformAnnouncementHead span{color:#2563eb;font-size:10px;font-weight:950;letter-spacing:.1em}.platformAnnouncementHead h2{margin:3px 0 0;color:#14213d;font-size:24px;letter-spacing:-.04em}.platformAnnouncementHead button{width:34px;height:34px;border:1px solid #dce4f0;border-radius:10px;background:#fff;color:#41536e;font-size:22px;line-height:1;cursor:pointer}.platformAnnouncementIntro{margin:12px 0 18px;color:#667085;font-size:13px;line-height:1.55}.platformAnnouncementList{display:grid;gap:10px}.platformAnnouncementItem{padding:16px;border:1px solid #e1e8f2;border-radius:14px;background:#fff}.platformAnnouncementItem.pinned{border-color:#bfdbfe;background:#f8fbff}.platformAnnouncementMeta{display:flex;align-items:center;justify-content:space-between;gap:8px}.platformAnnouncementMeta time{color:#8a98ab;font-size:11px;font-weight:750}.kind{padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#526178;font-size:10px;font-weight:900}.kind.important{background:#fff4e5;color:#b45309}.kind.update{background:#eef2ff;color:#4338ca}.platformAnnouncementItem h3{margin:10px 0 5px;color:#1b2a43;font-size:14px}.platformAnnouncementItem p{margin:0;color:#64748b;font-size:12px;line-height:1.6;word-break:keep-all}.platformAnnouncementItem a{display:inline-flex;gap:4px;margin-top:11px;color:#1d4ed8;font-size:12px;font-weight:850;text-decoration:none}.platformAnnouncementItem a span{font-size:17px;line-height:.7}.platformAnnouncementEmpty{margin:0;padding:30px 16px;border:1px dashed #cbd5e1;border-radius:14px;background:#fff;color:#64748b;text-align:center;font-size:13px;line-height:1.5}@media(max-width:640px){.platformAnnouncementTrigger{min-height:40px;padding:8px 6px;font-size:10px}.platformAnnouncementTrigger svg{width:14px;height:14px}.platformAnnouncementPanel{width:100%;padding:20px 16px}}
    `}</style>
  </>;
}
