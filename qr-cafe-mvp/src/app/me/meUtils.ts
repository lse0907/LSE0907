export type WalletRow = {
  store_id: string;
  point_balance: number;
  tier: "general" | "regular" | "vip" | string;
  lifetime_spent: number;
  lifetime_orders: number;
  nearest_expiry_at: string | null;
  expiring_soon_points: number;
  updated_at?: string | null;
};

export type LoyaltyStatusMap = Record<string, {
  pointsEnabled: boolean;
  couponsEnabled: boolean;
}>;

export function pointExpiryText(wallet: WalletRow) {
  const points = Math.max(0, Number(wallet.expiring_soon_points || 0));
  if (!points || !wallet.nearest_expiry_at) return null;
  const expiry = new Date(wallet.nearest_expiry_at);
  if (Number.isNaN(expiry.getTime())) return `${points.toLocaleString()}P 만료 예정`;
  return `${expiry.toLocaleDateString("ko-KR")}까지 ${points.toLocaleString()}P 만료 예정`;
}

export type CustomerOrder = {
  id: string;
  store_id: string;
  created_at: string;
  display_no: string | null;
  total_count: number | null;
  total_price: number | null;
  status: string;
  earned_points: number | null;
  store: { name: string; logo: string };
};

export type CustomerCoupon = {
  id: string;
  store_id: string;
  expires_at: string | null;
  template: {
    name: string | null;
    discount_type: string | null;
    discount_value: number | null;
    min_order_amount: number | null;
    max_discount_amount: number | null;
  } | null;
};

export type BenefitView = "stores" | "points" | "coupons" | null;

export function tierLabel(raw: string | null | undefined) {
  const value = String(raw || "").toLowerCase();
  if (value === "vip") return "VIP";
  if (value === "regular") return "단골";
  return "일반";
}

export function formatWon(value: number) {
  return `${Math.max(0, Number(value || 0)).toLocaleString()}원`;
}

export function couponBenefitText(coupon: CustomerCoupon) {
  const template = coupon.template;
  if (!template) return "혜택 정보를 확인해 주세요.";
  const value = Math.max(0, Number(template.discount_value || 0));
  const discount =
    template.discount_type === "percent"
      ? `${value}% 할인`
      : `${value.toLocaleString()}원 할인`;
  const conditions = [
    Number(template.min_order_amount || 0) > 0
      ? `${Number(template.min_order_amount).toLocaleString()}원 이상 주문`
      : "최소 주문 금액 없음",
    Number(template.max_discount_amount || 0) > 0
      ? `최대 ${Number(template.max_discount_amount).toLocaleString()}원`
      : "",
  ].filter(Boolean);
  return [discount, ...conditions].join(" · ");
}

export function orderStatusLabel(status: string) {
  return (
    {
      new: "접수 대기",
      checked: "매장 확인",
      making: "준비 중",
      ready_for_packing: "준비 완료",
      completed: "수령 완료",
      cancelled: "주문 취소",
    }[status] || "확인 중"
  );
}

export function orderStatusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "making") return "warning";
  if (status === "ready_for_packing") return "ready";
  return "info";
}

export function formatOrderDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function startOfLocalDay(value: Date) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

export function couponExpiry(coupon: CustomerCoupon, now = new Date()) {
  if (!coupon.expires_at)
    return {
      label: "사용 기한 제한 없음",
      tone: "normal",
      sort: Number.POSITIVE_INFINITY,
    };
  const expiry = new Date(coupon.expires_at);
  if (Number.isNaN(expiry.getTime()))
    return {
      label: "만료일 확인 필요",
      tone: "normal",
      sort: Number.POSITIVE_INFINITY,
    };
  const days = Math.ceil(
    (startOfLocalDay(expiry) - startOfLocalDay(now)) / 86_400_000,
  );
  if (days <= 0) return { label: "오늘 만료", tone: "urgent", sort: 0 };
  if (days <= 3) return { label: `D-${days}`, tone: "urgent", sort: days };
  if (days <= 7) return { label: "곧 만료", tone: "soon", sort: days };
  return {
    label: `${expiry.toLocaleDateString("ko-KR")}까지`,
    tone: "normal",
    sort: days,
  };
}
