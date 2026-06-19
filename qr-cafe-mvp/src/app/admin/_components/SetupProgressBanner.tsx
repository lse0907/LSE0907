"use client";

type SetupProgressBannerProps = {
  stepLabel: string;
  stepNumber?: number;
  modeLabel: string;
  modeDescription: string;
  stepGuide: string;
  completeLabel: string;
  completeDisabled: boolean;
  disabledReason?: string;
  noticeText?: string;
  setupHref: string;
  onComplete: () => void;
  isCompleted?: boolean;
  completedLabel?: string;
  completedDescription?: string;
};

export default function SetupProgressBanner({
  stepLabel,
  stepNumber,
  modeLabel,
  modeDescription,
  stepGuide,
  completeLabel,
  completeDisabled,
  disabledReason = "",
  noticeText = "",
  setupHref,
  onComplete,
  isCompleted = false,
  completedLabel = "확인 완료",
  completedDescription = "이 단계는 확인 완료되었습니다. 수정했다면 다시 완료 확인해 주세요.",
}: SetupProgressBannerProps) {
  const displayTitle = stepLabel;
  const displayGuide = isCompleted ? completedDescription : stepGuide;
  const actionLabel = isCompleted ? "다시 완료 확인" : completeLabel;

  return (
    <section className={`setupBanner ${isCompleted ? "setupBannerDone" : ""}`}>
      <style jsx>{`
        .setupBanner {
          border: 1px solid #bfdbfe;
          background: linear-gradient(180deg, #eef5ff 0%, #f8fbff 100%);
          border-radius: 16px;
          padding: 14px;
          display: grid;
          gap: 10px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .setupBannerDone {
          border-color: #bbf7d0;
          background: linear-gradient(180deg, #f0fdf4 0%, #fbfefc 100%);
        }
        .bannerRow {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }
        .textCol {
          display: grid;
          gap: 6px;
          min-width: 0;
          flex: 1 1 420px;
        }
        .stepTitle {
          margin: 0;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          font-size: 19px;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: #0f172a;
          font-weight: 950;
        }
        .stepNumberBadge {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid #bfdbfe;
          background: #ffffff;
          color: #1d4ed8;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          font-size: 14px;
          font-weight: 950;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04);
        }
        .setupBannerDone .stepNumberBadge {
          border-color: #bbf7d0;
          color: #166534;
          background: #f0fdf4;
        }
        .stepTitleText {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .modeLine {
          margin: 0;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .modeLabel {
          font-size: 13px;
          color: #1e3a8a;
          font-weight: 900;
        }
        .doneBadge {
          border: 1px solid #bbf7d0;
          background: #dcfce7;
          color: #166534;
          border-radius: 999px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 950;
          line-height: 1.2;
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: center;
          gap: 8px;
          justify-content: end;
          width: min(100%, 360px);
        }
        .secondaryBtn,
        .primaryBtn {
          min-height: 40px;
          border-radius: 11px;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 9px 12px;
          text-decoration: none;
          white-space: nowrap;
          width: 100%;
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
        .setupBannerDone .primaryBtn {
          background: #ffffff;
          border-color: #86efac;
          color: #166534;
          box-shadow: 0 1px 0 rgba(22, 101, 52, 0.08);
        }
        .primaryBtn:hover:not(:disabled) {
          background: #111f38;
          border-color: #111f38;
        }
        .setupBannerDone .primaryBtn:hover:not(:disabled) {
          background: #dcfce7;
          border-color: #4ade80;
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
          font-size: 12px;
          font-weight: 900;
          color: #b45309;
          background: #fffbeb;
          border: 1px solid #fde68a;
          border-radius: 9px;
          padding: 7px 9px;
        }
        .doneNotice {
          color: #166534;
          background: #ecfdf5;
          border-color: #bbf7d0;
        }
        @media (max-width: 1024px) {
          .stepTitle { font-size: 19px; }
          .guide { font-size: 13px; }
        }
        @media (max-width: 768px) {
          .setupBanner {
            padding: 12px;
            gap: 8px;
          }
          .stepTitle { font-size: 17px; }
          .btnCol {
            width: 100%;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            justify-content: stretch;
            gap: 6px;
          }
          .secondaryBtn,
          .primaryBtn {
            width: 100%;
            min-height: 38px;
            padding: 7px 9px;
            font-size: 12px;
          }
        }
      `}</style>
      <div className="bannerRow">
        <div className="textCol">
          <h2 className="stepTitle">
            {typeof stepNumber === "number" ? (
              <span className="stepNumberBadge" aria-label={`초기 설정 ${stepNumber}단계`}>{stepNumber}</span>
            ) : null}
            <span className="stepTitleText">{displayTitle}</span>
          </h2>
          <p className="modeLine">
            <span className="modeLabel">현재 설정 방식: <b>{modeLabel}</b></span>
            {isCompleted ? <span className="doneBadge" title={completedLabel}>완료 확인됨</span> : null}
          </p>
          <p className="modeDesc">{modeDescription}</p>
          <p className="guide">{displayGuide}</p>
        </div>
        <div className="btnCol">
          <a className="secondaryBtn" href={setupHref}>{isCompleted ? "초기설정으로" : "설정 방식 변경"}</a>
          <button className="primaryBtn" type="button" onClick={onComplete} disabled={completeDisabled}>
            {actionLabel}
          </button>
        </div>
      </div>
      {isCompleted ? (
        <p className="warnText doneNotice">완료 후에도 내용을 수정할 수 있습니다. 수정했다면 다시 완료 확인을 눌러 주세요.</p>
      ) : noticeText ? (
        <p className="warnText">{noticeText}</p>
      ) : completeDisabled && disabledReason ? (
        <p className="warnText">{disabledReason}</p>
      ) : null}
    </section>
  );
}
