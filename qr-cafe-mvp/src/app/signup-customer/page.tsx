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

function SignupCustomerPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialError = sp.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string>(initialError || "");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    if (!email.trim() || !password) return "이메일과 비밀번호를 입력해주세요.";
    const passwordError = getPasswordPolicyError(password);
    if (passwordError) return passwordError;
    if (!name.trim()) return "이름을 입력해주세요.";
    if (!phone.trim()) return "전화번호를 입력해주세요.";
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
    );

    if (signUpErr) {
      setLoading(false);
      setMsg(formatPasswordAuthError(signUpErr, "회원가입에 실패했습니다."));
      return;
    }

    if (!signUpData?.sessionEstablished) {
      setLoading(false);
      setMsg("가입 확인 이메일을 확인한 뒤 로그인해주세요.");
      return;
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      setLoading(false);
      setMsg("로그인 사용자 정보를 가져오지 못했어요. 다시 로그인 후 시도해주세요.");
      return;
    }

    const userId = userData.user.id;
    const { error: profileErr } = await supabase.from("customer_profiles").upsert(
      {
        user_id: userId,
        name: name.trim(),
        phone: phone.trim(),
      },
      { onConflict: "user_id" }
    );

    setLoading(false);

    if (profileErr) {
      setMsg(`고객정보 저장 실패: ${profileErr.message}`);
      return;
    }

    router.push("/me");
  };

  return (
    <AuthShell eyebrow="CUSTOMER ACCOUNT" title="고객 회원가입" description="간편하게 가입하고 매장별 포인트와 쿠폰 혜택을 받아보세요." footer={<><Link href="/signup">가입 유형 다시 선택</Link><span> · </span><Link href="/login">로그인</Link></>}>
      {msg ? <p className="authMessage" role="alert">{msg}</p> : null}
      <form onSubmit={onSubmit}>
        <p className="authSectionTitle">계정 정보</p>
        <label className="authField">이메일<input className="authInput" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required placeholder="example@email.com" /></label>
        <label className="authField">비밀번호<input className="authInput" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} aria-describedby="customer-password-policy" placeholder="10자 이상 · 소문자/숫자/특수문자" /><span id="customer-password-policy" className="authHint">{PASSWORD_POLICY_MESSAGE}</span></label>
        <div className="authDivider" />
        <p className="authSectionTitle">기본 정보</p>
        <label className="authField">이름<input className="authInput" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required placeholder="이름을 입력해 주세요" /></label>
        <label className="authField">전화번호<input className="authInput" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required placeholder="010-0000-0000" /></label>
        <button type="submit" disabled={loading} className="authButton">
          {loading ? "가입 처리 중..." : "가입하고 혜택 받기"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function SignupCustomerPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <SignupCustomerPageInner />
    </Suspense>
  );
}
