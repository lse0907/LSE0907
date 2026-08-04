"use client";
import { useMemo, useState } from "react";
import { CustomerSheet } from "../_components/CustomerSheet";
import {
  type BenefitView,
  type CustomerCoupon,
  type WalletRow,
  couponBenefitText,
  couponExpiry,
  tierLabel,
} from "./meUtils";

type Props = {
  view: BenefitView;
  onChange: (view: BenefitView) => void;
  wallets: WalletRow[];
  coupons: CustomerCoupon[];
  storeNameMap: Record<string, string>;
  couponCountMap: Record<string, number>;
  totalPoints: number;
  totalCoupons: number;
};

export function MeBenefitSections({
  view,
  onChange,
  wallets,
  coupons,
  storeNameMap,
  couponCountMap,
  totalPoints,
  totalCoupons,
}: Props) {
  const [fullView, setFullView] = useState<Exclude<BenefitView, null> | null>(
    null,
  );
  const sortedCoupons = useMemo(
    () =>
      [...coupons].sort((a, b) => couponExpiry(a).sort - couponExpiry(b).sort),
    [coupons],
  );
  const renderStores = (rows: WalletRow[]) =>
    rows.length ? (
      rows.map((wallet) => (
        <article className="benefitRow" key={`stores-${wallet.store_id}`}>
          <div className="benefitRowHead">
            <strong title={storeNameMap[wallet.store_id] || "매장"}>
              {storeNameMap[wallet.store_id] || "매장"}
            </strong>
            <span>{tierLabel(wallet.tier)}</span>
          </div>
          <p>
            주문 {Number(wallet.lifetime_orders || 0)}회 · 매장 포인트{" "}
            {Number(wallet.point_balance || 0).toLocaleString()}P · 쿠폰{" "}
            {couponCountMap[wallet.store_id] || 0}장
          </p>
        </article>
      ))
    ) : (
      <div className="benefitRow">
        <p>아직 이용한 매장이 없어요.</p>
      </div>
    );
  const renderPoints = (rows: WalletRow[]) =>
    rows.length ? (
      <>
        <div className="benefitTotal">
          <span>총 보유 포인트</span>
          <strong>{totalPoints.toLocaleString()}P</strong>
        </div>
        {rows.map((wallet) => (
          <article className="benefitRow" key={`points-${wallet.store_id}`}>
            <div className="benefitRowHead">
              <strong title={storeNameMap[wallet.store_id] || "매장"}>
                {storeNameMap[wallet.store_id] || "매장"}
              </strong>
              <strong>
                {Number(wallet.point_balance || 0).toLocaleString()}P
              </strong>
            </div>
            <p>이 매장에서 사용할 수 있는 매장 포인트예요.</p>
          </article>
        ))}
      </>
    ) : (
      <div className="benefitRow">
        <p>아직 적립된 포인트가 없어요.</p>
      </div>
    );
  const renderCoupons = (rows: CustomerCoupon[]) =>
    rows.length ? (
      rows.map((coupon) => {
        const expiry = couponExpiry(coupon);
        return (
          <article className="benefitRow" key={coupon.id}>
            <div className="benefitRowHead">
              <strong title={coupon.template?.name || "매장 쿠폰"}>
                {coupon.template?.name || "매장 쿠폰"}
              </strong>
              <span className={`expiryBadge ${expiry.tone}`}>
                {expiry.label}
              </span>
            </div>
            <p>{storeNameMap[coupon.store_id] || "매장"}</p>
            <p>{couponBenefitText(coupon)}</p>
          </article>
        );
      })
    ) : (
      <div className="benefitRow">
        <p>사용할 수 있는 쿠폰이 없어요.</p>
      </div>
    );
  const count = view === "coupons" ? sortedCoupons.length : wallets.length;
  return (
    <>
      <section className="benefitSection">
        <p className="sectionLabel">MY BENEFITS</p>
        <h2>혜택 요약</h2>
        <div className="benefitGrid">
          {(
            [
              ["stores", "이용 매장", `${wallets.length}곳`],
              ["points", "총 보유 포인트", `${totalPoints.toLocaleString()}P`],
              ["coupons", "내 쿠폰", `${totalCoupons}장`],
            ] as const
          ).map(([key, label, value]) => (
            <button
              type="button"
              className={`benefitItem ${view === key ? "active" : ""}`}
              aria-pressed={view === key}
              onClick={() => onChange(view === key ? null : key)}
              key={key}
            >
              <span>{label}</span>
              <strong>{value}</strong>
            </button>
          ))}
        </div>
        {view ? (
          <div className="benefitDetail" aria-live="polite">
            {view === "stores"
              ? renderStores(wallets.slice(0, 3))
              : view === "points"
                ? renderPoints(wallets.slice(0, 3))
                : renderCoupons(sortedCoupons.slice(0, 3))}
            {count > 3 ? (
              <button
                type="button"
                className="benefitMoreButton"
                onClick={() => setFullView(view)}
              >
                전체 {count}개 보기
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {fullView ? (
        <CustomerSheet
          title={
            fullView === "stores"
              ? `이용 매장 ${wallets.length}곳`
              : fullView === "points"
                ? "매장별 포인트"
                : `내 쿠폰 ${sortedCoupons.length}장`
          }
          onClose={() => setFullView(null)}
        >
          <div className="sheetList">
            {fullView === "stores"
              ? renderStores(wallets)
              : fullView === "points"
                ? renderPoints(wallets)
                : renderCoupons(sortedCoupons)}
          </div>
        </CustomerSheet>
      ) : null}
    </>
  );
}
