// src/app/menu/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMenuItems, MenuItem } from "@/app/lib/menuStore";
import { useStoreProfile } from "@/app/lib/storeProfile";
import { supabase } from "@/app/lib/supabaseClient";
import { getStoreIdFromSearchParams } from "@/app/lib/storeScope";

type SelectedOptionItem = {
  id: string;
  name: string;
  priceDelta: number;
  qty: number;
};

type SelectedGroup = {
  groupId: string;
  groupName: string;
  required: boolean;
  min: number;
  max: number;
  items: SelectedOptionItem[];
};

type CartLine = {
  lineId: string;
  menuId: string;
  name: string;
  basePrice: number;
  qty: number;
  image?: string;
  options: SelectedGroup[];
  optionTotal: number; // 1개 기준 옵션 추가금 합계
};

type OptionGroup = {
  id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
};

type OptionItem = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
};

type MenuOptionPrice = {
  menuId: string;
  optionItemId: string;
  priceDelta: number;
};

type OptionData = {
  groups: OptionGroup[];
  items: OptionItem[];
};

type MenuCategory = {
  id: string;
  name: string;
  sortOrder: number;
};

type MenuSection = {
  id: string;
  name: string;
  items: MenuItem[];
};

function uid(prefix = "line") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random()
    .toString(16)
    .slice(2, 8)}`;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function toStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function buildOptionSignature(groups: SelectedGroup[]) {
  const normalized = groups
    .map((g) => ({
      groupId: String(g.groupId || ""),
      items: (Array.isArray(g.items) ? g.items : [])
        .map((it) => ({ id: String(it.id || ""), qty: Math.max(0, Number(it.qty || 0)) }))
        .filter((it) => it.id && it.qty > 0)
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));

  return JSON.stringify(normalized);
}

function MenuPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  // ✅ 멀티매장 핵심: URL(store) > env fallback
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);

  // ⚠️ useStoreProfile/useMenuItems는 아직 내부가 "store별"이 아님(로컬스토리지/ENV 기준).
  //    그래서 이 페이지에서 storeId 바뀔 때마다 refresh를 확실히 호출해주고,
  //    옵션은 여기서 직접 storeId 기반으로 쿼리함.
  const { profile } = useStoreProfile(storeId);
  const { items: menuItems, loading: menuLoading, refresh: refreshMenu } = useMenuItems(storeId);

  const table = (sp.get("table") || "").trim();
  const isTableQr = !!table;
  const cartStorageKey = useMemo(
    () => `qrCafeCart:${storeId}:${isTableQr ? table : "counter"}`,
    [storeId, isTableQr, table]
  );

  const [optionsData, setOptionsData] = useState<OptionData>({
    groups: [],
    items: [],
  });
  const [menuOptionPrices, setMenuOptionPrices] = useState<MenuOptionPrice[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("all");
  const [scrollCategoryId, setScrollCategoryId] = useState("all");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const menuContentRef = useRef<HTMLDivElement | null>(null);
  const topStickyRef = useRef<HTMLDivElement | null>(null);
  const [topStickyHeight, setTopStickyHeight] = useState(0);

  const [cartLines, setCartLines] = useState<CartLine[]>([]);

  const [optOpen, setOptOpen] = useState(false);
  const [optTarget, setOptTarget] = useState<MenuItem | null>(null);

  const [optSel, setOptSel] = useState<Record<string, Record<string, number>>>({});
  const [optQty, setOptQty] = useState(1);

  const fetchOptionsFromDb = async () => {
    setOptionsLoading(true);

    const [
      { data: gData, error: gErr },
      { data: iData, error: iErr },
      { data: pData, error: pErr },
    ] = await Promise.all([
      supabase
        .from("option_groups")
        .select("id,name,required,min,max,store_id,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true }),
      supabase
        .from("option_items")
        .select("id,group_id,name,price_delta,store_id,created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true }),
      supabase
        .from("menu_option_prices")
        .select("menu_id,option_item_id,price_delta,store_id")
        .eq("store_id", storeId),
    ]);

    if (gErr) console.error("[menu] fetch option_groups error:", gErr.message);
    if (iErr) console.error("[menu] fetch option_items error:", iErr.message);
    if (pErr) console.error("[menu] fetch menu_option_prices error:", pErr.message);

    const groups: OptionGroup[] = (Array.isArray(gData) ? gData : [])
      .map((g: any) => ({
        id: toStr(g.id).trim(),
        name: toStr(g.name).trim(),
        required: !!g.required,
        min: Math.max(0, toInt(g.min, 0)),
        max: Math.max(0, toInt(g.max, 1)),
      }))
      .filter((g) => g.id && g.name);

    const items: OptionItem[] = (Array.isArray(iData) ? iData : [])
      .map((it: any) => ({
        id: toStr(it.id).trim(),
        groupId: toStr(it.group_id).trim(),
        name: toStr(it.name).trim(),
        priceDelta: Math.round(Number(it.price_delta ?? 0)),
      }))
      .filter((it) => it.id && it.groupId && it.name);

    const priceRows: MenuOptionPrice[] = (Array.isArray(pData) ? pData : [])
      .map((row: any) => ({
        menuId: toStr(row.menu_id).trim(),
        optionItemId: toStr(row.option_item_id).trim(),
        priceDelta: Math.round(Number(row.price_delta ?? 0)),
      }))
      .filter((row) => row.menuId && row.optionItemId);

    setOptionsData({ groups, items });
    setMenuOptionPrices(priceRows);
    setOptionsLoading(false);
  };


  const fetchCategoriesFromDb = async () => {
    const { data, error } = await supabase
      .from("menu_categories")
      .select("id,name,sort_order,is_active,store_id")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[menu] fetch menu_categories error:", error.message);
      setCategories([]);
      setSelectedCategoryId("all");
      setScrollCategoryId("all");
      return;
    }

    const rows = (Array.isArray(data) ? data : []).map((row: any) => ({
      id: toStr(row.id).trim(),
      name: toStr(row.name).trim(),
      sortOrder: Number.isFinite(Number(row.sort_order)) ? toInt(row.sort_order, 0) : 0,
    })).filter((row) => row.id && row.name);

    setCategories(rows);
  };

  // ✅ storeId가 바뀌면 옵션/메뉴를 다시 불러오고, 장바구니는 현재 매장/테이블 키로 복원
  useEffect(() => {
    fetchOptionsFromDb();
    fetchCategoriesFromDb();
    refreshMenu();
    setSelectedCategoryId("all");
    setScrollCategoryId("all");
    try {
      const raw = sessionStorage.getItem(cartStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      const restored = Array.isArray(parsed)
        ? parsed
            .filter((x) => x && typeof x === "object")
            .map((x: any) => ({
              lineId: String(x.lineId || uid("line")),
              menuId: String(x.menuId || ""),
              name: String(x.name || ""),
              basePrice: Number(x.basePrice ?? 0),
              qty: Math.max(0, Number(x.qty ?? 0)),
              image: typeof x.image === "string" ? x.image : "",
              options: Array.isArray(x.options) ? x.options : [],
              optionTotal: Number(x.optionTotal ?? 0),
            }))
            .filter((x) => x.menuId && x.qty > 0)
        : [];
      setCartLines(restored);
    } catch {
      setCartLines([]);
    }
    setOptOpen(false);
    setOptTarget(null);
    setOptSel({});
    setOptQty(1);

    const onFocus = () => {
      fetchOptionsFromDb();
      fetchCategoriesFromDb();
      refreshMenu();
    };
    window.addEventListener("focus", onFocus);

    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, cartStorageKey]);

  useEffect(() => {
    try {
      if (!cartLines.length) sessionStorage.removeItem(cartStorageKey);
      else sessionStorage.setItem(cartStorageKey, JSON.stringify(cartLines));
    } catch {
      // ignore storage write errors
    }
  }, [cartLines, cartStorageKey]);

  const sortedMenuItems = useMemo(() => {
    const sorted = [...(menuItems || [])].sort((a: any, b: any) => {
      const ao = Number((a as any).sortOrder ?? 999999);
      const bo = Number((b as any).sortOrder ?? 999999);
            if (ao !== bo) return ao - bo;
      return String((a as any).name || "").localeCompare(String((b as any).name || ""));
    });
    return sorted;
  }, [menuItems]);

  const menuSections = useMemo<MenuSection[]>(() => {
    if (selectedCategoryId !== "all") {
      const selectedCategory = categories.find((cat) => cat.id === selectedCategoryId);
      return [
        {
          id: selectedCategoryId,
          name: selectedCategory?.name || "카테고리",
          items: sortedMenuItems.filter(
            (m: any) => String((m as any).categoryId || "") === selectedCategoryId
          ),
        },
      ];
    }

    const byCategory = new Map<string, MenuItem[]>();
    sortedMenuItems.forEach((item: any) => {
      const cid = String(item.categoryId || "").trim();
      if (!cid) return;
      if (!byCategory.has(cid)) byCategory.set(cid, []);
      byCategory.get(cid)?.push(item);
    });

    const sections: MenuSection[] = categories
      .map((cat) => ({ id: cat.id, name: cat.name, items: byCategory.get(cat.id) || [] }))
      .filter((section) => section.items.length > 0);

    const uncategorized = sortedMenuItems.filter((item: any) => !String(item.categoryId || "").trim());
    if (uncategorized.length > 0) {
      sections.push({ id: "uncategorized", name: "기타", items: uncategorized });
    }

    return sections;
  }, [categories, selectedCategoryId, sortedMenuItems]);

  const list = useMemo(() => menuSections.flatMap((section) => section.items), [menuSections]);

  const highlightedCategoryId = selectedCategoryId === "all" ? scrollCategoryId : selectedCategoryId;

  useEffect(() => {
    if (selectedCategoryId !== "all") return;
    if (!menuSections.length) {
      setScrollCategoryId("all");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (!visible) return;
        const sectionId = visible.target.getAttribute("data-section-id") || "all";
        const isKnown = sectionId === "all" || categories.some((cat) => cat.id === sectionId);
        setScrollCategoryId(isKnown ? sectionId : "all");
      },
      {
        root: null,
        rootMargin: "-90px 0px -60% 0px",
        threshold: [0.1, 0.35, 0.65],
      }
    );

    menuSections.forEach((section) => {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [categories, menuSections, selectedCategoryId]);

  useEffect(() => {
    const el = topStickyRef.current;
    if (!el) return;

    const updateHeight = () => {
      setTopStickyHeight(Math.ceil(el.getBoundingClientRect().height));
    };

    updateHeight();

    const ro = new ResizeObserver(() => updateHeight());
    ro.observe(el);
    window.addEventListener("resize", updateHeight);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [menuLoading, optionsLoading, categories.length]);

  useEffect(() => {
    if (selectedCategoryId === "all") return;
    const el = menuContentRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - Math.max(0, topStickyHeight) - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  }, [selectedCategoryId, topStickyHeight]);

  const scrollToCategory = (categoryId: string) => {
    if (categoryId === "all") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = sectionRefs.current[categoryId];
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - Math.max(0, topStickyHeight) - 8;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const headerImage = profile.mainImage || "/hero.jpg";
  const headerOverlayStrength = Math.max(
    0,
    Math.min(100, Number((profile as any).mainImageOverlayStrength ?? 55))
  );
  const overlayBg = useMemo(() => {
    const aTop = 0.1 + 0.35 * (headerOverlayStrength / 100);
    const aMid = 0.18 + 0.45 * (headerOverlayStrength / 100);
    const aBot = 0.25 + 0.6 * (headerOverlayStrength / 100);
    return `linear-gradient(
      to bottom,
      rgba(0,0,0,${aTop}) 0%,
      rgba(0,0,0,${aMid}) 55%,
      rgba(0,0,0,${aBot}) 100%
    )`;
  }, [headerOverlayStrength]);

  const totals = useMemo(() => {
    const totalCount = cartLines.reduce((s, x) => s + (x.qty || 0), 0);
    const totalPrice = cartLines.reduce(
      (s, x) => s + (x.basePrice + x.optionTotal) * (x.qty || 0),
      0
    );
    return { totalCount, totalPrice };
  }, [cartLines]);

  // ✅ 옵션 없는 단순 메뉴에서만 +/- 수량 조절(표시에도 사용)
  const simpleQtyByMenuId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of cartLines) {
      if (line.options.length === 0) {
        map[line.menuId] = (map[line.menuId] || 0) + (line.qty || 0);
      }
    }
    return map;
  }, [cartLines]);

  // ✅ 하단바 요약
  const cartSummary = useMemo(() => {
    if (!cartLines.length) return { text: "", distinctCount: 0 };

    const map = new Map<string, number>();
    for (const ln of cartLines) {
      const key = ln.name;
      map.set(key, (map.get(key) || 0) + (ln.qty || 0));
    }

    const entries = Array.from(map.entries());
    const distinctCount = entries.length;

    const top2 = entries.slice(0, 2).map(([name, q]) => `${name}×${q}`);
    const rest = distinctCount - top2.length;

    const text = rest > 0 ? `${top2.join(", ")} 외 ${rest}개` : top2.join(", ");
    return { text, distinctCount };
  }, [cartLines]);

  const incSimple = (m: MenuItem) => {
    setCartLines((prev) => {
      const idx = prev.findIndex((x) => x.menuId === m.id && x.options.length === 0);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: (next[idx].qty || 0) + 1 };
        return next;
      }
      return [
        ...prev,
        {
          lineId: uid("line"),
          menuId: m.id,
          name: m.name,
          basePrice: Number((m as any).price || 0),
          qty: 1,
          image: (m as any).image || "",
          options: [],
          optionTotal: 0,
        },
      ];
    });
  };

  const decSimple = (m: MenuItem) => {
    setCartLines((prev) => {
      const idx = prev.findIndex((x) => x.menuId === m.id && x.options.length === 0);
      if (idx < 0) return prev;
      const next = [...prev];
      const q = Math.max(0, (next[idx].qty || 0) - 1);
      if (q === 0) next.splice(idx, 1);
      else next[idx] = { ...next[idx], qty: q };
      return next;
    });
  };

  const onPlus = (m: MenuItem) => {
    if ((m as any).isSoldOut) return;

    const groupIds: string[] = Array.isArray((m as any).optionGroupIds)
      ? (m as any).optionGroupIds
      : [];

    if (!groupIds.length) {
      incSimple(m);
      return;
    }

    const init: Record<string, Record<string, number>> = {};
    groupIds.forEach((gid) => (init[gid] = {}));
    setOptSel(init);
    setOptQty(1);
    setOptTarget(m);
    setOptOpen(true);
  };

  const onMinus = (m: MenuItem) => {
    const groupIds: string[] = Array.isArray((m as any).optionGroupIds)
      ? (m as any).optionGroupIds
      : [];
    if (groupIds.length) return;
    decSimple(m);
  };

  const findGroup = (gid: string): OptionGroup | null =>
    optionsData.groups.find((g) => g.id === gid) || null;

  const groupItems = (gid: string): OptionItem[] =>
    optionsData.items.filter((it) => it.groupId === gid);

  const menuOptionPriceMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    menuOptionPrices.forEach((row) => {
      if (!map.has(row.menuId)) map.set(row.menuId, new Map());
      map.get(row.menuId)?.set(row.optionItemId, row.priceDelta);
    });
    return map;
  }, [menuOptionPrices]);

  const resolveOptionPrice = (menuId: string, item: OptionItem) => {
    const menuMap = menuOptionPriceMap.get(menuId);
    if (menuMap && menuMap.has(item.id)) return menuMap.get(item.id) || 0;
    return item.priceDelta || 0;
  };

  const getSelectedQty = (gid: string) => {
    const picked = optSel[gid] || {};
    return Object.values(picked).reduce((sum, n) => sum + Math.max(0, Number(n || 0)), 0);
  };

  const setOptionItemQty = (
    gid: string,
    itemId: string,
    nextQtyRaw: number,
    max: number,
    isSingle: boolean
  ) => {
    setOptSel((prev) => {
      const groupMap = { ...(prev[gid] || {}) };
      const nextQty = Math.max(0, Math.floor(Number(nextQtyRaw) || 0));

      if (isSingle) {
        if (nextQty <= 0) return { ...prev, [gid]: {} };
        return { ...prev, [gid]: { [itemId]: 1 } };
      }

      const othersTotal = Object.entries(groupMap)
              .filter(([id]) => id !== itemId)
        .reduce((sum, [, q]) => sum + Math.max(0, Number(q || 0)), 0);

      const allowed = Math.max(0, Math.min(nextQty, Math.max(0, max - othersTotal)));

      if (allowed <= 0) delete groupMap[itemId];
      else groupMap[itemId] = allowed;

      return { ...prev, [gid]: groupMap };
    });
  };

  const validateOpt = () => {

    if (!optTarget) return { ok: false, msg: "대상 메뉴가 없습니다." };
    const groupIds: string[] = Array.isArray((optTarget as any).optionGroupIds)
      ? (optTarget as any).optionGroupIds
      : [];

    for (const gid of groupIds) {
      const g = findGroup(gid);
      if (!g) continue;
      const picked = optSel[gid] || {};
      const selectedQty = Object.values(picked).reduce((sum, n) => sum + Math.max(0, Number(n || 0)), 0);
      const requiredMin = g.required ? 1 : 0;
      const min = Math.max(requiredMin, Math.max(0, Number(g.min ?? 0)));
      const max = Math.max(min, Number(g.max ?? min));

      if (selectedQty < min) {
        return { ok: false, msg: `“${g.name}” 옵션은 최소 ${min}개 선택이 필요합니다.` };
      }
      if (selectedQty > max) {
        return { ok: false, msg: `“${g.name}” 옵션은 최대 ${max}개까지 선택 가능합니다.` };
      }
    }
    return { ok: true, msg: "" };
  };

  const buildSelectedGroups = (
    m: MenuItem
  ): { groups: SelectedGroup[]; optionTotal: number } => {
    const groupIds: string[] = Array.isArray((m as any).optionGroupIds)
      ? (m as any).optionGroupIds
      : [];

    const groups: SelectedGroup[] = [];
    let optionTotal = 0;

    for (const gid of groupIds) {
      const g = findGroup(gid);
      if (!g) continue;

      const pickedMap = optSel[gid] || {};
      const allItems = groupItems(gid);

      const selectedItems: SelectedOptionItem[] = Object.entries(pickedMap)
        .map(([id, qty]) => ({ item: allItems.find((x) => x.id === id), qty: Math.max(0, Number(qty || 0)) }))
        .filter((x) => !!x.item && x.qty > 0)
        .map((x: any) => ({
          id: x.item.id,
          name: x.item.name,
          priceDelta: resolveOptionPrice(m.id, x.item),
          qty: x.qty,
        }));

      const sum = selectedItems.reduce((s, x) => s + Number(x.priceDelta || 0) * Math.max(1, Number(x.qty || 0)), 0);
      optionTotal += sum;

      groups.push({
        groupId: g.id,
        groupName: g.name,
        required: !!g.required,
        min: Math.max(g.required ? 1 : 0, Number(g.min || 0)),
        max: Number(g.max || 0),
        items: selectedItems,
      });
    }

    return { groups, optionTotal };
  };

  const modalPrice = useMemo(() => {
    if (!optTarget) return 0;
    const base = Number((optTarget as any).price || 0);
    const { optionTotal } = buildSelectedGroups(optTarget);
    return base + optionTotal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optTarget, optSel, optionsData]);

  const onConfirmOptions = () => {
    if (!optTarget) return;
    const v = validateOpt();
    if (!v.ok) {
      alert(v.msg);
      return;
    }

    const { groups, optionTotal } = buildSelectedGroups(optTarget);

    const nextSig = buildOptionSignature(groups);

    setCartLines((prev) => {
      const idx = prev.findIndex(
        (x) => x.menuId === optTarget.id && buildOptionSignature(x.options) === nextSig
      );

      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.max(1, (next[idx].qty || 0) + Math.max(1, optQty)) };
        return next;
      }

      return [
        ...prev,
        {
          lineId: uid("line"),
          menuId: optTarget.id,
          name: optTarget.name,
          basePrice: Number((optTarget as any).price || 0),
          qty: Math.max(1, optQty),
          image: (optTarget as any).image || "",
          options: groups,
          optionTotal,
        },
      ];
    });

    setOptOpen(false);
    setOptTarget(null);
    setOptSel({});
    setOptQty(1);
  };

  const selectedOptionSummary = useMemo(() => {
    if (!optTarget) return { selectedQty: 0, optionTotal: 0 };
    const { optionTotal } = buildSelectedGroups(optTarget);
    const selectedQty = Object.keys(optSel || {}).reduce((sum, gid) => sum + getSelectedQty(gid), 0);
    return { selectedQty, optionTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optTarget, optSel, optionsData]);

  const goConfirm = () => {
    if (totals.totalCount === 0) return;
    const cart = encodeURIComponent(JSON.stringify(cartLines));

    // ✅ 핵심: confirm으로 store 유지 + table 유지
    const base = `/confirm?store=${encodeURIComponent(storeId)}`;
    const url = isTableQr
      ? `${base}&table=${encodeURIComponent(table)}&cart=${cart}`
      : `${base}&cart=${cart}`;

    router.push(url);
  };

  const showEmpty = !menuLoading && (!list || list.length === 0);

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
          min-height: 100vh;
          padding-bottom: 92px; /* 하단 고정바 공간 */
        }

        .topSticky {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50;
          background: var(--bg);
        }

        .hero {
          position: relative;
          height: 144px;
          overflow: hidden;
          background: linear-gradient(135deg, #111827 0%, #374151 100%);
        }
        .heroImg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .overlay {
          position: absolute;
          inset: 0;
        }
        .heroInner {
          position: relative;
          height: 100%;
          max-width: 760px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          align-content: end;
        }
        .stickyHead {
          background: rgba(246, 247, 249, 0.95);
          backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--line);
        }
        .stickyInner {
          max-width: 760px;
          margin: 0 auto;
          padding: 10px 12px 8px;
          display: grid;
          gap: 8px;
        }
        .titleRow {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 10px;
        }
        .h1 {
          margin: 0;
          color: #fff;
          font-weight: 950;
          font-size: 22px;
          letter-spacing: -0.02em;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
        }
        .sub {
          margin: 0;
          color: rgba(255, 255, 255, 0.9);
          font-weight: 850;
          font-size: 12px;
          text-shadow: 0 1px 5px rgba(0, 0, 0, 0.35);
        }
        .content {
          padding: 10px 12px 28px;
        }
        .contentInner {
          max-width: 760px;
          margin: 0 auto;
          display: grid;
          gap: 12px;
        }
        .catTabs {
          display:flex;
          gap:8px;
          overflow-x:auto;
          padding-bottom:2px;
                  }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTabs::-webkit-scrollbar {
          display: none;
        }
        .catTab {
          white-space:nowrap;
          border:1px solid var(--line);
          background:#fff;
          color:var(--text);
          -webkit-text-fill-color: currentColor;
          border-radius:999px;
          padding:8px 12px;
          font-weight:900;
          cursor:pointer;
        }
        .catTabOn {
          background:var(--brand);
          border-color:var(--brand);
          color:#fff;
        }

        .menuCard {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 12px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          display: grid;
          gap: 10px;
        }
        .sectionTitle {
          margin: 2px 2px 0;
          font-size: 14px;
          font-weight: 950;
          color: #374151;
        }
        .menuRow {
          display: grid;
          grid-template-columns: 92px 1fr auto;
          gap: 12px;
          align-items: center;
        }
        .imgBox {
          width: 92px;
          height: 72px;
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
          color: #9ca3af;
          font-weight: 950;
          font-size: 12px;
        }

        .name {
          margin: 0;
          font-weight: 950;
          font-size: 16px;
          letter-spacing: -0.01em;
        }
        .price {
          margin-top: 4px;
          color: var(--muted);
          font-weight: 850;
          font-size: 13px;
        }
        .soldout {
          display: inline-flex;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 900;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #f3f4f6;
          color: #6b7280;
        }
        .metaLine {
          margin-top: 6px;
          color: #6b7280;
          font-weight: 850;
          font-size: 12px;
        }

        .qtyBox {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .qbtn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          font-weight: 950;
          cursor: pointer;
        }
        .qbtn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .qnum {
          width: 22px;
          text-align: center;
          font-weight: 950;
        }

        .addBtn {
          height: 38px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          font-weight: 950;
          cursor: pointer;
          white-space: nowrap;
        }
        .addBtn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .bottomBar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          padding: 10px 12px;
          background: rgba(246, 247, 249, 0.92);
          backdrop-filter: blur(10px);
          border-top: 1px solid var(--line);
        }
        .bottomInner {
          max-width: 760px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: center;
        }
        .sumText {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .sumTop {
          color: var(--muted);
          font-weight: 900;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sumMain {
          font-weight: 950;
          font-size: 16px;
          letter-spacing: -0.01em;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .btnPrimary {
          border: 0;
          border-radius: 14px;
          padding: 12px 14px;
          background: var(--brand);
          color: #fff;
          font-weight: 950;
          font-size: 14px;
          cursor: pointer;
          white-space: nowrap;
        }
        .btnPrimary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .modalBg {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          z-index: 50;
          display: grid;
          place-items: end center;
          padding: 12px;
        }
        .modal {
          width: 100%;
          max-width: 760px;
          background: #fff;
          border-radius: 18px;
          border: 1px solid var(--line);
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
        }
        .modalHead {
          padding: 12px 14px;
          border-bottom: 1px solid var(--line);
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }
        .modalTitle {
          margin: 0;
          font-weight: 950;
          font-size: 16px;
        }
        .xbtn {
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          border-radius: 12px;
          padding: 8px 10px;
          font-weight: 950;
          cursor: pointer;
        }
        .modalBody {
          padding: 12px 14px;
          display: grid;
          gap: 12px;
          max-height: 65vh;
          overflow: auto;
        }
        .gCard {
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 12px;
          background: #fff;
        }
        .gTitleRow {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .gName {
          font-weight: 950;
        }
        .gHint {
          color: var(--muted);
          font-weight: 850;
          font-size: 12px;
        }
                  .iList {
          margin-top: 10px;
          display: grid;
          gap: 8px;
        }
        .iRow {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px;
          background: #fff;
        }
        .iLeft {
          display: flex;
          gap: 10px;
          align-items: center;
          min-width: 0;
        }
        .iState {
          color: #2563eb;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          padding: 2px 8px;
          white-space: nowrap;
        }
        .iName {
          font-weight: 900;
        }
        .iPrice {
          color: var(--muted);
          font-weight: 850;
          font-size: 12px;
          white-space: nowrap;
        }
        .iRight {
          display: grid;
          gap: 6px;
          justify-items: end;
        }
        .iQtyBox {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 2px 6px;
          background: #f8fafc;
        }
        .miniBtn {
          width: 24px;
          height: 24px;
          border-radius: 999px;
          border: 1px solid #cbd5e1;
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          font-weight: 900;
          cursor: pointer;
        }
        .miniBtn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .iQtyNum {
          min-width: 14px;
          text-align: center;
          font-size: 12px;
        }
        .modalFoot {
          padding: 12px 14px;
          border-top: 1px solid var(--line);
          display: grid;
          gap: 10px;
          background: #fff;
        }
        .mini {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-weight: 900;
        }
        .orderQtyRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-weight: 900;
        }
        .orderQtyBox {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 2px 6px;
          background: #f8fafc;
        }

        @media (max-width: 520px) {
          .hero {
            height: 128px;
          }
          .menuRow {
            grid-template-columns: 86px 1fr auto;
          }
          .imgBox {
            width: 86px;
            height: 68px;
          }
          .sumMain {
            font-size: 15px;
          }
          .iRow {
            align-items: flex-start;
          }
          .iRight {
            justify-items: end;
          }
        }
      `}</style>

      <div className="topSticky" ref={topStickyRef}>
        <section className="hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="heroImg" src={headerImage} alt="hero" />
          <div className="overlay" style={{ background: overlayBg }} />
          <div className="heroInner">
            <div className="titleRow">
              <h1 className="h1">{profile.storeName || "메뉴"}</h1>
              <p className="sub">{isTableQr ? `테이블 ${table} 주문` : "카운터 주문"}</p>
            </div>
          </div>
        </section>

        <section className="stickyHead">
          <div className="stickyInner">
            {!menuLoading && !optionsLoading ? (
              <div className="catTabs" role="tablist" aria-label="메뉴 카테고리">
                <button
                  className={`catTab ${highlightedCategoryId === "all" ? "catTabOn" : ""}`}
                  onClick={() => {
                    setSelectedCategoryId("all");
                    setScrollCategoryId("all");
                    scrollToCategory("all");
                  }}
                >
                  전체
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    className={`catTab ${highlightedCategoryId === cat.id ? "catTabOn" : ""}`}
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setScrollCategoryId(cat.id);
                    }}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div style={{ height: topStickyHeight }} aria-hidden />

      <section className="content">
        <div className="contentInner" ref={menuContentRef}>
          {menuLoading || optionsLoading ? (
            <div style={{ color: "#6b7280", fontWeight: 850, padding: 12 }}>
              데이터를 불러오는 중...
            </div>
          ) : showEmpty ? (
            <div style={{ color: "#6b7280", fontWeight: 850, padding: 12 }}>
              등록된 메뉴가 없습니다. (DB에 menu_items를 넣었는지 확인해 주세요)
            </div>
          ) : (
            menuSections.map((section) => (
              <div
                key={section.id}
                data-section-id={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                style={{ display: "grid", gap: 10 }}
              >
                {selectedCategoryId === "all" ? <div className="sectionTitle">{section.name}</div> : null}

                {section.items.map((m: any) => {
                  const hasOptions =
                    Array.isArray(m.optionGroupIds) && m.optionGroupIds.length > 0;

                  const simpleQty = simpleQtyByMenuId[m.id] || 0;

                  return (
                    <div key={m.id} className="menuCard">
                      <div className="menuRow">
                        <div className="imgBox">
                          {(m.image || "").trim() ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.image} alt={m.name} />
                          ) : (
                            <div className="noImg">NO IMG</div>
                          )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <p className="name">{m.name}</p>
                          <div className="price">{fmt(Number(m.price || 0))}원</div>

                          {m.isSoldOut ? <div className="soldout">품절</div> : null}

                          {hasOptions ? <div className="metaLine">옵션 선택</div> : null}
                        </div>

                        {simpleQty === 0 ? (
                          <button
                            className="addBtn"
                            onClick={() => onPlus(m)}
                            disabled={m.isSoldOut}
                            aria-label={hasOptions ? "add-with-options" : "add"}
                          >
                            담기
                          </button>
                        ) : (
                          <div className="qtyBox">
                            <button
                              className="qbtn"
                              onClick={() => onMinus(m)}
                              disabled={m.isSoldOut || simpleQty === 0}
                              aria-label="minus"
                            >
                              -
                            </button>
                            <b className="qnum">{simpleQty}</b>
                            <button
                              className="qbtn"
                              onClick={() => onPlus(m)}
                              disabled={m.isSoldOut}
                              aria-label="plus"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>
            {totals.totalCount > 0 ? (
        <section className="bottomBar">
          <div className="bottomInner">
            <div className="sumText">
              <div className="sumTop">{cartSummary.text || "장바구니"}</div>
              <div className="sumMain">
                총 {totals.totalCount}개 · {fmt(totals.totalPrice)}원
              </div>
            </div>

            <button className="btnPrimary" onClick={goConfirm}>
              주문 확인
            </button>
          </div>
        </section>
      ) : null}

      {optOpen && optTarget ? (
        <div
          className="modalBg"
          onClick={() => {
            setOptOpen(false);
            setOptTarget(null);
            setOptSel({});
            setOptQty(1);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <h2 className="modalTitle">{optTarget.name} · 옵션 선택</h2>
              <button
                className="xbtn"
                onClick={() => {
                  setOptOpen(false);
                  setOptTarget(null);
                  setOptSel({});
                  setOptQty(1);
                }}
              >
                닫기
              </button>
            </div>

            <div className="modalBody">
              {(Array.isArray((optTarget as any).optionGroupIds)
                ? (optTarget as any).optionGroupIds
                : []
              ).map((gid: string) => {
                const g = findGroup(gid);
                if (!g) return null;

                const items = groupItems(gid);

                if (items.length === 0) {
                  return (
                    <div key={gid} className="gCard">
                      <div className="gTitleRow">
                        <div className="gName">
                          {g.name} {g.required ? "(필수)" : "(선택)"}
                        </div>
                        <div className="gHint">
                          {Math.max(g.required ? 1 : 0, Number(g.min || 0))}~{Math.max(Math.max(g.required ? 1 : 0, Number(g.min || 0)), Number(g.max || 0))}개 선택
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          color: "#b45309",
                          fontWeight: 900,
                          fontSize: 12,
                          lineHeight: 1.4,
                        }}
                      >
                        * 이 그룹({gid})에 연결된 option_items가 없습니다.
                        <br />
                        Supabase option_items의 group_id 값이 "{gid}"인지 확인하세요.
                      </div>
                    </div>
                  );
                }

                const picked = optSel[gid] || {};
                const requiredMin = g.required ? 1 : 0;
                const min = Math.max(requiredMin, Math.max(0, Number(g.min ?? 0)));
                const max = Math.max(min, Number(g.max ?? min));
                const isSingle = max === 1;
                const selectedQty = getSelectedQty(gid);
                const remaining = Math.max(0, max - selectedQty);

                return (
                  <div key={gid} className="gCard">
                    <div className="gTitleRow">
                      <div className="gName">
                        {g.name} {g.required ? "(필수)" : "(선택)"}
                      </div>
                      <div className="gHint">
                        {min}~{max}개 선택 · 현재 {selectedQty}개 · 남은 선택 {remaining}개
                      </div>
                    </div>

                    <div className="iList">
                      {items.map((it) => {
                        const qty = Math.max(0, Number(picked[it.id] || 0));
                        const checked = qty > 0;
                        return (
                          <div key={it.id} className="iRow">
                            <div className="iLeft">
                              {checked ? <span className="iState">선택됨</span> : null}
                              <div className="iName">{it.name}</div>
                            </div>

                            <div className="iRight">
                              <div className="iPrice">
                                {resolveOptionPrice(optTarget.id, it) >= 0
                                  ? `+${fmt(resolveOptionPrice(optTarget.id, it))}`
                                  : `-${fmt(Math.abs(resolveOptionPrice(optTarget.id, it)))}`}
                                원
                              </div>
                              <div className="iQtyBox">
                                <button
                                  type="button"
                                  className="miniBtn"
                                  onClick={() => setOptionItemQty(gid, it.id, qty - 1, max, isSingle)}
                                  disabled={qty <= 0}
                                >
                                  -
                                </button>
                                <b className="iQtyNum">{qty}</b>
                                <button
                                  type="button"
                                  className="miniBtn"
                                  onClick={() => setOptionItemQty(gid, it.id, qty + 1, max, isSingle)}
                                  disabled={isSingle ? qty >= 1 : getSelectedQty(gid) >= max}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="modalFoot">
              <div className="mini">
                <span>예상 가격({optQty}개)</span>
                <b>{fmt(modalPrice * Math.max(1, optQty))}원</b>
              </div>

              <div className="mini" style={{ color: "#475569", fontWeight: 850 }}>
                <span>선택 옵션 합계</span>
                <b>
                  {selectedOptionSummary.selectedQty}개 · +
                  {fmt(selectedOptionSummary.optionTotal)}원/개
                </b>
              </div>

              <div className="orderQtyRow">
                <span>주문 수량</span>
                <div className="orderQtyBox">
                  <button type="button" className="miniBtn" onClick={() => setOptQty((q) => Math.max(1, q - 1))}>
                    -
                  </button>
                  <b className="iQtyNum">{optQty}</b>
                  <button type="button" className="miniBtn" onClick={() => setOptQty((q) => Math.min(99, q + 1))}>
                    +
                  </button>
                </div>
              </div>

              <button className="btnPrimary" onClick={onConfirmOptions}>
                담기 ({fmt(modalPrice * Math.max(1, optQty))}원)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function MenuPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <MenuPageInner />
    </Suspense>
  );
}