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
          background: linear-gradient(180deg, #eef5ff 0%, #f8fbff 100%);
          border-radius: 18px;
          padding: 16px;
          display: grid;
          gap: 12px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .bannerRow {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 14px;
          flex-wrap: wrap;
        }
        .textCol {
          display: grid;
          gap: 7px;
          min-width: 0;
          flex: 1 1 420px;
        }
        .stepTitle {
          margin: 0;
          font-size: 21px;
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
          font-weight: 850;
        }
        .guide {
          margin: 0;
          font-size: 14px;
          line-height: 1.45;
          color: #0f172a;
          font-weight: 900;
        }
        .btnCol {
          display: grid;
          grid-template-columns: repeat(2, minmax(132px, auto));
          align-items: center;
          gap: 8px;
          justify-content: end;
        }
        .secondaryBtn,
        .primaryBtn {
          min-height: 44px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 900;
          line-height: 1.2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 14px;
          text-decoration: none;
          white-space: nowrap;
          transition: transform 0.1s ease, box-shadow 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
        }
        .secondaryBtn {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.03);
        }
        .secondaryBtn:hover {
          border-color: #94a3b8;
          background: #f8fafc;
        }
        .primaryBtn {
          background: #0f172a;
          border: 1px solid #0f172a;
          color: #ffffff;
          box-shadow: 0 2px 0 rgba(15, 23, 42, 0.18);
          cursor: pointer;
        }
        .primaryBtn:hover:not(:disabled) {
          background: #111f38;
          border-color: #111f38;
        }
        .primaryBtn:active:not(:disabled),
        .secondaryBtn:active {
          transform: translateY(1px);
        }
        .primaryBtn:disabled {
          cursor: not-allowed;
          background: #9ca3af;
          border-color: #9ca3af;
          color: #f8fafc;
          box-shadow: none;
        }
        .warnText {
          margin: 0;
          font-size: 13px;
          font-weight: 900;
          color: #b45309;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 10px;
          padding: 8px 10px;
        }
        @media (max-width: 1024px) {
          .stepTitle { font-size: 19px; }
          .guide { font-size: 13px; }
        }
        @media (max-width: 768px) {
          .setupBanner {
            padding: 14px;
            gap: 10px;
          }
          .stepTitle { font-size: 18px; }
          .btnCol {
            width: 100%;
            grid-template-columns: 1fr;
            justify-content: stretch;
          }
          .secondaryBtn,
          .primaryBtn {
            width: 100%;
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
          <a className="secondaryBtn" href={setupHref}>설정 방식 변경</a>
          <button className="primaryBtn" type="button" onClick={onComplete} disabled={completeDisabled}>
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
