import Image from "next/image";

type RionBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  product?: boolean;
};

export default function RionBrand({ compact = false, inverse = false, product = false }: RionBrandProps) {
  const logoSrc = inverse ? "/brand/rion-logo-white.png" : "/rion-symbol.svg";

  return (
    <div className={`rionBrand ${compact ? "compact" : ""} ${inverse ? "inverse" : ""}`} aria-label={product ? "RION Order OPS" : "RION Labs"}>
      <Image
        className="rionBrandLogo"
        src={logoSrc}
        width={inverse ? 224 : 52}
        height={52}
        alt={inverse ? "RION Labs" : ""}
        aria-hidden={inverse ? undefined : "true"}
        priority
      />
      {product || !inverse ? (
        <div className="rionBrandCopy">
          <strong>{product ? <>RION Order <b>OPS</b></> : <>RION <b>Labs</b></>}</strong>
          {!compact ? <span>{product ? "통합 운영 콘솔" : "Realize Innovation ON"}</span> : null}
        </div>
      ) : null}
      <style jsx>{`
        .rionBrand { display:flex; align-items:center; gap:11px; color:#0f1f3d; min-width:0; }
        .rionBrand.inverse { color:#fff; }
        .rionBrandLogo { width:48px; height:48px; flex:0 0 auto; object-fit:contain; }
        .rionBrand.inverse .rionBrandLogo { width:auto; max-width:224px; height:48px; object-position:left center; }
        .rionBrand.inverse .rionBrandCopy { padding-left:18px; border-left:1px solid rgba(255,255,255,.24); }
        .rionBrandCopy { display:grid; gap:2px; min-width:0; }
        .rionBrandCopy strong { font-family:Inter,"Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:23px; line-height:1; letter-spacing:-.045em; white-space:nowrap; }
        .rionBrandCopy strong b { font-weight:500; }
        .rionBrandCopy span { font-size:11px; font-weight:700; letter-spacing:-.01em; opacity:.76; }
        .rionBrand.compact { gap:9px; }
        .rionBrand.compact .rionBrandLogo { width:38px; height:38px; }
        .rionBrand.compact.inverse .rionBrandLogo { width:auto; max-width:178px; height:38px; }
        .rionBrand.compact .rionBrandCopy strong { font-size:18px; }
      `}</style>
    </div>
  );
}
