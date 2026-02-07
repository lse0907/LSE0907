// src/app/lib/menuStore.ts
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  image?: string;
  isSoldOut?: boolean;
  optionGroupIds?: string[];
  sortOrder?: number;
};

export const MENU_UPDATED_EVENT = "qrCafeMenuItemsUpdated";

// DB 비었을 때만 보여줄 샘플(원하면 나중에 제거 가능)
export const DEFAULT_MENU: MenuItem[] = [
  { id: "americano", name: "아메리카노", price: 4500, image: "", sortOrder: 10 },
  { id: "sig-latte", name: "시그니처라떼", price: 5500, image: "", sortOrder: 20 },
  { id: "ice-cream-latte", name: "아이스크림라떼", price: 6000, image: "", sortOrder: 30 },
  { id: "brown-bubble", name: "흑당버블티", price: 6000, image: "", sortOrder: 40 },
];

function cleanId(v: any) {
  return typeof v === "string" ? v.trim() : "";
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function sanitizeItem(x: any): MenuItem | null {
  if (!x || typeof x !== "object") return null;

  const id = cleanId(x.id);
  const name = typeof x.name === "string" ? x.name.trim() : "";
  const price = Number(x.price);

  if (!id || !name || !Number.isFinite(price)) return null;

  const image = typeof x.image === "string" ? x.image.trim() : "";

  // DB: is_sold_out(boolean) / 예전 로컬: isSoldOut(boolean)
  const isSoldOut = Boolean((x as any).is_sold_out ?? (x as any).isSoldOut);

  // DB: option_group_ids(text[]) / 예전 로컬: optionGroupIds(string[])
  const rawGroups = (x as any).option_group_ids ?? (x as any).optionGroupIds ?? [];
  const optionGroupIds = Array.isArray(rawGroups)
    ? rawGroups
        .filter((v: any) => typeof v === "string" && v.trim())
        .map((v: string) => v.trim())
    : [];

  // sort_order
  const sortOrderRaw = (x as any).sort_order ?? (x as any).sortOrder;
  const sortOrder = Number.isFinite(Number(sortOrderRaw))
    ? toInt(sortOrderRaw, 999999)
    : 999999;

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

function envStoreId() {
  return (process.env.NEXT_PUBLIC_STORE_ID || "ximen").trim();
}

/**
 * ✅ storeId를 인자로 받도록 변경 (멀티매장)
 */
export async function fetchMenuItemsFromDb(storeId?: string): Promise<MenuItem[]> {
  const sid = (storeId || "").trim() || envStoreId();

  const { data, error } = await supabase
    .from("menu_items")
    .select("id,name,price,image,is_sold_out,option_group_ids,sort_order,store_id,created_at")
    .eq("store_id", sid)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[menuStore] fetchMenuItemsFromDb error:", error.message);
    return [];
  }

  return (Array.isArray(data) ? data : [])
    .map(sanitizeItem)
    .filter(Boolean) as MenuItem[];
}

/**
 * ✅ storeId를 필수처럼 쓰되, 호환을 위해 optional로 둠
 * - menu/page.tsx에서는 useMenuItems(storeId) 로 호출 추천
 */
export function useMenuItems(storeId?: string) {
  const [items, setItems] = useState<MenuItem[]>(DEFAULT_MENU);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = async () => {
    setLoading(true);
    const dbItems = await fetchMenuItemsFromDb(storeId);
    setItems(dbItems.length ? dbItems : []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    const onUpdate = () => refresh();
    window.addEventListener(MENU_UPDATED_EVENT, onUpdate);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(MENU_UPDATED_EVENT, onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  return { items, setItems, loading, refresh };
}
