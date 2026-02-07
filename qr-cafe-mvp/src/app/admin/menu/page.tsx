// src/app/menu/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type SelectedOptionItem = {
  id: string;
  name: string;
  priceDelta: number;
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

type OptionData = {
  groups: OptionGroup[];
  items: OptionItem[];
};

type MenuItem = {
  id: string;
  name: string;
  price: number;
  image?: string;
  isSoldOut?: boolean;
  optionGroupIds?: string[];
  sortOrder?: number;
};

type StoreProfileView = {
  storeName: string;
  storeDesc: string;
  mainImage: string;
  logoImage: string;
  mainImageOverlayStrength: number; // 0~100
};

function uid(prefix = "line") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function clampMaxSelection(arr: string[], max: number) {
  if (max <= 0) return arr;
  if (arr.length <= max) return arr;
  return arr.slice(0, max);
}

function toStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function getStoreIdFromSearchParams(sp: ReturnType<typeof useSearchParams>) {
  const s = (sp.get("store") || "").trim();
  return s || (process.env.NEXT_PUBLIC_STORE_ID || "ximen").trim();
}

function clamp01to100(v: any, fallback = 55) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ✅ 메뉴 sanitize(이 파일에서만 사용: 멀티매장 storeId 기반으로 DB에서 직접 조회)
function sanitizeMenuItem(x: any): MenuItem | null {
  if (!x || typeof x !== "object") return null;

  const id = toStr(x.id).trim();
  const name = toStr(x.name).trim();
  const price = Number(x.price);

  if (!id || !name || !Number.isFinite(price)) return null;

  const image = toStr(x.image).trim();
  const isSoldOut = Boolean(x.is_sold_out ?? x.isSoldOut);

  const rawGroups = x.option_group_ids ?? x.optionGroupIds ?? [];
  const optionGroupIds = Array.isArray(rawGroups)
    ? rawGroups
        .filter((v: any) => typeof v === "string" && v.trim())
        .map((v: string) => v.trim())
    : [];

  const sortOrderRaw = x.sort_order ?? x.sortOrder;
  const sortOrder = Number.isFinite(Number(sortOrderRaw)) ? toInt(sortOrderRaw, 999999) : 999999;

  return {
    id,
    name,
    price: Math.max(0, Math.round(price)),
    image,
    isSoldOut,
    optionGroupIds,
    sortOrder,
  };
}

export default function MenuPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // ✅ 멀티매장 핵심: URL(store) > env fallback
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);

  const table = (sp.get("table") || "").trim();
  const isTableQr = !!table;

  // -----------------------------
  // ✅ Store Profile (멀티매장)
  // - 우선 stores 테이블에서 읽어오고
  // - 실패하면 기본값으로 UI 유지
  // -----------------------------
  const [profile, setProfile] = useState<StoreProfileView>({
    storeName: "메뉴",
    storeDesc: "",
    mainImage: "/hero.jpg",
    logoImage: "",
    mainImageOverlayStrength: 55,
  });

  const [profileLoading, setProfileLoading] = useState(true);

  const fetchStoreProfile = async () => {
    setProfileLoading(true);

    // ✅ stores 테이블 구조가 프로젝트마다 다를 수 있어서
    // 가능한 필드만 읽고, 없으면 기본 UI로 유지하도록 방어적으로 작성
    const { data, error } = await supabase
      .from("stores")
      .select("id,name,store_name,desc,store_desc,main_image,logo_image,main_image_overlay_strength")
      .eq("id", storeId)
      .maybeSingle();

    if (error) {
      console.warn("[menu] fetch stores profile error:", error.message);
      setProfileLoading(false);
      return;
    }

    if (data) {
      const storeName = (toStr((data as any).store_name) || toStr((data as any).name) || "메뉴").trim();
      const storeDesc = (toStr((data as any).store_desc) || toStr((data as any).desc) || "").trim();
      const mainImage = (toStr((data as any).main_image) || "/hero.jpg").trim();
      const logoImage = (toStr((data as any).logo_image) || "").trim();
      const overlay = clamp01to100((data as any).main_image_overlay_strength, 55);

      setProfile({
        storeName,
        storeDesc,
        mainImage,
        logoImage,
        mainImageOverlayStrength: overlay,
      });
    }

    setProfileLoading(false);
  };

  // -----------------------------
  // ✅ Menu Items (멀티매장)
  // -----------------------------
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);

  const fetchMenuFromDb = async () => {
    setMenuLoading(true);

    const { data, error } = await supabase
      .from("menu_items")
      .select("id,name,price,image,is_sold_out,option_group_ids,sort_order,store_id,created_at")
      .eq("store_id", storeId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[menu] fetch menu_items error:", error.message);
      setMenuItems([]);
      setMenuLoading(false);
      return;
    }

    const cleaned = (Array.isArray(data) ? data : [])
      .map(sanitizeMenuItem)
      .filter(Boolean) as MenuItem[];

    setMenuItems(cleaned);
    setMenuLoading(false);
  };

  // -----------------------------
  // ✅ Options (멀티매장)
  // -----------------------------
  const [optionsData, setOptionsData] = useState<OptionData>({
    groups: [],
    items: [],
  });
  const [optionsLoading, setOptionsLoading] = useState(true);

  const fetchOptionsFromDb = async () => {
    setOptionsLoading(true);

    const [{ data: gData, error: gErr }, { data: iData, error: iErr }] =
      await Promise.all([
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
      ]);

    if (gErr) console.error("[menu] fetch option_groups error:", gErr.message);
    if (iErr) console.error("[menu] fetch option_items error:", iErr.message);

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

    setOptionsData({ groups, items });
    setOptionsLoading(false);
  };

  // -----------------------------
  // ✅ Cart + Option Modal (원본 UI/동작 유지)
  // -----------------------------
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [optOpen, setOptOpen] = useState(false);
  const [optTarget, setOptTarget] = useState<MenuItem | null>(null);
  const [optSel, setOptSel] = useState<Record<string, string[]>>({});

  useEffect(() => {
    // storeId 바뀌면 해당 매장 데이터 다시 로드 + 장바구니 초기화(안전)
    setCartLines([]);
    setOptOpen(false);
    setOptTarget(null);
    setOptSel({});

    fetchStoreProfile();
    fetchMenuFromDb();
    fetchOptionsFromDb();

    const onFocus = () => {
      fetchStoreProfile();
      fetchMenuFromDb();
      fetchOptionsFromDb();
    };
    window.addEventListener("focus", onFocus);

    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const list = useMemo(() => {
    const sorted = [...(menuItems || [])];
    return sorted;
  }, [menuItems]);

  const headerImage = profile.mainImage || "/hero.jpg";
  const headerOverlayStrength = Math.max(
    0,
    Math.min(100, Number(profile.mainImageOverlayStrength ?? 55))
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

  // ✅ 하단바 요약: “아이스크림라떼×1, 아메리카노×2 외 1개”
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

    const init: Record<string, string[]> = {};
    groupIds.forEach((gid) => (init[gid] = []));
    setOptSel(init);
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

  const validateOpt = () => {
    if (!optTarget) return { ok: false, msg: "대상 메뉴가 없습니다." };
    const groupIds: string[] = Array.isArray((optTarget as any).optionGroupIds)
      ? (optTarget as any).optionGroupIds
      : [];

    for (const gid of groupIds) {
      const g = findGroup(gid);
      if (!g) continue;
      const picked = optSel[gid] || [];
      const min = Math.max(0, Number(g.min ?? (g.required ? 1 : 0)));
      const max = Math.max(min, Number(g.max ?? min));

      if (g.required && picked.length < min) {
        return {
          ok: false,
          msg: `“${g.name}” 옵션은 최소 ${min}개 선택이 필요합니다.`,
        };
      }
      if (picked.length > max) {
        return {
          ok: false,
          msg: `“${g.name}” 옵션은 최대 ${max}개까지 선택 가능합니다.`,
        };
      }
    }
    return { ok: true, msg: "" };
  };

  const buildSelectedGroups = (m: MenuItem): { groups: SelectedGroup[]; optionTotal: number } => {
    const groupIds: string[] = Array.isArray((m as any).optionGroupIds)
      ? (m as any).optionGroupIds
      : [];

    const groups: SelectedGroup[] = [];
    let optionTotal = 0;

    for (const gid of groupIds) {
      const g = findGroup(gid);
      if (!g) continue;

      const pickedIds = optSel[gid] || [];
      const allItems = groupItems(gid);

      const selectedItems: SelectedOptionItem[] = pickedIds
        .map((id) => allItems.find((x) => x.id === id))
        .filter(Boolean)
        .map((x: any) => ({
          id: x.id,
          name: x.name,
          priceDelta: Number(x.priceDelta || 0),
        }));

      const sum = selectedItems.reduce((s, x) => s + Number(x.priceDelta || 0), 0);
      optionTotal += sum;

      groups.push({
        groupId: g.id,
        groupName: g.name,
        required: !!g.required,
        min: Number(g.min || 0),
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

    setCartLines((prev) => [
      ...prev,
      {
        lineId: uid("line"),
        menuId: optTarget.id,
        name: optTarget.name,
        basePrice: Number((optTarget as any).price || 0),
        qty: 1,
        image: (optTarget as any).image || "",
        options: groups,
        optionTotal,
      },
    ]);

    setOptOpen(false);
    setOptTarget(null);
    setOptSel({});
  };

  const goConfirm = () => {
    if (totals.totalCount === 0) return;
    const cart = encodeURIComponent(JSON.stringify(cartLines));

    // ✅ 핵심: confirm으로 갈 때 store를 반드시 전달 + table 유지
    const base = `/confirm?store=${encodeURIComponent(storeId)}`;
    const url = isTableQr
      ? `${base}&table=${encodeURIComponent(table)}&cart=${cart}`
      : `${base}&cart=${cart}`;

    router.push(url);
  };

  const showEmpty = !menuLoading && (!list || list.length === 0);

  const anyLoading = menuLoading || optionsLoading || profileLoading;

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
          min-height: 100vh;
          display: grid;
          grid-template-rows: auto 1fr;
          padding-bottom: 92px; /* 하단 고정바 공간 */
        }

        .hero {
          position: relative;
          height: 180px;
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
          gap: 6px;
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
        }
        .sub {
          margin: 0;
          color: rgba(255, 255, 255, 0.85);
          font-weight: 850;
          font-size: 12px;
        }

        .content {
          padding: 14px 12px 28px;
        }
        .contentInner {
          max-width: 760px;
          margin: 0 auto;
          display: grid;
          gap: 12px;
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
        .iName {
          font-weight: 900;
        }
        .iPrice {
          color: var(--muted);
          font-weight: 850;
          font-size: 12px;
          white-space: nowrap;
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

        @media (max-width: 520px) {
          .hero {
            height: 168px;
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
        }
      `}</style>

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

      <section className="content">
        <div className="contentInner">
          {anyLoading ? (
            <div style={{ color: "#6b7280", fontWeight: 850, padding: 12 }}>
              데이터를 불러오는 중...
            </div>
          ) : showEmpty ? (
            <div style={{ color: "#6b7280", fontWeight: 850, padding: 12 }}>
              등록된 메뉴가 없습니다. (DB에 menu_items를 넣었는지 확인해 주세요)
            </div>
          ) : (
            list.map((m: any) => {
              const hasOptions = Array.isArray(m.optionGroupIds) && m.optionGroupIds.length > 0;
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

                    {hasOptions ? (
                      <button
                        className="addBtn"
                        onClick={() => onPlus(m)}
                        disabled={m.isSoldOut}
                        aria-label="add-with-options"
                      >
                        담기
                      </button>
                    ) : simpleQty === 0 ? (
                      <button
                        className="qbtn"
                        onClick={() => onPlus(m)}
                        disabled={m.isSoldOut}
                        aria-label="plus"
                      >
                        +
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
            })
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
                          {g.min}~{g.max}개 선택
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

                const picked = optSel[gid] || [];
                const min = Math.max(0, Number(g.min ?? (g.required ? 1 : 0)));
                const max = Math.max(min, Number(g.max ?? min));
                const isSingle = max === 1;

                return (
                  <div key={gid} className="gCard">
                    <div className="gTitleRow">
                      <div className="gName">
                        {g.name} {g.required ? "(필수)" : "(선택)"}
                      </div>
                      <div className="gHint">
                        {min}~{max}개 선택
                      </div>
                    </div>

                    <div className="iList">
                      {items.map((it) => {
                        const checked = picked.includes(it.id);
                        return (
                          <label key={it.id} className="iRow">
                            <div className="iLeft">
                              <input
                                type={isSingle ? "radio" : "checkbox"}
                                name={isSingle ? `g_${gid}` : undefined}
                                checked={checked}
                                onChange={() => {
                                  setOptSel((prev) => {
                                    const cur = prev[gid] || [];
                                    let nextArr: string[] = [];

                                    if (isSingle) {
                                      nextArr = checked ? [] : [it.id];
                                    } else {
                                      const set = new Set(cur);
                                      if (set.has(it.id)) set.delete(it.id);
                                      else set.add(it.id);
                                      nextArr = Array.from(set);
                                      nextArr = clampMaxSelection(nextArr, max);
                                    }

                                    return { ...prev, [gid]: nextArr };
                                  });
                                }}
                              />
                              <div className="iName">{it.name}</div>
                            </div>

                            <div className="iPrice">
                              {it.priceDelta >= 0 ? `+${fmt(it.priceDelta)}` : `-${fmt(Math.abs(it.priceDelta))}`}
                              원
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="modalFoot">
              <div className="mini">
                <span>예상 가격(1개)</span>
                <b>{fmt(modalPrice)}원</b>
              </div>

              <button className="btnPrimary" onClick={onConfirmOptions}>
                담기 ({fmt(modalPrice)}원)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
