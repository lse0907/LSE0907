"use client";
import { CustomerIcon } from "../_components/CustomerIcon";
export function MeQuickMenu({
  hasActiveOrder,
  onOrders,
  onStores,
  onQr,
  onAccount,
}: {
  hasActiveOrder: boolean;
  onOrders: () => void;
  onStores: () => void;
  onQr: () => void;
  onAccount: () => void;
}) {
  const items = [
    {
      label: "주문 내역",
      detail: "최근 주문 확인",
      icon: "orders" as const,
      tone: "",
      action: onOrders,
    },
    {
      label: "내 매장",
      detail: "포인트·쿠폰",
      icon: "store" as const,
      tone: "green",
      action: onStores,
    },
    {
      label: "QR 주문",
      detail: "매장 QR 스캔",
      icon: "qr" as const,
      tone: "purple",
      action: onQr,
      emphasis: !hasActiveOrder,
    },
    {
      label: "계정 정보",
      detail: "확인·수정",
      icon: "user" as const,
      tone: "gray",
      action: onAccount,
    },
  ];
  return (
    <>
      <div className="sectionHeading">
        <div>
          <p className="sectionLabel">QUICK MENU</p>
          <h2>빠른 메뉴</h2>
        </div>
      </div>
      <div className="quickGrid" aria-label="빠른 메뉴">
        {items.map((item) => (
          <button
            type="button"
            className={`quickCard ${item.emphasis ? "emphasis" : ""}`}
            onClick={item.action}
            aria-label={`${item.label}, ${item.detail}`}
            key={item.label}
          >
            <span className={`quickIcon ${item.tone}`}>
              <CustomerIcon name={item.icon} />
            </span>
            <span className="quickCopy">
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
