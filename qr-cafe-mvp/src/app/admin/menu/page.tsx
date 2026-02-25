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

type MenuDraft = {
  id: string;
  name: string;
  price: string;
  image: string;
  isSoldOut: boolean;
  optionGroupIds: string[];
  sortOrder: string;
  optionPriceByItem: Record<string, string>;
};

function slugify(input: string) {
  const base = (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-+|\-+$/g, "");
  if (!base) return "";
  return base.slice(0, 40);
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function getFileExt(name: string) {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

const emptyDraft: MenuDraft = {
  id: "",
  name: "",
  price: "",
  image: "",
  isSoldOut: false,
  optionGroupIds: [],
  sortOrder: "",
  optionPriceByItem: {},
};

function AdminMenuPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [optionItems, setOptionItems] = useState<OptionItem[]>([]);
  const [optionPrices, setOptionPrices] = useState<MenuOptionPrice[]>([]);
  const [hasLinkedMenuColumn, setHasLinkedMenuColumn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [badge, setBadge] = useState<"idle" | "saved" | "error">("idle");
  const badgeText = badge === "saved" ? "저장됨 ✅" : badge === "error" ? "저장 실패 ❗" : " ";
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageFileName, setImageFileName] = useState("");
  const [msg, setMsg] = useState("");
  const [showExclusiveCreateForm, setShowExclusiveCreateForm] = useState(false);
  const [commonGroupToAdd, setCommonGroupToAdd] = useState("");
  const [newExclusiveGroup, setNewExclusiveGroup] = useState({
    name: "",
    max: "1",
  });
  const [newExclusiveItems, setNewExclusiveItems] = useState<Array<{ name: string; price: string }>>([]);
  const [showExclusiveItemInputs, setShowExclusiveItemInputs] = useState(false);
  const [selectedExclusiveGroupId, setSelectedExclusiveGroupId] = useState("");
  const [exclusiveEdit, setExclusiveEdit] = useState({ name: "", max: "1" });
  const [newSelectedExclusiveItem, setNewSelectedExclusiveItem] = useState({ name: "", price: "" });

  const [draft, setDraft] = useState<MenuDraft>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string>("");

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
        .select("id,store_id,name,price,image,is_sold_out,option_group_ids,sort_order")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (menuRes.error) throw menuRes.error;

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

      setItems((menuRes.data || []) as MenuItem[]);
      setGroups(groupData);
      setOptionItems((itemRes.data || []) as OptionItem[]);
      setOptionPrices((priceRes.data || []) as MenuOptionPrice[]);

      setSelectedId((prev) => {
        if (prev && (menuRes.data || []).some((x) => x.id === prev)) return prev;
        return (menuRes.data || [])[0]?.id || "";
      });
    } catch (e: any) {
      console.error("[admin/menu] refresh error:", e?.message || e);
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

  useEffect(() => {
    if (!selectedId) {
      setDraft(emptyDraft);
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
      sortOrder: found.sort_order != null ? String(found.sort_order) : "",
      optionPriceByItem: optionPrices
        .filter((row) => row.menu_id === found.id)
        .reduce<Record<string, string>>((acc, row) => {
          acc[row.option_item_id] = String(row.price_delta ?? 0);
          return acc;
        }, {}),
    });
  }, [items, selectedId, optionPrices]);

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

  const onNew = () => {
    setSelectedId("");
    setDraft(emptyDraft);
    setImageFileName("");
    setMsg("");
    setShowExclusiveCreateForm(false);
  };

  const onSave = async () => {
    if (!storeId) return;
    const name = draft.name.trim();
    const id = draft.id.trim();
    const price = toInt(draft.price, -1);

    if (!name) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    if (!id) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    if (price < 0) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    setSaving(true);
    setBadge("idle");

    try {
      if (!hasLinkedMenuColumn) {
        const hasExclusiveSelection = draft.optionGroupIds.some((gid) => {
          const group = groups.find((g) => g.id === gid);
          return group?.scope === "exclusive";
        });

        if (hasExclusiveSelection) {
          setBadge("error");
          setTimeout(() => setBadge("idle"), 1600);
          setMsg("DB에 linked_menu_id 컬럼이 없어 전용옵션 저장이 불가합니다. SQL 마이그레이션을 먼저 실행해 주세요.");
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
        sort_order: draft.sortOrder ? toInt(draft.sortOrder, 0) : null,
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
        const ins = await supabase.from("menu_items").insert([payload]);
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
    } catch (e: any) {
      console.error("[admin/menu] save error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
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
    } catch (e: any) {
      console.error("[admin/menu] delete error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (id: string) => {
    setDraft((prev) => {
      const has = prev.optionGroupIds.includes(id);
      const next = has ? prev.optionGroupIds.filter((g) => g !== id) : [...prev.optionGroupIds, id];
      if (!has) return { ...prev, optionGroupIds: next };

      const nextPrices = { ...prev.optionPriceByItem };
      optionItems
        .filter((it) => it.group_id === id)
        .forEach((it) => {
          delete nextPrices[it.id];
        });
      return { ...prev, optionGroupIds: next, optionPriceByItem: nextPrices };
    });
  };

  const updateSelectedExclusiveGroupInMenu = async () => {
    if (!storeId || !selectedExclusiveGroup) return;

    const nextName = exclusiveEdit.name.trim();
    if (!nextName) {
      setMsg("전용옵션 그룹명을 입력해주세요.");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const nextMax = Math.max(toInt(exclusiveEdit.max, selectedExclusiveGroup.max || 1), 1);
      const { error } = await supabase
        .from("option_groups")
        .update({ name: nextName, max: nextMax })
        .eq("store_id", storeId)
        .eq("id", selectedExclusiveGroup.id);
      if (error) throw error;

      await refresh();
      setMsg("전용옵션 그룹을 수정했습니다.");
    } catch (e: any) {
      setMsg(`옵션수정 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const addItemToSelectedExclusiveGroupInMenu = async () => {
    if (!storeId || !selectedExclusiveGroup) return;

    const name = newSelectedExclusiveItem.name.trim();
    if (!name) {
      setMsg("추가할 옵션 항목명을 입력해주세요.");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const row = {
        id: `item_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`,
        store_id: storeId,
        group_id: selectedExclusiveGroup.id,
        name,
        price_delta: toInt(newSelectedExclusiveItem.price, 0),
      };

      const { error } = await supabase.from("option_items").insert([row]);
      if (error) throw error;

      setNewSelectedExclusiveItem({ name: "", price: "" });
      await refresh();
      setMsg("옵션 항목을 추가했습니다.");
    } catch (e: any) {
      setMsg(`옵션 항목 추가 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteExclusiveItemInMenu = async (itemId: string) => {
    if (!storeId || !draft.id.trim()) return;
    if (!confirm("옵션 항목을 삭제할까요?")) return;

    setSaving(true);
    setMsg("");
    try {
      const delPrice = await supabase
        .from("menu_option_prices")
        .delete()
        .eq("store_id", storeId)
        .eq("menu_id", draft.id.trim())
        .eq("option_item_id", itemId);
      if (delPrice.error) throw delPrice.error;

      const delItem = await supabase
        .from("option_items")
        .delete()
        .eq("store_id", storeId)
        .eq("id", itemId);
      if (delItem.error) throw delItem.error;

      setDraft((prev) => {
        const nextPrices = { ...prev.optionPriceByItem };
        delete nextPrices[itemId];
        return { ...prev, optionPriceByItem: nextPrices };
      });

      await refresh();
      setMsg("옵션 항목을 삭제했습니다.");
    } catch (e: any) {
      setMsg(`옵션 항목 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveCommonPricesInMenu = async () => {
    if (!storeId) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setMsg("메뉴를 먼저 저장한 뒤 단가를 수정해주세요.");
      return;
    }

    const commonItemIds = selectedCommonGroups.flatMap((group) =>
      (itemsByGroup.get(group.id) || []).map((item) => item.id)
    );
    if (commonItemIds.length === 0) {
      setMsg("저장할 공통옵션 항목이 없습니다.");
      return;
    }

    setSaving(true);
    setMsg("");
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

      await refresh();
      setMsg("공통옵션 단가를 수정했습니다.");
    } catch (e: any) {
      setMsg(`공통옵션 단가 수정 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedExclusivePricesInMenu = async () => {
    if (!storeId || !selectedExclusiveGroup) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setMsg("메뉴를 먼저 저장한 뒤 단가를 저장해주세요.");
      return;
    }

    const itemIds = (itemsByGroup.get(selectedExclusiveGroup.id) || []).map((item) => item.id);
    if (itemIds.length === 0) {
      setMsg("저장할 옵션 항목이 없습니다.");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const rows = itemIds.map((optionItemId) => ({
        store_id: storeId,
        menu_id: menuId,
        option_item_id: optionItemId,
        price_delta: toInt(draft.optionPriceByItem[optionItemId] ?? "0", 0),
      }));

      const { error } = await supabase
        .from("menu_option_prices")
        .upsert(rows, { onConflict: "store_id,menu_id,option_item_id" });
      if (error) throw error;

      await refresh();
      setMsg("옵션 단가를 저장했습니다.");
    } catch (e: any) {
      setMsg(`옵션 단가 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteExclusiveGroupInMenu = async (groupId: string) => {
    if (!storeId) return;
    if (!confirm(`등록된 전용옵션 그룹을 삭제할까요?\n연결된 옵션 항목도 함께 삭제됩니다.`)) return;

    setSaving(true);
    setMsg("");
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
      setMsg("전용옵션을 삭제했습니다.");
    } catch (e: any) {
      setMsg(`전용옵션 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const createExclusiveGroupInMenu = async () => {
    if (!storeId) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setMsg("전용옵션을 만들기 전에 메뉴명을 입력해 메뉴 ID를 먼저 만들어주세요.");
      return;
    }
    const groupName = newExclusiveGroup.name.trim();
    if (!groupName) {
      setMsg("전용옵션 그룹명을 입력해주세요.");
      return;
    }

    const cleanedItems = newExclusiveItems
      .map((x) => ({ name: x.name.trim(), price: toInt(x.price, 0) }))
      .filter((x) => Boolean(x.name));
    if (cleanedItems.length === 0) {
      setMsg("전용옵션 항목을 1개 이상 입력해주세요.");
      return;
    }

    setSaving(true);
    setMsg("");
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
      setShowExclusiveCreateForm(false);
      await refresh();
      setMsg("전용옵션 그룹을 생성했고 현재 메뉴에 자동 연결했습니다.");
    } catch (e: any) {
      setMsg(`전용옵션 생성 실패: ${String(e?.message || e)}`);
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
      setNewSelectedExclusiveItem({ name: "", price: "" });
      return;
    }
    setExclusiveEdit({
      name: selectedExclusiveGroup.name || "",
      max: String(Math.max(Number(selectedExclusiveGroup.max ?? 1), 1)),
    });
    setNewSelectedExclusiveItem({ name: "", price: "" });
  }, [selectedExclusiveGroup]);

  const effectiveExclusiveCreateOpen = showExclusiveCreateForm;
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

  const addCommonGroup = () => {
    if (!commonGroupToAdd) return;
    setDraft((prev) => {
      if (prev.optionGroupIds.includes(commonGroupToAdd)) return prev;
      return { ...prev, optionGroupIds: [...prev.optionGroupIds, commonGroupToAdd] };
    });
    setCommonGroupToAdd("");
  };

  const onUploadMenuImage = async (file: File | null) => {
    if (!file) return;
    if (!draft.id.trim()) {
      setMsg("이미지를 올리려면 메뉴 ID를 먼저 입력해주세요.");
      return;
    }

    setUploadingImage(true);
    setMsg("");
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
      setMsg(`메뉴 이미지 업로드 실패: ${String(e?.message || e)}`);
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
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .sub + .sub + .headerActionRow {
          display: none;
        }
        .btn {
          border: 1px solid var(--line);
          background: #fff;
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
          display: grid;
          gap: 6px;
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
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
        .optionGrid {
          display: grid;
          gap: 8px;
          margin-top: 8px;
        }
        .optionConnectCard {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          background: #fcfcfd;
          display: grid;
          gap: 10px;
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
          grid-template-columns: 96px 1fr;
          gap: 10px;
          align-items: center;
        }
        .imageActionCol {
          display: grid;
          gap: 8px;
        }
        .fileNameInput {
          width: 100%;
        }
        .previewThumb {
          margin-top: 0;
          width: 96px;
          height: 96px;
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
          width: 96px;
          height: 96px;
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
        .sortOrderInput {
          width: 34%;
          min-width: 90px;
          max-width: 130px;
        }
        .menuIdInput {
          min-width: 0;
          max-width: 220px;
        }
        .sortIdRow {
          display: grid;
          grid-template-columns: 120px minmax(0, 1fr);
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
        .fullWidthBtn {
          width: 100%;
          justify-content: center;
        }
        .divider {
          height: 1px;
          background: var(--line);
          margin: 10px 0;
        }
        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .inlineSelectRow {
            grid-template-columns: 1fr;
          }
          .twoColRow {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .imageUploadRow {
            grid-template-columns: 96px 1fr;
          }
          .maxSelectInput {
            width: 100%;
            min-width: 88px;
          }
          .sortOrderInput {
            width: 100%;
            min-width: 0;
          }
          .sortIdRow {
            grid-template-columns: 110px minmax(0, 1fr);
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
            width: 96px;
            height: 96px;
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
              <a className="btn" href={`/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                옵션관리
              </a>
            </div>
          </div>
          <p className="sub">메뉴 기본정보와 옵션 가격을 관리합니다.</p>
          <p className="sub" style={{ marginTop: 6 }}>
            현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
          </p>
          <div className="headerActionRow">
            <button className="btn" onClick={onBack}>
              관리자 홈
            </button>
            <a className="btn" href={`/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
              옵션관리
            </a>
          </div>
          {msg ? (
            <p className="sub" style={{ marginTop: 6, color: "#b91c1c" }}>
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
            </div>

            <div className="list">
              {sortedItems.map((m) => {
                const groupIds = Array.isArray(m.option_group_ids) ? m.option_group_ids : [];
                const commonCount = groupIds.filter((gid) => {
                  const group = groups.find((g) => g.id === gid);
                  return (group?.scope || "common") !== "exclusive";
                }).length;
                const exclusiveCount = groupIds.filter((gid) => {
                  const group = groups.find((g) => g.id === gid);
                  return (group?.scope || "common") === "exclusive";
                }).length;
                return (
                  <button
                    key={m.id}
                    className={`rowBtn ${m.id === selectedId ? "rowBtnOn" : ""}`}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <div className="name">
                      {m.name}
                      {m.is_sold_out ? <span className="soldOutChip">품절</span> : null}
                    </div>
                    <div className="muted">
                      {Number(m.price || 0).toLocaleString()}원 · 공통옵션 {commonCount}개 · 전용옵션 {exclusiveCount}개
                    </div>
                  </button>
                );
              })}
              {!loading && items.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  아직 메뉴가 없습니다. “+ 새 메뉴”로 시작하세요.
                </div>
              ) : null}
            </div>
          </div>

          <div className="detailColumn">
            <div className="card">
              <h2 className="cardTitle">메뉴 상세</h2>

            <div className="field">
              <div className="label">메뉴명</div>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    name: nextName,
                    id: prev.id || slugify(nextName),
                  }));
                }}
                placeholder="예: 아메리카노"
                disabled={saving || loading}
              />
            </div>

            <div className="twoColRow">
              <div className="field">
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

              <div className="field" style={{ minWidth: 92 }}>
                <div className="label">품절</div>
                <label className="optionRow" style={{ minHeight: 42 }}>
                  <input
                    type="checkbox"
                    checked={draft.isSoldOut}
                    onChange={(e) => setDraft((prev) => ({ ...prev, isSoldOut: e.target.checked }))}
                    disabled={saving || loading}
                  />
                  품절 처리
                </label>
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
                  <label className="btn">
                    {uploadingImage ? "업로드 중..." : "이미지 업로드"}
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => onUploadMenuImage(e.target.files?.[0] || null)}
                      disabled={saving || loading || uploadingImage}
                    />
                  </label>
                  <input className="input fileNameInput" value={imageFileName} readOnly placeholder="선택된 파일명" />
                </div>
              </div>
            </div>

            <div className="sortIdRow">
              <div className="field">
                <div className="label">노출 순서</div>
                <input
                  className="input sortOrderInput"
                  inputMode="numeric"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
                  placeholder="예: 10"
                  disabled={saving || loading}
                />
              </div>

              <div className="field menuIdInput">
                <div className="label">메뉴 ID</div>
                <input
                  className="input"
                  value={draft.id}
                  onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))}
                  placeholder="예: americano"
                  disabled={saving || loading || isEditing}
                />
                <div className="hint">등록 된 메뉴는 ID변경 불가</div>
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
                        {g.name}
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
                              <div className="name">{group.name}</div>
                              <button className="btn btnDanger" type="button" onClick={() => toggleGroup(group.id)} disabled={saving || loading}>
                                연결해제
                              </button>
                            </div>
                            {groupOptions.length === 0 ? (
                              <div className="muted">옵션 항목이 없습니다.</div>
                            ) : (
                              groupOptions.map((item) => (
                                <div key={item.id} className="groupOptionItem">
                                  <span>{item.name}</span>
                                  <input
                                    className="input"
                                    style={{ maxWidth: 140 }}
                                    inputMode="numeric"
                                    value={getOptionPrice(item)}
                                    onChange={(e) =>
                                      setDraft((prev) => ({
                                        ...prev,
                                        optionPriceByItem: {
                                          ...prev.optionPriceByItem,
                                          [item.id]: e.target.value,
                                        },
                                      }))
                                    }
                                    disabled={saving || loading}
                                  />
                                </div>
                              ))
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="btnRow" style={{ marginTop: 6 }}>
                      <button className="btn" type="button" onClick={saveCommonPricesInMenu} disabled={saving || loading}>
                        단가 수정
                      </button>
                    </div>
                  </>
                )}
                </div>
              </div>

              <div className="field">
                <div className="label">전용옵션 (현재 메뉴 전용)</div>
                <div className="optionConnectCard">
                {exclusiveGroups.length === 0 ? <div className="muted">아직 전용옵션이 없습니다.</div> : null}

                <div className="optionGrid" style={{ marginTop: 6 }}>
                  {exclusiveGroups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className={`rowBtn ${g.id === selectedExclusiveGroupId ? "rowBtnOn" : ""}`}
                      onClick={() => setSelectedExclusiveGroupId(g.id)}
                      disabled={saving || loading}
                    >
                      <div className="name">{g.name}</div>
                      <div className="muted">최대 {Math.max(Number(g.max ?? 1), 1)}개 선택</div>
                    </button>
                  ))}
                </div>

                {selectedExclusiveGroup ? (
                  <div className="groupOptionDetail" style={{ marginTop: 8 }}>
                    <div className="groupTopRow">
                      <div className="field" style={{ marginTop: 0 }}>
                        <div className="label">전용옵션 그룹</div>
                        <input
                          className="input"
                          value={exclusiveEdit.name}
                          onChange={(e) => setExclusiveEdit((p) => ({ ...p, name: e.target.value }))}
                          disabled={saving || loading}
                        />
                      </div>
                      <div className="field maxSelectField" style={{ marginTop: 0 }}>
                        <div className="label">최대 선택 수량</div>
                        <input
                          className="input maxSelectInput"
                          inputMode="numeric"
                          value={exclusiveEdit.max}
                          onChange={(e) => setExclusiveEdit((p) => ({ ...p, max: e.target.value }))}
                          disabled={saving || loading}
                        />
                      </div>
                    </div>

                    <div className="btnRow" style={{ marginTop: 8 }}>
                      <button className="btn btnPrimary" type="button" onClick={updateSelectedExclusiveGroupInMenu} disabled={saving || loading}>
                        그룹 수정
                      </button>
                      <button className="btn btnDanger" type="button" onClick={() => deleteExclusiveGroupInMenu(selectedExclusiveGroup.id)} disabled={saving || loading}>
                        그룹 삭제
                      </button>
                    </div>

                    <div className="label" style={{ marginTop: 6 }}>옵션 항목</div>
                    <div className="hint">단가를 수정한 뒤에는 아래의 단가 수정 버튼을 눌러주세요.</div>
                    {(itemsByGroup.get(selectedExclusiveGroup.id) || []).length === 0 ? (
                      <div className="muted">옵션 항목이 없습니다.</div>
                    ) : (
                      (itemsByGroup.get(selectedExclusiveGroup.id) || []).map((item) => (
                        <div key={item.id} className="exclusiveItemCard">
                          <div className="exclusiveItemTop">
                            <span className="exclusiveItemName">{item.name}</span>
                            <input
                              className="input"
                              inputMode="numeric"
                              value={getOptionPrice(item)}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  optionPriceByItem: {
                                    ...prev.optionPriceByItem,
                                    [item.id]: e.target.value,
                                  },
                                }))
                              }
                              placeholder="단가 입력"
                              disabled={saving || loading}
                            />
                          </div>
                          <button
                            className="btn btnDanger itemDeleteBtn"
                            type="button"
                            onClick={() => deleteExclusiveItemInMenu(item.id)}
                            disabled={saving || loading}
                          >
                            항목 삭제
                          </button>
                        </div>
                      ))
                    )}

                    <div className="btnRow" style={{ marginTop: 6 }}>
                      <button className="btn" type="button" onClick={saveSelectedExclusivePricesInMenu} disabled={saving || loading}>
                        단가 수정
                      </button>
                    </div>

                    <div className="label" style={{ marginTop: 8 }}>옵션 항목 추가</div>
                    <div className="optionRow" style={{ marginTop: 4 }}>
                      <input
                        className="input"
                        value={newSelectedExclusiveItem.name}
                        onChange={(e) => setNewSelectedExclusiveItem((p) => ({ ...p, name: e.target.value }))}
                        placeholder="옵션 항목명"
                        disabled={saving || loading}
                      />
                      <input
                        className="input"
                        style={{ maxWidth: 120 }}
                        inputMode="numeric"
                        value={newSelectedExclusiveItem.price}
                        onChange={(e) => setNewSelectedExclusiveItem((p) => ({ ...p, price: e.target.value }))}
                        placeholder="단가 입력"
                        disabled={saving || loading}
                      />
                    </div>
                    <div className="btnRow" style={{ marginTop: 6 }}>
                      <button className="btn fullWidthBtn" type="button" onClick={addItemToSelectedExclusiveGroupInMenu} disabled={saving || loading}>
                        항목추가
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="field" style={{ marginTop: 16 }}>
                  <button
                    className="btn fullWidthBtn"
                    type="button"
                    onClick={() =>
                      setShowExclusiveCreateForm((p) => {
                        const next = !p;
                        if (!next) setShowExclusiveItemInputs(false);
                        return next;
                      })
                    }
                    disabled={saving || loading}
                  >
                    {effectiveExclusiveCreateOpen ? "전용옵션 추가 닫기" : "+ 전용옵션 추가"}
                  </button>
                </div>

                {effectiveExclusiveCreateOpen ? (
                  <div className="createBox">
                    <div className="hint">메뉴의 전용 옵션 생성 및 연결</div>
                    <div className="groupTopRow">
                      <div className="field" style={{ marginTop: 0 }}>
                        <div className="label">전용옵션 그룹</div>
                        <input
                          className="input"
                          value={newExclusiveGroup.name}
                          onChange={(e) => setNewExclusiveGroup((p) => ({ ...p, name: e.target.value }))}
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
                          onChange={(e) => setNewExclusiveGroup((p) => ({ ...p, max: e.target.value }))}
                          placeholder="최대 선택 수량"
                          disabled={saving || loading}
                        />
                      </div>
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        setShowExclusiveItemInputs(true);
                        setNewExclusiveItems((prev) => [...prev, { name: "", price: "" }]);
                      }}
                      disabled={saving || loading}
                    >
                      옵션항목 추가
                    </button>
                    {showExclusiveItemInputs ? (
                      newExclusiveItems.map((row, idx) => (
                        <div className="optionRow" key={`new-item-${idx}`}>
                          <input
                            className="input"
                            value={row.name}
                            onChange={(e) =>
                              setNewExclusiveItems((prev) => prev.map((v, i) => (i === idx ? { ...v, name: e.target.value } : v)))
                            }
                            placeholder={`옵션 항목 ${idx + 1}`}
                            disabled={saving || loading}
                          />
                          <input
                            className="input"
                            style={{ maxWidth: 120 }}
                            inputMode="numeric"
                            value={row.price}
                            onChange={(e) =>
                              setNewExclusiveItems((prev) => prev.map((v, i) => (i === idx ? { ...v, price: e.target.value } : v)))
                            }
                            placeholder="단가 입력"
                            disabled={saving || loading}
                          />
                          {newExclusiveItems.length > 1 ? (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => setNewExclusiveItems((prev) => prev.filter((_, i) => i !== idx))}
                              disabled={saving || loading}
                            >
                              제거
                            </button>
                          ) : null}
                        </div>
                      ))
                    ) : null}
                    <div className="btnRow" style={{ marginTop: 6, width: "100%" }}>
                      <button className="btn btnPrimary fullWidthBtn" type="button" onClick={createExclusiveGroupInMenu} disabled={saving || loading}>
                        전용옵션 생성
                      </button>
                    </div>
                  </div>
                ) : null}
                </div>
              </div>

            </div>

          </div>
        </section>
      )}
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