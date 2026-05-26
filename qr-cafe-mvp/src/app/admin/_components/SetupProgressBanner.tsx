"use client";

type SetupProgressBannerProps = {
  stepLabel: string;
  modeLabel: string;
  modeDescription: string;
  stepGuide: string;
  completeLabel: string;
  completeDisabled: boolean;
  disabledReason?: string;
  setupHref: string;
  onComplete: () => void;
};

export default function SetupProgressBanner({
  stepLabel,
  modeLabel,
  modeDescription,
  stepGuide,
  completeLabel,
  completeDisabled,
  disabledReason = "",
  setupHref,
  onComplete,
}: SetupProgressBannerProps) {
  return (
    <section className="card" style={{ borderColor: "#bfdbfe", background: "#eff6ff" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <b>{stepLabel}</b>
          <p className="subText sub" style={{ margin: 0 }}>
            현재 설정 방식: <b>{modeLabel}</b>
          </p>
          <p className="subText sub" style={{ margin: 0 }}>{modeDescription}</p>
          <p className="subText sub" style={{ margin: 0 }}>{stepGuide}</p>
        </div>
        <div className="row btnRow" style={{ justifyContent: "flex-end", marginTop: 0 }}>
          <a className="btn" href={setupHref}>설정 방식 변경</a>
          <button className="btn btnPrimary" type="button" onClick={onComplete} disabled={completeDisabled}>
            {completeLabel}
          </button>
        </div>
      </div>
      {completeDisabled && disabledReason ? (
        <p className="subText sub" style={{ color: "#b45309", marginTop: 6 }}>{disabledReason}</p>
      ) : null}
    </section>
  );
}
