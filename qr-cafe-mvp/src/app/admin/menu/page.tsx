// src/app/admin/menu/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";
import { useOptionsDb } from "@/app/lib/optionStore";

type MenuItem = {
  id: string;
  name: string;
  price: number;
  image: string;
  isSoldOut: boolean;
  optionGroupIds: string[];
  sortOrder: number;
};

const LS_KEY = "current_store_id";

function uid(prefix = "menu") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function cleanStr(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function getCurrentStoreIdFromLocalStorage() {
  try {
    return (localStorage.getItem(LS_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setCurrentStoreIdToLocalStorage(storeId: string) {
  try {
    localStorage.setItem(LS_KEY, storeId);
  } catch {}
}

export default function AdminMenuPage() {
  // ✅ 선택 매장 기반
  const [storeId, setStoreId] = useState<string>("");

  // ✅ 메뉴 목록 상태
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ 옵션 그룹 (DB) - storeId 필요
  const { data: optData, loading: optLoading } = useOptionsDb(storeId || "__no_store__");
  const optionGroups = optData.groups || [];

  const [draft, setDraft] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [badge, setBadge] = useState<"idle" | "saved" | "error">("idle");

  // ------------------------------------------------------------------
  // 1) 현재 선택 매장 확보 로직
  // ------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    const resolveStoreId = async () => {
      // 1) localStorage 우선
      const ls = getCurrentStoreIdFromLocalStorage();
      if (ls) {
        if (mounted) setStoreId(ls);
        return;
      }

      // 2) 로그인 유저의 store_members에서 첫 매장 자동 선택
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id;
      if (!userId) {
        // 로그인 안됨 -> middleware가 막아야 하지만, 혹시 몰라 처리
        if (mounted) setStoreId("");
        return;
      }

      const { data, error } = await supabase
        .from("store_members")
        .select("store_id, role, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (error) {
        console.error("[admin/menu] resolveStoreId error:", error.message);
        if (mounted) setStoreId("");
        return;
      }

      const first = data?.[0]?.store_id?.trim?.() || "";
      if (first) {
        setCurrentStoreIdToLocalStorage(first);
        if (mounted) setStoreId(first);
        return;
      }

      // 3) 매장이 아예 없음
      if (mounted) setStoreId("");
    };

    resolveStoreId();

    return () => {
      mounted = false;
    };
  }, []);

  // ------------------------------------------------------------------
  // 2) storeId가 확정되면 menu_items 로딩
  // ------------------------------------------------------------------
  const refresh = async () => {
    if (!storeId) {
      setItems([]);
      setDraft(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("menu_items")
      .select("id, name, price, image, is_sold_out, option_group_ids, sort_order, store_id")
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[admin/menu] load error:", error.message);
      setItems([]);
      setDraft(null);
      setLoading(false);
      return;
    }

    const mapped: MenuItem[] = (data || []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      price: toInt(r.price, 0),
      image: String(r.image ?? ""),
      isSoldOut: !!r.is_sold_out,
      optionGroupIds: Array.isArray(r.option_group_ids) ? r.option_group_ids : [],
      sortOrder: toInt(r.sort_order ?? 999999, 999999),
    }));

    setItems(mapped);
    setDraft((prev) => {
      if (!prev) return mapped[0] || null;
      const found = mapped.find((x) => x.id === prev.id);
      return found || mapped[0] || null;
    });

    setLoading(false);
  };

  useEffect(() => {
    // storeId가 바뀌면 새로 로딩
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!draft && items.length) setDraft(items[0]);
  }, [items, draft]);

  const isEditing = useMemo(() => {
    return !!draft?.id && items.some((x) => x.id === draft.id);
  }, [draft, items]);

  const maxSortOrder = useMemo(() => {
    const nums = items.map((x) => Number(x.sortOrder ?? 0)).filter((n) => Number.isFinite(n));
    return nums.length ? Math.max(...nums) : 0;
  }, [items]);

  const onNew = () => {
    const nextOrder = maxSortOrder + 10;
    setDraft({
      id: uid("menu"),
      name: "",
      price: 0,
      image: "",
      isSoldOut: false,
      optionGroupIds: [],
      sortOrder: nextOrder,
    });
  };

  const onSelect = (id: string) => {
    const found = items.find((x) => x.id === id);
    if (found) setDraft(found);
  };

  const onToggleGroup = (gid: string) => {
    setDraft((p) => {
      if (!p) return p;
      const cur = new Set(p.optionGroupIds || []);
      if (cur.has(gid)) cur.delete(gid);
      else cur.add(gid);
      return { ...p, optionGroupIds: Array.from(cur) };
    });
  };

  // ✅ 순서 변경: 배열 swap 후, 바뀐 두 개만 sort_order 업데이트
  const move = async (direction: "up" | "down") => {
    if (!draft) return;
    if (!storeId) {
      alert("먼저 매장을 선택/생성해 주세요.");
      return;
    }

    const idx = items.findIndex((x) => x.id === draft.id);
    if (idx < 0) return;

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const a = items[idx];
    const b = items[targetIdx];

    const aOrder = toInt(a.sortOrder ?? 999999, 999999);
    const bOrder = toInt(b.sortOrder ?? 999999, 999999);

    // swap
    const nextA: MenuItem = { ...a, sortOrder: bOrder };
    const nextB: MenuItem = { ...b, sortOrder: aOrder };

    // optimistic UI
    const nextList = [...items];
    nextList[idx] = nextA;
    nextList[targetIdx] = nextB;
    nextList.sort((x, y) => toInt(x.sortOrder ?? 999999, 999999) - toInt(y.sortOrder ?? 999999, 999999));

    setItems(nextList);
    setDraft(nextA.id === draft.id ? nextA : nextB);

    // DB update
    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("menu_items")
        .upsert(
          [
            { id: nextA.id, store_id: storeId, sort_order: toInt(nextA.sortOrder, 999999) },
            { id: nextB.id, store_id: storeId, sort_order: toInt(nextB.sortOrder, 999999) },
          ],
          { onConflict: "id" }
        );

      if (error) throw error;

      setBadge("saved");
    } catch (e: any) {
      console.error("[admin/menu] move error:", e?.message || e);
      setBadge("error");
      await refresh();
    } finally {
      setSaving(false);
      setTimeout(() => setBadge("idle"), 1200);
    }
  };

  const onSave = async () => {
    if (!draft) return;
    if (!storeId) {
      alert("먼저 매장을 선택/생성해 주세요.");
      return;
    }

    const name = cleanStr(draft.name);
    if (!name) {
      alert("메뉴명을 입력해 주세요.");
      return;
    }

    const next: MenuItem = {
      ...draft,
      name,
      price: toInt(draft.price, 0),
      image: cleanStr(draft.image),
      isSoldOut: !!draft.isSoldOut,
      optionGroupIds: Array.isArray(draft.optionGroupIds) ? draft.optionGroupIds : [],
      sortOrder: toInt(draft.sortOrder ?? (maxSortOrder + 10), maxSortOrder + 10),
    };

    try {
      setSaving(true);
      setBadge("idle");

      const row = {
        id: next.id,
        name: next.name,
        price: next.price,
        image: next.image || null,
        is_sold_out: !!next.isSoldOut,
        option_group_ids: next.optionGroupIds || [],
        sort_order: toInt(next.sortOrder ?? 999999, 999999),
        store_id: storeId,
      };

      const { error } = await supabase.from("menu_items").upsert([row], { onConflict: "id" });
      if (error) throw error;

      setBadge("saved");
      setDraft(next);
      await refresh();
    } catch (e: any) {
      console.error("[admin/menu] save error:", e?.message || e);
      setBadge("error");
      alert(`저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setBadge("idle"), 1600);
    }
  };

  const onDelete = async () => {
    if (!draft) return;
    if (!isEditing) return;
    if (!storeId) return;
    if (!confirm("이 메뉴를 삭제할까요?")) return;

    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase.from("menu_items").delete().eq("id", draft.id).eq("store_id", storeId);

      if (error) throw error;

      setBadge("saved");
      setDraft(null);
      await refresh();
    } catch (e: any) {
      console.error("[admin/menu] delete error:", e?.message || e);
      setBadge("error");
      alert(`삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setBadge("idle"), 1600);
    }
  };

  const badgeText = badge === "saved" ? "저장됨 ✅" : badge === "error" ? "실패 ❗" : " ";

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  if (!storeId && !loading) {
    return (
      <main className="wrap">
        <style jsx global>{`
          :root {
            --bg: #f6f7f9;
            --card: #ffffff;
            --text: #111827;
            --muted: #6b7280;
            --line: #e5e7eb;
            --brand: #111827;
            --radius: 16px;
          }
          body {
            background: var(--bg);
            color: var(--text);
          }
        `}</style>

        <style jsx>{`
          .wrap {
            max-width: 900px;
            margin: 0 auto;
            padding: 14px;
          }
          .card {
            background: var(--card);
            border: 1px solid var(--line);
            border-radius: var(--radius);
            padding: 16px;
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          }
          .h1 {
            margin: 0;
            font-size: 22px;
            font-weight: 950;
          }
          .muted {
            margin-top: 8px;
            color: var(--muted);
            font-weight: 800;
            font-size: 13px;
            line-height: 1.5;
          }
          .btnRow {
            display: flex;
            gap: 10px;
            margin-top: 12px;
            flex-wrap: wrap;
          }
          .btn {
            border: 1px solid var(--line);
            background: #fff;
            padding: 10px 14px;
            border-radius: 12px;
            cursor: pointer;
            font-weight: 950;
            text-decoration: none;
            color: inherit;
          }
          .btnPrimary {
            background: var(--brand);
            color: #fff;
            border-color: var(--brand);
          }
        `}</style>

        <div className="card">
          <h1 className="h1">선택된 매장이 없습니다</h1>
          <p className="muted">
            메뉴 관리를 하려면 먼저 매장을 생성하거나 선택해야 합니다.
            <br />
            관리자 홈에서 매장을 선택/생성하는 흐름으로 연결할게요.
          </p>
          <div className="btnRow">
            <a className="btn btnPrimary" href="/admin">
              관리자 홈으로
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          max-width: 1050px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
        }
        .h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 6px 0 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        .badge {
          padding: 8px 10px;
          border-radius: 999px;
          font-weight: 900;
          font-size: 12px;
          border: 1px solid var(--line);
          background: #fff;
          min-width: 96px;
          text-align: center;
        }
        .badgeSaved {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }
        .badgeError {
          border-color: #fecaca;
          background: #fef2f2;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 10px;
          align-items: start;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 12px;
        }

        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 12px;
        }
        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
          text-decoration: none;
          color: inherit;
        }
        .btnPrimary {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .btnDanger {
          border-color: #fecaca;
          color: #b91c1c;
          background: #fff;
        }
        .btn:disabled,
        .btnPrimary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .list {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .rowBtn {
          text-align: left;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
        }
        .name {
          font-weight: 950;
        }

        .preview {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 12px;
          align-items: center;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 12px;
          background: #fff;
        }
        .imgBox {
          width: 110px;
          height: 84px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #f9fafb;
          overflow: hidden;
          display: grid;
          place-items: center;
        }
        .imgBox img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .noImg {
          font-weight: 950;
          color: #9ca3af;
          font-size: 12px;
        }

        .field {
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 800;
          width: 100%;
        }
        .row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .groupBox {
          margin-top: 14px;
          border-top: 1px solid var(--line);
          padding-top: 12px;
        }
        .checkRow {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }
        .check {
          display: flex;
          gap: 10px;
          align-items: center;
          font-weight: 900;
        }

        .storeLine {
          margin-top: 6px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .storeTag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 6px 10px;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 950;
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">메뉴 관리</h1>
          <div className="storeLine">
            현재 선택 매장:
            <span className="storeTag" title="current_store_id">
              {storeId || "(없음)"}
            </span>
          </div>
          <p className="sub">메뉴명/가격/이미지/옵션 연결 + 노출 순서(sort_order)를 관리합니다.</p>
          <p className="sub" style={{ marginTop: 6 }}>
            * “위/아래”로 정렬 변경 → 고객 메뉴에도 그대로 반영됩니다.
          </p>
        </div>

        {badge === "saved" ? (
          <span className="badge badgeSaved">{badgeText}</span>
        ) : badge === "error" ? (
          <span className="badge badgeError">{badgeText}</span>
        ) : (
          <span className="badge">{badgeText}</span>
        )}
      </header>

      <section className="grid">
        {/* 목록 */}
        <div className="card">
          <h2 className="cardTitle">
            메뉴 목록{" "}
            <span className="muted">({loading ? "불러오는 중..." : `${items.length}개`})</span>
          </h2>

          <div className="btnRow">
            <button className="btn btnPrimary" onClick={onNew} disabled={saving || loading || !storeId}>
              + 새 메뉴
            </button>
            <button className="btn" onClick={() => refresh()} disabled={saving}>
              새로고침
            </button>
            <a className="btn" href="/admin">
              관리자 홈
            </a>
          </div>

          <div className="list">
            {items.map((m) => {
              const on = draft?.id === m.id;
              const so = Number.isFinite(Number(m.sortOrder)) ? Number(m.sortOrder) : "-";
              return (
                <button
                  key={m.id}
                  className={`rowBtn ${on ? "rowBtnOn" : ""}`}
                  onClick={() => onSelect(m.id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="name">
                      {m.name} {m.isSoldOut ? "(품절)" : ""}
                    </div>
                    <div className="muted">
                      {m.price.toLocaleString()}원 · 순서 {so}
                    </div>
                  </div>
                  <div className="muted">{m.image ? "IMG" : "NO"}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 편집 */}
        <div className="card">
          <h2 className="cardTitle">메뉴 편집</h2>

          {!draft ? (
            <p className="muted" style={{ marginTop: 10 }}>
              메뉴를 선택하거나 “새 메뉴”를 눌러주세요.
            </p>
          ) : (
            <>
              <div className="preview">
                <div className="imgBox">
                  {(draft.image || "").trim() ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.image} alt="menu" />
                  ) : (
                    <div className="noImg">NO IMG</div>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>{draft.name || "메뉴명"}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {Number(draft.price || 0).toLocaleString()}원
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    * 이미지: public 경로 예) <b>/menu/americano.jpg</b>
                  </div>
                </div>
              </div>

              <div className="field">
                <div className="label">메뉴 ID</div>
                <input className="input" value={draft.id} readOnly />
              </div>

              <div className="row2">
                <div className="field">
                  <div className="label">노출 순서(sort_order)</div>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={String(draft.sortOrder ?? 0)}
                    onChange={(e) => setDraft((p) => (p ? { ...p, sortOrder: toInt(e.target.value, 0) } : p))}
                    placeholder="예: 10"
                  />
                  <div className="muted" style={{ marginTop: 6 }}>
                    숫자가 작을수록 위에 표시됩니다.
                  </div>
                </div>

                <div className="field">
                  <div className="label">정렬 빠른 변경</div>
                  <div className="btnRow" style={{ marginTop: 0 }}>
                    <button className="btn" onClick={() => move("up")} disabled={saving || loading || !storeId}>
                      ↑ 위로
                    </button>
                    <button className="btn" onClick={() => move("down")} disabled={saving || loading || !storeId}>
                      ↓ 아래로
                    </button>
                  </div>
                </div>
              </div>

              <div className="field">
                <div className="label">메뉴명</div>
                <input
                  className="input"
                  value={draft.name || ""}
                  onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                  placeholder="예: 아메리카노"
                />
              </div>

              <div className="row2">
                <div className="field">
                  <div className="label">가격(원)</div>
                  <input
                    className="input"
                    inputMode="numeric"
                    value={String(draft.price ?? 0)}
                    onChange={(e) => setDraft((p) => (p ? { ...p, price: toInt(e.target.value, 0) } : p))}
                  />
                </div>

                <div className="field">
                  <div className="label">품절 여부</div>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900 }}>
                    <input
                      type="checkbox"
                      checked={!!draft.isSoldOut}
                      onChange={(e) => setDraft((p) => (p ? { ...p, isSoldOut: e.target.checked } : p))}
                    />
                    품절
                  </label>
                </div>
              </div>

              <div className="field">
                <div className="label">메뉴 이미지 경로 (선택)</div>
                <input
                  className="input"
                  value={draft.image ?? ""}
                  onChange={(e) => setDraft((p) => (p ? { ...p, image: e.target.value } : p))}
                  placeholder='예: "/menu/americano.jpg"'
                />
              </div>

              <div className="groupBox">
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950 }}>연결 옵션 그룹(선택)</h3>
                <div className="muted" style={{ marginTop: 6 }}>
                  * 옵션관리에서 만든 그룹을 메뉴에 연결합니다.
                  {optLoading ? " (옵션 불러오는 중...)" : ""}
                </div>

                <div className="checkRow">
                  {optionGroups.length === 0 ? (
                    <div className="muted" style={{ marginTop: 8 }}>
                      연결 가능한 옵션 그룹이 없습니다. (옵션 관리에서 먼저 생성하세요)
                    </div>
                  ) : (
                    optionGroups.map((g: any) => (
                      <label key={g.id} className="check">
                        <input
                          type="checkbox"
                          checked={(draft.optionGroupIds || []).includes(g.id)}
                          onChange={() => onToggleGroup(g.id)}
                        />
                        {g.name} <span className="muted">(id: {g.id})</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="btnRow">
                <button className="btn btnPrimary" onClick={onSave} disabled={saving || !storeId}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button className="btn btnDanger" onClick={onDelete} disabled={!isEditing || saving || !storeId}>
                  삭제
                </button>
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                * 저장하면 고객 메뉴/직원 화면에도 즉시 반영됩니다.
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
