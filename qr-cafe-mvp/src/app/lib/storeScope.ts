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

/** 고객 주문 접근정보를 현재 기기에만 저장합니다. URL에는 토큰을 남기지 않습니다. */
export function persistLastOrderAccess(params: {
  storeId: string;
  orderId: string;
  accessToken: string;
}) {
  const storeId = resolveStoreId(params.storeId);
  const orderId = String(params.orderId || "").trim();
  const accessToken = String(params.accessToken || "").trim();
  if (!storeId || !orderId || !accessToken || typeof window === "undefined") return;

  localStorage.setItem(lsLastOrderIdKey(storeId), orderId);
  localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
  localStorage.setItem("qrCafeLastStoreId", storeId);
}

/** 예전 링크의 접근 토큰을 저장한 뒤 주소창·브라우저 기록에서 제거합니다. */
export function removeAccessTokenFromCurrentUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("accessToken")) return;
  url.searchParams.delete("accessToken");
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

/** (선택) 매장별 스토어프로필 키 */
export function lsStoreProfileKey(storeId: string) {
  return `qrCafeStoreProfile:${resolveStoreId(storeId)}`;
}
