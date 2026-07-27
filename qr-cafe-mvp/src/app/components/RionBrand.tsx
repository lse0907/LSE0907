"use client";

import Image from "next/image";
import { useState } from "react";

type RionBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  product?: boolean;
  admin?: boolean;
};

export default function RionBrand({ compact = false, inverse = false, product = false, admin = false }: RionBrandProps) {
  const [adminLogoFailed, setAdminLogoFailed] = useState(false);
  const logoSrc = admin && !adminLogoFailed ? "/rion-logo-deepnavy.png" : inverse ? "/rion-logo-white.png" : "/rion-symbol.svg";
  const productLabel = admin ? "ADMIN" : "OPS";

  return (
    <div className={`rionBrand ${compact ? "compact" : ""} ${inverse ? "inverse" : ""} ${admin ? "admin" : ""} ${adminLogoFailed ? "adminFallback" : ""}`} aria-label={product ? `RION Order ${productLabel}` : "RION Labs"}>
      <Image
        className="rionBrandLogo"
        src={logoSrc}
        width={admin ? 320 : 52}
        height={admin ? 80 : 52}
        alt=""
        aria-hidden="true"
        priority
        onError={admin ? () => setAdminLogoFailed(true) : undefined}
      />
      {!admin ? (
        <div className="rionBrandCopy">
          <strong>{product ? <>RION Order <b>{productLabel}</b></> : <>RION <b>Labs</b></>}</strong>
          {!compact ? <span>{product ? "통합 운영 콘솔" : "Realize Innovation ON"}</span> : null}
        </div>
      ) : null}
      <style jsx>{`
        .rionBrand { display:flex; align-items:center; gap:11px; color:#0f1f3d; min-width:0; }
        .rionBrand.inverse { color:#fff; }
        .rionBrandLogo { width:48px; height:48px; flex:0 0 auto; object-fit:contain; }
        .rionBrand.admin .rionBrandLogo { width:192px; height:48px; object-position:left center; }
        .rionBrand.adminFallback .rionBrandLogo { width:48px; }
        .rionBrand.inverse .rionBrandLogo { width:48px; height:48px; }
        .rionBrandCopy { display:grid; gap:2px; min-width:0; }
        .rionBrandCopy strong { font-family:Inter,"Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:23px; line-height:1; letter-spacing:-.045em; white-space:nowrap; }
        .rionBrandCopy strong b { font-weight:500; }
        .rionBrandCopy span { font-size:11px; font-weight:700; letter-spacing:-.01em; opacity:.76; }
        .rionBrand.compact { gap:9px; }
        .rionBrand.compact .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.admin.compact .rionBrandLogo { width:168px; height:42px; }
        .rionBrand.compact.inverse .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.compact .rionBrandCopy strong { font-size:18px; }
      `}</style>
    </div>
  );
}
