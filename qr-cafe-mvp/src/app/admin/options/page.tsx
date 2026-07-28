// src/app/admin/options/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import { getSetupProgress, setSetupStepConfirmed } from "@/app/lib/setupProgress";
import SetupProgressBanner from "@/app/admin/_components/SetupProgressBanner";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import MenuAdminNav from "@/app/admin/_components/MenuAdminNav";

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  sort_order?: number | null;
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

function menuHasOptionGroup(menu: MenuSummary, groupId: string) {
  return Array.isArray(menu.option_group_ids) && menu.option_group_ids.includes(groupId);
}

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

type MenuLinkStatusFilter = "all" | "linked" | "unlinked";

type OptionTemplateItem = {
  name: string;
  priceDelta: number;
};

type OptionTemplateGroup = {
  name: string;
  required: boolean;
  min: number;
  max: number;
  items: OptionTemplateItem[];
};

type OptionTemplate = {
  id: string;
  title: string;
  summary: string;
  groups: OptionTemplateGroup[];
};

function uid(prefix = "opt") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

const optionTemplates: OptionTemplate[] = [
  {
    id: "cafe-drink",
    title: "카페/음료",
    summary: "온도 · 사이즈",
    groups: [
      {
        name: "온도",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "HOT", priceDelta: 0 },
          { name: "ICE", priceDelta: 0 },
        ],
      },
      {
        name: "사이즈",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "기본", priceDelta: 0 },
          { name: "라지", priceDelta: 500 },
          { name: "점보", priceDelta: 1000 },
        ],
      },
      {
        name: "샷 추가",
        required: false,
        min: 0,
        max: 2,
        items: [
          { name: "1샷 추가", priceDelta: 500 },
          { name: "2샷 추가", priceDelta: 1000 },
        ],
      },
      {
        name: "시럽 추가",
        required: false,
        min: 0,
        max: 2,
        items: [
          { name: "헤이즐넛", priceDelta: 500 },
          { name: "바닐라", priceDelta: 500 },
          { name: "카라멜", priceDelta: 500 },
        ],
      },
    ],
  },
  {
    id: "restaurant",
    title: "일반 식당",
    summary: "맵기 · 곱빼기",
    groups: [
      {
        name: "맵기",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "순한맛", priceDelta: 0 },
          { name: "보통맛", priceDelta: 0 },
          { name: "매운맛", priceDelta: 0 },
        ],
      },
      {
        name: "기본선택",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "기본", priceDelta: 0 },
          { name: "곱빼기", priceDelta: 1000 },
        ],
      },
    ],
  },
  {
    id: "snack-foodtruck",
    title: "분식/푸드트럭",
    summary: "소스 · 토핑",
    groups: [
      {
        name: "소스",
        required: false,
        min: 0,
        max: 2,
        items: [
          { name: "케첩", priceDelta: 0 },
          { name: "머스타드", priceDelta: 0 },
          { name: "칠리", priceDelta: 0 },
          { name: "마요", priceDelta: 0 },
        ],
      },
      {
        name: "토핑 추가",
        required: false,
        min: 0,
        max: 3,
        items: [
          { name: "치즈 추가", priceDelta: 1000 },
          { name: "소시지 추가", priceDelta: 1500 },
          { name: "계란 추가", priceDelta: 1000 },
        ],
      },
    ],
  },
  {
    id: "popup-goods",
    title: "팝업/굿즈",
    summary: "사이즈 · 색상",
    groups: [
      {
        name: "사이즈",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "S", priceDelta: 0 },
          { name: "M", priceDelta: 0 },
          { name: "L", priceDelta: 0 },
          { name: "XL", priceDelta: 0 },
        ],
      },
      {
        name: "색상",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "블랙", priceDelta: 0 },
          { name: "화이트", priceDelta: 0 },
          { name: "네이비", priceDelta: 0 },
          { name: "레드", priceDelta: 0 },
        ],
      },
      {
        name: "포장",
        required: false,
        min: 0,
        max: 1,
        items: [
          { name: "일반 포장", priceDelta: 0 },
          { name: "선물 포장", priceDelta: 1000 },
        ],
      },
      {
        name: "수령 방식",
        required: true,
        min: 1,
        max: 1,
        items: [
          { name: "현장 수령", priceDelta: 0 },
          { name: "예약 수령", priceDelta: 0 },
        ],
      },
    ],
  },
];

function formatTemplateItem(item: OptionTemplateItem) {
  return item.priceDelta > 0 ? `${item.name}(+${item.priceDelta.toLocaleString()})` : item.name;
}

function AdminOptionsPageInner() {
  const sp = useSearchParams();
  const setupMode = (sp.get("mode") || "manual").trim();
  const setupModeLabel = setupMode === "copy" ? "원본 복사" : setupMode === "bulk" ? "일괄 등록" : "직접 설정";
  const [storeId, setStoreId] = useState<string>("");
  const [storeName, setStoreName] = useState("");

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<OptionItem[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [categoryCount, setCategoryCount] = useState(0);
  const [hasLinkedMenuColumn, setHasLinkedMenuColumn] = useState(true);
  const [hasSortOrderColumn, setHasSortOrderColumn] = useState(true);
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
    sortOrder: "",
    scope: "common" as "common" | "exclusive",
    linkedMenuId: "",
  });
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false);
  const [createGroupDraft, setCreateGroupDraft] = useState({ name: "", required: false, max: "1" });
  const [showCreateItemForm, setShowCreateItemForm] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState({ name: "", price: "" });
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [copySourceStoreId, setCopySourceStoreId] = useState("");
  const [copying, setCopying] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);
  const [stepConfirmed, setStepConfirmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");
  const actionBusy = saving || copying;
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    description: "",
    action: null,
  });
  const [editingItemId, setEditingItemId] = useState("");
  const [editItemDraft, setEditItemDraft] = useState({ name: "", price: "" });
  const [orderDirty, setOrderDirty] = useState(false);
  const [showTemplatePanel, setShowTemplatePanel] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [showTemplateNextStep, setShowTemplateNextStep] = useState(false);
  const [linkedMenusExpanded, setLinkedMenusExpanded] = useState(false);

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
      setOrderDirty(false);
      return;
      }

      let nextGroups: OptionGroup[] = [];
      const gRes = await supabase
        .from("option_groups")
        .select("id, store_id, name, required, min, max, sort_order, scope, linked_menu_id")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (gRes.error) {
        const errText = `${gRes.error.code || ""} ${gRes.error.message || ""}`;
        const missingLinkedMenuColumn =
          gRes.error.code === "42703" && errText.includes("linked_menu_id");
        const missingSortOrderColumn =
          gRes.error.code === "42703" && errText.includes("sort_order");

        if (!missingLinkedMenuColumn && !missingSortOrderColumn) throw gRes.error;

        const fallbackSelect = missingLinkedMenuColumn
          ? "id, store_id, name, required, min, max, scope"
          : "id, store_id, name, required, min, max, scope, linked_menu_id";
        const fallbackRes = await supabase
          .from("option_groups")
          .select(fallbackSelect)
          .eq("store_id", storeId)
          .order("created_at", { ascending: true });
        if (fallbackRes.error) throw fallbackRes.error;

        setHasLinkedMenuColumn(!missingLinkedMenuColumn);
        setHasSortOrderColumn(!missingSortOrderColumn);
        const fallbackRows = (fallbackRes.data || []) as unknown as Array<Record<string, unknown>>;
        nextGroups = fallbackRows.map((g, i) => ({ ...g, sort_order: i + 1 })) as OptionGroup[];
      } else {
        setHasLinkedMenuColumn(true);
        setHasSortOrderColumn(true);
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
      const cRes = await supabase
        .from("menu_categories")
        .select("id", { count: "exact", head: true })
        .eq("store_id", storeId);
      if (cRes.error) throw cRes.error;

      const nextItems = (iRes.data || []) as OptionItem[];
      const nextMenus = (mRes.data || []) as MenuSummary[];

      setGroups(nextGroups);
      setItems(nextItems);
      setMenus(nextMenus);
      setCategoryCount(Number(cRes.count || 0));
      setOrderDirty(false);

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
    if (!storeId) {
      setStoreName("");
      return;
    }
    let mounted = true;
    (async () => {
      const [{ data }, progress] = await Promise.all([
        supabase.from("stores").select("setup_completed,store_name").eq("store_id", storeId).maybeSingle(),
        getSetupProgress(storeId),
      ]);
      if (!mounted) return;
      const row = data as { setup_completed?: boolean | null; store_name?: string | null } | null;
      setSetupCompleted(Boolean(row?.setup_completed));
      setStepConfirmed(progress.step2);
      setStoreName(String(row?.store_name || ""));
    })();
    return () => {
      mounted = false;
    };
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
  const selectedTemplate = useMemo(
    () => optionTemplates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId]
  );

  useEffect(() => {
    if (!selectedGroup) {
      setGroupDraft({ name: "", required: false, min: "0", max: "1", sortOrder: "", scope: "common", linkedMenuId: "" });
      setShowCreateItemForm(false);
      setNewItemDraft({ name: "", price: "" });
      setLinkedMenusExpanded(false);
      return;
    }
    setGroupDraft({
      name: selectedGroup.name || "",
      required: Boolean(selectedGroup.required),
      min: String(selectedGroup.min ?? 0),
      max: String(selectedGroup.max ?? 1),
      sortOrder: selectedGroup.sort_order == null ? "" : String(selectedGroup.sort_order),
      scope: selectedGroup.scope === "exclusive" ? "exclusive" : "common",
      linkedMenuId: selectedGroup.linked_menu_id || "",
    });
    setLinkedMenusExpanded(false);
  }, [selectedGroup, items]);

  const groupItems = useMemo(
    () => items.filter((it) => it.group_id === selectedGroupId),
    [items, selectedGroupId]
  );
  const hasCopySource = myStores.length > 0;
  const scopedGroups = useMemo(
    () =>
      groups
        .filter((g) => (g.scope || "common") === activeScope)
        .sort((a, b) => {
          const ao = Number(a.sort_order ?? Number.MAX_SAFE_INTEGER);
          const bo = Number(b.sort_order ?? Number.MAX_SAFE_INTEGER);
          if (ao !== bo) return ao - bo;
          return a.id.localeCompare(b.id);
        }),
    [groups, activeScope]
  );
  const itemCountByGroupId = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      m.set(it.group_id, (m.get(it.group_id) || 0) + 1);
    }
    return m;
  }, [items]);

  useEffect(() => {
    setSelectedGroupId((prev) => {
      if (prev && scopedGroups.some((g) => g.id === prev)) return prev;
      return scopedGroups[0]?.id || "";
    });
  }, [scopedGroups]);

  const isInitialOptionSetup = !loading && groups.length === 0;
  const isCopyMode = setupMode === "copy";
  const isBulkMode = setupMode === "bulk";
  const showOptionAssist = isInitialOptionSetup && !isCopyMode && !isBulkMode;
  const hasCategoryPrerequisite = categoryCount > 0 || groups.length > 0;
  const hasOptionData = groups.length > 0;
  const canShowOptionManagement = setupMode === "manual" || hasOptionData;
  const groupIdsWithItems = new Set(items.map((item) => item.group_id));
  const hasOptionSetupReady = groups.some((group) => groupIdsWithItems.has(group.id));
  const showCopyHiddenNotice = isCopyMode && hasOptionData;
  const isExclusiveSelected = (selectedGroup?.scope || "common") === "exclusive";

  // 옵션 연결 확인 검색/필터 상태는 /admin/menu/option-connect 전용 페이지에서만 관리합니다.
  const linkedMenus = useMemo(() => {
    if (!selectedGroup) return [];
    return menus.filter((m) => menuHasOptionGroup(m, selectedGroup.id));
  }, [menus, selectedGroup]);

  const linkedMenuNamesByGroupId = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) {
      map[g.id] = menus.filter((m) => menuHasOptionGroup(m, g.id)).map((m) => m.name);
    }
    return map;
  }, [groups, menus]);

  const selectedRuleSummary = selectedGroup
    ? (() => {
        const max = Math.max(toInt(groupDraft.max, selectedGroup.max || 1), 1);
        if (groupDraft.required) {
          return max === 1 ? "필수 · 1개 선택" : `필수 · 최대 ${max}개 선택/추가`;
        }
        return max === 1 ? "선택 옵션 · 최대 1개" : `선택 옵션 · 최대 ${max}개 선택/추가`;
      })()
    : "";
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
    const nextName = createGroupDraft.name.trim();
    if (!nextName) {
      setMsgTone("error");
      return setMsg("옵션 그룹명을 입력해 주세요.");
    }
    try {
      setSaving(true);
      setBadge("idle");

      const id = uid("group");
      const max = Math.max(toInt(createGroupDraft.max, 1), 1);
      const row = {
        id,
        store_id: storeId,
        name: nextName,
        required: createGroupDraft.required,
        min: createGroupDraft.required ? 1 : 0,
        max,
        sort_order: scopedGroups.length + 1,
        scope: "common" as const,
        linked_menu_id: null,
      };

      const { error } = await supabase.from("option_groups").insert([row]);
      if (error) throw error;

      await refresh();
      setSelectedGroupId(id);
      setShowCreateGroupForm(false);
      setCreateGroupDraft({ name: "", required: false, max: "1" });
      setShowCreateItemForm(true);
      setNewItemDraft({ name: "", price: "" });
      markSaved();
      setMsgTone("success");
      setMsg("옵션 그룹을 만들었습니다. 이제 옵션 항목을 추가해 주세요.");
    } catch (e: unknown) {
      console.error("[admin/options] addGroup:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`그룹 생성 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (template: OptionTemplate) => {
    if (!storeId) {
      setMsgTone("error");
      return setMsg("선택된 매장이 없습니다. 매장을 먼저 선택/생성하세요.");
    }
    if (groups.length > 0) {
      markError();
      setMsgTone("error");
      return setMsg("템플릿은 옵션 그룹이 없을 때만 적용할 수 있습니다.");
    }

    closeConfirm();
    try {
      setSaving(true);
      setBadge("idle");

      const groupRows = template.groups.map((group, idx) => ({
        id: uid("group"),
        store_id: storeId,
        name: group.name,
        required: group.required,
        min: group.required ? Math.max(group.min, 1) : Math.max(group.min, 0),
        max: Math.max(group.max, 1),
        sort_order: idx + 1,
        scope: "common" as const,
        linked_menu_id: null,
      }));

      const { error: groupError } = await supabase.from("option_groups").insert(groupRows);
      if (groupError) throw groupError;

      const itemRows = groupRows.flatMap((groupRow, groupIndex) =>
        template.groups[groupIndex].items.map((item) => ({
          id: uid("item"),
          store_id: storeId,
          group_id: groupRow.id,
          name: item.name,
          price_delta: item.priceDelta,
        }))
      );

      if (itemRows.length > 0) {
        const { error: itemError } = await supabase.from("option_items").insert(itemRows);
        if (itemError) {
          await supabase
            .from("option_groups")
            .delete()
            .eq("store_id", storeId)
            .in("id", groupRows.map((group) => group.id));
          throw itemError;
        }
      }

      await refresh();
      setSelectedGroupId(groupRows[0]?.id || "");
      setSelectedTemplateId("");
      setShowTemplatePanel(false);
      setShowTemplateNextStep(true);
      setShowCreateGroupForm(false);
      setShowCreateItemForm(false);
      setNewItemDraft({ name: "", price: "" });
      markSaved();
      setMsgTone("success");
      setMsg("템플릿을 적용했습니다. 가격과 항목을 매장에 맞게 수정해 주세요.");
    } catch (e: unknown) {
      console.error("[admin/options] applyTemplate:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`템플릿 적용 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmApplyTemplate = (template: OptionTemplate) => {
    openConfirm(
      "템플릿 적용",
      `${template.title} 템플릿의 옵션 그룹과 항목을 추가할까요?`,
      () => void applyTemplate(template)
    );
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
          sort_order: typeof patch.sort_order === "number" ? patch.sort_order : selectedGroup.sort_order ?? 0,
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

  const moveCommonGroup = (groupId: string, dir: -1 | 1) => {
    const common = scopedGroups.filter((g) => (g.scope || "common") === "common");
    const idx = common.findIndex((g) => g.id === groupId);
    if (idx < 0) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= common.length) return;

    const ids = common.map((g) => g.id);
    [ids[idx], ids[nextIdx]] = [ids[nextIdx], ids[idx]];

    setGroups((prev) => {
      const orderMap = new Map(ids.map((id, i) => [id, i + 1]));
      return prev.map((g) => ((g.scope || "common") === "common" && orderMap.has(g.id) ? { ...g, sort_order: orderMap.get(g.id)! } : g));
    });
    setOrderDirty(true);
  };

  const saveCommonOrder = async () => {
    if (!storeId || actionBusy) return;
    const common = scopedGroups.filter((g) => (g.scope || "common") === "common");
    try {
      setSaving(true);
      setBadge("idle");
      for (let i = 0; i < common.length; i += 1) {
        const g = common[i];
        const { error } = await supabase
          .from("option_groups")
          .update({ sort_order: i + 1 })
          .eq("store_id", storeId)
          .eq("id", g.id);
        if (error) throw error;
      }
      await refresh();
      markSaved();
      setMsgTone("success");
      setMsg("옵션 그룹 순서를 저장했습니다.");
      setOrderDirty(false);
    } catch (e: unknown) {
      console.error("[admin/options] saveCommonOrder:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`그룹 순서 저장 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
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

  const beginEditItem = (it: OptionItem) => {
    setEditingItemId(it.id);
    setEditItemDraft({
      name: it.name || "",
      price: String(it.price_delta ?? 0),
    });
  };

  const cancelEditItem = () => {
    setEditingItemId("");
    setEditItemDraft({ name: "", price: "" });
  };

  const saveItem = async (id: string) => {
    const nextName = editItemDraft.name.trim();
    if (!nextName) {
      setMsgTone("error");
      return setMsg("옵션명을 입력하세요.");
    }
    try {
      setSaving(true);
      setBadge("idle");
      const { error } = await supabase
        .from("option_items")
        .update({
          name: nextName,
          price_delta: toInt(editItemDraft.price, 0),
        })
        .eq("id", id)
        .eq("store_id", storeId);
      if (error) throw error;
      await refresh();
      cancelEditItem();
      markSaved();
      setMsgTone("success");
      setMsg("옵션 항목을 수정했습니다.");
    } catch (e: unknown) {
      console.error("[admin/options] saveItem:", toErrMsg(e));
      markError();
      setMsgTone("error");
      setMsg(`옵션 수정 실패: ${toErrMsg(e)}`);
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

  const onCompleteStep = async () => {
    if (!storeId || !hasOptionSetupReady) return;
    const ok = await setSetupStepConfirmed(storeId, "step2", true);
    if (!ok) {
      setMsgTone("error");
      setMsg("단계 완료 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    setStepConfirmed(true);
    setMsgTone("success");
    setMsg("공통옵션 확인이 완료되었습니다.");
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
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
          font-size: 13px;
          font-weight: 800;
          line-height: 1.4;
        }
        .copyHelpText { margin-top: 6px; }
        .copyWarnText { margin-top: 2px; color: #b45309; }
        .modeActionCard {
          border-color: #bfdbfe;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.08);
        }
        .modeActionBulk {
          border-color: #fde68a;
          background: linear-gradient(180deg, #fffbeb, #ffffff);
          box-shadow: 0 8px 24px rgba(245, 158, 11, 0.1);
        }
        .modeActionHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .modeActionTitle {
          font-weight: 950;
          font-size: 14px;
          color: #0f172a;
        }
        .modeActionBadge {
          border: 1px solid #93c5fd;
          background: #dbeafe;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
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
        .nextStepCard {
          margin-top: 8px;
          border: 1px solid #bfdbfe;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 8px;
        }
        .nextStepTitle {
          font-size: 13px;
          font-weight: 950;
          color: #1d4ed8;
        }
        .nextStepActions {
          margin-top: 0;
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
        .detailCard {
          padding: 12px;
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
        .createActionRow {
          justify-content: space-between;
          align-items: center;
        }
        .primaryActionGroup,
        .utilityActionGroup {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          color: var(--text);
          -webkit-text-fill-color: currentColor;
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
        .groupList {
          max-height: clamp(320px, 58vh, 640px);
          overflow-y: auto;
          padding-right: 4px;
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
          font-size: 15px;
        }
        .rowMain {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
        }
        .rowMain .name {
          min-width: 0;
          line-height: 1.3;
          overflow-wrap: anywhere;
        }
        .rowMeta {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          justify-content: flex-end;
          justify-self: end;
          white-space: nowrap;
        }
        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          padding: 4px 8px;
        }
        .statusRequired {
          background: #fee2e2;
          color: #991b1b;
        }
        .statusOptional {
          background: #e5e7eb;
          color: #374151;
        }
        .statusLinked {
          background: #dcfce7;
          color: #166534;
        }
        .statusUnlinked {
          background: #fff7ed;
          color: #9a3412;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 13px;
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
          color: var(--text);
          -webkit-text-fill-color: currentColor;
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
        .sectionSubTitle {
          margin: 0;
          font-size: 13px;
          font-weight: 900;
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
          font-size: 13px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          font-weight: 800;
          font-size: 14px;
          width: 100%;
        }
        .groupTopRow {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(88px, 110px) auto;
          gap: 10px;
          align-items: end;
        }
        .requiredInline {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          font-weight: 800;
          color: #334155;
          font-size: 12px;
        }
        .templateCard {
          margin-top: 10px;
          border: 1px solid #dbeafe;
          background: #f8fafc;
          border-radius: 14px;
          padding: 10px;
          display: grid;
          gap: 8px;
        }
        .templateGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .templateBtn {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          padding: 9px;
          text-align: left;
          cursor: pointer;
          display: grid;
          gap: 4px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .templateBtn:hover:not(:disabled),
        .templateBtnOn {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
        }
        .templateBtn:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }
        .templateBtn strong {
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
        }
        .templateBtn span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }
        .templatePreview {
          border: 1px solid #bfdbfe;
          background: #fff;
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 8px;
        }
        .templatePreviewTitle {
          font-size: 13px;
          font-weight: 900;
          color: #1e40af;
        }
        .templatePreviewList {
          display: grid;
          gap: 7px;
          max-height: 178px;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 2px;
        }
        .templatePreviewRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding: 8px;
          border: 1px solid #eef2f7;
          border-radius: 10px;
          background: #f8fafc;
        }
        .templatePreviewRow div {
          min-width: 0;
          display: grid;
          gap: 3px;
        }
        .templatePreviewRow strong {
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
        }
        .templatePreviewRow div span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .templateEditHint {
          border: 1px solid #e0e7ff;
          background: #eef2ff;
          color: #3730a3;
          border-radius: 10px;
          padding: 8px 9px;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.35;
        }
        .templateActions {
          margin-top: 0;
          justify-content: flex-end;
        }
        .templateFooter {
          margin-top: -2px;
        }
        .createGroupCard {
          margin-top: 10px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 8px;
        }
        .createGroupGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(120px, 150px);
          gap: 8px;
          align-items: start;
        }
        .createGroupField {
          display: grid;
          gap: 5px;
        }
        .createGroupHint {
          margin-top: -2px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }
        .createRequiredInline {
          white-space: normal;
          align-items: flex-start;
        }
        .createGroupActions {
          margin-top: 4px;
        }
        .requiredRuleStack {
          display: grid;
          gap: 6px;
          align-self: end;
        }
        .ruleSummary {
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1e40af;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 900;
          line-height: 1.25;
          width: fit-content;
          max-width: 100%;
          white-space: nowrap;
        }
        .groupActionRow {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .emptyItemCard,
        .emptyLinkBox {
          margin-top: 10px;
          border: 1px dashed var(--line);
          border-radius: 12px;
          background: #f8fafc;
          padding: 10px;
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .emptyItemCard {
          justify-content: flex-start;
        }
        .emptyLinkText {
          display: grid;
          gap: 6px;
        }
        .itemCollapsedHint {
          margin-top: 8px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #f8fafc;
          padding: 10px 12px;
          display: grid;
          gap: 8px;
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
        .itemFormActions {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .itemSaveBtn {
          width: 100%;
          justify-self: stretch;
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
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .itemName {
          font-size: 15px;
          font-weight: 900;
        }
        .itemPrice {
          color: var(--muted);
          font-weight: 900;
          font-size: 12px;
          white-space: nowrap;
        }
        .itemActions {
          display: inline-flex;
          gap: 8px;
          flex-wrap: nowrap;
        }
        .itemActionBtn {
          font-size: 12px;
          font-weight: 800;
          padding: 6px 9px;
          border-radius: 9px;
        }
        .detailCard .field {
          margin-top: 8px;
        }
        .detailCard .input {
          font-size: 13px;
          padding: 8px 10px;
          border-radius: 10px;
        }
        .detailCard .btn {
          font-size: 13px;
          padding: 8px 10px;
          border-radius: 10px;
        }
        .orderActionRow {
          display: inline-flex;
          gap: 4px;
          margin-left: 2px;
          flex: 0 0 auto;
        }
        .orderBtn {
          border: 1px solid #dbe2ea;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
          border-radius: 9px;
          width: 28px;
          height: 26px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.06);
          transition: background 0.15s ease, transform 0.1s ease, border-color 0.15s ease;
        }
        .orderBtn:hover:not(:disabled) {
          border-color: #cbd5e1;
          background: #f1f5f9;
        }
        .orderBtn:active:not(:disabled) {
          transform: translateY(1px);
        }
        .orderBtn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .orderBtn svg {
          width: 14px;
          height: 14px;
          stroke: #334155;
          stroke-width: 2.2;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .linkedMenuSummary {
          margin-top: 12px;
          border-top: 1px solid var(--line);
          padding-top: 12px;
        }
        .linkedMenuHeader {
          width: 100%;
          border: 0;
          background: transparent;
          color: var(--text);
          padding: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          text-align: left;
          cursor: pointer;
        }
        .linkedMenuTitleRow {
          min-width: 0;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .linkedMenuToggle {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 5px 9px;
          color: #334155;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }
        .linkedMenuBody {
          margin-top: 10px;
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

        @media (max-width: 560px) {
          .templateGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .templatePreviewList {
            max-height: 150px;
          }
          .templatePreviewRow {
            grid-template-columns: 1fr;
          }
          .templatePreviewRow > .pill {
            justify-self: start;
          }
          .rowMain {
            align-items: start;
          }
          .rowMeta {
            gap: 4px;
          }
          .rowMeta .muted {
            font-size: 11px;
          }
          .orderBtn {
            width: 26px;
            height: 24px;
          }
          .ruleSummary {
            white-space: normal;
            border-radius: 10px;
          }
        }

        @media (min-width: 561px) and (max-width: 768px) {
          .wrap { padding: 12px; gap: 9px; }
          .card { padding: 12px; border-radius: 14px; }
          .h1 { font-size: 22px; }
          .headerActionRow { gap: 6px; }
          .headerActionRow .btn { padding: 8px 10px; font-size: 12px; }
          .scopeRow { gap: 6px; }
          .scopeBtn, .modeSwitchBtn { min-height: 38px; padding: 7px 10px; font-size: 12px; }
          .groupList { gap: 7px; }
          .rowBtn { padding: 10px; }
          .detailCard { padding: 11px; }
          .btnRow { gap: 6px; }
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .groupTopRow {
            grid-template-columns: 1fr minmax(86px, 110px);
            align-items: end;
          }
          .name {
            font-size: 14px;
          }
          .muted,
          .label {
            font-size: 12px;
          }
          .itemLine {
            grid-template-columns: minmax(0, 1fr) minmax(110px, 0.8fr);
          }
          .createGroupGrid {
            grid-template-columns: minmax(0, 1fr);
          }
          .itemName {
            font-size: 14px;
          }
          .itemActionBtn {
            font-size: 11px;
            padding: 5px 8px;
          }
          .itemSaveBtn {
            width: 100%;
            justify-self: stretch;
          }
          .menuConnectionTools {
            grid-template-columns: 1fr;
          }
          .menuConnectionFilters {
            justify-content: flex-start;
          }
          .menuConnectionRow {
            grid-template-columns: 1fr;
          }
          .menuConnectionSummary,
          .menuConnectionButtons {
            width: 100%;
          }
          .menuConnectionButtons .btn {
            flex: 1 1 140px;
          }
        }
      `}</style>

      <AdminPageHeader title="옵션 관리" description="여러 메뉴에서 함께 사용할 옵션 그룹과 항목을 관리합니다." storeId={storeId} storeName={storeName} eyebrow="MENU MANAGEMENT" />
      <MenuAdminNav active="options" storeId={storeId} />
      <section className="topbar">
        <div className="topbarMain">
          {!setupCompleted ? (
            <section style={{ marginTop: 8 }}>
              <SetupProgressBanner
                stepLabel="공통옵션 확인"
                stepNumber={2}
                modeLabel={setupModeLabel}
                modeDescription={
                  setupMode === "manual"
                    ? "옵션 그룹/항목을 직접 등록하는 방식입니다."
                    : setupMode === "copy"
                      ? "원본 매장의 옵션을 복사해 빠르게 시작할 수 있습니다."
                      : "옵션은 일괄 등록을 지원하지 않아 직접 설정이 필요합니다."
                }
                stepGuide="여러 메뉴에서 함께 사용할 옵션 그룹과 항목을 확인해 주세요."
                completeLabel="공통옵션 확인 완료"
                isCompleted={stepConfirmed}
                completedLabel="공통옵션 확인 완료"
                completedDescription="공통으로 사용할 옵션이 준비되었습니다. 수정했다면 다시 확인해 주세요."
                completeDisabled={loading || actionBusy || !hasOptionSetupReady}
                disabledReason="옵션 그룹과 항목을 1개 이상 등록하면 완료할 수 있습니다."
                noticeText={
                  showCopyHiddenNotice
                    ? "이미 등록된 옵션이 있어 원본 복사를 사용할 수 없습니다."
                    : isBulkMode
                      ? "옵션은 일괄 등록을 지원하지 않습니다. 옵션 그룹과 항목을 직접 등록해 주세요."
                      : ""
                }
                setupHref={`/admin/setup${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`}
                onComplete={() => void onCompleteStep()}
              />
            </section>
          ) : null}
          {msg ? (
            <div className={`msgBox ${msgTone === "success" ? "msgBoxSuccess" : msgTone === "error" ? "msgBoxError" : ""}`}>
              {msg}
            </div>
          ) : null}
          {showTemplateNextStep ? (
            <div className="nextStepCard">
              <div>
                <div className="nextStepTitle">다음 단계</div>
                <div className="muted">옵션 연결 확인에서 메뉴 연결 상태를 확인해 주세요.</div>
              </div>
              <div className="btnRow nextStepActions">
                <a className="btn btnPrimary" href={`/admin/menu/option-connect${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`}>
                  옵션 연결 확인
                </a>
                <button className="btn" type="button" onClick={() => setShowTemplateNextStep(false)}>
                  닫기
                </button>
              </div>
            </div>
          ) : null}
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

      </section>

      {!loading && !hasCategoryPrerequisite ? (
        <section className="card" style={{ borderColor: "#fcd34d", background: "#fffbeb" }}>
          <h2 className="cardTitle">선행 단계 필요</h2>
          <p className="sub" style={{ marginTop: 6 }}>카테고리를 1개 이상 등록해 주세요.</p>
          <div className="btnRow" style={{ marginTop: 8 }}>
            <a className="btn btnPrimary" href={`/admin/categories${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`}>카테고리 확인으로 이동</a>
          </div>
        </section>
      ) : null}
      {isInitialOptionSetup && isCopyMode ? (
        <section className="card modeActionCard">
          <div className="modeActionHead">
            <div className="modeActionTitle">원본 매장 옵션 복사</div>
            <span className="modeActionBadge">원본 복사</span>
          </div>
          <div className="copyRow">
            <select className="input copySelect" value={copySourceStoreId} onChange={(e) => setCopySourceStoreId(e.target.value)}>
              <option value="">원본 매장 선택</option>
              {myStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name || s.store_id} ({s.store_id})
                </option>
              ))}
            </select>
            <button className="btn copyBtn" type="button" onClick={onCopyOptions} disabled={actionBusy || loading || !hasCopySource || !copySourceStoreId}>
              {copying ? "복사 중..." : "다른 매장 옵션 복사"}
            </button>
          </div>
          <p className="sub copyHelpText">
            다른 매장 옵션을 복사합니다.
          </p>
          {!hasCopySource ? (
            <p className="sub copyWarnText">복사할 원본 매장이 없습니다.</p>
          ) : null}
        </section>
      ) : null}

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
      ) : canShowOptionManagement ? (
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
              <>
                <div className="btnRow createActionRow">
                  <div className="primaryActionGroup">
                    <button
                      className="btn btnPrimary"
                      onClick={() => {
                        setShowTemplatePanel(false);
                        setSelectedTemplateId("");
                        setShowCreateGroupForm((v) => !v);
                      }}
                      disabled={actionBusy || loading}
                      type="button"
                    >
                      {showCreateGroupForm ? "그룹 만들기 닫기" : "+ 새 그룹"}
                    </button>
                    {showOptionAssist ? (
                      <button
                        className="btn"
                        onClick={() => {
                          setShowCreateGroupForm(false);
                          setShowTemplatePanel((prev) => {
                            if (prev) setSelectedTemplateId("");
                            return !prev;
                          });
                        }}
                        disabled={actionBusy || loading}
                        type="button"
                      >
                        {showTemplatePanel ? "빠른 옵션 닫기" : "빠른 옵션 만들기"}
                      </button>
                    ) : null}
                  </div>
                  <div className="utilityActionGroup">
                    <button className="btn" onClick={refresh} disabled={actionBusy || loading}>
                      새로고침
                    </button>
                    <button className="btn" onClick={saveCommonOrder} disabled={actionBusy || loading || !orderDirty || !hasSortOrderColumn}>
                      순서 저장
                    </button>
                  </div>
                </div>
                {showOptionAssist && showTemplatePanel ? (
                  <div className="templateCard">
                    <div>
                      <div className="label">빠른 옵션 만들기</div>
                      <div className="muted">업종별 기본 옵션을 먼저 만들 수 있습니다.</div>
                    </div>
                    <div className="templateGrid">
                      {optionTemplates.map((template) => (
                        <button
                          key={template.id}
                          className={`templateBtn ${selectedTemplateId === template.id ? "templateBtnOn" : ""}`}
                          onClick={() => setSelectedTemplateId((prev) => (prev === template.id ? "" : template.id))}
                          disabled={actionBusy || loading}
                          type="button"
                        >
                          <strong>{template.title}</strong>
                          <span>{template.summary}</span>
                        </button>
                      ))}
                    </div>
                    {selectedTemplate ? (
                      <div className="templatePreview">
                        <div className="templatePreviewTitle">{selectedTemplate.title} 미리보기</div>
                        <div className="templatePreviewList">
                          {selectedTemplate.groups.map((group) => (
                            <div key={group.name} className="templatePreviewRow">
                              <div>
                                <strong>{group.name}</strong>
                                <span>{group.items.map(formatTemplateItem).join(", ")}</span>
                              </div>
                              <span className="pill">
                                {group.required ? "필수" : "선택"} · 최대 {group.max}개
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="templateEditHint">적용 후 그룹과 항목은 수정/삭제할 수 있습니다.</div>
                        <div className="btnRow templateActions">
                          <button
                            className="btn"
                            onClick={() => setSelectedTemplateId("")}
                            disabled={actionBusy || loading}
                            type="button"
                          >
                            취소
                          </button>
                          <button
                            className="btn btnPrimary"
                            onClick={() => confirmApplyTemplate(selectedTemplate)}
                            disabled={actionBusy || loading}
                            type="button"
                          >
                            템플릿 적용
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="muted templateFooter">원하는 업종이 없으면 + 새 그룹으로 직접 만들 수 있습니다.</div>
                  </div>
                ) : null}
                {showCreateGroupForm ? (
                  <div className="createGroupCard">
                    <div className="label">새 옵션 그룹 만들기</div>
                    <div className="muted">예: 사이즈, 맵기, 소스</div>
                    <div className="createGroupGrid">
                      <div className="createGroupField">
                        <div className="label">그룹명</div>
                        <input
                          className="input"
                          value={createGroupDraft.name}
                          onChange={(e) => setCreateGroupDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="예: 시럽 추가"
                          disabled={actionBusy || loading}
                        />
                      </div>
                      <div className="createGroupField">
                        <div className="label">최대 선택 수량</div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={createGroupDraft.max}
                          onChange={(e) => setCreateGroupDraft((prev) => ({ ...prev, max: e.target.value }))}
                          placeholder="예: 2"
                          disabled={actionBusy || loading}
                        />
                      </div>
                    </div>
                    <div className="createGroupHint">같은 항목도 여러 번 추가할 수 있어요.</div>
                    <label className="requiredInline createRequiredInline">
                      <input
                        type="checkbox"
                        checked={createGroupDraft.required}
                        onChange={(e) => setCreateGroupDraft((prev) => ({ ...prev, required: e.target.checked }))}
                        disabled={actionBusy || loading}
                      />
                      필수 옵션
                    </label>
                    <div className="btnRow createGroupActions">
                      <button className="btn btnPrimary" onClick={addGroup} disabled={actionBusy || loading || !createGroupDraft.name.trim()} type="button">
                        그룹 만들기
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          setShowCreateGroupForm(false);
                          setCreateGroupDraft({ name: "", required: false, max: "1" });
                        }}
                        disabled={actionBusy || loading}
                        type="button"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : null}
                {!hasSortOrderColumn ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    DB에 sort_order 컬럼이 없어 순서 이동/저장이 비활성화되었습니다. SQL 적용 후 사용해주세요.
                  </div>
                ) : null}
                <div className="muted" style={{ marginTop: 2 }}>
                  공통옵션 그룹 순서는 목록의 ↑/↓ 이동 후 “순서 저장” 버튼으로 반영됩니다.
                </div>
              </>
            ) : null}

            <div className="list groupList">
              {scopedGroups.map((g, idx) => (
                <button
                  key={g.id}
                  className={`rowBtn ${g.id === selectedGroupId ? "rowBtnOn" : ""}`}
                  onClick={() => setSelectedGroupId(g.id)}
                >
                  <div className="rowMain">
                    <div className="name" title={g.name}>{g.name}</div>
                    <div className="rowMeta">
                      <span className="pill">항목 {itemCountByGroupId.get(g.id) || 0}개</span>
                      <span className={`statusBadge ${g.required ? "statusRequired" : "statusOptional"}`}>
                        {g.required ? "필수" : "선택"}
                      </span>
                      <span className="muted">{g.min}~{g.max}개</span>
                      {(() => {
                        const linkedCount = (linkedMenuNamesByGroupId[g.id] || []).length;
                        return (
                          <span className={`statusBadge ${linkedCount > 0 ? "statusLinked" : "statusUnlinked"}`}>
                            {linkedCount > 0 ? `연결 ${linkedCount}개` : "미연결"}
                          </span>
                        );
                      })()}
                      {activeScope === "common" ? (
                        <span className="orderActionRow">
                          <button
                            className="orderBtn"
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              moveCommonGroup(g.id, -1);
                            }}
                            disabled={actionBusy || loading || idx === 0 || !hasSortOrderColumn}
                            aria-label={`${g.name} 위로 이동`}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M6 14l6-6 6 6" />
                            </svg>
                          </button>
                          <button
                            className="orderBtn"
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              moveCommonGroup(g.id, 1);
                            }}
                            disabled={actionBusy || loading || idx === scopedGroups.length - 1 || !hasSortOrderColumn}
                            aria-label={`${g.name} 아래로 이동`}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M6 10l6 6 6-6" />
                            </svg>
                          </button>
                        </span>
                      ) : null}
                    </div>
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
                    : "아직 옵션 그룹이 없습니다. 새 그룹을 만들고 항목을 추가해 주세요."}
                </div>
              ) : null}
            </div>
          </div>

          {/* 상세 */}
          <div className="card detailCard">
            <h2 className="cardTitle">옵션그룹 상세</h2>

            {!selectedGroup ? (
              <p className="muted" style={{ marginTop: 10 }}>
                그룹을 선택하세요.
              </p>
            ) : (
              <>
                <div className="field" style={{ marginTop: 0, marginBottom: 10 }}>
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
                    <div className="label">최대 선택</div>
                    <input
                      className="input maxInput"
                      inputMode="numeric"
                      value={groupDraft.max}
                      onChange={(e) => setGroupDraft((prev) => ({ ...prev, max: e.target.value }))}
                      disabled={actionBusy || loading || isExclusiveSelected}
                    />
                  </div>
                  <div className="requiredRuleStack">
                    <label className="requiredInline">
                      <input
                        type="checkbox"
                        checked={groupDraft.required}
                        onChange={(e) =>
                          setGroupDraft((prev) => ({ ...prev, required: e.target.checked, min: e.target.checked ? "1" : "0" }))
                        }
                        disabled={actionBusy || loading || isExclusiveSelected}
                      />
                      필수 여부
                    </label>
                    <span className="ruleSummary">{selectedRuleSummary}</span>
                  </div>
                </div>

                <div className="groupActionRow">
                  {!isExclusiveSelected ? (
                    <button
                      className="btn"
                      onClick={() => {
                        const min = groupDraft.required ? 1 : 0;
                        const max = Math.max(toInt(groupDraft.max, selectedGroup.max || 1), 1);
                        const sortOrder = Math.max(toInt(groupDraft.sortOrder, selectedGroup.sort_order ?? 1), 1);
                        updateGroup({
                          name: groupDraft.name.trim() || selectedGroup.name,
                          required: groupDraft.required,
                          min,
                          max,
                          sort_order: sortOrder,
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

                {!isExclusiveSelected ? (
                  <div className="btnRow" style={{ marginTop: 12 }}>
                    <button className="btn btnPrimary" onClick={() => setShowCreateItemForm((v) => !v)} disabled={actionBusy || loading}>
                      + 옵션 추가
                    </button>
                    <div className="muted">무료 항목은 추가금액에 0을 입력해 주세요.</div>
                  </div>
                ) : null}

                <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                    <h3 className="sectionSubTitle">옵션 항목</h3>

                    <div className="list" style={{ marginTop: 10 }}>
                      {groupItems.map((it) => (
                        <div key={it.id} className="savedItemRow">
                          {editingItemId === it.id ? (
                            <>
                              <div className="itemLine" style={{ gridColumn: "1 / -1" }}>
                                <input
                                  className="input"
                                  value={editItemDraft.name}
                                  onChange={(e) => setEditItemDraft((p) => ({ ...p, name: e.target.value }))}
                                  placeholder="옵션 항목명"
                                  disabled={actionBusy || loading}
                                />
                                <input
                                  className="input"
                                  inputMode="numeric"
                                  value={editItemDraft.price}
                                  onChange={(e) => setEditItemDraft((p) => ({ ...p, price: e.target.value }))}
                                  placeholder="추가금액(원)"
                                  disabled={actionBusy || loading}
                                />
                              </div>
                              <div className="itemActions" style={{ gridColumn: "1 / -1", justifyContent: "flex-end" }}>
                                <button className="btn" onClick={() => saveItem(it.id)} disabled={actionBusy || loading}>
                                  저장
                                </button>
                                <button className="btn" onClick={cancelEditItem} disabled={actionBusy || loading}>
                                  취소
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="savedItemMeta">
                                <div className="itemName">{it.name}</div>
                                <div className="itemPrice">{Number(it.price_delta ?? 0).toLocaleString()}원</div>
                              </div>
                              <div className="itemActions">
                                <button className="btn itemActionBtn" onClick={() => beginEditItem(it)} disabled={actionBusy || loading}>
                                  수정
                                </button>
                                <button className="btn btnDanger itemActionBtn" onClick={() => deleteItem(it.id)} disabled={actionBusy || loading}>
                                  삭제
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}

                      {!loading && groupItems.length === 0 ? (
                        <div className="emptyItemCard">
                          <div className="muted">아직 옵션 항목이 없습니다. 옵션 항목을 추가해 주세요.</div>
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
                              placeholder="추가금액(원)"
                              disabled={actionBusy || loading}
                            />
                            <div className="itemFormActions">
                              <button className="btn itemSaveBtn" onClick={addItem} disabled={actionBusy || loading}>
                                저장
                              </button>
                              <button
                                className="btn itemSaveBtn"
                                type="button"
                                onClick={() => {
                                  setShowCreateItemForm(false);
                                  setNewItemDraft({ name: "", price: "" });
                                }}
                                disabled={actionBusy || loading}
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                <div className="linkedMenuSummary">
                  <button
                    className="linkedMenuHeader"
                    type="button"
                    onClick={() => setLinkedMenusExpanded((prev) => !prev)}
                    aria-expanded={linkedMenusExpanded}
                  >
                    <span className="linkedMenuTitleRow">
                      <span className="label">연결된 메뉴</span>
                      <span className={`statusBadge ${linkedMenus.length > 0 ? "statusLinked" : "statusUnlinked"}`}>
                        {linkedMenus.length > 0 ? `총 ${linkedMenus.length}개 연결` : "미연결"}
                      </span>
                    </span>
                    <span className="linkedMenuToggle">{linkedMenusExpanded ? "접기" : "펼치기"}</span>
                  </button>
                  {linkedMenusExpanded ? (
                    <div className="linkedMenuBody">
                      {linkedMenus.length === 0 ? (
                        <div className="emptyLinkBox">
                          <div className="emptyLinkText">
                            <div className="muted">메뉴관리에서 필요한 메뉴에 공통옵션을 연결할 수 있습니다.</div>
                          </div>
                        </div>
                      ) : (
                        <div className="scopeRow">
                          {linkedMenus.slice(0, 8).map((m) => (
                            <span key={m.id} className="pill">
                              {m.name}
                            </span>
                          ))}
                          {linkedMenus.length > 8 ? <span className="pill">외 {linkedMenus.length - 8}개</span> : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </section>
      ) : isBulkMode ? (
        <section className="card modeActionCard modeActionBulk">
          <div className="modeActionHead">
            <div className="modeActionTitle">옵션은 직접 설정이 필요합니다</div>
            <span className="modeActionBadge">안내</span>
          </div>
          <p className="sub" style={{ margin: 0 }}>
            옵션은 일괄 등록으로 자동 생성되지 않습니다. 직접 등록하려면 위의 설정 방식 변경에서 직접 설정을 선택해 주세요.
          </p>
        </section>
      ) : null}

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
