"use client";

import Link from "next/link";

import type { SignupAudience } from "@/app/lib/signupPolicy";

type Props = {
  audience: SignupAudience;
  minimumAgeConfirmed: boolean;
  onMinimumAgeChange: (checked: boolean) => void;
  businessAuthorityConfirmed: boolean;
  onBusinessAuthorityChange: (checked: boolean) => void;
  termsAccepted: boolean;
  onTermsChange: (checked: boolean) => void;
  privacyNoticeAcknowledged: boolean;
  onPrivacyNoticeChange: (checked: boolean) => void;
  marketingConsent: boolean;
  onMarketingConsentChange: (checked: boolean) => void;
  disabled?: boolean;
};

export default function SignupPolicyConsent(props: Props) {
  const isOwner = props.audience === "owner";
  const allSelected = props.minimumAgeConfirmed
    && (!isOwner || props.businessAuthorityConfirmed)
    && props.termsAccepted
    && props.privacyNoticeAcknowledged
    && props.marketingConsent;
  const ageLabel = isOwner
    ? "만 19세 이상입니다."
    : "만 14세 이상입니다.";

  const setAll = (checked: boolean) => {
    props.onMinimumAgeChange(checked);
    if (isOwner) props.onBusinessAuthorityChange(checked);
    props.onTermsChange(checked);
    props.onPrivacyNoticeChange(checked);
    props.onMarketingConsentChange(checked);
  };

  return (
    <section className="policyBox" aria-labelledby={`${props.audience}-policy-title`}>
      <header className="policyHeader">
        <div>
          <p id={`${props.audience}-policy-title`} className="authSectionTitle">가입 확인 및 정책 안내</p>
          <p className="policyNotice">필수 항목과 선택 항목을 구분해 확인해 주세요.</p>
        </div>
        <span className="draftBadge">법률 검토 전</span>
      </header>

      <label className="allCheck">
        <input type="checkbox" checked={allSelected} onChange={(event) => setAll(event.target.checked)} disabled={props.disabled} />
        <span><strong>전체 동의</strong><small>선택 동의를 포함하며, 선택 항목은 다시 해제할 수 있습니다.</small></span>
      </label>

      <div className="policyGroup">
        <p className="groupTitle">가입 자격 <span className="requiredBadge">필수</span></p>
        <label className="policyCheck">
          <input type="checkbox" checked={props.minimumAgeConfirmed} onChange={(event) => props.onMinimumAgeChange(event.target.checked)} disabled={props.disabled} />
          <span>{ageLabel}</span>
        </label>
        {isOwner ? (
          <label className="policyCheck">
            <input type="checkbox" checked={props.businessAuthorityConfirmed} onChange={(event) => props.onBusinessAuthorityChange(event.target.checked)} disabled={props.disabled} />
            <span>사업자 대표자이거나 가입·계약 권한을 위임받은 담당자입니다.</span>
          </label>
        ) : null}
      </div>

      <div className="policyGroup">
        <p className="groupTitle">서비스 이용 정책 <span className="requiredBadge">필수</span></p>
        <label className="policyCheck">
          <input type="checkbox" checked={props.termsAccepted} onChange={(event) => props.onTermsChange(event.target.checked)} disabled={props.disabled} />
          <span><Link href={`/legal/terms?audience=${props.audience}`} target="_blank">이용정책 안내</Link>를 확인하고 동의합니다.</span>
        </label>
        <label className="policyCheck">
          <input type="checkbox" checked={props.privacyNoticeAcknowledged} onChange={(event) => props.onPrivacyNoticeChange(event.target.checked)} disabled={props.disabled} />
          <span><Link href={`/legal/privacy?audience=${props.audience}`} target="_blank">개인정보 처리 안내</Link>를 확인했습니다.</span>
        </label>
      </div>

      <div className="policyGroup optionalGroup">
        <p className="groupTitle">혜택 및 소식 <span className="optionalBadge">선택</span></p>
        <label className="policyCheck">
          <input type="checkbox" checked={props.marketingConsent} onChange={(event) => props.onMarketingConsentChange(event.target.checked)} disabled={props.disabled} />
          <span><Link href={`/legal/marketing?audience=${props.audience}`} target="_blank">마케팅 정보 수신</Link>에 동의합니다.<small>동의하지 않아도 가입할 수 있습니다.</small></span>
        </label>
      </div>

      <style jsx>{`
        .policyBox{display:grid;gap:12px;margin:20px 0;padding:17px;border:1px solid #d9e2ef;border-radius:16px;background:#f8fafc}
        .policyHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.policyHeader p{margin:0}.policyHeader .authSectionTitle{font-size:13px}.policyNotice{margin-top:4px!important;color:#667085;font-size:11px;line-height:1.5}.draftBadge,.requiredBadge,.optionalBadge{display:inline-flex;align-items:center;border-radius:999px;font-size:10px;font-weight:900;white-space:nowrap}.draftBadge{padding:5px 8px;background:#eef4ff;color:#315b9d}.requiredBadge{padding:3px 6px;background:#e8f0ff;color:#244f91}.optionalBadge{padding:3px 6px;background:#edf7f2;color:#28725a}
        .allCheck{display:flex;align-items:flex-start;gap:10px;padding:13px;border:1px solid #c9d8ed;border-radius:12px;background:#fff;color:#182b49;cursor:pointer}.allCheck span{display:grid;gap:3px}.allCheck strong{font-size:14px}.allCheck small,.policyCheck small{display:block;color:#738096;font-size:10px;font-weight:650;line-height:1.45}.allCheck input,.policyCheck input{width:19px;height:19px;margin:1px 0 0;flex:0 0 auto;accent-color:#173e73}
        .policyGroup{display:grid;gap:9px;padding:12px 13px;border:1px solid #e2e8f1;border-radius:12px;background:#fff}.optionalGroup{background:#fbfdfc}.groupTitle{display:flex;align-items:center;gap:7px;margin:0;color:#253a58;font-size:11px;font-weight:950}.policyCheck{display:flex;align-items:flex-start;gap:10px;min-height:25px;color:#344054;font-size:12px;font-weight:750;line-height:1.5;cursor:pointer}.policyCheck span{min-width:0}.policyBox :global(a){display:inline-block;color:#1d4f91;font-weight:900;text-decoration:underline;text-underline-offset:3px}
        @media(max-width:420px){.policyBox{margin-inline:-2px;padding:14px}.policyHeader{align-items:center}.allCheck,.policyGroup{padding:12px}.policyCheck{font-size:12px}}
      `}</style>
    </section>
  );
}
