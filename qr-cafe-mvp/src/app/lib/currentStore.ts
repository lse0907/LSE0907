// src/app/lib/currentStore.ts
export const CURRENT_STORE_KEY = "qr_current_store_id";

export function getCurrentStoreId(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(CURRENT_STORE_KEY);
  return v && v.trim() ? v.trim() : null;
}

export function setCurrentStoreId(storeId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CURRENT_STORE_KEY, storeId);
}

export function clearCurrentStoreId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CURRENT_STORE_KEY);
}
