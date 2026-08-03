import Image from "next/image";

type CustomerBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  poweredBy?: boolean;
};

export function CustomerBrand({
  compact = false,
  inverse = false,
  poweredBy = false,
}: CustomerBrandProps) {
  return (
    <div
      className={`customerBrand ${compact ? "customerBrandCompact" : ""} ${inverse ? "customerBrandInverse" : ""}`}
    >
      {poweredBy ? (
        <span className="customerBrandPowered">Powered by</span>
      ) : null}
      <Image
        src={inverse ? "/rion-logo-white.png" : "/rion-logo-deepnavy.png"}
        width={32}
        height={32}
        alt=""
        aria-hidden="true"
      />
      <span className="customerBrandName">
        RION <b>Order</b>
      </span>
      <style jsx>{`
        .customerBrand {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #0f1f3d;
          min-width: 0;
        }
        .customerBrand :global(img) {
          width: 32px;
          height: 32px;
          object-fit: contain;
          flex: 0 0 auto;
        }
        .customerBrandName {
          font-size: 17px;
          font-weight: 800;
          letter-spacing: -0.04em;
          white-space: nowrap;
        }
        .customerBrandName b {
          font-weight: 500;
        }
        .customerBrandPowered {
          color: #6b7280;
          font-size: 10px;
          font-weight: 750;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        .customerBrandCompact {
          gap: 6px;
        }
        .customerBrandCompact :global(img) {
          width: 24px;
          height: 24px;
        }
        .customerBrandCompact .customerBrandName {
          font-size: 14px;
        }
        .customerBrandInverse {
          color: #fff;
        }
        .customerBrandInverse .customerBrandPowered {
          color: rgba(255, 255, 255, 0.72);
        }
      `}</style>
    </div>
  );
}

export function CustomerTrustFooter({
  inverse = false,
}: {
  inverse?: boolean;
}) {
  return (
    <footer className={`customerTrust ${inverse ? "inverse" : ""}`}>
      <span>Powered by</span>
      <CustomerBrand compact inverse={inverse} />
      <style jsx>{`
        .customerTrust {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 28px 16px calc(24px + env(safe-area-inset-bottom));
          color: #7b8492;
        }
        .customerTrust > span {
          font-size: 10px;
          font-weight: 700;
        }
        .customerTrust :global(.customerBrand) {
          opacity: 0.72;
        }
        .customerTrust.inverse {
          color: rgba(255, 255, 255, 0.62);
        }
      `}</style>
    </footer>
  );
}

export function StoreIdentity({
  name,
  logo,
  compact = false,
}: {
  name: string;
  logo?: string;
  compact?: boolean;
}) {
  const initial = name.trim().slice(0, 1) || "매";
  return (
    <div className={`storeIdentity ${compact ? "compact" : ""}`}>
      <span className="storeMark">
        {logo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="" />
          </>
        ) : (
          initial
        )}
      </span>
      <strong>{name || "매장"}</strong>
      <style jsx>{`
        .storeIdentity {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          color: #0f1f3d;
        }
        .storeMark {
          display: grid;
          place-items: center;
          width: 38px;
          height: 38px;
          flex: 0 0 38px;
          overflow: hidden;
          border: 1px solid #dfe4eb;
          border-radius: 12px;
          background: #f2f5f9;
          font-size: 15px;
          font-weight: 850;
        }
        .storeMark img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 17px;
          letter-spacing: -0.025em;
        }
        .compact .storeMark {
          width: 32px;
          height: 32px;
          flex-basis: 32px;
          border-radius: 10px;
        }
        .compact strong {
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}

type CustomerPageHeaderProps = {
  title: string;
  description?: string;
  context?: string;
  actions?: React.ReactNode;
  storeName?: string;
  storeLogo?: string;
  platform?: boolean;
};

export function CustomerPageHeader({
  title,
  description,
  context,
  actions,
  storeName,
  storeLogo,
  platform = false,
}: CustomerPageHeaderProps) {
  return (
    <header className="customerPageHeader">
      <div className="customerPageHeaderTop">
        {storeName ? (
          <StoreIdentity name={storeName} logo={storeLogo} compact />
        ) : platform ? (
          <CustomerBrand compact />
        ) : null}
        {actions ? (
          <div className="customerPageHeaderActions">{actions}</div>
        ) : null}
      </div>
      <div className="customerPageHeaderCopy">
        {context ? (
          <span className="customerPageContext">{context}</span>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <style jsx>{`
        .customerPageHeader {
          padding: 20px;
          border: 1px solid #dfe4eb;
          border-radius: 22px;
          background: linear-gradient(145deg, #fff 0%, #f8fafc 100%);
          box-shadow: 0 18px 48px rgba(15, 31, 61, 0.08);
        }
        .customerPageHeaderTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .customerPageHeaderActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .customerPageHeaderCopy {
          margin-top: 24px;
        }
        .customerPageContext {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
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
          .customerPageHeader {
            padding: 17px;
            border-radius: 18px;
          }
          .customerPageHeaderCopy {
            margin-top: 20px;
          }
        }
      `}</style>
    </header>
  );
}
