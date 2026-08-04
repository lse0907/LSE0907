"use client";

import Image from "next/image";
import { useState } from "react";
import { useStoreProfile } from "@/app/lib/storeProfile";

function firstStoreCharacter(name: string) {
  return Array.from(name.trim())[0] || "매";
}

type StoreIdentityProps = {
  storeId: string;
  inverse?: boolean;
  compact?: boolean;
};

export function StoreIdentity({
  storeId,
  inverse = false,
  compact = false,
}: StoreIdentityProps) {
  const { profile, loading } = useStoreProfile(storeId);
  const [failedLogo, setFailedLogo] = useState("");
  const logo = profile.logoImage.trim();
  const showLogo = Boolean(logo) && failedLogo !== logo;
  const storeName = loading
    ? "매장 정보를 불러오는 중"
    : profile.storeName || "매장";

  return (
    <div
      className={`storeIdentity ${inverse ? "inverse" : ""} ${compact ? "compact" : ""}`}
    >
      <span className="storeMark" aria-hidden={!showLogo}>
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={`${storeName} 로고`}
            onError={() => setFailedLogo(logo)}
          />
        ) : (
          <span aria-hidden="true">
            {loading ? "" : firstStoreCharacter(storeName)}
          </span>
        )}
      </span>
      <span className="storeName">{storeName}</span>
      <style jsx>{`
        .storeIdentity {
          display: flex;
          align-items: center;
          gap: 11px;
          min-width: 0;
          color: #0f1f3d;
        }
        .storeMark {
          width: 46px;
          height: 46px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          overflow: hidden;
          border: 1px solid #dfe4eb;
          border-radius: 14px;
          background: #fff;
          color: #0f1f3d;
          font-size: 20px;
          font-weight: 950;
          box-shadow: 0 5px 16px rgba(15, 31, 61, 0.08);
        }
        .storeMark img {
          width: 100%;
          height: 100%;
          padding: 5px;
          object-fit: contain;
        }
        .storeName {
          min-width: 0;
          overflow: hidden;
          color: inherit;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: -0.025em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .compact .storeMark {
          width: 40px;
          height: 40px;
          border-radius: 12px;
        }
        .compact .storeName {
          font-size: 18px;
        }
        @media (max-width: 340px) {
          .compact .storeName {
            font-size: 17px;
          }
        }
        .inverse {
          color: #fff;
        }
        .inverse .storeMark {
          border-color: rgba(255, 255, 255, 0.34);
          background: rgba(255, 255, 255, 0.94);
          color: #0f1f3d;
        }
      `}</style>
    </div>
  );
}

type StoreCustomerHeaderProps = StoreIdentityProps & {
  title: string;
  description?: string;
  context?: string;
  actions?: React.ReactNode;
};

export function StoreCustomerHeader({
  storeId,
  title,
  description,
  context,
  actions,
}: StoreCustomerHeaderProps) {
  return (
    <header className="storeHeader">
      <div className="top">
        <StoreIdentity storeId={storeId} />
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      <div className="copy">
        {context ? <span className="context">{context}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <style jsx>{`
        .storeHeader {
          padding: 20px;
          border: 1px solid #dfe4eb;
          border-radius: 22px;
          background: linear-gradient(145deg, #fff 0%, #f8fafc 100%);
          box-shadow: 0 18px 48px rgba(15, 31, 61, 0.08);
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .copy {
          margin-top: 22px;
        }
        .context {
          display: inline-flex;
          min-height: 28px;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          background: #e9eef6;
          color: #30415f;
          font-size: 12px;
          font-weight: 750;
        }
        h1 {
          margin: 10px 0 0;
          color: #0f1f3d;
          font-size: clamp(28px, 5vw, 38px);
          line-height: 1.12;
          letter-spacing: -0.045em;
        }
        p {
          margin: 9px 0 0;
          color: #5c6678;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.65;
        }
        @media (max-width: 520px) {
          .storeHeader {
            padding: 17px;
            border-radius: 18px;
          }
          .top {
            align-items: flex-start;
          }
          .copy {
            margin-top: 20px;
          }
        }
      `}</style>
    </header>
  );
}

export function CustomerTrustFooter({
  inverse = false,
}: {
  inverse?: boolean;
}) {
  return (
    <footer className={`trustFooter ${inverse ? "inverse" : ""}`}>
      <span>Powered by</span>
      <Image
        src={inverse ? "/rion-logo-white.png" : "/rion-logo-deepnavy.png"}
        width={96}
        height={28}
        alt="RION Order"
      />
      <style jsx>{`
        .trustFooter {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 28px 16px calc(20px + env(safe-area-inset-bottom));
          color: #7a8494;
          font-size: 10px;
          font-weight: 750;
        }
        .trustFooter :global(img) {
          width: auto;
          height: 20px;
          object-fit: contain;
        }
        .inverse {
          color: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </footer>
  );
}
