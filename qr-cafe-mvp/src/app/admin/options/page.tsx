// src/app/admin/options/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
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
type MyStore = {
  store_id: string;
  store_name: string | null;
};
type ConfirmState = {
  open: boolean;
  title: string;
  description: string;
  action: null | (() => void);
};

function uid(prefix = "opt") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function AdminOptionsPageInner() {
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
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [copySourceStoreId, setCopySourceStoreId] = useState("");
  const [copying, setCopying] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");
  const actionBusy = saving || copying;
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    description: "",
    action: null,
  });
  const [detailOpen, setDetailOpen] = useState(true);
  const [linkedOpen, setLinkedOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);

  const toErrMsg = (e: unknown) => {
    if (e instanceof Error) return e.message;
    return String(e ?? "알 수 없는 오류");
  };

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
    setMsg("");
    setMsgTone("neutral");
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
    } catch (e: unknown) {
      console.error("[admin/options] refresh error:", toErrMsg(e));
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setMsgTone("error");
      setMsg(`옵션 데이터 로드 실패: ${toErrMsg(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) return;
      const memRes = await supabase.from("store_members").select("store_id").eq("user_id", authData.user.id);
      if (memRes.error) return;
      const ids = (memRes.data || [])
        .map((x: { store_id?: string | null }) => String(x.store_id || ""))
        .filter(Boolean);
      if (!ids.length) return;
      const storeRes = await supabase.from("stores").select("store_id,store_name").in("store_id", ids).order("store_name");
      if (storeRes.error || !mounted) return;
      const list = ((storeRes.data || []) as MyStore[]).filter((s) => s.store_id !== storeId);
      setMyStores(list);
      if (!copySourceStoreId && list.length > 0) setCopySourceStoreId(list[0].store_id);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId, copySourceStoreId]);

  const onCopyOptions = async () => {
    if (actionBusy) return;
    if (!storeId) {
      setMsgTone("error");
      return setMsg("대상 매장을 먼저 선택해주세요.");
    }
    if (!copySourceStoreId) {
      setMsgTone("error");
      return setMsg("원본 매장을 선택해주세요.");
    }
    openConfirm(
      "옵션 복사 확인",
      `원본 매장(${copySourceStoreId})의 옵션 그룹/항목을 현재 매장(${storeId})으로 복사할까요?`,
      async () => {
        closeConfirm();
        try {
          setCopying(true);
          setMsg("");
          setMsgTone("neutral");
          const { error } = await supabase.rpc("admin_copy_options_v1", {
            p_source_store_id: copySourceStoreId,
            p_target_store_id: storeId,
          });
          if (error) throw error;
          await refresh();
          setMsgTone("success");
          setMsg("옵션 복사가 완료되었습니다.");
        } catch (e: unknown) {
          setMsgTone("error");
          setMsg(`옵션 복사 실패: ${toErrMsg(e)}`);
        } finally {
          setCopying(false);
        }
      }
    );
    return;
  };

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
  const linkedMenuNamesByGroupId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) {
      map[g.id] = menus
        .filter((m) => (Array.isArray(m.option_group_ids) ? m.option_group_ids.includes(g.id) : false))
        .map((m) => m.name);
    }
    return map;
  }, [groups, menus]);

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
  const openConfirm = (title: string, description: string, action: () => void) => {
    setConfirmState({ open: true, title, description, action });
  };
  const closeConfirm = () => {
    setConfirmState({ open: false, title: "", description: "", action: null });
  };

  // ===== 그룹 CRUD =====
  const addGroup = async () => {
    if (!storeId) {
      setMsgTone("error");
      return setMsg("선택된 매장이 없습니다. 매장을 먼저 선택/생성하세요.");
    }
    if (activeScope === "exclusive") {
      markError();
      setMsgTone("error");
      return setMsg("전용옵션 그룹 등록은 메뉴관리에서만 가능합니다.");
    }
    if (!hasLinkedMenuColumn) {
      markError();
      setMsgTone("error");
      return setMsg("DB에 linked_menu_id 컬럼이 없어 전용옵션 그룹을 만들 수 없습니다. SQL 마이그레이션을 먼저 실행해 주세요.");
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
        linked_menu_id: null,
      };

      const { error } = await supabase.from("option_groups").insert([row]);
      if (error) throw error;

      await refresh();
      setSelectedGroupId(id);
      markSaved();
      setMsgTone("success");
      setMsg("옵션 그룹을 생성했습니다.");
    } catch (e: unknown) {
      console.error("[admin/options] addGroup:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`그룹 생성 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async (patch: Partial<OptionGroup>) => {
    if (!selectedGroup) return;
    if (isExclusiveSelected) {
      markError();
      setMsgTone("error");
      return setMsg("전용옵션 그룹은 옵션관리에서 수정할 수 없습니다. 메뉴관리에서 수정하거나 여기서는 삭제만 해주세요.");
    }
    const nextScope = patch.scope ?? selectedGroup.scope ?? "common";
    if (!hasLinkedMenuColumn && (nextScope === "exclusive" || patch.linked_menu_id != null)) {
      markError();
      setMsgTone("error");
      return setMsg("DB에 linked_menu_id 컬럼이 없어 전용옵션 저장이 불가능합니다. SQL 마이그레이션을 먼저 실행해 주세요.");
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
      setMsgTone("success");
      setMsg("옵션 그룹을 저장했습니다.");
    } catch (e: unknown) {
      console.error("[admin/options] updateGroup:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`그룹 저장 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup) return;
    openConfirm(
      "옵션 그룹 삭제",
      "이 옵션그룹을 삭제할까요? (그룹의 옵션아이템도 함께 삭제됩니다)",
      async () => {
        closeConfirm();
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
          setMsgTone("success");
          setMsg("옵션 그룹을 삭제했습니다.");
        } catch (e: unknown) {
          console.error("[admin/options] deleteGroup:", toErrMsg(e));
          markError();
          setMsgTone("error");
          setMsg(`그룹 삭제 실패: ${toErrMsg(e)}`);
        } finally {
          setSaving(false);
        }
      }
    );
    return;
  };

  // ===== 아이템 CRUD =====
  const addItem = async () => {
    if (!selectedGroup) {
      setMsgTone("error");
      return setMsg("그룹을 먼저 선택하세요.");
    }
    if (isExclusiveSelected) {
      markError();
      setMsgTone("error");
      return setMsg("전용옵션 항목 등록은 메뉴관리에서만 가능합니다.");
    }
    const nextName = newItemDraft.name.trim();
    if (!nextName) {
      setMsgTone("error");
      return setMsg("옵션명을 입력하세요.");
    }
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
      setMsgTone("success");
      setMsg("옵션 항목을 추가했습니다.");
    } catch (e: unknown) {
      console.error("[admin/options] addItem:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`옵션 추가 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    openConfirm("옵션 삭제", "이 옵션을 삭제할까요?", async () => {
      closeConfirm();
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
        setMsgTone("success");
        setMsg("옵션 항목을 삭제했습니다.");
      } catch (e: unknown) {
        console.error("[admin/options] deleteItem:", toErrMsg(e));
        markError();
        setMsgTone("error");
        setMsg(`옵션 삭제 실패: ${toErrMsg(e)}`);
      } finally {
        setSaving(false);
      }
    });
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
        .msgBox {
          border-radius: 12px;
          padding: 10px 12px;
          margin-top: 8px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          color: #374151;
        }
        .msgBoxSuccess {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .msgBoxError {
          border-color: #fecaca;
          background: #fef2f2;
          color: #991b1b;
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
          flex-wrap: nowrap;
          justify-content: flex-end;
        }
        .copyRow {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: nowrap;
          margin-top: 8px;
        }
        .copySelect {
          flex: 1;
          min-width: 0;
        }
        .copyBtn {
          flex: 0 0 auto;
          white-space: nowrap;
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
        .sectionToggle {
          width: 100%;
          text-align: left;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
          margin-top: 10px;
        }
        .linkedMenuField {
          justify-items: end;
        }
        .linkedMenuField .label {
          text-align: right;
        }
        .linkedMenuField .scopeRow {
          margin-top: 0;
          justify-content: flex-end;
        }
        .linkedMenuField .muted {
          text-align: right;
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
          font-size: 14px;
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
          align-items: start;
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
        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: grid;
          place-items: center;
          padding: 16px;
          z-index: 90;
        }
        .modalCard {
          width: min(460px, 100%);
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 14px;
          display: grid;
          gap: 10px;
          box-shadow: 0 14px 40px rgba(15, 23, 42, 0.18);
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
              <a className="btn" href={`/admin/categories${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                카테고리관리
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
          {msg ? (
            <div className={`msgBox ${msgTone === "success" ? "msgBoxSuccess" : msgTone === "error" ? "msgBoxError" : ""}`}>
              {msg}
            </div>
          ) : null}
          <div className="copyRow">
            <select className="input copySelect" value={copySourceStoreId} onChange={(e) => setCopySourceStoreId(e.target.value)}>
              <option value="">원본 매장 선택</option>
              {myStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name || s.store_id} ({s.store_id})
                </option>
              ))}
            </select>
            <button className="btn copyBtn" type="button" onClick={onCopyOptions} disabled={actionBusy || loading || !copySourceStoreId}>
              {copying ? "복사 중..." : "다른 매장 옵션 복사"}
            </button>
          </div>
          <div className="scopeRow">
            {[
              { key: "common", label: "공통옵션" },
              { key: "exclusive", label: "전용옵션(조회)" },
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

            {activeScope === "exclusive" ? (
              <div className="btnRow" style={{ marginTop: 8 }}>
                <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                  메뉴관리로 이동
                </a>
              </div>
            ) : null}

            {activeScope === "common" ? (
              <div className="btnRow">
                <button className="btn btnPrimary" onClick={addGroup} disabled={actionBusy || loading}>
                  + 새 그룹
                </button>
                <button className="btn" onClick={refresh} disabled={actionBusy || loading}>
                  새로고침
                </button>
              </div>
            ) : null}

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
                  {activeScope === "exclusive" ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      연결 메뉴: {(linkedMenuNamesByGroupId[g.id] || []).join(", ") || "없음"}
                    </div>
                  ) : null}
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
                    {isExclusiveSelected ? (
                      <>
                        <div>옵션관리에서는 조회/삭제만 가능합니다.</div>
                        <div style={{ marginBottom: 10 }}>등록.수정은 메뉴관리에서 해주세요.</div>
                      </>
                    ) : (
                      "공통옵션 그룹과 항목을 등록/수정/삭제할 수 있습니다."
                    )}
                  </div>
                </div>

                <button className="sectionToggle" type="button" onClick={() => setDetailOpen((v) => !v)}>
                  {detailOpen ? "▼ 그룹 정보 접기" : "▶ 그룹 정보 펼치기"}
                </button>
                {detailOpen ? (
                  <>
                <div className="groupTopRow">
                  <div className="field" style={{ marginTop: 0 }}>
                    <div className="label">그룹명</div>
                    <input
                      className="input"
                      value={groupDraft.name}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                      disabled={actionBusy || loading || isExclusiveSelected}
                    />
                  </div>

                  <div className="field" style={{ marginTop: 0 }}>
                    <div className="label">필수 여부</div>
                    <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900 }}>
                      <input
                        type="checkbox"
                        checked={groupDraft.required}
                        onChange={(e) =>
                          setGroupDraft((prev) => ({ ...prev, required: e.target.checked, min: e.target.checked ? "1" : "0" }))
                        }
                        disabled={actionBusy || loading || isExclusiveSelected}
                      />
                      필수
                    </label>
                  </div>
                </div>

                <div className="row3" style={{ alignItems: isExclusiveSelected ? "start" : "end" }}>
                  <div className="field" style={{ marginTop: 0 }}>
                    <div className="label">최대 선택</div>
                    <input
                      className="input maxInput"
                      inputMode="numeric"
                      value={groupDraft.max}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, max: e.target.value }))}
                      disabled={actionBusy || loading || isExclusiveSelected}
                    />
                  </div>
                  {!isExclusiveSelected ? (
                    <div className="field" style={{ marginTop: 0 }}>
                      <div className="label">그룹 ID</div>
                      <input className="input" value={selectedGroup.id} readOnly />
                    </div>
                  ) : (
                    <div className="field linkedMenuField" style={{ marginTop: 0 }}>
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
                  )}
                </div>

                <div className="btnRow">
                  {!isExclusiveSelected ? (
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
                      disabled={actionBusy || loading || !groupDraft.name.trim()}
                    >
                      그룹 저장
                    </button>
                  ) : null}
                  <button className="btn btnDanger" onClick={deleteGroup} disabled={actionBusy || loading}>
                    그룹 삭제
                  </button>
                </div>
                  </>
                ) : null}

                <button className="sectionToggle" type="button" onClick={() => setLinkedOpen((v) => !v)}>
                  {linkedOpen ? "▼ 연결 메뉴 접기" : "▶ 연결 메뉴 펼치기"}
                </button>
                {linkedOpen && !isExclusiveSelected ? (
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
                ) : null}

                <button className="sectionToggle" type="button" onClick={() => setItemsOpen((v) => !v)}>
                  {itemsOpen ? "▼ 옵션 항목 접기" : "▶ 옵션 항목 펼치기"}
                </button>
                {itemsOpen && !isExclusiveSelected ? (
                  <div className="btnRow" style={{ marginTop: 12 }}>
                    <button className="btn btnPrimary" onClick={() => setShowCreateItemForm((v) => !v)} disabled={actionBusy || loading}>
                      + 옵션 추가
                    </button>
                  </div>
                ) : null}

                {itemsOpen ? (
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
                          disabled={actionBusy || loading}
                        >
                          삭제
                        </button>
                      </div>
                    ))}

                    {!loading && groupItems.length === 0 ? (
                      <div className="muted" style={{ marginTop: 10 }}>
                        {isExclusiveSelected
                          ? "이 그룹에는 옵션 항목이 없습니다."
                          : "이 그룹에는 옵션 항목이 없습니다. “+ 옵션 추가”를 눌러주세요."}
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
                            disabled={actionBusy || loading}
                          />
                          <input
                            className="input"
                            inputMode="numeric"
                            value={newItemDraft.price}
                            onChange={(e) => setNewItemDraft((p) => ({ ...p, price: e.target.value }))}
                            placeholder="단가 입력"
                            disabled={actionBusy || loading}
                          />
                          <button className="btn itemSaveBtn" onClick={addItem} disabled={actionBusy || loading}>
                            항목 저장
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      )}

      {confirmState.open ? (
        <div className="modalOverlay">
          <div className="modalCard">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 950 }}>{confirmState.title}</h3>
            <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
              {confirmState.description}
            </p>
            <div className="btnRow" style={{ justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn" type="button" onClick={closeConfirm}>
                취소
              </button>
              <button className="btn btnPrimary" type="button" onClick={() => confirmState.action?.()} disabled={actionBusy}>
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function AdminOptionsPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminOptionsPageInner />
    </Suspense>
  );
}
