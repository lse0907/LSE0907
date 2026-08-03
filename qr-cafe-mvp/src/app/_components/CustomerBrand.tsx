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
        src={inverse ? "/rion-logo-white.png" : "/rion-symbol.svg"}
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

type CustomerPageHeaderProps = {
  title: string;
  description?: string;
  context?: string;
  actions?: React.ReactNode;
};

export function CustomerPageHeader({
  title,
  description,
  context,
  actions,
}: CustomerPageHeaderProps) {
  return (
    <header className="customerPageHeader">
      <div className="customerPageHeaderTop">
        <CustomerBrand compact />
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
