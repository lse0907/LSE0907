"use client";

import Image from "next/image";

type RionBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  product?: boolean;
  admin?: boolean;
  auth?: boolean;
  staff?: boolean;
  landing?: boolean;
};

export default function RionBrand({ compact = false, inverse = false, product = false, admin = false, auth = false, staff = false, landing = false }: RionBrandProps) {
  const usesWordmark = admin || auth || staff;
  // All product and operational surfaces use the approved RION brand CI.
  // Do not add a fallback service symbol here: brand-ci verification rejects it.
  const logoSrc = inverse ? "/rion-logo-white.png" : "/rion-logo-deepnavy.png";
  const productLabel = admin ? "ADMIN" : staff ? "STAFF" : "OPS";

  return (
    <div className={`rionBrand ${compact ? "compact" : ""} ${inverse ? "inverse" : ""} ${admin ? "admin" : ""} ${auth ? "auth" : ""} ${staff ? "staff" : ""} ${landing ? "landingBrand" : ""}`} aria-label={product ? (auth ? "RION Order" : `RION Order ${productLabel}`) : "RION Labs"}>
      {landing ? <svg className="rionBrandLandingMark" viewBox="0 0 150 150" aria-hidden="true" focusable="false">
        <path d="M16 124V20C16 13.4 21.4 8 28 8H78C109 8 133 28 133 57C133 74 124 85 108 91L134 124H98.5L65 82H58V124Z" fill="currentColor" />
        <path d="M50.5 37.5C40.5 46 40.5 61 47.5 71.5C54.5 82 68.5 86.5 80.5 82C94 77 101 64 99 50C98 45 95 40.5 90 37.5" fill="none" stroke="#fff" strokeWidth="11.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M70 24V56" fill="none" stroke="#fff" strokeWidth="11.5" strokeLinecap="round" />
      </svg> : <Image
        className="rionBrandLogo"
        src={logoSrc}
        width={usesWordmark ? 42 : 52}
        height={usesWordmark ? 42 : 52}
        style={usesWordmark ? { width: "var(--rion-logo-size)", height: "var(--rion-logo-size)", objectFit: "contain", flexShrink: 0 } : undefined}
        alt=""
        aria-hidden="true"
        priority
      />}
      <div className="rionBrandCopy">
        <strong>{product ? <>RION Order{!admin && !auth && !staff ? <> <b>{productLabel}</b></> : null}</> : <>RION <b>Labs</b></>}</strong>
        {!compact ? <span>{product ? (auth ? "주문·매장 통합 서비스" : admin ? "매장 운영 워크스페이스" : staff ? "매장 주문 운영" : "통합 운영 콘솔") : "Realize Innovation ON"}</span> : null}
      </div>
      <style jsx>{`
        .rionBrand { --rion-logo-size:48px; display:flex; align-items:center; gap:11px; color:#0f1f3d; min-width:0; }
        .rionBrand.admin { --rion-logo-size:42px; }
        .rionBrand.auth { --rion-logo-size:42px; }
        .rionBrand.staff { --rion-logo-size:42px; }
        .rionBrand.inverse { color:#fff; }
        .rionBrandLogo { width:48px; height:48px; flex:0 0 auto; object-fit:contain; }
        .rionBrand.admin .rionBrandLogo { width:42px; height:42px; object-position:center; }
        .rionBrand.auth .rionBrandLogo { width:42px; height:42px; object-position:center; }
        .rionBrand.staff .rionBrandLogo { width:42px; height:42px; object-position:center; }
        .rionBrand.auth.inverse .rionBrandLogo { box-sizing:border-box; padding:0; border-radius:0; background:transparent; }
        .rionBrand.auth.inverse.adminFallback .rionBrandLogo { padding:0; background:transparent; }
        .rionBrand.adminFallback .rionBrandLogo { width:42px; height:42px; }
        .rionBrand.inverse .rionBrandLogo { width:48px; height:48px; }
        .rionBrandCopy { display:grid; gap:2px; min-width:0; }
        .rionBrandCopy strong { font-family:Inter,"Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:23px; line-height:1; letter-spacing:-.045em; white-space:nowrap; }
        .rionBrandCopy strong b { font-weight:500; }
        .rionBrandCopy span { font-size:11px; font-weight:700; letter-spacing:-.01em; opacity:.76; }
        .rionBrand.compact { --rion-logo-size:38px; gap:9px; }
        .rionBrand.compact .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.admin.compact .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.staff.compact .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.compact.inverse .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.compact .rionBrandCopy strong { font-size:18px; }
        .rionBrand.landingBrand.compact { --rion-logo-size:24px; gap:10px; color:#10264b; }
        .rionBrandLandingMark { width:var(--rion-logo-size); height:var(--rion-logo-size); flex:0 0 auto; color:#10264b; }
        .rionBrand.landingBrand.compact .rionBrandCopy strong { font-size:21px; }
        @media (max-width:900px) {
          .rionBrand.staff { --rion-logo-size:36px; gap:8px; }
          .rionBrand.staff .rionBrandLogo { width:36px; height:36px; }
          .rionBrand.staff .rionBrandCopy strong { font-size:18px; }
          .rionBrand.staff .rionBrandCopy span { display:none; }
        }
        @media (max-width:640px) {
          .rionBrand.landingBrand.compact { --rion-logo-size:22px; gap:9px; }
          .rionBrand.landingBrand.compact .rionBrandCopy strong { font-size:19px; }
          .rionBrand.admin { --rion-logo-size:38px; gap:8px; }
          .rionBrand.admin .rionBrandLogo { width:38px; height:38px; }
          .rionBrand.admin .rionBrandCopy strong { font-size:18px; }
          .rionBrand.admin .rionBrandCopy span { font-size:9px; }
          .rionBrand.staff { --rion-logo-size:36px; gap:8px; }
          .rionBrand.staff .rionBrandLogo { width:36px; height:36px; }
          .rionBrand.staff .rionBrandCopy strong { font-size:18px; }
          .rionBrand.staff .rionBrandCopy span { font-size:9px; }
        }
      `}</style>
    </div>
  );
}
