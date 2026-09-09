"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import RionBrand from "@/app/components/RionBrand";
import { supabase } from "@/app/lib/supabaseClient";

type Audience = "customer" | "owner";
type Role = { audience: Audience; status: string };
type Verification = { status: string; submitted_at?: string | null } | null;

type AccountResponse = {
  ok?: boolean;
  message?: string;
  roles?: Role[];
  businessVerification?: Verification;
};

const roleCopy: Record<Audience, { title: string; detail: string; icon: string }> = {
  customer: { title: "고객 서비스", detail: "주문 조회와 매장 이용", icon: "▦" },
  owner: { title: "사업자 서비스", detail: "매장 관리와 구독 운영", icon: "▣" },
};

const verificationCopy: Record<string, string> = {
  submitted: "사업자 인증 심사 중",
  changes_requested: "사업자 인증 보완 필요",
  approved: "사업자 인증 완료",
  rejected: "사업자 인증 확인 필요",
};

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [verification, setVerification] = useState<Verification>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fromAdmin = searchParams.get("from") === "admin";
  const storeId = String(searchParams.get("store") || "");
  const adminHref = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin";
  const privacyHref = `/account/privacy?from=account${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      const next = `/account${fromAdmin ? `?from=admin${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setEmail(data.user.email || "");
    const response = await fetch("/api/account/roles", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as AccountResponse;
    if (!response.ok || !payload.ok) setError(payload.message || "계정 정보를 불러오지 못했습니다.");
    else {
      setRoles(payload.roles || []);
      setVerification(payload.businessVerification || null);
    }
    setLoading(false);
  }, [fromAdmin, router, storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeRoles = useMemo(() => new Map(roles.filter((role) => role.status !== "withdrawn").map((role) => [role.audience, role])), [roles]);
  const addHref = (audience: Audience) => `/account/services/add/${audience}?from=account${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`;

  return (
    <main className="accountSurface">
      <div className="accountPage">
        <header className="accountBrand"><RionBrand product auth />{fromAdmin ? <Link href={adminHref}>매장 관리</Link> : <Link href="/me">고객 홈</Link>}</header>
        <section className="accountHero"><span>MY ACCOUNT</span><h1>내 계정</h1><p>로그인 정보와 이용 중인 서비스를 한곳에서 확인하고 관리합니다.</p></section>
        {error ? <p className="accountError" role="alert">{error}</p> : null}
        {loading ? <section className="accountCard loading">계정 상태를 확인하고 있습니다.</section> : <>
          <section className="accountCard"><h2>로그인 계정</h2><p className="sectionIntro">가입한 이메일은 계정 식별과 중요한 안내에 사용됩니다.</p><div className="identity"><span className="identityIcon" aria-hidden="true">●</span><div><b>{email || "이메일 정보를 확인할 수 없습니다."}</b><small>이메일 로그인 계정</small></div></div></section>
          <section className="accountCard"><h2>이용 중인 서비스</h2><p className="sectionIntro">하나의 이메일로 고객 서비스와 사업자 서비스를 함께 이용할 수 있습니다.</p><div className="serviceGrid">{(["customer", "owner"] as const).map((audience) => {
            const role = activeRoles.get(audience);
            const isOwner = audience === "owner";
            const verificationLabel = isOwner && verification ? verificationCopy[verification.status] || "사업자 인증 상태 확인 필요" : null;
            return <article className="serviceItem" key={audience}><div className="serviceTop"><div className="serviceName"><span aria-hidden="true">{roleCopy[audience].icon}</span>{roleCopy[audience].title}</div><em className={role ? "active" : "inactive"}>{role ? "이용 중" : "미이용"}</em></div><p>{role ? (verificationLabel || roleCopy[audience].detail) : "필요할 때 이 계정에 서비스를 추가할 수 있습니다."}</p>{role ? isOwner && verification && verification.status !== "approved" ? <Link className="smallAction" href="/account/business/start?from=account">인증 상태 확인</Link> : null : <Link className="smallAction" href={addHref(audience)}>{audience === "owner" ? "사업자 서비스 추가" : "고객 서비스 추가"}</Link>}</article>;
          })}</div></section>
          <section className="accountCard accountManage"><h2>개인정보·탈퇴</h2><p className="sectionIntro">개인정보 요청, 수신 설정, 서비스 또는 계정 탈퇴를 관리합니다.</p><Link className="privacyAction" href={privacyHref} style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 12, width: "100%", minHeight: 58, padding: "11px 14px", border: "1px solid #d6e4f5", borderRadius: 12, background: "#f6faff", color: "#1d477e", boxShadow: "none", textDecoration: "none" }}><span className="privacyIcon" aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "#e4f0ff", color: "#245a9f", flex: "0 0 auto" }}><svg viewBox="0 0 24 24" width="21" height="21" fill="none"><path d="M12 3.4 19 6v5.2c0 4.4-2.8 7.8-7 9.4-4.2-1.6-7-5-7-9.4V6l7-2.6Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M8.8 12.1 11 14.3l4.4-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></span><span className="privacyButtonLabel" style={{ color: "#1d477e", fontSize: 14, fontWeight: 850, letterSpacing: "-.01em" }}>개인정보·탈퇴 관리</span></Link></section>
        </>}
      </div>
      <style jsx>{`
        .accountSurface{min-height:100dvh;background:radial-gradient(circle at 8% 0%,rgba(45,103,183,.12),transparent 32rem),#f2f5fa;color:#172033}.accountPage{width:min(840px,100%);margin:0 auto;padding:26px 18px 70px}.accountBrand{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;padding:0 4px}.accountBrand :global(a){display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border:1px solid #d8e1ec;border-radius:11px;background:#fff;color:#334b6a;font-size:12px;font-weight:850;text-decoration:none}.accountHero{position:relative;overflow:hidden;padding:27px 28px;margin-bottom:16px;border:1px solid #dce4ef;border-radius:22px;background:#fff;box-shadow:0 18px 46px rgba(15,35,66,.07)}.accountHero:after{content:"";position:absolute;right:-52px;bottom:-78px;width:220px;aspect-ratio:1;background:url("/brand/rion-symbol-watermark-white.svg") center/contain no-repeat;filter:invert(16%) sepia(24%) saturate(1750%) hue-rotate(177deg);opacity:.035;pointer-events:none}.accountHero span{font-size:10px;font-weight:950;color:#2b63ad;letter-spacing:.15em}.accountHero h1{position:relative;margin:6px 0 8px;font-size:30px;letter-spacing:-.04em}.accountHero p{position:relative;max-width:570px;margin:0;color:#667085;font-weight:650;line-height:1.65}.accountCard{margin:14px 0;padding:22px;border:1px solid #dce4ef;border-radius:20px;background:#fff;box-shadow:0 14px 34px rgba(15,35,66,.055)}.accountCard h2{margin:0 0 7px;font-size:18px;letter-spacing:-.025em}.sectionIntro{margin:0 0 18px;color:#667085;font-size:13px;line-height:1.65}.identity{display:flex;align-items:center;gap:13px;padding:4px 0}.identityIcon{display:grid;place-items:center;width:44px;height:44px;border-radius:13px;background:#eaf2fd;color:#245797;font-size:17px}.identity b{display:block;overflow-wrap:anywhere;color:#173e73;font-size:15px}.identity small{display:block;margin-top:4px;color:#718096;font-size:12px}.serviceGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.serviceItem{min-height:128px;padding:15px;border:1px solid #e1e8f1;border-radius:13px;background:#fff}.serviceTop{display:flex;align-items:center;justify-content:space-between;gap:8px}.serviceName{display:flex;align-items:center;gap:8px;color:#243c61;font-size:15px;font-weight:850}.serviceName span{display:grid;place-items:center;width:21px;height:21px;color:#245797;font-size:16px}.serviceItem em{padding:4px 8px;border-radius:999px;font-size:10px;font-style:normal;font-weight:850;white-space:nowrap}.serviceItem em.active{background:#eaf8ee;color:#237247}.serviceItem em.inactive{background:#f0f3f7;color:#718096}.serviceItem p{min-height:38px;margin:11px 0;color:#667085;font-size:12px;line-height:1.55}.smallAction{display:inline-flex;padding:7px 9px;border-radius:8px;background:#eef4fd;color:#245797;font-size:11px;font-weight:850;text-decoration:none}.accountManage{padding-bottom:20px}.privacyAction{display:flex;align-items:center;justify-content:center;gap:13px;width:100%;min-height:64px;padding:14px 20px;border:1px solid #112e59;border-radius:12px;background:linear-gradient(135deg,#102b58,#173e73);color:#fff;box-shadow:0 10px 22px rgba(16,43,88,.18);text-decoration:none}.privacyAction:hover{background:linear-gradient(135deg,#173e73,#21528f)}.privacyIcon{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#fff;color:#173e73;box-shadow:0 2px 7px rgba(5,22,51,.2);flex:0 0 auto}.privacyIcon svg{display:block;width:22px;height:22px}.privacyButtonLabel{font-size:15px;font-weight:850;letter-spacing:-.01em}.accountError{padding:13px 15px;border-radius:12px;background:#fff1f2;color:#a31337}.loading{display:flex;align-items:center;min-height:100px;color:#526071}@media(max-width:560px){.accountPage{padding:18px 12px 52px}.accountBrand{padding:0 6px}.accountHero{padding:22px 18px}.accountHero h1{font-size:26px}.accountCard{padding:18px}.serviceGrid{grid-template-columns:1fr}.serviceItem{min-height:0}.privacyAction{min-height:62px}.accountBrand :global(a){font-size:11px;padding:0 10px}}
      `}</style>
    </main>
  );
}

export default function AccountPage() {
  return <Suspense fallback={<main style={{ padding: 32 }}>내 계정 화면을 준비하고 있습니다.</main>}><AccountContent /></Suspense>;
}
