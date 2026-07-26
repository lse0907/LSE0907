import Image from "next/image";

type RionBrandProps = {
  compact?: boolean;
  inverse?: boolean;
  product?: boolean;
};

export default function RionBrand({ compact = false, inverse = false, product = false }: RionBrandProps) {
  return (
    <div className={`rionBrand ${compact ? "compact" : ""} ${inverse ? "inverse" : ""}`} aria-label={product ? "RION Order OPS" : "RION Labs"}>
      <Image src={inverse ? "/rion-symbol-white.svg" : "/rion-symbol.svg"} width={52} height={52} alt="" aria-hidden="true" priority />
      <div className="rionBrandCopy">
        <strong>{product ? <>RION Order <b>OPS</b></> : <>RION <b>Labs</b></>}</strong>
        {!compact ? <span>{product ? "통합 운영 콘솔" : "Realize Innovation ON"}</span> : null}
      </div>
      <style jsx>{`
        .rionBrand { display:flex; align-items:center; gap:12px; color:#0f1f3d; min-width:0; }
        .rionBrand.inverse { color:#fff; }
        .rionBrand img { width:52px; height:52px; flex:0 0 auto; object-fit:contain; }
        .rionBrandCopy { display:grid; gap:2px; min-width:0; }
        .rionBrandCopy strong { font-family:Inter,"Malgun Gothic","Apple SD Gothic Neo",sans-serif; font-size:23px; line-height:1; letter-spacing:-.045em; white-space:nowrap; }
        .rionBrandCopy strong b { font-weight:500; }
        .rionBrandCopy span { font-size:11px; font-weight:700; letter-spacing:-.01em; opacity:.76; }
        .rionBrand.compact { gap:9px; }
        .rionBrand.compact img { width:38px; height:38px; }
        .rionBrand.compact .rionBrandCopy strong { font-size:18px; }
      `}</style>
    </div>
  );
}
