import Link from "next/link";
import type { ReactNode } from "react";

import RionBrand from "@/app/components/RionBrand";
import { SIGNUP_POLICY_VERSION } from "@/app/lib/signupPolicy";

export default function LegalPolicyPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="legalWrap">
      <div className="legalBrand">
        <Link href="/" aria-label="RION Order 홈"><RionBrand product auth /></Link>
        <Link className="signupLink" href="/signup">가입 화면으로</Link>
      </div>
      <header className="legalHeader">
        <p className="eyebrow">RION ORDER POLICY</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="versionRow"><span>문서 버전 {SIGNUP_POLICY_VERSION}</span><span>법률 검토 전 운영정책</span></div>
      </header>
      <aside className="draftNotice"><strong>중요</strong><span>이 문서는 확정된 서비스 운영정책을 가입 화면에 연결하기 위한 검토본입니다. 정식 공개 전 법률 검토 결과와 확정 사업자 정보를 반영하여 새 버전으로 교체합니다.</span></aside>
      <article className="legalBody">{children}</article>
      <nav className="legalNav" aria-label="정책 문서">
        <Link href="/legal/terms?audience=customer">고객 이용정책</Link>
        <Link href="/legal/terms?audience=owner">사업자 이용정책</Link>
        <Link href="/legal/privacy">개인정보 처리 안내</Link>
        <Link href="/legal/marketing">마케팅 수신 안내</Link>
        <Link href="/legal/subscription-billing">구독·결제·환불 정책</Link>
        <Link href="/legal/customer-benefits">주문·포인트·쿠폰 정책</Link>
      </nav>
      <style>{`
        *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 8% 0%,rgba(37,99,235,.12),transparent 32rem),#f2f5fa;color:#172033;font-family:Inter,"Malgun Gothic","Apple SD Gothic Neo",sans-serif}.legalWrap{width:min(880px,100%);margin:auto;padding:28px 18px 72px}.legalBrand{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;padding:0 4px}.legalBrand>a:first-child{text-decoration:none}.signupLink{padding:9px 13px;border:1px solid #cfd9e7;border-radius:11px;background:rgba(255,255,255,.82);color:#173e73;font-size:12px;font-weight:900;text-decoration:none}.legalHeader,.legalBody,.draftNotice{background:#fff;border:1px solid #dce4ef;border-radius:20px;box-shadow:0 18px 46px rgba(15,35,66,.06)}.legalHeader{position:relative;overflow:hidden;padding:30px}.legalHeader:after{content:"";position:absolute;right:-45px;bottom:-65px;width:210px;aspect-ratio:1;background:url("/brand/rion-symbol-watermark-white.svg") center/contain no-repeat;filter:invert(16%) sepia(24%) saturate(1750%) hue-rotate(177deg);opacity:.035;pointer-events:none}.eyebrow{margin:0;color:#2b63ad;font-size:10px;font-weight:950;letter-spacing:.16em}.legalHeader h1{margin:9px 0;font-size:30px;letter-spacing:-.04em}.legalHeader>p:not(.eyebrow){max-width:660px;margin:0;color:#667085;font-weight:650;line-height:1.65}.versionRow{display:flex;flex-wrap:wrap;gap:8px;margin-top:19px}.versionRow span{padding:6px 9px;border-radius:999px;background:#eef4ff;color:#234ca5;font-size:10px;font-weight:850}.draftNotice{display:flex;gap:11px;margin:14px 0;padding:16px 18px;border-color:#f2d793;background:#fff9e9;color:#70410c;font-size:12px;line-height:1.65;box-shadow:none}.legalBody{padding:30px}.legalBody section+section{margin-top:27px;padding-top:24px;border-top:1px solid #e7edf4}.legalBody h2{margin:0 0 11px;color:#172a47;font-size:19px;letter-spacing:-.02em}.legalBody p,.legalBody li{color:#4e5d72;line-height:1.78}.legalBody ul{margin:8px 0;padding-left:21px}.legalNav{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.legalNav a{padding:10px 12px;border:1px solid #d4ddea;border-radius:11px;background:#fff;color:#31445f;font-size:11px;font-weight:850;text-decoration:none}.legalNav a:hover,.signupLink:hover{border-color:#8faaca;color:#0f356d}@media(max-width:600px){.legalWrap{padding:18px 12px 50px}.legalBrand{padding:0 6px}.signupLink{padding:8px 10px}.legalHeader,.legalBody{padding:20px}.legalHeader h1{font-size:25px}.draftNotice{display:grid}.legalNav{display:grid;grid-template-columns:1fr 1fr}.legalNav a{text-align:center}}
      `}</style>
    </main>
  );
}
