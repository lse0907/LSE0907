// src/app/lib/storeScope.ts
"use client";

export const DEFAULT_STORE_ID = (process.env.NEXT_PUBLIC_STORE_ID || "ximen").trim();

/** URL에서 store를 받으면 최우선, 없으면 env fallback */
export function resolveStoreId(input?: string | null) {
  const s = (input || "").trim();
  return s || DEFAULT_STORE_ID;
}

/** searchParams-like 객체에서 store를 뽑음 (Next useSearchParams 호환) */
export function getStoreIdFromSearchParams(sp: { get: (k: string) => string | null }) {
  return resolveStoreId(sp.get("store"));
}

/** 매장별 로컬스토리지 키 (주문목록/마지막 주문) */
export function lsOrdersKey(storeId: string) {
  return `qrCafeOrders:${resolveStoreId(storeId)}`;
}
export function lsLastOrderIdKey(storeId: string) {
  return `qrCafeLastOrderId:${resolveStoreId(storeId)}`;
}

/** (선택) 매장별 스토어프로필 키 */
export function lsStoreProfileKey(storeId: string) {
  return `qrCafeStoreProfile:${resolveStoreId(storeId)}`;
}
