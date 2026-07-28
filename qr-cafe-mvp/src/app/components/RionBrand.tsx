"use client";

import Image from "next/image";
import { useState } from "react";

type RionBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  product?: boolean;
  admin?: boolean;
  auth?: boolean;
  staff?: boolean;
};

export default function RionBrand({ compact = false, inverse = false, product = false, admin = false, auth = false, staff = false }: RionBrandProps) {
  const [adminLogoFailed, setAdminLogoFailed] = useState(false);
  const usesWordmark = admin || auth || staff;
  const logoSrc = usesWordmark && !adminLogoFailed ? "/rion-logo-deepnavy.png" : inverse ? "/rion-logo-white.png" : "/rion-symbol.svg";
  const productLabel = admin ? "ADMIN" : staff ? "STAFF" : "OPS";

  return (
    <div className={`rionBrand ${compact ? "compact" : ""} ${inverse ? "inverse" : ""} ${admin ? "admin" : ""} ${auth ? "auth" : ""} ${staff ? "staff" : ""} ${adminLogoFailed ? "adminFallback" : ""}`} aria-label={product ? (auth ? "RION Order" : `RION Order ${productLabel}`) : "RION Labs"}>
      <Image
        className="rionBrandLogo"
        src={logoSrc}
        width={usesWordmark ? 42 : 52}
        height={usesWordmark ? 42 : 52}
        style={usesWordmark ? { width: "var(--rion-logo-size)", height: "var(--rion-logo-size)", objectFit: "contain", flexShrink: 0 } : undefined}
        alt=""
        aria-hidden="true"
        priority
        onError={usesWordmark ? () => setAdminLogoFailed(true) : undefined}
      />
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
        .rionBrand.auth.inverse .rionBrandLogo { box-sizing:border-box; padding:4px; border-radius:12px; background:#fff; }
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
        @media (max-width:640px) {
          .rionBrand.admin { --rion-logo-size:38px; gap:8px; }
          .rionBrand.admin .rionBrandLogo { width:38px; height:38px; }
          .rionBrand.admin .rionBrandCopy strong { font-size:18px; }
          .rionBrand.admin .rionBrandCopy span { font-size:9px; }
          .rionBrand.staff { --rion-logo-size:38px; gap:8px; }
          .rionBrand.staff .rionBrandLogo { width:38px; height:38px; }
          .rionBrand.staff .rionBrandCopy strong { font-size:18px; }
          .rionBrand.staff .rionBrandCopy span { font-size:9px; }
        }
      `}</style>
    </div>
  );
}
