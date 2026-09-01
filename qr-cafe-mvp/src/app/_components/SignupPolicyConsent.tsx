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
  const ageLabel = isOwner
    ? "[필수] 만 19세 이상이며 아래 사업자 자격을 확인했습니다."
    : "[필수] 만 14세 이상입니다.";

  return (
    <section className="policyBox" aria-labelledby={`${props.audience}-policy-title`}>
      <p id={`${props.audience}-policy-title`} className="authSectionTitle">가입 확인 및 정책 안내</p>
      <p className="policyNotice">현재 문구는 확정된 운영정책을 반영한 법률 검토 전 안내입니다. 정식 공개 전 법률 검토 후 문서 버전을 갱신합니다.</p>

      <label className="policyCheck">
        <input type="checkbox" checked={props.minimumAgeConfirmed} onChange={(event) => props.onMinimumAgeChange(event.target.checked)} disabled={props.disabled} />
        <span>{ageLabel}</span>
      </label>

      {isOwner ? (
        <label className="policyCheck">
          <input type="checkbox" checked={props.businessAuthorityConfirmed} onChange={(event) => props.onBusinessAuthorityChange(event.target.checked)} disabled={props.disabled} />
          <span>[필수] 사업자 대표자이거나 가입·계약 권한을 위임받은 담당자입니다.</span>
        </label>
      ) : null}

      <label className="policyCheck">
        <input type="checkbox" checked={props.termsAccepted} onChange={(event) => props.onTermsChange(event.target.checked)} disabled={props.disabled} />
        <span>[필수] <Link href={`/legal/terms?audience=${props.audience}`} target="_blank">이용정책 안내</Link>를 확인하고 동의합니다.</span>
      </label>

      <label className="policyCheck">
        <input type="checkbox" checked={props.privacyNoticeAcknowledged} onChange={(event) => props.onPrivacyNoticeChange(event.target.checked)} disabled={props.disabled} />
        <span>[필수] <Link href={`/legal/privacy?audience=${props.audience}`} target="_blank">개인정보 처리 안내</Link>를 확인했습니다.</span>
      </label>

      <label className="policyCheck">
        <input type="checkbox" checked={props.marketingConsent} onChange={(event) => props.onMarketingConsentChange(event.target.checked)} disabled={props.disabled} />
        <span>[선택] <Link href={`/legal/marketing?audience=${props.audience}`} target="_blank">마케팅 정보 수신</Link>에 동의합니다. 동의하지 않아도 가입할 수 있습니다.</span>
      </label>

      <style jsx>{`
        .policyBox{display:grid;gap:11px;margin:20px 0;padding:16px;border:1px solid #d9e2ef;border-radius:14px;background:#f8fafc}
        .policyBox :global(a){color:#2457d6;font-weight:900;text-decoration:underline;text-underline-offset:2px}
        .policyNotice{margin:0 0 2px;color:#667085;font-size:12px;line-height:1.55}
        .policyCheck{display:flex;align-items:flex-start;gap:9px;color:#344054;font-size:13px;font-weight:700;line-height:1.5;cursor:pointer}
        .policyCheck input{width:18px;height:18px;margin:1px 0 0;flex:0 0 auto;accent-color:#2457d6}
      `}</style>
    </section>
  );
}
