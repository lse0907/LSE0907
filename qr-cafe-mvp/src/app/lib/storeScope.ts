// src/app/lib/storeScope.ts
"use client";

/** 전달받은 매장 ID만 사용하며, 값이 없으면 빈 문자열을 반환합니다. */
export function resolveStoreId(input?: string | null) {
  return (input || "").trim();
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
export function lsLastOrderTokenKey(storeId: string) {
  return `qrCafeLastOrderToken:${resolveStoreId(storeId)}`;
}

/** (선택) 매장별 스토어프로필 키 */
export function lsStoreProfileKey(storeId: string) {
  return `qrCafeStoreProfile:${resolveStoreId(storeId)}`;
}
