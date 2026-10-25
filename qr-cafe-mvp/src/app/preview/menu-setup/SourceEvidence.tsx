"use client";
import { useState } from "react";
import type { Menu } from "./draftModel";
import styles from "./preview.module.css";

export type EvidencePhoto = { id: string; name: string; url: string };
export default function SourceEvidence({ photos, onAttach }: { photos: EvidencePhoto[]; onAttach: () => void }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const photo = photos[Math.min(index, photos.length - 1)];
  return <aside className={styles.evidencePanel} aria-label="원본과 대조">
    <details open><summary>원본과 대조</summary>
      <p className={styles.muted}>연결 사진은 자동 판별하지 않습니다.</p>
      {photo ? <>{photos.length > 1 ? <label>해당 메뉴의 사진 선택<select value={Math.min(index, photos.length - 1)} onChange={(event) => { setIndex(Number(event.target.value)); setZoom(100); }}>{photos.map((item, i) => <option key={item.id} value={i}>{i + 1}. {item.name}</option>)}</select></label> : <p className={styles.evidenceName}>{photo.name}</p>}
        <label className={styles.zoomControl}>확대 {zoom}%<input aria-label="원본 사진 확대" type="range" min="100" max="300" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
        <div className={styles.evidenceImage} tabIndex={0} aria-label="원본 사진 확대 보기">
          {/* eslint-disable-next-line @next/next/no-img-element -- In-memory owner attachment, never published. */}
          <img src={photo.url} style={{ width: `${zoom}%` }} alt={`대조할 원본 메뉴판: ${photo.name}`} />
        </div></> : <><p>저장된 사진이 없습니다. 다시 첨부해도 초안은 유지됩니다.</p><button className={styles.secondary} onClick={onAttach}>원본 자료 첨부</button></>}
    </details>
  </aside>;
}

export function ConnectedMenus({ menus, onOpen }: { menus: Menu[]; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(menus.length / 6)); const current = Math.min(page, pages - 1);
  return <section className={styles.connectionReview} aria-label="연결 메뉴 대조">
    <strong>연결 메뉴 {menus.length}개</strong><p>원본에 없는 사이즈는 메뉴별 수정에서 연결을 해제하세요.</p>
    {menus.slice(current * 6, (current + 1) * 6).map((menu) => <button key={menu.id} className={styles.connectionRow} onClick={() => onOpen(menu.id)}><span>{menu.name}</span><span>메뉴별 수정 →</span></button>)}
    {pages > 1 && <nav className={styles.pagination} aria-label="연결 메뉴 페이지"><button className={styles.secondary} disabled={!current} onClick={() => setPage(current - 1)}>이전</button><span>{current + 1} / {pages}</span><button className={styles.secondary} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음</button></nav>}
  </section>;
}
