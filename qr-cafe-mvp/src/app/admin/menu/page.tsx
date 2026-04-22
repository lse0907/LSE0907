"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

const MENU_IMAGE_BUCKET = "menu-assets";

type MenuItem = {
  id: string;
  store_id: string;
  name: string;
  price: number;
  image?: string | null;
  is_sold_out?: boolean | null;
  option_group_ids?: string[] | null;
  sort_order?: number | null;
  category_id?: string | null;
};

type MenuCategory = {
  id: string;
  store_id: string;
  name: string;
  sort_order?: number | null;
  is_active?: boolean | null;
};

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  scope?: "common" | "exclusive" | null;
  linked_menu_id?: string | null;
  required?: boolean;
  min?: number;
  max?: number;
};

type OptionItem = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta?: number | null;
};

type MenuOptionPrice = {
  store_id: string;
  menu_id: string;
  option_item_id: string;
  price_delta: number;
};
type MenuOptionItemExclusion = {
  store_id: string;
  menu_id: string;
  option_item_id: string;
};
type MyStore = {
  store_id: string;
  store_name: string | null;
};
type ConfirmState = {
  open: boolean;
  title: string;
  description: string;
  action: null | (() => void | Promise<void>);
};

type MenuDraft = {
  id: string;
  name: string;
  price: string;
  image: string;
  isSoldOut: boolean;
  optionGroupIds: string[];
  categoryId: string;
  optionPriceByItem: Record<string, string>;
  excludedCommonItemIds: string[];
};

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function isWholeNumberString(v: string) {
  return /^\d+$/.test(v.trim());
}

function getFileExt(name: string) {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

function summarizeFileName(name: string, maxLen = 24) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  if (raw.length <= maxLen) return raw;
  const ext = getFileExt(raw);
  const suffix = ext ? `.${ext}` : "";
  const keep = Math.max(maxLen - suffix.length - 1, 8);
  return `${raw.slice(0, keep)}…${suffix}`;
}

const emptyDraft: MenuDraft = {
  id: "",
  name: "",
  price: "",
  image: "",
  isSoldOut: false,
  optionGroupIds: [],
  categoryId: "",
  optionPriceByItem: {},
  excludedCommonItemIds: [],
};

function sanitizeIdPart(input: string) {
  const v = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return v || "store";
}

function buildNextMenuId(storeId: string, items: MenuItem[]) {
  const prefix = `${sanitizeIdPart(storeId)}-menu-`;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let maxSeq = 0;
  for (const row of items) {
    const m = String(row.id || "").match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, n);
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

function getGroupPolicyText(group: OptionGroup) {
  const min = Math.max(Number(group.min ?? 0), 0);
  const max = Math.max(Number(group.max ?? 1), 1);
  if (group.required) return `필수 ${min}~${max}`;
  return `선택 ${min}~${max}`;
}

function AdminMenuPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [optionItems, setOptionItems] = useState<OptionItem[]>([]);
  const [optionPrices, setOptionPrices] = useState<MenuOptionPrice[]>([]);
  const [optionExclusions, setOptionExclusions] = useState<MenuOptionItemExclusion[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [hasLinkedMenuColumn, setHasLinkedMenuColumn] = useState(true);
  const [hasExclusionTable, setHasExclusionTable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [badge, setBadge] = useState<"idle" | "saved" | "error">("idle");
  const badgeText = badge === "saved" ? "저장됨 ✅" : badge === "error" ? "저장 실패 ❗" : " ";
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageFileName, setImageFileName] = useState("");
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");
  const [exclusiveEditorMode, setExclusiveEditorMode] = useState<"none" | "edit" | "create">("none");
  const [optionTab, setOptionTab] = useState<"common" | "exclusive">("common");
  const [commonDirty, setCommonDirty] = useState(false);
  const [exclusiveDirty, setExclusiveDirty] = useState(false);
  const [pendingOptionTab, setPendingOptionTab] = useState<"common" | "exclusive" | null>(null);
  const [commonGroupToAdd, setCommonGroupToAdd] = useState("");
  const [newExclusiveGroup, setNewExclusiveGroup] = useState({
    name: "",
    max: "1",
  });
  const [newExclusiveItems, setNewExclusiveItems] = useState<Array<{ name: string; price: string }>>([]);
  const [showExclusiveItemInputs, setShowExclusiveItemInputs] = useState(false);
  const [selectedExclusiveGroupId, setSelectedExclusiveGroupId] = useState("");
  const [exclusiveEdit, setExclusiveEdit] = useState({ name: "", max: "1" });
  const [exclusiveEditItems, setExclusiveEditItems] = useState<Array<{ id: string; name: string; price: string }>>([]);
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [copySourceStoreId, setCopySourceStoreId] = useState("");
  const [copying, setCopying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState("");
  const [soldOutOnly, setSoldOutOnly] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: "",
    description: "",
    action: null,
  });

  const [draft, setDraft] = useState<MenuDraft>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string>("");
  const setStatus = (tone: "neutral" | "success" | "error", text: string) => {
    setMsgTone(tone);
    setMsg(text);
  };
  const clearStatus = () => {
    setMsgTone("neutral");
    setMsg("");
  };
  const openConfirm = (title: string, description: string, action: () => void | Promise<void>) => {
    setConfirmState({ open: true, title, description, action });
  };
  const closeConfirm = () => {
    setConfirmState({ open: false, title: "", description: "", action: null });
  };

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

  const refresh = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!authData?.user) {
        setItems([]);
        setGroups([]);
        setSelectedId("");
        setDraft(emptyDraft);
        return;
      }

      const menuRes = await supabase
        .from("menu_items")
        .select("id,store_id,name,price,image,is_sold_out,option_group_ids,sort_order,category_id")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (menuRes.error) throw menuRes.error;

      const categoryRes = await supabase
        .from("menu_categories")
        .select("id,store_id,name,sort_order,is_active")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (categoryRes.error) throw categoryRes.error;

      let groupData: OptionGroup[] = [];
      const groupRes = await supabase
        .from("option_groups")
        .select("id,store_id,name,scope,linked_menu_id,required,min,max")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (groupRes.error) {
        const missingLinkedMenuColumn =
          groupRes.error.code === "42703" && String(groupRes.error.message || "").includes("linked_menu_id");

        if (!missingLinkedMenuColumn) throw groupRes.error;

        const fallbackRes = await supabase
          .from("option_groups")
          .select("id,store_id,name,scope,required,min,max")
          .eq("store_id", storeId)
          .order("created_at", { ascending: true });
        if (fallbackRes.error) throw fallbackRes.error;

        setHasLinkedMenuColumn(false);
        groupData = (fallbackRes.data || []).map((g) => ({ ...g, linked_menu_id: null })) as OptionGroup[];
      } else {
        setHasLinkedMenuColumn(true);
        groupData = (groupRes.data || []) as OptionGroup[];
      }

      const itemRes = await supabase
        .from("option_items")
        .select("id,store_id,group_id,name,price_delta")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (itemRes.error) throw itemRes.error;

      const priceRes = await supabase
        .from("menu_option_prices")
        .select("store_id,menu_id,option_item_id,price_delta")
        .eq("store_id", storeId);

      if (priceRes.error) throw priceRes.error;
      const exclusionRes = await supabase
        .from("menu_option_item_exclusions")
        .select("store_id,menu_id,option_item_id")
        .eq("store_id", storeId);

      let exclusionRows: MenuOptionItemExclusion[] = [];
      if (exclusionRes.error) {
        const missingTable = exclusionRes.error.code === "42P01";
        if (!missingTable) throw exclusionRes.error;
        setHasExclusionTable(false);
      } else {
        setHasExclusionTable(true);
        exclusionRows = (exclusionRes.data || []) as MenuOptionItemExclusion[];
      }

      setItems((menuRes.data || []) as MenuItem[]);
      setGroups(groupData);
      setOptionItems((itemRes.data || []) as OptionItem[]);
      setOptionPrices((priceRes.data || []) as MenuOptionPrice[]);
      setOptionExclusions(exclusionRows);
      setCategories((categoryRes.data || []) as MenuCategory[]);
      setOrderDirty(false);

      setSelectedId((prev) => {
        if (prev && (menuRes.data || []).some((x) => x.id === prev)) return prev;
        return (menuRes.data || [])[0]?.id || "";
      });
    } catch (e: any) {
      console.error("[admin/menu] refresh error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", `메뉴 데이터 로드 실패: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) return;
      const memRes = await supabase.from("store_members").select("store_id").eq("user_id", authData.user.id);
      if (memRes.error) return;
      const ids = (memRes.data || []).map((x: any) => String(x.store_id || "")).filter(Boolean);
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

  const onCopyMenus = async () => {
    if (!storeId) return setStatus("error", "대상 매장을 먼저 선택해주세요.");
    if (!copySourceStoreId) return setStatus("error", "원본 매장을 선택해주세요.");
    openConfirm(
      "메뉴 복사 확인",
      "선택한 매장의 메뉴를 현재 매장으로 복사할까요?",
      async () => {
        closeConfirm();
        try {
          setCopying(true);
          clearStatus();
          const { error } = await supabase.rpc("admin_copy_menus_v1", {
            p_source_store_id: copySourceStoreId,
            p_target_store_id: storeId,
          });
          if (error) throw error;
          await refresh();
          setStatus("success", "메뉴 복사가 완료되었습니다.");
        } catch (e: any) {
          setStatus("error", `메뉴 복사 실패: ${String(e?.message || e)}`);
        } finally {
          setCopying(false);
        }
      }
    );
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(emptyDraft);
      setCommonDirty(false);
      setExclusiveDirty(false);
      setPendingOptionTab(null);
      setOptionTab("common");
      return;
    }
    const found = items.find((x) => x.id === selectedId);
    if (!found) return;

    setDraft({
      id: found.id || "",
      name: found.name || "",
      price: String(found.price ?? ""),
      image: found.image || "",
      isSoldOut: Boolean(found.is_sold_out),
      optionGroupIds: Array.isArray(found.option_group_ids) ? found.option_group_ids : [],
      categoryId: String(found.category_id || ""),
      optionPriceByItem: optionPrices
        .filter((row) => row.menu_id === found.id)
        .reduce<Record<string, string>>((acc, row) => {
          acc[row.option_item_id] = String(row.price_delta ?? 0);
          return acc;
        }, {}),
      excludedCommonItemIds: optionExclusions
        .filter((row) => row.menu_id === found.id)
        .map((row) => row.option_item_id),
    });
    setCommonDirty(false);
    setExclusiveDirty(false);
    setPendingOptionTab(null);
    setOptionTab("common");
  }, [items, selectedId, optionPrices, optionExclusions]);

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      const ao = Number(a.sort_order ?? 999999);
      const bo = Number(b.sort_order ?? 999999);
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }, [items]);
  const filteredItems = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    return sortedItems.filter((m) => {
      if (soldOutOnly && !m.is_sold_out) return false;
      if (filterCategoryId && String(m.category_id || "") !== filterCategoryId) return false;
      if (keyword && !String(m.name || "").toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [sortedItems, soldOutOnly, filterCategoryId, searchQuery]);

  const onNew = () => {
    setSelectedId("");
    setDraft({ ...emptyDraft, id: buildNextMenuId(storeId, items) });
    setImageFileName("");
    clearStatus();
    setExclusiveEditorMode("none");
    setShowExclusiveItemInputs(false);
    setOptionTab("common");
    setCommonDirty(false);
    setExclusiveDirty(false);
    setPendingOptionTab(null);
  };

  const onSave = async () => {
    if (!storeId) return;
    const name = draft.name.trim();
    const id = draft.id.trim();
    const priceText = draft.price.trim();
    const price = toInt(priceText, -1);

    if (!name) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "메뉴명을 입력해주세요.");
      return;
    }

    if (!id) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "메뉴 ID를 입력해주세요.");
      return;
    }
    if (!/^[a-z0-9-]{1,40}$/.test(id)) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "메뉴 ID는 영문 소문자/숫자/-만 사용해 40자 이내로 입력해주세요.");
      return;
    }
    if (!selectedId && items.some((x) => x.id === id)) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "이미 사용 중인 메뉴 ID입니다. 다른 ID를 입력해주세요.");
      return;
    }
    if (selectedId && selectedId !== id) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "기존 메뉴의 ID는 변경할 수 없습니다.");
      return;
    }

    if (!priceText || !isWholeNumberString(priceText)) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "기본 가격은 숫자만 입력해주세요. (예: 4500)");
      return;
    }

    if (price < 0) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "기본 가격은 0 이상의 숫자로 입력해주세요.");
      return;
    }
    if (draft.categoryId && !categories.some((cat) => cat.id === draft.categoryId)) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", "선택한 카테고리가 유효하지 않습니다. 다시 선택해주세요.");
      return;
    }

    setSaving(true);
    setBadge("idle");
    clearStatus();

    try {
      if (!hasLinkedMenuColumn) {
        const hasExclusiveSelection = draft.optionGroupIds.some((gid) => {
          const group = groups.find((g) => g.id === gid);
          return group?.scope === "exclusive";
        });

        if (hasExclusiveSelection) {
          setBadge("error");
          setTimeout(() => setBadge("idle"), 1600);
          setStatus("error", "DB에 linked_menu_id 컬럼이 없어 전용옵션 저장이 불가합니다. SQL 마이그레이션을 먼저 실행해 주세요.");
          return;
        }
      }

      const filteredGroups = draft.optionGroupIds.filter((gid) => {
        const group = groups.find((g) => g.id === gid);
        if (!group) return false;
        if (group.scope !== "exclusive") return true;
        return !group.linked_menu_id || group.linked_menu_id === id;
      });

      const payload = {
        id,
        store_id: storeId,
        name,
        price,
        image: draft.image.trim(),
        is_sold_out: draft.isSoldOut,
        option_group_ids: filteredGroups,
        category_id: draft.categoryId || null,
      };

      const exists = items.some((x) => x.id === id);
      if (exists) {
        const upd = await supabase
          .from("menu_items")
          .update(payload)
          .eq("id", id)
          .eq("store_id", storeId);
        if (upd.error) throw upd.error;
      } else {
        const ins = await supabase.from("menu_items").insert([{ ...payload, sort_order: sortedItems.length + 1 }]);
        if (ins.error) throw ins.error;
      }

      const activeOptionItemIds = new Set(
        filteredGroups.flatMap((gid) =>
          optionItems.filter((it) => it.group_id === gid).map((it) => it.id)
        )
      );

      if (activeOptionItemIds.size === 0) {
        const delAll = await supabase.from("menu_option_prices").delete().eq("menu_id", id).eq("store_id", storeId);
        if (delAll.error) throw delAll.error;
      } else {
        const ids = [...activeOptionItemIds];
        const inFilter = `(${ids.map((val) => `"${val}"`).join(",")})`;
        const delOther = await supabase
          .from("menu_option_prices")
          .delete()
          .eq("menu_id", id)
          .eq("store_id", storeId)
          .not("option_item_id", "in", inFilter);
        if (delOther.error) throw delOther.error;

        const rows = ids.map((optionItemId) => ({
          store_id: storeId,
          menu_id: id,
          option_item_id: optionItemId,
          price_delta: toInt(draft.optionPriceByItem[optionItemId] ?? "0", 0),
        }));
        const up = await supabase
          .from("menu_option_prices")
          .upsert(rows, { onConflict: "store_id,menu_id,option_item_id" });
        if (up.error) throw up.error;
      }

      await refresh();
      setSelectedId(id);
      setBadge("saved");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("success", "메뉴를 저장했습니다.");
    } catch (e: any) {
      console.error("[admin/menu] save error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", `메뉴 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!storeId) return;
    const id = draft.id.trim();
    if (!id) return;

    setSaving(true);
    setBadge("idle");
    try {
      const del = await supabase.from("menu_items").delete().eq("id", id).eq("store_id", storeId);
      if (del.error) throw del.error;
      await refresh();
      setSelectedId("");
      setDraft(emptyDraft);
      setBadge("saved");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("success", "메뉴를 삭제했습니다.");
    } catch (e: any) {
      console.error("[admin/menu] delete error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      setStatus("error", `메뉴 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const moveMenuItem = (menuId: string, dir: -1 | 1) => {
    const idx = sortedItems.findIndex((m) => m.id === menuId);
    if (idx < 0) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= sortedItems.length) return;

    const ids = sortedItems.map((m) => m.id);
    [ids[idx], ids[nextIdx]] = [ids[nextIdx], ids[idx]];

    setItems((prev) => {
      const orderMap = new Map(ids.map((id, i) => [id, i + 1]));
      return prev.map((m) => (orderMap.has(m.id) ? { ...m, sort_order: orderMap.get(m.id)! } : m));
    });
    setOrderDirty(true);
  };

  const saveMenuOrder = async () => {
    if (!storeId || !orderDirty) return;
    try {
      setSaving(true);
      setBadge("idle");
      clearStatus();
      for (let i = 0; i < sortedItems.length; i += 1) {
        const row = sortedItems[i];
        const { error } = await supabase
          .from("menu_items")
          .update({ sort_order: i + 1 })
          .eq("store_id", storeId)
          .eq("id", row.id);
        if (error) throw error;
      }
      await refresh();
      setStatus("success", "메뉴 노출 순서를 저장했습니다.");
      setOrderDirty(false);
    } catch (e: any) {
      setStatus("error", `메뉴 순서 저장 실패: ${String(e?.message || e)}`);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (id: string) => {
    setCommonDirty(true);
    setDraft((prev) => {
      const has = prev.optionGroupIds.includes(id);
      const next = has ? prev.optionGroupIds.filter((g) => g !== id) : [...prev.optionGroupIds, id];
      if (!has) return { ...prev, optionGroupIds: next };

      const nextPrices = { ...prev.optionPriceByItem };
      const nextExcluded = [...prev.excludedCommonItemIds];
      optionItems
        .filter((it) => it.group_id === id)
        .forEach((it) => {
          delete nextPrices[it.id];
          const exIdx = nextExcluded.indexOf(it.id);
          if (exIdx >= 0) nextExcluded.splice(exIdx, 1);
        });
      return { ...prev, optionGroupIds: next, optionPriceByItem: nextPrices, excludedCommonItemIds: nextExcluded };
    });
  };

  const requestOptionTabChange = (next: "common" | "exclusive") => {
    if (next === optionTab) return;
    const currentDirty = optionTab === "common" ? commonDirty : exclusiveDirty;
    if (!currentDirty) {
      setOptionTab(next);
      return;
    }
    setPendingOptionTab(next);
  };

  const closeOptionTabConfirm = () => {
    setPendingOptionTab(null);
  };

  const discardAndMoveOptionTab = () => {
    if (!pendingOptionTab) return;
    if (optionTab === "common") setCommonDirty(false);
    if (optionTab === "exclusive") setExclusiveDirty(false);
    setOptionTab(pendingOptionTab);
    setPendingOptionTab(null);
  };

  const saveAndMoveOptionTab = async () => {
    if (!pendingOptionTab) return;
    if (optionTab === "common") {
      const ok = await saveCommonPricesInMenu();
      if (!ok) return;
      setOptionTab(pendingOptionTab);
      setPendingOptionTab(null);
      return;
    }
    if (exclusiveEditorMode !== "none") {
      await saveExclusiveEditor();
      if (exclusiveDirty) return;
    }
    setOptionTab(pendingOptionTab);
    setPendingOptionTab(null);
  };

  const openExclusiveEdit = (groupId: string) => {
    setSelectedExclusiveGroupId(groupId);
    setExclusiveEditorMode("edit");
    setExclusiveDirty(false);
  };

  const openExclusiveCreate = () => {
    setExclusiveEditorMode("create");
    setExclusiveDirty(false);
    setNewExclusiveGroup({ name: "", max: "1" });
    setNewExclusiveItems([{ name: "", price: "" }]);
    setShowExclusiveItemInputs(true);
  };

  const closeExclusiveEditor = () => {
    setExclusiveEditorMode("none");
    setExclusiveDirty(false);
  };

  const addExclusiveEditRow = () => {
    setExclusiveDirty(true);
    setExclusiveEditItems((prev) => [...prev, { id: `tmp_${Date.now()}_${prev.length}`, name: "", price: "" }]);
  };

  const saveExclusiveEditor = async () => {
    if (!storeId) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setStatus("error", "메뉴를 먼저 저장한 뒤 전용옵션을 수정해주세요.");
      return;
    }

    if (exclusiveEditorMode === "create") {
      await createExclusiveGroupInMenu();
      return;
    }

    if (!selectedExclusiveGroup) return;
    const nextName = exclusiveEdit.name.trim();
    if (!nextName) {
      setStatus("error", "전용옵션 그룹명을 입력해주세요.");
      return;
    }
    const cleanedRows = exclusiveEditItems
      .map((row) => ({ ...row, name: String(row.name || "").trim(), price: String(row.price || "").trim() }))
      .filter((row) => row.name);
    if (cleanedRows.length === 0) {
      setStatus("error", "옵션 항목을 1개 이상 입력해주세요.");
      return;
    }
    const invalid = cleanedRows.find((row) => !isWholeNumberString(row.price || "0"));
    if (invalid) {
      setStatus("error", "옵션 단가는 숫자만 입력해주세요. (예: 500)");
      return;
    }

    setSaving(true);
    clearStatus();
    try {
      const nextMax = Math.max(toInt(exclusiveEdit.max, selectedExclusiveGroup.max || 1), 1);
      const groupRes = await supabase
        .from("option_groups")
        .update({ name: nextName, max: nextMax })
        .eq("store_id", storeId)
        .eq("id", selectedExclusiveGroup.id);
      if (groupRes.error) throw groupRes.error;

      const existingItems = itemsByGroup.get(selectedExclusiveGroup.id) || [];
      const existingIdSet = new Set(existingItems.map((it) => it.id));
      const keepIds = new Set<string>();

      for (const row of cleanedRows) {
        const price = toInt(row.price, 0);
        if (row.id && existingIdSet.has(row.id)) {
          keepIds.add(row.id);
          const upItem = await supabase
            .from("option_items")
            .update({ name: row.name, price_delta: price })
            .eq("store_id", storeId)
            .eq("id", row.id);
          if (upItem.error) throw upItem.error;
          continue;
        }

        const newId = `item_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
        const ins = await supabase.from("option_items").insert([{
          id: newId,
          store_id: storeId,
          group_id: selectedExclusiveGroup.id,
          name: row.name,
          price_delta: price,
        }]);
        if (ins.error) throw ins.error;
        keepIds.add(newId);
      }

      const deleteIds = existingItems.map((it) => it.id).filter((id) => !keepIds.has(id));
      if (deleteIds.length > 0) {
        const delPrices = await supabase
          .from("menu_option_prices")
          .delete()
          .eq("store_id", storeId)
          .eq("menu_id", menuId)
          .in("option_item_id", deleteIds);
        if (delPrices.error) throw delPrices.error;

        const delItems = await supabase
          .from("option_items")
          .delete()
          .eq("store_id", storeId)
          .in("id", deleteIds);
        if (delItems.error) throw delItems.error;
      }

      const priceRows = Array.from(keepIds).map((optionItemId) => ({
        store_id: storeId,
        menu_id: menuId,
        option_item_id: optionItemId,
        price_delta: toInt(
          cleanedRows.find((row) => row.id === optionItemId)?.price
            ?? existingItems.find((it) => it.id === optionItemId)?.price_delta
            ?? 0,
          0
        ),
      }));
      if (priceRows.length > 0) {
        const upPrice = await supabase
          .from("menu_option_prices")
          .upsert(priceRows, { onConflict: "store_id,menu_id,option_item_id" });
        if (upPrice.error) throw upPrice.error;
      }

      await refresh();
      setStatus("success", "전용옵션을 저장했습니다.");
      setExclusiveDirty(false);
      setExclusiveEditorMode("none");
    } catch (e: any) {
      setStatus("error", `전용옵션 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };


  const saveCommonPricesInMenu = async () => {
    if (!storeId) return false;
    const menuId = draft.id.trim();
    if (!menuId) {
      setStatus("error", "메뉴를 먼저 저장한 뒤 단가를 수정해주세요.");
      return false;
    }

    const commonItemIds = selectedCommonGroups.flatMap((group) =>
      (itemsByGroup.get(group.id) || []).map((item) => item.id)
    );
    if (commonItemIds.length === 0) {
      setStatus("neutral", "저장할 공통옵션 항목이 없습니다.");
      return false;
    }
    const invalidCommonItem = commonItemIds.find((optionItemId) => {
      const raw = String(draft.optionPriceByItem[optionItemId] ?? "0").trim();
      return !isWholeNumberString(raw);
    });
    if (invalidCommonItem) {
      setStatus("error", "공통옵션 단가는 숫자만 입력해주세요. (예: 500)");
      return false;
    }
    const selectedExcluded = draft.excludedCommonItemIds.filter((id) => commonItemIds.includes(id));
    if (!hasExclusionTable && selectedExcluded.length > 0) {
      setStatus("error", "옵션 제외 기능을 쓰려면 DB SQL 적용이 먼저 필요합니다. (menu_option_item_exclusions)");
      return false;
    }

    setSaving(true);
    clearStatus();
    try {
      const rows = commonItemIds.map((optionItemId) => ({
        store_id: storeId,
        menu_id: menuId,
        option_item_id: optionItemId,
        price_delta: toInt(draft.optionPriceByItem[optionItemId] ?? "0", 0),
      }));

      const { error } = await supabase
        .from("menu_option_prices")
        .upsert(rows, { onConflict: "store_id,menu_id,option_item_id" });
      if (error) throw error;

      if (hasExclusionTable) {
        const delRes = await supabase
          .from("menu_option_item_exclusions")
          .delete()
          .eq("store_id", storeId)
          .eq("menu_id", menuId)
          .in("option_item_id", commonItemIds);
        if (delRes.error) throw delRes.error;

        if (selectedExcluded.length > 0) {
          const insertRows = selectedExcluded.map((optionItemId) => ({
            store_id: storeId,
            menu_id: menuId,
            option_item_id: optionItemId,
          }));
          const insRes = await supabase.from("menu_option_item_exclusions").insert(insertRows);
          if (insRes.error) throw insRes.error;
        }
      }

      await refresh();
      setStatus("success", "공통옵션 단가/제외 항목을 저장했습니다.");
      setCommonDirty(false);
      return true;
    } catch (e: any) {
      setStatus("error", `공통옵션 저장 실패: ${String(e?.message || e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const deleteExclusiveGroupInMenu = async (groupId: string) => {
    if (!storeId) return;
    openConfirm(
      "전용옵션 그룹 삭제",
      "등록된 전용옵션 그룹과 연결된 옵션 항목을 함께 삭제할까요?",
      async () => {
        closeConfirm();
        setSaving(true);
        clearStatus();
        try {
          const groupItems = itemsByGroup.get(groupId) || [];
          const itemIds = groupItems.map((it) => it.id);

          if (itemIds.length > 0) {
            const delPrices = await supabase
              .from("menu_option_prices")
              .delete()
              .eq("store_id", storeId)
              .eq("menu_id", draft.id.trim())
              .in("option_item_id", itemIds);
            if (delPrices.error) throw delPrices.error;
          }

          const delItems = await supabase
            .from("option_items")
            .delete()
            .eq("store_id", storeId)
            .eq("group_id", groupId);
          if (delItems.error) throw delItems.error;

          const delGroup = await supabase
            .from("option_groups")
            .delete()
            .eq("store_id", storeId)
            .eq("id", groupId);
          if (delGroup.error) throw delGroup.error;

          setDraft((prev) => {
            const nextPrices = { ...prev.optionPriceByItem };
            itemIds.forEach((id) => delete nextPrices[id]);
            return {
              ...prev,
              optionGroupIds: prev.optionGroupIds.filter((id) => id !== groupId),
              optionPriceByItem: nextPrices,
            };
          });

          await refresh();
          setSelectedExclusiveGroupId((prev) => (prev === groupId ? "" : prev));
          setStatus("success", "전용옵션을 삭제했습니다.");
          setExclusiveDirty(false);
          setExclusiveEditorMode("none");
        } catch (e: any) {
          setStatus("error", `전용옵션 삭제 실패: ${String(e?.message || e)}`);
        } finally {
          setSaving(false);
        }
      }
    );
  };

  const createExclusiveGroupInMenu = async () => {
    if (!storeId) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setStatus("error", "전용옵션을 만들기 전에 메뉴명을 입력해 메뉴 ID를 먼저 만들어주세요.");
      return;
    }
    const groupName = newExclusiveGroup.name.trim();
    if (!groupName) {
      setStatus("error", "전용옵션 그룹명을 입력해주세요.");
      return;
    }

    const cleanedItems = newExclusiveItems
      .map((x) => ({ name: x.name.trim(), price: toInt(x.price, 0) }))
      .filter((x) => Boolean(x.name));
    if (cleanedItems.length === 0) {
      setStatus("error", "전용옵션 항목을 1개 이상 입력해주세요.");
      return;
    }

    setSaving(true);
    clearStatus();
    try {
      const groupId = `group_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
      const min = 0;
      const max = Math.max(toInt(newExclusiveGroup.max, 1), 1);

      const groupInsert = await supabase.from("option_groups").insert([
        {
          id: groupId,
          store_id: storeId,
          name: groupName,
          required: false,
          min,
          max,
          scope: "exclusive",
          linked_menu_id: menuId,
        },
      ]);
      if (groupInsert.error) throw groupInsert.error;

      const itemRows = cleanedItems.map((item) => ({
        id: `item_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`,
        store_id: storeId,
        group_id: groupId,
        name: item.name,
        price_delta: item.price,
      }));
      const itemInsert = await supabase.from("option_items").insert(itemRows);
      if (itemInsert.error) throw itemInsert.error;

      const nextGroupIds = Array.from(new Set([...(draft.optionGroupIds || []), groupId]));
      const menuUpdate = await supabase
        .from("menu_items")
        .update({ option_group_ids: nextGroupIds })
        .eq("store_id", storeId)
        .eq("id", menuId);
      if (menuUpdate.error) throw menuUpdate.error;

      setDraft((prev) => ({
        ...prev,
        optionGroupIds: nextGroupIds,
      }));
      setSelectedExclusiveGroupId(groupId);
      setNewExclusiveGroup({ name: "", max: "1" });
      setNewExclusiveItems([]);
      setShowExclusiveItemInputs(false);
      setExclusiveEditorMode("none");
      await refresh();
      setStatus("success", "전용옵션 그룹을 생성했고 현재 메뉴에 자동 연결했습니다.");
      setExclusiveDirty(false);
    } catch (e: any) {
      setStatus("error", `전용옵션 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => {
    if (storeId) {
      router.push(`/admin?store=${encodeURIComponent(storeId)}`);
    } else {
      router.push("/admin");
    }
  };

  const isEditing = Boolean(selectedId);
  const commonGroups = groups.filter((g) => (g.scope || "common") !== "exclusive");
  const selectedCommonGroups = commonGroups.filter((g) => draft.optionGroupIds.includes(g.id));
  const unselectedCommonGroups = commonGroups.filter((g) => !draft.optionGroupIds.includes(g.id));
  const exclusiveGroups = groups.filter(
    (g) => (g.scope || "common") === "exclusive" && (!draft.id.trim() || g.linked_menu_id === draft.id.trim())
  );
  const selectedExclusiveGroup = useMemo(
    () => exclusiveGroups.find((g) => g.id === selectedExclusiveGroupId) || null,
    [exclusiveGroups, selectedExclusiveGroupId]
  );

  useEffect(() => {
    setSelectedExclusiveGroupId((prev) => {
      if (prev && exclusiveGroups.some((g) => g.id === prev)) return prev;
      return exclusiveGroups[0]?.id || "";
    });
  }, [exclusiveGroups]);

  useEffect(() => {
    if (!selectedExclusiveGroup) {
      setExclusiveEdit({ name: "", max: "1" });
      setExclusiveEditItems([]);
      return;
    }
    const rows = (itemsByGroup.get(selectedExclusiveGroup.id) || []).map((item) => ({
      id: item.id,
      name: item.name || "",
      price: draft.optionPriceByItem[item.id] != null
        ? String(draft.optionPriceByItem[item.id] ?? "0")
        : String(item.price_delta ?? 0),
    }));
    setExclusiveEdit({
      name: selectedExclusiveGroup.name || "",
      max: String(Math.max(Number(selectedExclusiveGroup.max ?? 1), 1)),
    });
    setExclusiveEditItems(rows);
  }, [selectedExclusiveGroup, itemsByGroup, draft.optionPriceByItem]);

  const itemsByGroup = useMemo(() => {
    const map = new Map<string, OptionItem[]>();
    optionItems.forEach((it) => {
      if (!map.has(it.group_id)) map.set(it.group_id, []);
      map.get(it.group_id)?.push(it);
    });
    return map;
  }, [optionItems]);

  const getOptionPrice = (item: OptionItem) => {
    if (draft.optionPriceByItem[item.id] != null) return draft.optionPriceByItem[item.id];
    return String(item.price_delta ?? 0);
  };
  const isExcludedCommonItem = (itemId: string) => draft.excludedCommonItemIds.includes(itemId);
  const toggleExcludeCommonItem = (itemId: string) => {
    setDraft((prev) => {
      const has = prev.excludedCommonItemIds.includes(itemId);
      return {
        ...prev,
        excludedCommonItemIds: has
          ? prev.excludedCommonItemIds.filter((id) => id !== itemId)
          : [...prev.excludedCommonItemIds, itemId],
      };
    });
  };

  const addCommonGroup = () => {
    if (!commonGroupToAdd) return;
    setCommonDirty(true);
    setDraft((prev) => {
      if (prev.optionGroupIds.includes(commonGroupToAdd)) return prev;
      return { ...prev, optionGroupIds: [...prev.optionGroupIds, commonGroupToAdd] };
    });
    setCommonGroupToAdd("");
  };

  const onUploadMenuImage = async (file: File | null) => {
    if (!file) return;
    if (!draft.id.trim()) {
      setStatus("error", "이미지를 올리려면 메뉴 ID를 먼저 입력해주세요.");
      return;
    }

    setUploadingImage(true);
    clearStatus();
    try {
      setImageFileName(file.name || "");
      const ext = getFileExt(file.name) || "png";
      const path = `${storeId}/${draft.id.trim()}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(MENU_IMAGE_BUCKET).upload(path, file, { upsert: true });
      if (error) throw error;

      const { data } = supabase.storage.from(MENU_IMAGE_BUCKET).getPublicUrl(path);
      const url = data.publicUrl || "";
      if (url) setDraft((prev) => ({ ...prev, image: url }));
    } catch (e: any) {
      setStatus("error", `메뉴 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingImage(false);
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
          --brand: #0f172a;
          --brand-soft: #e2e8f0;
          --accent: #2563eb;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .h1 {
          margin: 0;
          font-size: 26px;
          font-weight: 950;
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
          margin: 4px 0 0 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.4;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 12px;
        }
        .detailColumn {
          display: grid;
          gap: 10px;
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
        .badge {
          height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid var(--line);
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          font-weight: 900;
          color: var(--muted);
        }
        .badgeSaved {
          border-color: #bbf7d0;
          color: #15803d;
        }
        .badgeError {
          border-color: #fecaca;
          color: #991b1b;
        }
        .btnRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
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
        .btn {
          border: 1px solid var(--line);
          background: #fff;
          padding: 8px 12px;
          border-radius: 10px;
          cursor: pointer;
          font-weight: 950;
          font-size: 14px;
          line-height: 1.2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
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
        .btnMini {
          padding: 6px 9px;
          font-size: 12px;
          border-radius: 9px;
        }
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .filterRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 150px auto;
          gap: 8px;
          margin-top: 10px;
          align-items: center;
        }
        .list {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .listScroll {
          max-height: 56vh;
          overflow-y: auto;
          padding-right: 4px;
        }
        .listScroll::-webkit-scrollbar { width: 8px; }
        .listScroll::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 999px; }
        .rowBtn {
          text-align: left;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
          display: grid;
          gap: 6px;
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
        }
        .menuRowHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .orderActionRow {
          display: inline-flex;
          gap: 4px;
        }
        .orderBtn {
          border: 1px solid #dbe2ea;
          background: linear-gradient(180deg, #fff, #f8fafc);
          border-radius: 9px;
          width: 26px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .orderBtn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .orderBtn svg {
          width: 13px;
          height: 13px;
          stroke: #334155;
          stroke-width: 2.2;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .name {
          font-weight: 900;
          font-size: 14px;
        }
        .soldOutChip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #b91c1c;
          font-size: 11px;
          font-weight: 900;
          margin-left: 6px;
        }
        .field {
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }
        .detailTopRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 120px 140px;
          gap: 10px;
          align-items: end;
        }
        .idSoldOutRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }
        .menuIdLabelRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .soldOutInline {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }
        .soldOutLabel {
          color: #b91c1c;
          font-weight: 900;
          font-size: 12px;
        }
        .soldOutOnlyLabel {
          font-size: 12px;
          font-weight: 700;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 800;
          font-size: 14px;
          width: 100%;
        }
        .optionGrid {
          display: grid;
          gap: 8px;
          margin-top: 8px;
        }
        .optionConnectCard {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px;
          background: #fcfcfd;
          display: grid;
          gap: 8px;
        }
        .groupOptionDetail {
          border: 1px dashed var(--line);
          border-radius: 10px;
          padding: 10px;
          background: #fff;
          display: grid;
          gap: 6px;
        }
        .groupOptionItem {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .groupOptionValueRow {
          align-items: center;
        }
        .optionItemLeft {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1 1 auto;
        }
        .optionItemControlRow {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex: 0 0 auto;
        }
        .optionExcludeLabel {
          font-size: 13px;
          font-weight: 700;
          white-space: nowrap;
        }
        .optionItemText {
          font-size: 13px;
          font-weight: 700;
          white-space: normal;
          word-break: keep-all;
          overflow-wrap: anywhere;
          line-height: 1.35;
        }
        .policyBadge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #dbe2ea;
          color: #334155;
          font-size: 11px;
          font-weight: 900;
          background: #f8fafc;
        }
        .policyBadgeRequired {
          border-color: #fecaca;
          color: #b91c1c;
          background: #fff1f2;
        }
        .exclusiveItemCard {
          border: 1px dashed var(--line);
          border-radius: 10px;
          padding: 10px;
          background: #fff;
          display: grid;
          gap: 8px;
        }
        .exclusiveItemTop {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 104px;
          gap: 8px;
          align-items: center;
        }
        .exclusiveItemName {
          min-width: 0;
          font-weight: 800;
          line-height: 1.35;
          word-break: break-word;
        }
        .itemDeleteBtn {
          width: auto;
          justify-self: end;
          padding: 7px 10px;
          font-size: 12px;
        }
        .inlineSelectRow {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
        }
        .twoColRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: end;
        }
        .imageUploadRow {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 10px;
          align-items: center;
        }
        .imageActionCol {
          display: grid;
          gap: 8px;
        }
        .uploadControl {
          width: 220px;
          max-width: 100%;
        }
        .imageUploadBtn {
          justify-self: start;
        }
        .fileNameInput {
          width: 100%;
        }
        .fileNameBadge {
          display: inline-flex;
          align-items: center;
          color: var(--muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-weight: 800;
        }
        .formGuide {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        .modeSwitchRow {
          display: inline-flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .modeSwitchBtn {
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #fff;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
        }
        .modeSwitchBtnOn {
          border-color: var(--brand);
          background: #eef2ff;
          color: var(--brand);
        }
        .previewThumb {
          margin-top: 0;
          width: 80px;
          height: 80px;
          border-radius: 10px;
          border: 1px solid var(--line);
          object-fit: cover;
          background: #f9fafb;
        }
        .previewWrap {
          display: flex;
          justify-content: center;
        }
        .previewPlaceholder {
          width: 80px;
          height: 80px;
          border-radius: 10px;
          border: 1px dashed var(--line);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
          background: #fff;
        }
        .maxSelectInput {
          width: 100%;
          min-width: 88px;
          max-width: 96px;
        }
        .menuIdInput {
          min-width: 0;
          max-width: none;
        }
        .metaRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
          align-items: start;
        }
        .groupTopRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 96px;
          gap: 10px;
          align-items: end;
        }
        .maxSelectField {
          justify-self: end;
          width: 96px;
        }
        .optionRow {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 800;
        }
        .hint {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        .sectionTitle {
          margin: 0;
          font-size: 15px;
          font-weight: 950;
        }
        .createBox {
          margin-top: 8px;
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 8px;
          background: #fafafa;
        }
        .optionSectionBox {
          margin-top: 14px;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
        }
        .exclusiveWorkspace {
          display: grid;
          gap: 10px;
          grid-template-columns: 1fr;
        }
        .exclusiveGroupCard {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          padding: 10px;
          display: grid;
          gap: 8px;
        }
        .exclusiveGroupCardTop {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .exclusiveGroupMeta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .exclusiveCardActions {
          display: inline-flex;
          gap: 6px;
          align-items: center;
        }
        .fullWidthBtn {
          width: 100%;
          justify-content: center;
        }
        .divider {
          height: 1px;
          background: var(--line);
          margin: 10px 0;
        }
        .confirmOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 60;
          padding: 16px;
        }
        .confirmCard {
          width: 100%;
          max-width: 440px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #fff;
          box-shadow: 0 16px 44px rgba(15, 23, 42, 0.2);
          padding: 16px;
          display: grid;
          gap: 10px;
        }
        .confirmTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 950;
        }
        .confirmDesc {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.45;
        }
        .confirmActions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .inlineSelectRow {
            grid-template-columns: 1fr;
          }
          .filterRow {
            grid-template-columns: 1fr;
          }
          .listScroll {
            max-height: 45vh;
          }
          .twoColRow {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .imageUploadRow {
            grid-template-columns: 80px 1fr;
          }
          .uploadControl {
            width: 100%;
          }
          .maxSelectInput {
            width: 100%;
            min-width: 88px;
          }
          .detailTopRow {
            grid-template-columns: minmax(0, 1fr) 112px 120px;
          }
          .idSoldOutRow {
            grid-template-columns: minmax(0, 1fr);
          }
          .metaRow {
            grid-template-columns: 1fr;
          }
          .groupTopRow {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .exclusiveItemTop {
            grid-template-columns: minmax(0, 1fr) 96px;
          }
          .titleRow {
            align-items: flex-start;
          }
          .headerActionRow {
            width: auto;
            justify-content: flex-end;
          }
          .previewThumb,
          .previewPlaceholder {
            width: 80px;
            height: 80px;
          }
        }
        @media (min-width: 900px) {
          .exclusiveWorkspace {
            grid-template-columns: minmax(230px, 0.9fr) minmax(0, 1.1fr);
            align-items: start;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="topbarMain">
          <div className="titleRow">
            <h1 className="h1">메뉴 관리</h1>
            <div className="headerActionRow">
              <button className="btn" onClick={onBack}>
                관리자 홈
              </button>
              <a className="btn" href={`/admin/categories${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                카테고리관리
              </a>
              <a className="btn" href={`/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                옵션관리
              </a>
            </div>
          </div>
          <p className="sub">메뉴 기본정보와 옵션 가격을 관리합니다.</p>
          <p className="sub" style={{ marginTop: 6 }}>
            현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
          </p>
          {msg ? (
            <p
              className="sub"
              style={{
                marginTop: 6,
                color: msgTone === "success" ? "#065f46" : msgTone === "error" ? "#b91c1c" : "#374151",
              }}
            >
              {msg}
            </p>
          ) : null}
        </div>

        {badge === "saved" ? (
          <span className="badge badgeSaved">{badgeText}</span>
        ) : badge === "error" ? (
          <span className="badge badgeError">{badgeText}</span>
        ) : null}
      </header>

      {!loading && items.length === 0 ? (
        <section className="card">
          <div className="copyRow">
            <select className="input copySelect" value={copySourceStoreId} onChange={(e) => setCopySourceStoreId(e.target.value)}>
              <option value="">원본 매장 선택</option>
              {myStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name || s.store_id} ({s.store_id})
                </option>
              ))}
            </select>
            <button className="btn copyBtn" onClick={onCopyMenus} disabled={copying || loading || !copySourceStoreId}>
              {copying ? "복사 중..." : "다른 매장 메뉴 복사"}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            최초 등록 시에만 복사 기능이 활성화됩니다.
          </p>
        </section>
      ) : null}

      {!storeId ? (
        <section className="card">
          <h2 className="cardTitle">매장을 먼저 선택/생성하세요</h2>
          <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            현재 선택된 매장이 없습니다.<br />
            관리자 홈에서 매장을 선택한 뒤 다시 들어와 주세요.
          </p>
          <div className="btnRow">
            <button className="btn btnPrimary" onClick={onBack}>
              관리자 홈으로
            </button>
          </div>
        </section>
      ) : (
        <section className="grid">
          <div className="card">
            <h2 className="cardTitle">메뉴 목록 ({items.length})</h2>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={onNew} disabled={saving || loading}>
                + 새 메뉴
              </button>
              <button className="btn" onClick={refresh} disabled={saving || loading}>
                새로고침
              </button>
              <button className="btn" onClick={saveMenuOrder} disabled={saving || loading || !orderDirty}>
                순서 저장
              </button>
            </div>
            <div className="filterRow">
              <input
                className="input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="메뉴명 검색"
                disabled={saving || loading}
              />
              <select
                className="input"
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                disabled={saving || loading}
              >
                <option value="">전체 카테고리</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <label className="optionRow soldOutOnlyLabel" style={{ justifyContent: "flex-end" }}>
                <input
                  type="checkbox"
                  checked={soldOutOnly}
                  onChange={(e) => setSoldOutOnly(e.target.checked)}
                  disabled={saving || loading}
                />
                품절만
              </label>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              목록에서 ↑/↓로 순서를 바꾼 뒤 <b>순서 저장</b>을 눌러주세요.
            </p>

            <div className="listScroll">
              <div className="list">
              {filteredItems.map((m) => {
                const groupIds = Array.isArray(m.option_group_ids) ? m.option_group_ids : [];
                const commonCount = groupIds.filter((gid) => {
                  const group = groups.find((g) => g.id === gid);
                  return (group?.scope || "common") !== "exclusive";
                }).length;
                const exclusiveCount = groupIds.filter((gid) => {
                  const group = groups.find((g) => g.id === gid);
                  return (group?.scope || "common") === "exclusive";
                }).length;
                const currentIdx = sortedItems.findIndex((x) => x.id === m.id);
                return (
                  <div
                    key={m.id}
                    className={`rowBtn ${m.id === selectedId ? "rowBtnOn" : ""}`}
                    onClick={() => setSelectedId(m.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(m.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="menuRowHeader">
                      <div className="name">
                        {m.name}
                        {m.is_sold_out ? <span className="soldOutChip">품절</span> : null}
                      </div>
                      <span className="orderActionRow">
                        <button
                          className="orderBtn"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            moveMenuItem(m.id, -1);
                          }}
                          disabled={saving || loading || currentIdx === 0}
                          aria-label={`${m.name} 위로 이동`}
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
                            moveMenuItem(m.id, 1);
                          }}
                          disabled={saving || loading || currentIdx === sortedItems.length - 1}
                          aria-label={`${m.name} 아래로 이동`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 10l6 6 6-6" />
                          </svg>
                        </button>
                      </span>
                    </div>
                    <div className="muted">
                      {Number(m.price || 0).toLocaleString()}원 · 공통 {commonCount}개 · 전용 {exclusiveCount}개
                    </div>
                  </div>
                );
              })}
                {!loading && filteredItems.length === 0 ? (
                  <div className="muted" style={{ marginTop: 10 }}>
                    조건에 맞는 메뉴가 없습니다.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="detailColumn">
            <div className="card">
              <h2 className="cardTitle">메뉴 상세</h2>

            <div className="detailTopRow">
              <div className="field" style={{ marginTop: 0 }}>
                <div className="label">메뉴명</div>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="예: 아메리카노"
                  disabled={saving || loading}
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <div className="label">기본 가격</div>
                <input
                  className="input"
                  inputMode="numeric"
                  value={draft.price}
                  onChange={(e) => setDraft((prev) => ({ ...prev, price: e.target.value }))}
                  placeholder="예: 4500"
                  disabled={saving || loading}
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <div className="label">카테고리</div>
                <select
                  className="input"
                  value={draft.categoryId}
                  onChange={(e) => setDraft((prev) => ({ ...prev, categoryId: e.target.value }))}
                  disabled={saving || loading}
                >
                  <option value="">미분류</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="idSoldOutRow">
              <div className="field menuIdInput" style={{ marginTop: 0 }}>
                <div className="menuIdLabelRow">
                  <div className="label">메뉴 ID</div>
                  <label className="soldOutInline">
                    <span className="soldOutLabel">품절</span>
                    <input
                      type="checkbox"
                      checked={draft.isSoldOut}
                      onChange={(e) => setDraft((prev) => ({ ...prev, isSoldOut: e.target.checked }))}
                      disabled={saving || loading}
                    />
                  </label>
                </div>
                <input
                  className="input"
                  value={draft.id}
                  onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))}
                  placeholder="예: testximen-menu-0001"
                  disabled={saving || loading || isEditing}
                />
                <div className="hint">ID는 저장 후에는 변경할 수 없습니다.</div>
              </div>
            </div>

            <div className="field">
              <div className="label">메뉴 이미지</div>
              <div className="imageUploadRow" style={{ marginTop: 4 }}>
                {draft.image ? (
                  <img src={draft.image} alt={`${draft.name || draft.id || "menu"} preview`} className="previewThumb" />
                ) : (
                  <div className="previewPlaceholder">미리보기</div>
                )}
                <div className="imageActionCol">
                  <label className="btn uploadControl imageUploadBtn">
                    {uploadingImage ? "업로드 중..." : "이미지 업로드"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => onUploadMenuImage(e.target.files?.[0] || null)}
                      disabled={saving || loading || uploadingImage}
                    />
                  </label>
                  <div className="input fileNameBadge uploadControl" title={imageFileName || "선택된 파일명"}>
                    {imageFileName ? summarizeFileName(imageFileName, 24) : "선택된 파일명"}
                  </div>
                </div>
              </div>
            </div>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={onSave} disabled={saving || loading}>
                {saving ? "저장 중..." : "저장"}
              </button>
              <button className="btn" onClick={onNew} disabled={saving || loading}>
                새로 작성
              </button>
              <button className="btn btnDanger" onClick={onDelete} disabled={saving || loading || !draft.id}>
                삭제
              </button>
            </div>
          </div>

          <div className="card optionSectionBox">
            <div className="field" style={{ marginTop: 0 }}>
              <h3 className="sectionTitle">옵션 연결</h3>
            </div>
            <div className="modeSwitchRow" style={{ marginTop: 6 }}>
              <button
                type="button"
                className={`modeSwitchBtn ${optionTab === "common" ? "modeSwitchBtnOn" : ""}`}
                onClick={() => requestOptionTabChange("common")}
                disabled={saving || loading}
              >
                공통옵션
              </button>
              <button
                type="button"
                className={`modeSwitchBtn ${optionTab === "exclusive" ? "modeSwitchBtnOn" : ""}`}
                onClick={() => requestOptionTabChange("exclusive")}
                disabled={saving || loading}
              >
                전용옵션
              </button>
            </div>

            {optionTab === "common" ? (
              <div className="field">
                <div className="label">공통옵션</div>
                <div className="optionConnectCard">
                <div className="inlineSelectRow">
                  <select
                    className="input"
                    style={{ minWidth: 220, maxWidth: 420 }}
                    value={commonGroupToAdd}
                    onChange={(e) => setCommonGroupToAdd(e.target.value)}
                    disabled={saving || loading || unselectedCommonGroups.length === 0}
                  >
                    <option value="">추가할 공통옵션 그룹 선택</option>
                    {unselectedCommonGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {getGroupPolicyText(g)}
                      </option>
                    ))}
                  </select>
                  <button className="btn" type="button" onClick={addCommonGroup} disabled={saving || loading || !commonGroupToAdd}>
                    + 옵션연결
                  </button>
                </div>

                {selectedCommonGroups.length === 0 ? (
                  <div className="muted">아직 연결된 공통옵션이 없습니다.</div>
                ) : (
                  <>
                    <div className="optionGrid">
                      {selectedCommonGroups.map((group) => {
                        const groupOptions = itemsByGroup.get(group.id) || [];
                        return (
                          <div className="groupOptionDetail" key={group.id}>
                            <div className="groupOptionItem">
                              <div className="name" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                                <span>{group.name}</span>
                                <span className={`policyBadge ${group.required ? "policyBadgeRequired" : ""}`.trim()}>{getGroupPolicyText(group)}</span>
                              </div>
                              <button className="btn btnDanger btnMini" type="button" onClick={() => toggleGroup(group.id)} disabled={saving || loading}>
                                연결해제
                              </button>
                            </div>
                            {groupOptions.length === 0 ? (
                              <div className="muted">옵션 항목이 없습니다.</div>
                            ) : (
                              groupOptions.map((item) => (
                                <div key={item.id} className="groupOptionItem groupOptionValueRow">
                                  <span className="optionItemLeft">
                                    <span className="optionItemText">{item.name}</span>
                                  </span>
                                  <span className="optionItemControlRow">
                                    <input
                                      className="input"
                                      style={{ maxWidth: 120 }}
                                      inputMode="numeric"
                                      value={getOptionPrice(item)}
                                      onChange={(e) =>
                                        {
                                          setCommonDirty(true);
                                          setDraft((prev) => ({
                                            ...prev,
                                            optionPriceByItem: {
                                              ...prev.optionPriceByItem,
                                              [item.id]: e.target.value,
                                            },
                                          }));
                                        }
                                      }
                                      disabled={saving || loading}
                                    />
                                    <label className="optionRow optionExcludeLabel" style={{ gap: 4 }}>
                                      <input
                                        type="checkbox"
                                        checked={isExcludedCommonItem(item.id)}
                                        onChange={() => {
                                          setCommonDirty(true);
                                          toggleExcludeCommonItem(item.id);
                                        }}
                                        disabled={saving || loading || !hasExclusionTable}
                                      />
                                      제외
                                    </label>
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="btnRow" style={{ marginTop: 6 }}>
                      <button className="btn" type="button" onClick={saveCommonPricesInMenu} disabled={saving || loading}>
                        옵션수정 저장
                      </button>
                    </div>
                    {!hasExclusionTable ? (
                      <div className="hint">제외 기능은 DB SQL 적용 후 활성화됩니다.</div>
                    ) : (
                      <div className="hint">체크한 항목은 이 메뉴에서만 숨김 처리됩니다.</div>
                    )}
                  </>
                )}
                </div>
              </div>
            ) : null}

            {optionTab === "exclusive" ? (
              <div className="field">
                <div className="label">전용옵션 (현재 메뉴 전용)</div>
                <div className="optionConnectCard">
                  <div className="formGuide">그룹 카드에서 수정/삭제를 선택하거나 새 그룹을 추가하세요.</div>
                  <div className="exclusiveWorkspace">
                    <div className="optionGrid" style={{ marginTop: 0 }}>
                      {exclusiveGroups.length === 0 ? <div className="muted">아직 전용옵션이 없습니다.</div> : null}
                      {exclusiveGroups.map((g) => (
                        <div key={g.id} className="exclusiveGroupCard">
                          <div className="exclusiveGroupCardTop">
                            <div className="exclusiveGroupMeta">
                              <span className="name">{g.name}</span>
                              <span className={`policyBadge ${g.required ? "policyBadgeRequired" : ""}`.trim()}>{getGroupPolicyText(g)}</span>
                            </div>
                            <div className="exclusiveCardActions">
                              <button className="btn btnMini" type="button" onClick={() => openExclusiveEdit(g.id)} disabled={saving || loading}>
                                그룹 수정
                              </button>
                              <button className="btn btnDanger btnMini" type="button" onClick={() => deleteExclusiveGroupInMenu(g.id)} disabled={saving || loading}>
                                그룹 삭제
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button className="btn" type="button" onClick={openExclusiveCreate} disabled={saving || loading}>
                        신규 그룹 추가 +
                      </button>
                    </div>

                    {exclusiveEditorMode !== "none" ? (
                      <div className="groupOptionDetail" style={{ marginTop: 0 }}>
                        {exclusiveEditorMode === "edit" && selectedExclusiveGroup ? (
                          <>
                            <div className="groupTopRow">
                              <div className="field" style={{ marginTop: 0 }}>
                                <div className="label">전용옵션 그룹</div>
                                <input
                                  className="input"
                                  value={exclusiveEdit.name}
                                  onChange={(e) => {
                                    setExclusiveDirty(true);
                                    setExclusiveEdit((p) => ({ ...p, name: e.target.value }));
                                  }}
                                  disabled={saving || loading}
                                />
                              </div>
                              <div className="field maxSelectField" style={{ marginTop: 0 }}>
                                <div className="label">최대 선택 수량</div>
                                <input
                                  className="input maxSelectInput"
                                  inputMode="numeric"
                                  value={exclusiveEdit.max}
                                  onChange={(e) => {
                                    setExclusiveDirty(true);
                                    setExclusiveEdit((p) => ({ ...p, max: e.target.value }));
                                  }}
                                  disabled={saving || loading}
                                />
                              </div>
                            </div>
                            <div className="btnRow" style={{ marginTop: 8 }}>
                              <button className="btn btnPrimary" type="button" onClick={saveExclusiveEditor} disabled={saving || loading}>
                                저장
                              </button>
                              <button className="btn" type="button" onClick={closeExclusiveEditor} disabled={saving || loading}>
                                취소
                              </button>
                            </div>

                            <div className="label" style={{ marginTop: 6 }}>옵션 항목</div>
                            {exclusiveEditItems.length === 0 ? (
                              <div className="muted">옵션 항목이 없습니다.</div>
                            ) : (
                              exclusiveEditItems.map((item, idx) => (
                                <div key={item.id || `edit-row-${idx}`} className="exclusiveItemCard">
                                  <div className="exclusiveItemTop">
                                    <input
                                      className="input"
                                      value={item.name}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setExclusiveDirty(true);
                                        setExclusiveEditItems((prev) => prev.map((row, i) => (i === idx ? { ...row, name: v } : row)));
                                      }}
                                      placeholder="옵션 항목명"
                                      disabled={saving || loading}
                                    />
                                    <input
                                      className="input"
                                      inputMode="numeric"
                                      value={item.price}
                                      onChange={(e) => {
                                        setExclusiveDirty(true);
                                        const v = e.target.value;
                                        setExclusiveEditItems((prev) => prev.map((row, i) => (i === idx ? { ...row, price: v } : row)));
                                      }}
                                      placeholder="단가 입력"
                                      disabled={saving || loading}
                                    />
                                  </div>
                                  <button
                                    className="btn btnDanger itemDeleteBtn"
                                    type="button"
                                    onClick={() => {
                                      setExclusiveDirty(true);
                                      setExclusiveEditItems((prev) => prev.filter((_, i) => i !== idx));
                                    }}
                                    disabled={saving || loading}
                                  >
                                    삭제
                                  </button>
                                </div>
                              ))
                            )}
                            <div className="btnRow" style={{ marginTop: 6 }}>
                              <button className="btn" type="button" onClick={addExclusiveEditRow} disabled={saving || loading}>
                                옵션항목 추가
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="hint">메뉴의 전용 옵션 생성 및 연결</div>
                            <div className="groupTopRow">
                              <div className="field" style={{ marginTop: 0 }}>
                                <div className="label">전용옵션 그룹</div>
                                <input
                                  className="input"
                                  value={newExclusiveGroup.name}
                                  onChange={(e) => {
                                    setExclusiveDirty(true);
                                    setNewExclusiveGroup((p) => ({ ...p, name: e.target.value }));
                                  }}
                                  placeholder="전용옵션 그룹명 (예: 당도)"
                                  disabled={saving || loading}
                                />
                              </div>
                              <div className="field maxSelectField" style={{ marginTop: 0 }}>
                                <div className="label">최대 선택 수량</div>
                                <input
                                  className="input maxSelectInput"
                                  inputMode="numeric"
                                  value={newExclusiveGroup.max}
                                  onChange={(e) => {
                                    setExclusiveDirty(true);
                                    setNewExclusiveGroup((p) => ({ ...p, max: e.target.value }));
                                  }}
                                  placeholder="최대 선택 수량"
                                  disabled={saving || loading}
                                />
                              </div>
                            </div>
                            {showExclusiveItemInputs ? (
                              newExclusiveItems.map((row, idx) => (
                                <div className="optionRow" key={`new-item-${idx}`}>
                                  <input
                                    className="input"
                                    value={row.name}
                                    onChange={(e) => {
                                      setExclusiveDirty(true);
                                      setNewExclusiveItems((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)));
                                    }}
                                    placeholder={`옵션 항목 ${idx + 1}`}
                                    disabled={saving || loading}
                                  />
                                  <input
                                    className="input"
                                    style={{ maxWidth: 120 }}
                                    inputMode="numeric"
                                    value={row.price}
                                    onChange={(e) => {
                                      setExclusiveDirty(true);
                                      setNewExclusiveItems((prev) => prev.map((v, i) => (i === idx ? { ...v, price: e.target.value } : v)));
                                    }}
                                    placeholder="단가 입력"
                                    disabled={saving || loading}
                                  />
                                  {newExclusiveItems.length > 1 ? (
                                    <button
                                      className="btn btnDanger btnMini"
                                      type="button"
                                      onClick={() => {
                                        setExclusiveDirty(true);
                                        setNewExclusiveItems((prev) => prev.filter((_, i) => i !== idx));
                                      }}
                                      disabled={saving || loading}
                                    >
                                      삭제
                                    </button>
                                  ) : null}
                                </div>
                              ))
                            ) : null}
                            <div className="btnRow" style={{ marginTop: 6 }}>
                              <button
                                className="btn"
                                type="button"
                                onClick={() => {
                                  setExclusiveDirty(true);
                                  setShowExclusiveItemInputs(true);
                                  setNewExclusiveItems((prev) => [...prev, { name: "", price: "" }]);
                                }}
                                disabled={saving || loading}
                              >
                                옵션항목 추가
                              </button>
                            </div>
                            <div className="btnRow" style={{ marginTop: 6, width: "100%" }}>
                              <button className="btn btnPrimary fullWidthBtn" type="button" onClick={createExclusiveGroupInMenu} disabled={saving || loading}>
                                전용옵션 생성
                              </button>
                              <button className="btn" type="button" onClick={closeExclusiveEditor} disabled={saving || loading}>
                                취소
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            </div>

          </div>
        </section>
      )}
      {pendingOptionTab ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-labelledby="option-tab-confirm-title">
          <div className="confirmCard">
            <h3 id="option-tab-confirm-title" className="confirmTitle">저장되지 않은 변경사항</h3>
            <p className="confirmDesc">저장하지 않고 이동하면 변경 내용이 사라질 수 있습니다.</p>
            <div className="confirmActions">
              <button className="btn" type="button" onClick={closeOptionTabConfirm} disabled={saving || loading}>
                취소
              </button>
              <button className="btn" type="button" onClick={discardAndMoveOptionTab} disabled={saving || loading}>
                그대로 이동
              </button>
              <button className="btn btnPrimary" type="button" onClick={() => void saveAndMoveOptionTab()} disabled={saving || loading}>
                저장 후 이동
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmState.open ? (
        <div className="confirmOverlay" role="dialog" aria-modal="true" aria-labelledby="menu-confirm-title">
          <div className="confirmCard">
            <h3 id="menu-confirm-title" className="confirmTitle">{confirmState.title}</h3>
            <p className="confirmDesc">{confirmState.description}</p>
            <div className="confirmActions">
              <button className="btn" type="button" onClick={closeConfirm} disabled={saving || copying}>
                취소
              </button>
              <button
                className="btn btnPrimary"
                type="button"
                onClick={() => void confirmState.action?.()}
                disabled={saving || copying}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function AdminMenuPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminMenuPageInner />
    </Suspense>
  );
}
