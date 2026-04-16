// src/app/lib/optionStore.ts
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export type OptionGroup = {
  id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
  sortOrder?: number;
};

export type OptionItem = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
};

export type OptionData = {
  groups: OptionGroup[];
  items: OptionItem[];
};

export const DEFAULT_OPTIONS: OptionData = {
  groups: [],
  items: [],
};

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/**
 * ✅ Supabase에서 옵션 데이터 가져오기 (store_id 기준)
 */
export async function fetchOptionsFromDb(storeId: string): Promise<OptionData> {
  if (!storeId) return DEFAULT_OPTIONS;

  let groups: any[] | null = null;
  let gErr: any = null;

  const gRes = await supabase
    .from("option_groups")
    .select("id, name, required, min, max, sort_order")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (gRes.error && gRes.error.code === "42703" && String(gRes.error.message || "").includes("sort_order")) {
    const fallback = await supabase
      .from("option_groups")
      .select("id, name, required, min, max")
      .eq("store_id", storeId)
      .order("created_at", { ascending: true });
    groups = fallback.data as any[] | null;
    gErr = fallback.error;
  } else {
    groups = gRes.data as any[] | null;
    gErr = gRes.error;
  }

  if (gErr) {
    console.error("[fetchOptionsFromDb] option_groups error:", gErr);
    return DEFAULT_OPTIONS;
  }

  const { data: items, error: iErr } = await supabase
    .from("option_items")
    .select("id, group_id, name, price_delta")
    .eq("store_id", storeId)
    .order("created_at", { ascending: true });

  if (iErr) {
    console.error("[fetchOptionsFromDb] option_items error:", iErr);
    return { groups: (groups || []).map(mapGroup), items: [] };
  }

  return {
    groups: (groups || []).map(mapGroup),
    items: (items || []).map(mapItem),
  };
}

function mapGroup(x: any): OptionGroup {
  return {
    id: String(x.id || "").trim(),
    name: String(x.name || "").trim(),
    required: !!x.required,
    min: toInt(x.min, 0),
    max: Math.max(toInt(x.max, 1), toInt(x.min, 0)),
    sortOrder: toInt(x.sort_order, 0),
  };
}

function mapItem(x: any): OptionItem {
  return {
    id: String(x.id || "").trim(),
    groupId: String(x.group_id || "").trim(),
    name: String(x.name || "").trim(),
    priceDelta: Math.round(Number(x.price_delta || 0)),
  };
}

/**
 * ✅ React Hook: optionsData를 DB에서 불러와 상태로 제공
 */
export function useOptionsDb(storeId: string) {
  const [data, setData] = useState<OptionData>(DEFAULT_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const refresh = async () => {
    try {
      setLoading(true);
      setErrorMsg("");
      const next = await fetchOptionsFromDb(storeId);
      setData(next);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "옵션 데이터를 불러오지 못했습니다.");
      setData(DEFAULT_OPTIONS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  return { data, loading, errorMsg, refresh };
}
