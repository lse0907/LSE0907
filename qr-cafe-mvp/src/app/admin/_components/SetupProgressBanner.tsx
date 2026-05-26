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
    <section className="setupBanner">
      <style jsx>{`
        .setupBanner {
          border: 1px solid #bfdbfe;
          background: linear-gradient(180deg, #eff6ff 0%, #f8fbff 100%);
          border-radius: 16px;
          padding: 14px;
          display: grid;
          gap: 10px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
        }
        .bannerRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .textCol {
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .stepTitle {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: #0f172a;
          font-weight: 950;
        }
        .modeLabel {
          margin: 0;
          font-size: 14px;
          color: #1e3a8a;
          font-weight: 900;
        }
        .modeDesc {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
          color: #334155;
          font-weight: 800;
        }
        .guide {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
          color: #0f172a;
          font-weight: 900;
        }
        .btnCol {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .warnText {
          margin: 0;
          font-size: 13px;
          font-weight: 900;
          color: #b45309;
        }
        @media (max-width: 768px) {
          .stepTitle { font-size: 18px; }
          .btnCol {
            width: 100%;
            justify-content: flex-start;
          }
        }
      `}</style>
      <div className="bannerRow">
        <div className="textCol">
          <h2 className="stepTitle">{stepLabel}</h2>
          <p className="modeLabel">
            현재 설정 방식: <b>{modeLabel}</b>
          </p>
          <p className="modeDesc">{modeDescription}</p>
          <p className="guide">{stepGuide}</p>
        </div>
        <div className="btnCol">
          <a className="btn" href={setupHref}>설정 방식 변경</a>
          <button className="btn btnPrimary" type="button" onClick={onComplete} disabled={completeDisabled}>
            {completeLabel}
          </button>
        </div>
      </div>
      {completeDisabled && disabledReason ? (
        <p className="warnText">{disabledReason}</p>
      ) : null}
    </section>
  );
}
