"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CustomerTrustFooter,
  StoreIdentity,
} from "@/app/_components/CustomerBrand";
import { useStoreProfile } from "@/app/lib/storeProfile";

function ConfirmFailPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const { profile: storeProfile } = useStoreProfile(storeId);
  const code = useMemo(() => String(sp.get("code") || "").trim(), [sp]);
  const message = useMemo(() => String(sp.get("message") || "").trim(), [sp]);

  return (
    <main className="failPage customer-page">
      <section className="failCard">
        <StoreIdentity
          name={storeProfile.storeName}
          logo={storeProfile.logoImage}
          compact
        />
        <div className="failIcon" aria-hidden="true">
          !
        </div>
        <span className="eyebrow">결제 미완료</span>
        <h1>결제가 완료되지 않았어요</h1>
        <p className="description">
          주문은 아직 접수되지 않았습니다. 결제 정보를 확인한 뒤 다시 시도해
          주세요.
        </p>

        <button
          className="primary"
          onClick={() =>
            router.push(`/confirm?store=${encodeURIComponent(storeId)}`)
          }
        >
          다시 결제하기
        </button>
        <button
          className="secondary"
          onClick={() =>
            router.push(`/menu?store=${encodeURIComponent(storeId)}`)
          }
        >
          메뉴로 돌아가기
        </button>

        {code || message ? (
          <details>
            <summary>오류 상세 보기</summary>
            {code ? <p>오류 코드: {code}</p> : null}
            {message ? <p>사유: {message}</p> : null}
          </details>
        ) : null}
      </section>
      <CustomerTrustFooter />
      <style jsx>{`
        .failPage {
          display: grid;
          place-items: center;
          padding: 24px 16px;
        }
        .failCard {
          width: 100%;
          max-width: 520px;
          padding: 24px;
          border: 1px solid var(--customer-line);
          border-radius: 24px;
          background: #fff;
          box-shadow: var(--customer-shadow);
        }
        .failIcon {
          display: grid;
          place-items: center;
          width: 58px;
          height: 58px;
          margin-top: 32px;
          border-radius: 18px;
          background: #fff1f2;
          color: #be123c;
          font-size: 28px;
          font-weight: 900;
        }
        .eyebrow {
          display: block;
          margin-top: 22px;
          color: #be123c;
          font-size: 12px;
          font-weight: 800;
        }
        h1 {
          margin: 8px 0 0;
          color: var(--rion-navy);
          font-size: 30px;
          line-height: 1.2;
          letter-spacing: -0.045em;
        }
        .description {
          margin: 12px 0 26px;
          color: var(--customer-muted);
          font-weight: 600;
          line-height: 1.65;
        }
        button {
          width: 100%;
          min-height: 52px;
          border-radius: 14px;
          font-weight: 800;
          cursor: pointer;
        }
        .primary {
          border: 1px solid var(--rion-navy);
          background: var(--rion-navy);
          color: #fff;
          box-shadow: 0 10px 24px rgba(15, 31, 61, 0.2);
        }
        .secondary {
          margin-top: 10px;
          border: 1px solid var(--customer-line);
          background: #fff;
          color: var(--customer-ink);
        }
        details {
          margin-top: 22px;
          padding-top: 18px;
          border-top: 1px solid var(--customer-line);
          color: var(--customer-muted);
          font-size: 13px;
          line-height: 1.6;
        }
        summary {
          cursor: pointer;
          color: #475467;
          font-weight: 750;
        }
        details p {
          margin: 8px 0 0;
          overflow-wrap: anywhere;
        }
      `}</style>
    </main>
  );
}
export default function ConfirmFailPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <ConfirmFailPageInner />
    </Suspense>
  );
}
