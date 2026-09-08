"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import AuthShell from "@/app/_components/AuthShell";
import SignupPolicyConsent from "@/app/_components/SignupPolicyConsent";
import { supabase } from "@/app/lib/supabaseClient";

type Audience = "customer" | "owner";

function AddServiceContent({ params }: { params: Promise<{ audience: string }> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const localPreview = process.env.NODE_ENV !== "production" && searchParams.get("preview") === "1";
  const rawAudience = use(params).audience;
  const audience: Audience | null = rawAudience === "customer" || rawAudience === "owner" ? rawAudience : null;
  const isOwner = audience === "owner";
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [minimumAgeConfirmed, setMinimumAgeConfirmed] = useState(false);
  const [businessAuthorityConfirmed, setBusinessAuthorityConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyNoticeAcknowledged, setPrivacyNoticeAcknowledged] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (localPreview) {
      const timer = window.setTimeout(() => {
        setEmail("rion@example.com");
        setChecking(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        const next = audience ? `/account/services/add/${audience}` : "/";
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setEmail(data.user.email || "");
      setChecking(false);
    })();
  }, [audience, localPreview, router]);

  if (!audience) return <main style={{ padding: 32 }}>지원하지 않는 서비스입니다.</main>;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch("/api/account/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, minimumAgeConfirmed: isOwner ? minimumAgeConfirmed : true, businessAuthorityConfirmed, termsAccepted, privacyNoticeAcknowledged, marketingConsent }),
      });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; next?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "서비스를 추가하지 못했습니다.");
      router.replace(payload.next || "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "서비스를 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow={isOwner ? "START BUSINESS" : "ADD CUSTOMER SERVICE"}
      title={isOwner ? "사업자 서비스 이용 신청" : "고객 서비스 이용 신청"}
      description={isOwner ? "현재 계정으로 사업자 서비스를 이용하기 위한 약관을 확인합니다." : "현재 계정으로 주문·포인트·쿠폰 서비스를 이용하기 위한 약관을 확인합니다."}
      footer={<Link href="/">서비스 선택으로 돌아가기</Link>}
    >
      {message ? <p className="authMessage" role="alert">{message}</p> : null}
      {checking ? <p className="authMessage">계정을 확인하고 있습니다.</p> : (
        <form onSubmit={submit}>
          <div className="roleIdentity"><span>현재 로그인 계정</span><strong>{email}</strong></div>
          <SignupPolicyConsent
            audience={audience}
            minimumAgeConfirmed={isOwner ? minimumAgeConfirmed : true}
            onMinimumAgeChange={setMinimumAgeConfirmed}
            businessAuthorityConfirmed={businessAuthorityConfirmed}
            onBusinessAuthorityChange={setBusinessAuthorityConfirmed}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            privacyNoticeAcknowledged={privacyNoticeAcknowledged}
            onPrivacyNoticeChange={setPrivacyNoticeAcknowledged}
            marketingConsent={marketingConsent}
            onMarketingConsentChange={setMarketingConsent}
            disabled={busy}
          />
          <button className="authButton" type="submit" disabled={busy}>{busy ? "처리 중..." : isOwner ? "사업자 인증 신청으로 계속" : "고객 서비스 이용 시작"}</button>
        </form>
      )}
      <style jsx>{`.roleIdentity{display:grid;gap:4px;margin-bottom:22px;padding:14px 15px;border:1px solid #dce4ef;border-radius:14px;background:#f7f9fc}.roleIdentity span{color:#667085;font-size:11px;font-weight:800}.roleIdentity strong{overflow:hidden;color:#173e73;font-size:13px;text-overflow:ellipsis}`}</style>
    </AuthShell>
  );
}

export default function AddServicePage({ params }: { params: Promise<{ audience: string }> }) {
  return <Suspense fallback={<main style={{ padding: 32 }}>서비스 추가 화면을 준비하고 있습니다.</main>}><AddServiceContent params={params} /></Suspense>;
}
