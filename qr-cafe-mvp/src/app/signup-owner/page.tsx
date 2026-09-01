"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import Link from "next/link";
import AuthShell from "@/app/_components/AuthShell";
import {
  formatPasswordAuthError,
  getPasswordPolicyError,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "@/app/lib/passwordPolicy";
import { signUpWithPasswordPolicy } from "@/app/lib/signUpWithPasswordPolicy";
import SignupPolicyConsent from "@/app/_components/SignupPolicyConsent";

function SignupOwnerPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [minimumAgeConfirmed, setMinimumAgeConfirmed] = useState(false);
  const [businessAuthorityConfirmed, setBusinessAuthorityConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyNoticeAcknowledged, setPrivacyNoticeAcknowledged] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (!email.trim() || !password) return "이메일과 비밀번호를 입력해주세요.";
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) return passwordError;
    if (!name.trim()) return "이름을 입력해주세요.";
    if (!phone.trim()) return "전화번호를 입력해주세요.";
    if (!minimumAgeConfirmed) return "만 19세 이상 확인이 필요합니다.";
    if (!businessAuthorityConfirmed) return "사업자 대표자 또는 위임받은 담당자 확인이 필요합니다.";
    if (!termsAccepted || !privacyNoticeAcknowledged) return "이용정책 동의와 개인정보 처리 안내 확인이 필요합니다.";
    return "";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg("");

    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }

    setLoading(true);

    const { data: signUpData, error: signUpErr } = await signUpWithPasswordPolicy(
      email.trim(),
      password,
      {
        audience: "owner",
        minimumAgeConfirmed,
        businessAuthorityConfirmed,
        termsAccepted,
        privacyNoticeAcknowledged,
        marketingConsent,
      },
      referralCode.trim(),
    );

    if (signUpErr) {
      setLoading(false);
      setMsg(formatPasswordAuthError(signUpErr, "회원가입에 실패했습니다."));
      return;
    }

    if (!signUpData?.sessionEstablished) {
      setLoading(false);
      setMsg(signUpData?.referralWarning || "가입 확인 이메일을 확인한 뒤 로그인해주세요.");
      return;
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      setLoading(false);
      setMsg("로그인 사용자 정보를 가져오지 못했어요. 다시 로그인 후 시도해주세요.");
      return;
    }
    const userId = userData.user.id;

    const { error: profileErr } = await supabase.from("profiles").upsert(
      {
        user_id: userId,
        name: name.trim(),
        phone: phone.trim(),
      },
      { onConflict: "user_id" }
    );

    setLoading(false);

    if (profileErr) {
      setMsg(`회원정보 저장 실패: ${profileErr.message}`);
      return;
    }

    if (signUpData.referralWarning) {
      setMsg(signUpData.referralWarning);
      return;
    }

    router.push("/admin");
  };

  return (
    <AuthShell eyebrow="OWNER ACCOUNT" title="점주 회원가입" description="점주 계정을 만든 다음 매장 정보와 메뉴 설정을 이어갈 수 있습니다." footer={<><Link href="/signup">가입 유형 다시 선택</Link><span> · </span><Link href="/login">로그인</Link></>}>
      {msg ? <p className="authMessage" role="alert">{msg}</p> : null}
      <form onSubmit={onSubmit}>
        <p className="authSectionTitle">계정 정보</p>
        <label className="authField">이메일<input className="authInput" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required placeholder="example@email.com" /></label>
        <label className="authField">비밀번호<input className="authInput" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} aria-describedby="owner-password-policy" placeholder="10자 이상 · 소문자/숫자/특수문자" /><span id="owner-password-policy" className="authHint">{PASSWORD_POLICY_MESSAGE}</span></label>
        <label className="authField">추천코드 (선택)<input className="authInput" value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))} autoCapitalize="characters" autoComplete="off" placeholder="코드 입력 시 첫 구독 3,000원 할인" /></label>
        <div className="authDivider" />
        <p className="authSectionTitle">대표자 정보</p>
        <label className="authField">이름<input className="authInput" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="이름을 입력해 주세요" /></label>
        <label className="authField">전화번호<input className="authInput" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required placeholder="010-0000-0000" /></label>
        <p className="authHint">개인 거주지 주소는 수집하지 않습니다. 매장 주소는 매장 등록 단계에서 별도로 입력합니다.</p>
        <SignupPolicyConsent
          audience="owner"
          minimumAgeConfirmed={minimumAgeConfirmed}
          onMinimumAgeChange={setMinimumAgeConfirmed}
          businessAuthorityConfirmed={businessAuthorityConfirmed}
          onBusinessAuthorityChange={setBusinessAuthorityConfirmed}
          termsAccepted={termsAccepted}
          onTermsChange={setTermsAccepted}
          privacyNoticeAcknowledged={privacyNoticeAcknowledged}
          onPrivacyNoticeChange={setPrivacyNoticeAcknowledged}
          marketingConsent={marketingConsent}
          onMarketingConsentChange={setMarketingConsent}
          disabled={loading}
        />
        <button type="submit" disabled={loading} className="authButton">
          {loading ? "가입 처리 중..." : "점주 계정 만들기"}
        </button>
      </form>

    </AuthShell>
  );
}

export default function SignupOwnerPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <SignupOwnerPageInner />
    </Suspense>
  );
}
