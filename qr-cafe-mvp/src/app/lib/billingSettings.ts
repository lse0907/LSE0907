"use client";

export type BillingSettings = {
  baseApproved: boolean;
  addonApproved: boolean;
  pgMid: string;
  pgClientKey: string;
  pgSecretKey: string;
  updatedAt: number | null;
};

const DEFAULT_SETTINGS: BillingSettings = {
  baseApproved: false,
  addonApproved: false,
  pgMid: "",
  pgClientKey: "",
  pgSecretKey: "",
  updatedAt: null,
};

const keyOf = (storeId: string) => `billingSettings:${storeId}`;

export function maskToken(value: string, visibleTail = 4) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= visibleTail) return "*".repeat(trimmed.length);
  return `${trimmed.slice(0, 6)}${"*".repeat(Math.max(4, trimmed.length - (6 + visibleTail)))}${trimmed.slice(-visibleTail)}`;
}

export function loadBillingSettings(storeId: string): BillingSettings {
  if (typeof window === "undefined" || !storeId) return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(keyOf(storeId));
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) || {};
    return {
      baseApproved: !!parsed.baseApproved,
      addonApproved: !!parsed.addonApproved,
      pgMid: String(parsed.pgMid || "").trim(),
      pgClientKey: String(parsed.pgClientKey || "").trim(),
      pgSecretKey: String(parsed.pgSecretKey || "").trim(),
      updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : null,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveBillingSettings(storeId: string, next: BillingSettings) {
  if (typeof window === "undefined" || !storeId) return;
  const payload: BillingSettings = {
    ...next,
    pgMid: String(next.pgMid || "").trim(),
    pgClientKey: String(next.pgClientKey || "").trim(),
    pgSecretKey: String(next.pgSecretKey || "").trim(),
    updatedAt: Date.now(),
  };
  window.localStorage.setItem(keyOf(storeId), JSON.stringify(payload));
}
