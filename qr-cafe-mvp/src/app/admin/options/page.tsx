// src/app/admin/options/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  scope?: "common" | "exclusive" | null;
  linked_menu_id?: string | null;
};

type OptionItem = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta?: number | null;
};

type MenuSummary = {
  id: string;
  name: string;
  option_group_ids?: string[] | null;
};

function uid(prefix = "opt") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export default function AdminOptionsPage() {
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState<string>("");

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<OptionItem[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [hasLinkedMenuColumn, setHasLinkedMenuColumn] = useState(true);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [, setBadge] = useState<"idle" | "saved" | "error">("idle");
  const [activeScope, setActiveScope] = useState<"common" | "exclusive">("common");
  const [groupDraft, setGroupDraft] = useState({
    name: "",
    required: false,
    min: "0",
    max: "1",
    scope: "common" as "common" | "exclusive",
    linkedMenuId: "",
  });
  const [showCreateItemForm, setShowCreateItemForm] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState({ name: "", price: "" });

  // 1) storeId 로드
  useEffect(() => {
    const queryStore = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = queryStore || saved;
    if (sid) {
      setStoreId(sid);
      setCurrentStoreId(sid);
    } else {
      setStoreId("");
    }
  }, [sp]);

  // 2) 데이터 로드
  const refresh = async () => {
    if (!storeId) return;

    setLoading(true);
    try {
      // 로그인 체크(원인 파악 쉬움)
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!authData?.user) {
        // 비로그인이라면 화면에서 안내만 (미들웨어에서 막는 게 더 좋음)
        setGroups([]);
        setItems([]);
        setSelectedGroupId("");
        return;
      }

      let nextGroups: OptionGroup[] = [];
      const gRes = await supabase
        .from("option_groups")
        .select("id, store_id, name, required, min, max, scope, linked_menu_id")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });

      if (gRes.error) {
        const missingLinkedMenuColumn =
          gRes.error.code === "42703" && String(gRes.error.message || "").includes("linked_menu_id");

        if (!missingLinkedMenuColumn) throw gRes.error;

        const fallbackRes = await supabase
          .from("option_groups")
          .select("id, store_id, name, required, min, max, scope")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false });
        if (fallbackRes.error) throw fallbackRes.error;

        setHasLinkedMenuColumn(false);
        nextGroups = (fallbackRes.data || []).map((g) => ({ ...g, linked_menu_id: null })) as OptionGroup[];
      } else {
        setHasLinkedMenuColumn(true);
        nextGroups = (gRes.data || []) as OptionGroup[];
      }

      const iRes = await supabase
        .from("option_items")
        .select("id, store_id, group_id, name, price_delta")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });

      if (iRes.error) throw iRes.error;

      const mRes = await supabase
        .from("menu_items")
        .select("id, name, option_group_ids")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });

      if (mRes.error) throw mRes.error;

      const nextItems = (iRes.data || []) as OptionItem[];
      const nextMenus = (mRes.data || []) as MenuSummary[];

      setGroups(nextGroups);
      setItems(nextItems);
      setMenus(nextMenus);

      // 선택 그룹 자동 세팅
      setSelectedGroupId((prev) => {
        if (prev && nextGroups.some((x) => x.id === prev)) return prev;
        return nextGroups[0]?.id || "";
      });
    } catch (e: any) {
      console.error("[admin/options] refresh error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  useEffect(() => {
    if (!selectedGroup) {
      setGroupDraft({ name: "", required: false, min: "0", max: "1", scope: "common", linkedMenuId: "" });
      setShowCreateItemForm(false);
      setNewItemDraft({ name: "", price: "" });
      return;
    }
    setGroupDraft({
      name: selectedGroup.name || "",
      required: Boolean(selectedGroup.required),
      min: String(selectedGroup.min ?? 0),
      max: String(selectedGroup.max ?? 1),
      scope: selectedGroup.scope === "exclusive" ? "exclusive" : "common",
      linkedMenuId: selectedGroup.linked_menu_id || "",
    });
  }, [selectedGroup, items]);

  const groupItems = useMemo(
    () => items.filter((it) => it.group_id === selectedGroupId),
    [items, selectedGroupId]
  );

  const scopedGroups = useMemo(
    () => groups.filter((g) => (g.scope || "common") === activeScope),
    [groups, activeScope]
  );

  useEffect(() => {
    setSelectedGroupId((prev) => {
      if (prev && scopedGroups.some((g) => g.id === prev)) return prev;
      return scopedGroups[0]?.id || "";
    });
  }, [scopedGroups]);

  const linkedMenus = useMemo(() => {
    if (!selectedGroup) return [];
    return menus.filter((m) =>
      Array.isArray(m.option_group_ids) ? m.option_group_ids.includes(selectedGroup.id) : false
    );
  }, [menus, selectedGroup]);

  const isExclusiveSelected = (selectedGroup?.scope || "common") === "exclusive";

  // 공통: 뱃지 처리
  const markSaved = () => {
    setBadge("saved");
    setTimeout(() => setBadge("idle"), 1600);
  };
  const markError = () => {
    setBadge("error");
    setTimeout(() => setBadge("idle"), 1600);
  };

  // ===== 그룹 CRUD =====
  const addGroup = async () => {
    if (!storeId) return alert("선택된 매장이 없습니다. 매장을 먼저 선택/생성하세요.");
    if (activeScope === "exclusive") {
      markError();
      return alert("전용옵션 그룹 등록은 메뉴관리에서만 가능합니다.");
    }
    if (!hasLinkedMenuColumn && activeScope === "exclusive") {
      markError();
      return alert("DB에 linked_menu_id 컬럼이 없어 전용옵션 그룹을 만들 수 없습니다. SQL 마이그레이션을 먼저 실행해 주세요.");
    }
    try {
      setSaving(true);
      setBadge("idle");

      const id = uid("group");
      const row = {
        id,
        store_id: storeId,
        name: "새 옵션그룹",
        required: false,
        min: 0,
        max: 1,
        scope: activeScope,
        linked_menu_id: activeScope === "exclusive" ? menus[0]?.id || null : null,
      };

      const { error } = await supabase.from("option_groups").insert([row]);
      if (error) throw error;

      await refresh();
      setSelectedGroupId(id);
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] addGroup:", e?.message || e);
      markError();
      alert(`그룹 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async (patch: Partial<OptionGroup>) => {
    if (!selectedGroup) return;
    if (isExclusiveSelected) {
      markError();
      return alert("전용옵션 그룹은 옵션관리에서 수정할 수 없습니다. 메뉴관리에서 수정하거나 여기서는 삭제만 해주세요.");
    }
    const nextScope = patch.scope ?? selectedGroup.scope ?? "common";
    if (!hasLinkedMenuColumn && (nextScope === "exclusive" || patch.linked_menu_id != null)) {
      markError();
      return alert("DB에 linked_menu_id 컬럼이 없어 전용옵션 저장이 불가능합니다. SQL 마이그레이션을 먼저 실행해 주세요.");
    }
    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("option_groups")
        .update({
          name: patch.name ?? selectedGroup.name,
          required: patch.required ?? selectedGroup.required,
          min: typeof patch.min === "number" ? patch.min : selectedGroup.min,
          max: typeof patch.max === "number" ? patch.max : selectedGroup.max,
          scope: patch.scope ?? selectedGroup.scope ?? "common",
          linked_menu_id:
            patch.scope === "exclusive" || (patch.scope == null && (selectedGroup.scope ?? "common") === "exclusive")
              ? patch.linked_menu_id ?? selectedGroup.linked_menu_id ?? null
              : null,
        })
        .eq("id", selectedGroup.id)
        .eq("store_id", storeId);

      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] updateGroup:", e?.message || e);
      markError();
      alert(`그룹 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup) return;
    if (!confirm("이 옵션그룹을 삭제할까요? (그룹의 옵션아이템도 함께 삭제됩니다)")) return;

    try {
      setSaving(true);
      setBadge("idle");

      // 아이템 먼저 삭제
      const delItems = await supabase
        .from("option_items")
        .delete()
        .eq("store_id", storeId)
        .eq("group_id", selectedGroup.id);

      if (delItems.error) throw delItems.error;

      // 그룹 삭제
      const delGroup = await supabase
        .from("option_groups")
        .delete()
        .eq("store_id", storeId)
        .eq("id", selectedGroup.id);

      if (delGroup.error) throw delGroup.error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] deleteGroup:", e?.message || e);
      markError();
      alert(`그룹 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  // ===== 아이템 CRUD =====
  const addItem = async () => {
    if (!selectedGroup) return alert("그룹을 먼저 선택하세요.");
    if (isExclusiveSelected) {
      markError();
      return alert("전용옵션 항목 등록은 메뉴관리에서만 가능합니다.");
    }
    const nextName = newItemDraft.name.trim();
    if (!nextName) return alert("옵션명을 입력하세요.");
    try {
      setSaving(true);
      setBadge("idle");

      const row = {
        id: uid("item"),
        store_id: storeId,
        group_id: selectedGroup.id,
        name: nextName,
        price_delta: toInt(newItemDraft.price, 0),
      };

      const { error } = await supabase.from("option_items").insert([row]);
      if (error) throw error;

      await refresh();
      setShowCreateItemForm(false);
      setNewItemDraft({ name: "", price: "" });
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] addItem:", e?.message || e);
      markError();
      alert(`옵션 추가 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("이 옵션을 삭제할까요?")) return;
    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("option_items")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);

      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] deleteItem:", e?.message || e);
      markError();
      alert(`옵션 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

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
          align-items: flex-start;
          gap: 10px;
        }
        .h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .topbarMain {
          width: 100%;
        }
        .titleRow {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          flex-wrap: wrap;
          width: 100%;
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
          grid-template-columns: 1fr 1.2fr;
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
          font-size: 14px;
          line-height: 1.2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        .headerActionRow {
          display: flex;
          gap: 8px;
          margin-top: 0;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        /* 중복으로 내려오는 보조 액션 행이 있으면 숨기고 타이틀 옆 액션만 유지 */
        .sub + .sub + .headerActionRow {
          display: none;
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
        .btn:disabled {
          opacity: 0.6;
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
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
        }
        .name {
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 12px;
        }

        .scopeRow {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .scopeBtn {
          border: 1px solid var(--line);
          background: #fff;
          padding: 10px 14px;
          border-radius: 12px;
          font-weight: 950;
          font-size: 14px;
          line-height: 1.2;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .scopeBtnOn {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          background: #f3f4f6;
          color: #111827;
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
        .row3 {
          display: grid;
          grid-template-columns: minmax(90px, 1fr) minmax(0, 3fr);
          gap: 10px;
          align-items: end;
        }
        .row2 {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: end;
        }
        .groupTopRow {
          display: grid;
          grid-template-columns: 70% auto;
          gap: 10px;
          align-items: end;
        }
        .maxInput {
          width: 100%;
        }
        .itemLine {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(120px, 0.8fr);
          gap: 8px;
          align-items: end;
        }
        .itemSaveBtn {
          grid-column: 1 / -1;
          justify-self: end;
        }
        .savedItemRow {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px 12px;
          background: #fff;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }
        .savedItemMeta {
          display: grid;
          gap: 4px;
        }

        .itemCard {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 8px;
        }
        .itemTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .row3 {
            grid-template-columns: minmax(72px, 1fr) minmax(0, 3fr);
          }
          .row2 {
            grid-template-columns: 1fr;
          }
          .groupTopRow {
            grid-template-columns: 70% auto;
          }
          .itemLine {
            grid-template-columns: minmax(0, 1fr) minmax(110px, 0.8fr);
          }
          .itemSaveBtn {
            width: 100%;
            justify-self: stretch;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="topbarMain">
          <div className="titleRow">
            <h1 className="h1">옵션 관리</h1>
            <div className="headerActionRow">
              <a className="btn" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                관리자 홈
              </a>
              <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                메뉴관리
              </a>
            </div>
          </div>
          <p className="sub">
            메뉴에 연결되는 옵션을 등록 및 관리 합니다.
          </p>
          <p className="sub" style={{ marginTop: 6 }}>
            현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
          </p>
          <div className="headerActionRow">
            <a className="btn" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
              관리자 홈
            </a>
            <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
              메뉴관리
            </a>
          </div>
          <div className="scopeRow">
            {[
              { key: "common", label: "공통옵션" },
              { key: "exclusive", label: "전용옵션" },
            ].map((scope) => (
              <button
                key={scope.key}
                className={`scopeBtn ${activeScope === scope.key ? "scopeBtnOn" : ""}`}
                onClick={() => setActiveScope(scope.key as "common" | "exclusive")}
                type="button"
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>

      </header>

      {!storeId ? (
        <section className="card">
          <h2 className="cardTitle">매장을 먼저 선택/생성하세요</h2>
          <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            현재 선택된 매장(저장된 매장)이 없습니다.<br />
            관리자 홈에서 매장을 선택한 뒤 다시 들어와 주세요.
          </p>
          <div className="btnRow">
            <a className="btn btnPrimary" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
              관리자 홈으로
            </a>
          </div>
        </section>
      ) : (
        <section className="grid">
          {/* 그룹 */}
          <div className="card">
            <h2 className="cardTitle">
              {activeScope === "common" ? "공통옵션 그룹" : "전용옵션 그룹"} ({scopedGroups.length})
            </h2>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={addGroup} disabled={saving || loading || activeScope === "exclusive"}>
                + 새 그룹
              </button>
              <button className="btn" onClick={refresh} disabled={saving || loading}>
                새로고침
              </button>

            </div>

            <div className="list">
              {scopedGroups.map((g) => (
                <button
                  key={g.id}
                  className={`rowBtn ${g.id === selectedGroupId ? "rowBtnOn" : ""}`}
                  onClick={() => setSelectedGroupId(g.id)}
                >
                  <div className="name">{g.name}</div>
                  <div className="muted">
                    {g.required ? "필수" : "선택"} · {g.min}~{g.max}개
                  </div>
                </button>
              ))}
              {!loading && scopedGroups.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  {activeScope === "exclusive"
                    ? "전용옵션 그룹 등록은 메뉴관리에서 해주세요. 여기서는 조회/삭제만 가능합니다."
                    : "아직 옵션 그룹이 없습니다. “+ 새 그룹”으로 시작하세요."}
                </div>
              ) : null}
            </div>
          </div>

          {/* 상세 */}
          <div className="card">
            <h2 className="cardTitle">옵션그룹 상세</h2>

            {!selectedGroup ? (
              <p className="muted" style={{ marginTop: 10 }}>
                그룹을 선택하세요.
              </p>
            ) : (
              <>
                <div className="field" style={{ marginTop: 0 }}>
                  <div className="muted" style={{ marginTop: 2 }}>
                    {isExclusiveSelected
                      ? "전용옵션은 옵션관리에서 조회/삭제만 가능합니다. 등록·수정은 메뉴관리에서 해주세요."
                      : "공통옵션 그룹과 항목을 등록/수정/삭제할 수 있습니다."}
                  </div>
                </div>

                <div className="groupTopRow">
                  <div className="field" style={{ marginTop: 0 }}>
                    <div className="label">그룹명</div>
                    <input
                      className="input"
                      value={groupDraft.name}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                      disabled={saving || loading || isExclusiveSelected}
                    />
                  </div>

                  <div className="field" style={{ marginTop: 0, justifySelf: "end" }}>
                    <div className="label">필수 여부</div>
                    <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900 }}>
                      <input
                        type="checkbox"
                        checked={groupDraft.required}
                        onChange={(e) =>
                          setGroupDraft((prev) => ({ ...prev, required: e.target.checked, min: e.target.checked ? "1" : "0" }))
                        }
                        disabled={saving || loading || isExclusiveSelected}
                      />
                      필수
                    </label>
                  </div>
                </div>

                <div className="row3">
                  <div className="field" style={{ marginTop: 0 }}>
                    <div className="label">최대 선택</div>
                    <input
                      className="input maxInput"
                      inputMode="numeric"
                      value={groupDraft.max}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, max: e.target.value }))}
                      disabled={saving || loading || isExclusiveSelected}
                    />
                  </div>
                  {!isExclusiveSelected ? (
                    <div className="field" style={{ marginTop: 0 }}>
                      <div className="label">그룹 ID</div>
                      <input className="input" value={selectedGroup.id} readOnly />
                    </div>
                  ) : null}
                </div>

                {groupDraft.scope === "exclusive" && hasLinkedMenuColumn ? (
                  <div className="field">
                    <div className="label">전용 대상 메뉴</div>
                    <select
                      className="input"
                      value={groupDraft.linkedMenuId}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, linkedMenuId: e.target.value }))}
                      disabled
                    >
                      <option value="">메뉴 선택</option>
                      {menus.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {groupDraft.scope === "exclusive" && !hasLinkedMenuColumn ? (
                  <div className="muted" style={{ marginTop: 8 }}>
                    linked_menu_id 컬럼이 없어 전용 대상 메뉴를 지정할 수 없습니다. SQL 마이그레이션을 먼저 실행해 주세요.
                  </div>
                ) : null}

                <div className="btnRow">
                  <button
                    className="btn"
                    onClick={() => {
                      const min = 0;
                      const max = Math.max(toInt(groupDraft.max, selectedGroup.max), 0);
                      updateGroup({
                        name: groupDraft.name.trim() || selectedGroup.name,
                        required: groupDraft.required,
                        min,
                        max,
                        scope: groupDraft.scope,
                        linked_menu_id: groupDraft.scope === "exclusive" ? groupDraft.linkedMenuId || null : null,
                      });
                    }}
                    disabled={saving || loading || !groupDraft.name.trim() || isExclusiveSelected}
                  >
                    그룹 저장
                  </button>
                  <button className="btn btnDanger" onClick={deleteGroup} disabled={saving || loading}>
                    그룹 삭제
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  <div className="label">연결된 메뉴</div>
                  {linkedMenus.length === 0 ? (
                    <div className="muted" style={{ marginTop: 6 }}>
                      아직 연결된 메뉴가 없습니다. 메뉴관리에서 이 옵션을 연결하세요.
                    </div>
                  ) : (
                    <div className="scopeRow">
                      {linkedMenus.map((m) => (
                        <span key={m.id} className="pill">
                          {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="btnRow" style={{ marginTop: 12 }}>
                  <button className="btn btnPrimary" onClick={() => setShowCreateItemForm((v) => !v)} disabled={saving || loading || isExclusiveSelected}>
                    + 옵션 추가
                  </button>
                </div>

                <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950 }}>
                    옵션 항목 ({groupItems.length})
                  </h3>

                  <div className="list" style={{ marginTop: 10 }}>
                    {groupItems.map((it) => (
                      <div key={it.id} className="savedItemRow">
                        <div className="savedItemMeta">
                          <div style={{ fontWeight: 950 }}>{it.name}</div>
                          <div className="muted">단가: {Number(it.price_delta ?? 0).toLocaleString()}원</div>
                        </div>
                        <button
                          className="btn btnDanger"
                          onClick={() => deleteItem(it.id)}
                          disabled={saving || loading}
                        >
                          삭제
                        </button>
                      </div>
                    ))}

                    {!loading && groupItems.length === 0 ? (
                      <div className="muted" style={{ marginTop: 10 }}>
                        이 그룹에는 옵션 항목이 없습니다. “+ 옵션 추가”를 눌러주세요.
                      </div>
                    ) : null}

                    {!isExclusiveSelected && showCreateItemForm ? (
                      <div className="itemCard">
                        <div className="itemLine">
                          <input
                            className="input"
                            value={newItemDraft.name}
                            onChange={(e) => setNewItemDraft((p) => ({ ...p, name: e.target.value }))}
                            placeholder="옵션 항목명"
                            disabled={saving || loading}
                          />
                          <input
                            className="input"
                            inputMode="numeric"
                            value={newItemDraft.price}
                            onChange={(e) => setNewItemDraft((p) => ({ ...p, price: e.target.value }))}
                            placeholder="단가 입력"
                            disabled={saving || loading}
                          />
                          <button className="btn itemSaveBtn" onClick={addItem} disabled={saving || loading}>
                            항목 저장
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
