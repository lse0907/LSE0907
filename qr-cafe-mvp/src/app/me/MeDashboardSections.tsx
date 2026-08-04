"use client";

import { CustomerBrand } from "../_components/CustomerBrand";

export type ActiveOrderSummary = {
  storeName: string;
  detail: string;
  statusLabel?: string;
  statusTone?: string;
  actionLabel: string;
};

export function MePlatformHeader({
  name,
  storeCount,
  couponCount,
  activeOrder,
  bannerDismissed,
  onActiveOrder,
  onDismissBanner,
}: {
  name?: string | null;
  storeCount: number;
  couponCount: number;
  activeOrder: ActiveOrderSummary | null;
  bannerDismissed: boolean;
  onActiveOrder: () => void;
  onDismissBanner: () => void;
}) {
  return (
    <header className="meHero">
      <div className="meBrand">
        <CustomerBrand compact />
        <span className="meBrandName">
          <strong>RION Order</strong>
          <small>주문·혜택 서비스</small>
        </span>
      </div>
      <div style={{ marginTop: 22 }}>
        <p className="sectionLabel">MY RION</p>
        <h1>내 주문·혜택</h1>
        <p className="meHeroDescription">
          {name
            ? `${name}님, 매장별 포인트와 쿠폰을 확인하세요.`
            : "매장별 포인트와 쿠폰을 확인하세요."}
        </p>
        <span className="meContext">
          {storeCount}개 매장 · 쿠폰 {couponCount}장
        </span>
      </div>
      {activeOrder && !bannerDismissed ? (
        <section className="activeOrderBanner" aria-label="진행 중인 주문">
          <div className="activeOrderTop">
            <div>
              <p className="sectionLabel">CURRENT ORDER</p>
              <strong>{activeOrder.storeName}</strong>
              <p>{activeOrder.detail}</p>
            </div>
            {activeOrder.statusLabel ? (
              <span
                className={`statusBadge ${activeOrder.statusTone || "info"}`}
              >
                {activeOrder.statusLabel}
              </span>
            ) : null}
          </div>
          <div className="activeOrderActions">
            <button
              className="returnButton"
              style={{ marginTop: 0 }}
              type="button"
              onClick={onActiveOrder}
            >
              {activeOrder.actionLabel}
            </button>
            <button
              className="dismissButton"
              type="button"
              onClick={onDismissBanner}
            >
              나중에
            </button>
          </div>
        </section>
      ) : null}
    </header>
  );
}

export function MeDashboardSkeleton() {
  return (
    <div
      className="meHero meSkeleton"
      aria-label="내 정보를 불러오는 중"
      aria-busy="true"
    >
      <div className="meBrand">
        <CustomerBrand compact />
        <span className="meBrandName">
          <strong>RION Order</strong>
          <small>주문·혜택 서비스</small>
        </span>
      </div>
      <div className="skeletonLine wide" />
      <div className="skeletonGrid">
        <div className="skeletonCard" />
        <div className="skeletonCard" />
        <div className="skeletonCard" />
      </div>
    </div>
  );
}
