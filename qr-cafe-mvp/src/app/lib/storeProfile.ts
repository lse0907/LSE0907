// src/app/lib/storeProfile.ts
"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * ✅ 핵심 필드만 사용
 */
export type StoreProfile = {
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
    hours?: string;
    sns?: string;
    billing?: string;
  };
};

export const STORE_PROFILE_UPDATED_EVENT = "qrCafeStoreProfileUpdated";

export const DEFAULT_STORE_PROFILE: StoreProfile = {
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
    hours: "",
    sns: "",
    billing: "",
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

export function loadStoreProfile(storeId?: string): StoreProfile {
  try {
    const raw = localStorage.getItem(keyOf(storeId));
    if (!raw) return DEFAULT_STORE_PROFILE;

    const parsed = JSON.parse(raw) as Partial<StoreProfile>;

    return {
      ...DEFAULT_STORE_PROFILE,
      storeName: pickString(parsed.storeName, DEFAULT_STORE_PROFILE.storeName),
      storeDesc: pickString(parsed.storeDesc, DEFAULT_STORE_PROFILE.storeDesc),
      mainImage: pickString((parsed as any).mainImage, DEFAULT_STORE_PROFILE.mainImage),
      logoImage: pickString(parsed.logoImage, DEFAULT_STORE_PROFILE.logoImage),
      mainImageOverlayStrength: clampOverlay(Number((parsed as any).mainImageOverlayStrength)),
      // extra는 아직 저장 정책상 비활성
      extra: { ...DEFAULT_STORE_PROFILE.extra },
    };
  } catch {
    return DEFAULT_STORE_PROFILE;
  }
}

export function saveStoreProfile(storeId: string | undefined, next: StoreProfile) {
  const sanitized: StoreProfile = {
    ...DEFAULT_STORE_PROFILE,
    storeName: pickString(next.storeName, DEFAULT_STORE_PROFILE.storeName),
    storeDesc: pickString(next.storeDesc, DEFAULT_STORE_PROFILE.storeDesc),
    mainImage: pickString(next.mainImage, DEFAULT_STORE_PROFILE.mainImage),
    logoImage: pickString(next.logoImage, DEFAULT_STORE_PROFILE.logoImage),
    mainImageOverlayStrength: clampOverlay(next.mainImageOverlayStrength),
    extra: { ...DEFAULT_STORE_PROFILE.extra },
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

  useEffect(() => {
    setProfile(loadStoreProfile(sid));

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
      window.removeEventListener(STORE_PROFILE_UPDATED_EVENT, onUpdate as any);
      window.removeEventListener("storage", onStorage);
    };
  }, [sid]);

  return { profile, setProfile };
}
