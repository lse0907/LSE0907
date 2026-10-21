"use client";
import { useState } from "react";
import type { Draft, Menu } from "./draftModel";
import { compareAnalysis, menuDescription, MenuComparison } from "./analysisReview";
import styles from "./preview.module.css";

const labels = { added: "추가", removed: "빠짐", changed: "변경", same: "동일", ambiguous: "이름 중복" };
function MenuDetails({ menu, draft }: { menu?: Menu; draft: Draft | null }) {
  if (!menu || !draft) return <span className={styles.muted}>없음</span>;
  const info = menuDescription(menu, draft);
  return <div><strong>{menu.name || "메뉴명 확인 필요"}</strong><p>{info.category} · {/^\d+$/.test(menu.price) ? `${Number(menu.price).toLocaleString("ko-KR")}원` : "가격 확인 필요"}{!menu.selected ? " · 보류" : ""}</p>{info.options.length ? info.options.map((option, i) => <p key={i}>{option.name}{"items" in option ? ` · ${option.required === "yes" ? "필수" : option.required === "no" ? "선택" : "필수 여부 확인"} · ${option.max ? `최대 ${option.max}개` : "최대 선택 수 확인 필요"} / ${option.items?.map((item) => `${item.name} ${item.price === "" ? "추가금 확인 필요" : `+${Number(item.price).toLocaleString("ko-KR")}원`}`).join(", ")}` : ""}</p>) : <p>옵션 없음</p>}</div>;
}
export default function NewAnalysisReview({ before, after }: { before: Draft | null; after: Draft }) {
  const entries = compareAnalysis(before, after);
  const [kind, setKind] = useState<MenuComparison["kind"] | "all">("all");
  const [page, setPage] = useState(0);
  const filtered = entries.filter((entry) => kind === "all" ? entry.kind !== "same" : entry.kind === kind);
  const pages = Math.max(1, Math.ceil(filtered.length / 6)); const current = Math.min(page, pages - 1);
  return <section className={styles.comparison} aria-label="새 결과 비교">
    <p>아직 기존 초안은 바뀌지 않았습니다.</p>
    <div className={styles.comparisonCounts}>{Object.entries(labels).map(([key, label]) => <span key={key}>{label} {entries.filter((entry) => entry.kind === key).length}</span>)}</div>
    <label>확인할 메뉴<select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setPage(0); }}><option value="all">차이 있는 메뉴</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <div className={styles.comparisonRows}>{filtered.slice(current * 6, (current + 1) * 6).map((entry) => <details key={entry.key}><summary>{labels[entry.kind]} · {entry.after?.name || entry.before?.name || "메뉴명 확인 필요"}</summary>{entry.kind === "ambiguous" && <p className={styles.issue}>같은 이름이 여러 개라 자동으로 짝짓지 않았습니다.</p>}<div className={styles.comparisonPair}><article><small>기존</small><MenuDetails menu={entry.before} draft={before} /></article><article><small>새 결과</small><MenuDetails menu={entry.after} draft={after} /></article></div></details>)}</div>
    {!filtered.length && <p className={styles.muted}>이 범위에는 비교할 차이가 없습니다.</p>}
    {pages > 1 && <nav className={styles.pagination} aria-label="비교 메뉴 페이지"><button className={styles.secondary} disabled={!current} onClick={() => setPage(current - 1)}>이전</button><span>{current + 1} / {pages}</span><button className={styles.secondary} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>다음</button></nav>}
    {!!after.notes?.length && <details><summary>새 결과의 확인 요청 {after.notes.length}건</summary><ul>{after.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></details>}
    {before && <p className={styles.muted}>자동 병합하지 않습니다. 이름·분류가 바뀐 메뉴는 추가·빠짐으로 표시될 수 있습니다.</p>}
  </section>;
}
