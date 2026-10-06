"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { CustomerBrand } from "../_components/CustomerBrand";
import { CustomerIcon } from "../_components/CustomerIcon";

export function MePlatformHeader({
  name,
  loading,
  storeCount,
  couponCount,
  returnHref,
  children,
}: {
  name?: string | null;
  loading: boolean;
  storeCount: number;
  couponCount: number;
  returnHref?: string;
  children?: ReactNode;
}) {
  return (
    <header className="meHero">
      <div className="meHeroTop">
        <Link href="/" className="meBrand" aria-label="RION Order 홈으로 이동">
          <CustomerBrand compact />
          <span className="meBrandName">
            <strong>RION Order</strong>
            <small>주문·혜택 서비스</small>
          </span>
        </Link>
        {returnHref ? (
          <Link href={returnHref} className="meReturnLink" aria-label="주문으로 돌아가기">
            <CustomerIcon name="back" size={16} />
            <span><span className="meReturnContext">주문으로 </span>돌아가기</span>
          </Link>
        ) : null}
      </div>
      <div className="meHeroCopy">
        <p className="sectionLabel">MY RION</p>
        <h1>내 주문·혜택</h1>
        <p className="meHeroDescription">
          {name
            ? `${name}님, 주문과 매장별 혜택을 확인하세요.`
            : "매장별 포인트와 쿠폰을 확인하세요."}
        </p>
        {!loading ? (
          <span className="meContext">
            {storeCount}개 매장 · 쿠폰 {couponCount}장
          </span>
        ) : null}
      </div>
      {children}
    </header>
  );
}
