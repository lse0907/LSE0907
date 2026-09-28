const RION_ORDER_HOSTS = new Set([
  "order.rionlabs.co.kr",
  "lse-0907.vercel.app",
]);

export type QrScanTarget =
  | { ok: true; href: string; isExternalOrigin: boolean }
  | { ok: false; message: string };

/**
 * A table QR can carry the official domain even when the scanner is opened
 * from a Vercel preview or local address. Keep the canonical destination.
 */
export function resolveQrScanTarget(
  raw: string,
  currentOrigin: string,
): QrScanTarget {
  const text = String(raw || "").trim();
  if (!text) {
    return { ok: false, message: "QR 내용을 읽지 못했어요. 다시 맞춰 주세요." };
  }

  try {
    const url = new URL(text, currentOrigin);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, message: "주문용 웹 주소가 아닌 QR이에요." };
    }

    const currentHost = new URL(currentOrigin).hostname;
    if (url.hostname !== currentHost && !RION_ORDER_HOSTS.has(url.hostname)) {
      return { ok: false, message: "리온오더 매장 QR만 스캔할 수 있어요." };
    }

    if (!(url.searchParams.get("store") || "").trim()) {
      return { ok: false, message: "매장 정보가 없는 QR이에요." };
    }

    return {
      ok: true,
      href:
        url.origin === currentOrigin
          ? `${url.pathname}${url.search}${url.hash}`
          : url.toString(),
      isExternalOrigin: url.origin !== currentOrigin,
    };
  } catch {
    return { ok: false, message: "인식된 QR 형식이 올바르지 않습니다." };
  }
}
