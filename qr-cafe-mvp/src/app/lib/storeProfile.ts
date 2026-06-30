// src/app/lib/storeProfile.ts
"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

/**
 * ✅ 핵심 필드만 사용
 */
export type StoreProfile = {
  staffViewMode: "simple" | "station";
  storeName: string;
  storeDesc: string;
  mainImage: string;
  logoImage: string;
  mainImageOverlayStrength: number;

  extra?: {
    bizNo?: string;
    industry?: string;
    phone?: string;
    address?: string;
    addressDetail?: string;
    hours?: string;
    sns?: string;
  };
};

export const STORE_PROFILE_UPDATED_EVENT = "qrCafeStoreProfileUpdated";
const STORE_PROFILE_SELECT =
  "store_name, store_desc, main_image_url, logo_image_url, staff_view_mode, phone, address, address_detail, business_hours, business_number, industry, sns_url, main_image_overlay_strength";
const STORE_PROFILE_LEGACY_SELECT = "store_name, main_image_url, logo_image_url, staff_view_mode";

export const DEFAULT_STORE_PROFILE: StoreProfile = {
  staffViewMode: "simple",
  storeName: "카페 브라운",
  storeDesc: "QR로 간편하게 주문하고 기다리세요.\n주문 후 직원 안내에 따라 픽업/수령해 주세요.",
  mainImage: "/hero.jpg",
  logoImage: "",
  mainImageOverlayStrength: 55,
  extra: {
    bizNo: "",
    industry: "",
    phone: "",
    address: "",
    addressDetail: "",
    hours: "",
    sns: "",
  },
};

function envStoreId() {
  return (process.env.NEXT_PUBLIC_STORE_ID || "ximen").trim();
}

function keyOf(storeId?: string) {
  const sid = (storeId || "").trim() || envStoreId();
  // ✅ 매장별로 저장 분리!
  return `qrCafeStoreProfile:${sid}`;
}

function clampOverlay(v: number) {
  if (!Number.isFinite(v)) return DEFAULT_STORE_PROFILE.mainImageOverlayStrength;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function pickString(v: unknown, fallback: string) {
  return typeof v === "string" ? v : fallback;
}

function rowToStoreProfile(data: any, fallback: StoreProfile = DEFAULT_STORE_PROFILE): StoreProfile {
  return {
    ...fallback,
    staffViewMode: data?.staff_view_mode === "station" ? "station" : "simple",
    storeName: String(data?.store_name || fallback.storeName || "").trim() || fallback.storeName,
    storeDesc: pickString(data?.store_desc, fallback.storeDesc),
    mainImage: data?.main_image_url || fallback.mainImage,
    logoImage: data?.logo_image_url || fallback.logoImage,
    mainImageOverlayStrength: clampOverlay(Number(data?.main_image_overlay_strength ?? fallback.mainImageOverlayStrength)),
    extra: {
      ...(fallback.extra || {}),
      phone: pickString(data?.phone, fallback.extra?.phone || ""),
      address: pickString(data?.address, fallback.extra?.address || ""),
      addressDetail: pickString(data?.address_detail, fallback.extra?.addressDetail || ""),
      hours: pickString(data?.business_hours, fallback.extra?.hours || ""),
      bizNo: pickString(data?.business_number, fallback.extra?.bizNo || ""),
      industry: pickString(data?.industry, fallback.extra?.industry || ""),
      sns: pickString(data?.sns_url, fallback.extra?.sns || ""),
    },
  };
}

export async function fetchStoreProfileFromDb(storeId?: string): Promise<StoreProfile | null> {
  const sid = (storeId || "").trim() || envStoreId();
  if (!sid) return null;

  let res: any = await supabase
    .from("stores")
    .select(STORE_PROFILE_SELECT)
    .eq("store_id", sid)
    .maybeSingle();

  // Some environments may not have docs/sql/supabase-store-profile-fields-v1.sql applied yet.
  if (res.error && /store_desc|phone|address|business_hours|business_number|industry|sns_url|main_image_overlay_strength/i.test(res.error.message || "")) {
    res = await supabase
      .from("stores")
      .select(STORE_PROFILE_LEGACY_SELECT)
      .eq("store_id", sid)
      .maybeSingle();
  }

  if (res.error) throw res.error;
  if (!res.data) return null;
  return rowToStoreProfile(res.data);
}

export function loadStoreProfile(storeId?: string): StoreProfile {
  try {
    const raw = localStorage.getItem(keyOf(storeId));
    if (!raw) return DEFAULT_STORE_PROFILE;

    const parsed = JSON.parse(raw) as Partial<StoreProfile>;

    return {
      ...DEFAULT_STORE_PROFILE,
      staffViewMode: parsed.staffViewMode === "station" ? "station" : "simple",
      storeName: pickString(parsed.storeName, DEFAULT_STORE_PROFILE.storeName),
      storeDesc: pickString(parsed.storeDesc, DEFAULT_STORE_PROFILE.storeDesc),
      mainImage: pickString((parsed as any).mainImage, DEFAULT_STORE_PROFILE.mainImage),
      logoImage: pickString(parsed.logoImage, DEFAULT_STORE_PROFILE.logoImage),
      mainImageOverlayStrength: clampOverlay(Number((parsed as any).mainImageOverlayStrength)),
      extra: {
        bizNo: pickString(parsed?.extra?.bizNo, DEFAULT_STORE_PROFILE.extra?.bizNo || ""),
        industry: pickString(parsed?.extra?.industry, DEFAULT_STORE_PROFILE.extra?.industry || ""),
        phone: pickString(parsed?.extra?.phone, DEFAULT_STORE_PROFILE.extra?.phone || ""),
        address: pickString(parsed?.extra?.address, DEFAULT_STORE_PROFILE.extra?.address || ""),
        addressDetail: pickString(parsed?.extra?.addressDetail, DEFAULT_STORE_PROFILE.extra?.addressDetail || ""),
        hours: pickString(parsed?.extra?.hours, DEFAULT_STORE_PROFILE.extra?.hours || ""),
        sns: pickString(parsed?.extra?.sns, DEFAULT_STORE_PROFILE.extra?.sns || ""),
      },
    };
  } catch {
    return DEFAULT_STORE_PROFILE;
  }
}

export function saveStoreProfile(storeId: string | undefined, next: StoreProfile) {
  const sanitized: StoreProfile = {
    ...DEFAULT_STORE_PROFILE,
    staffViewMode: next.staffViewMode === "station" ? "station" : "simple",
    storeName: pickString(next.storeName, DEFAULT_STORE_PROFILE.storeName),
    storeDesc: pickString(next.storeDesc, DEFAULT_STORE_PROFILE.storeDesc),
    mainImage: pickString(next.mainImage, DEFAULT_STORE_PROFILE.mainImage),
    logoImage: pickString(next.logoImage, DEFAULT_STORE_PROFILE.logoImage),
    mainImageOverlayStrength: clampOverlay(next.mainImageOverlayStrength),
    extra: {
      bizNo: pickString(next?.extra?.bizNo, DEFAULT_STORE_PROFILE.extra?.bizNo || ""),
      industry: pickString(next?.extra?.industry, DEFAULT_STORE_PROFILE.extra?.industry || ""),
      phone: pickString(next?.extra?.phone, DEFAULT_STORE_PROFILE.extra?.phone || ""),
      address: pickString(next?.extra?.address, DEFAULT_STORE_PROFILE.extra?.address || ""),
      addressDetail: pickString(next?.extra?.addressDetail, DEFAULT_STORE_PROFILE.extra?.addressDetail || ""),
      hours: pickString(next?.extra?.hours, DEFAULT_STORE_PROFILE.extra?.hours || ""),
      sns: pickString(next?.extra?.sns, DEFAULT_STORE_PROFILE.extra?.sns || ""),
    },
  };

  localStorage.setItem(keyOf(storeId), JSON.stringify(sanitized));

  // ✅ 저장 즉시 반영 이벤트 (detail로 storeId도 같이 전달)
  window.dispatchEvent(
    new CustomEvent(STORE_PROFILE_UPDATED_EVENT, { detail: { storeId: (storeId || "").trim() || envStoreId() } })
  );
}

/**
 * ✅ storeId 기반 훅
 * - menu/page.tsx에서는 useStoreProfile(storeId)로 호출해야 “매장별 프로필”이 분리됨
 */
export function useStoreProfile(storeId?: string) {
  const sid = useMemo(() => (storeId || "").trim() || envStoreId(), [storeId]);
  const [profile, setProfile] = useState<StoreProfile>(DEFAULT_STORE_PROFILE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");

    const loadFromDb = async () => {
      if (!sid) return;
      try {
        const next = await fetchStoreProfileFromDb(sid);
        if (!alive) return;
        const resolved = next || loadStoreProfile(sid);
        saveStoreProfile(sid, resolved);
        setProfile(resolved);
      } catch (e: any) {
        if (!alive) return;
        console.error("[storeProfile] load from db error:", e?.message || e);
        setLoadError(String(e?.message || e || "매장 정보를 불러오지 못했습니다."));
        setProfile(loadStoreProfile(sid));
      } finally {
        if (alive) setLoading(false);
      }
    };

    loadFromDb();

    const onUpdate = (e: any) => {
      const target = e?.detail?.storeId;
      // 다른 매장 이벤트면 무시
      if (target && String(target) !== sid) return;
      setProfile(loadStoreProfile(sid));
    };
    window.addEventListener(STORE_PROFILE_UPDATED_EVENT, onUpdate as any);

    const onStorage = (e: StorageEvent) => {
      if (e.key === keyOf(sid)) setProfile(loadStoreProfile(sid));
    };
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      window.removeEventListener(STORE_PROFILE_UPDATED_EVENT, onUpdate as any);
      window.removeEventListener("storage", onStorage);
    };
  }, [sid]);

  return { profile, setProfile, loading, loadError };
}
