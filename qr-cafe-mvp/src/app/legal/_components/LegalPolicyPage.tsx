import Link from "next/link";
import type { ReactNode } from "react";

import { SIGNUP_POLICY_VERSION } from "@/app/lib/signupPolicy";

export default function LegalPolicyPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="legalWrap">
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
        <Link href="/legal/terms?audience=owner">점주 이용정책</Link>
        <Link href="/legal/privacy">개인정보 처리 안내</Link>
        <Link href="/legal/marketing">마케팅 수신 안내</Link>
        <Link href="/legal/subscription-billing">구독·결제·환불 정책</Link>
        <Link href="/legal/customer-benefits">주문·포인트·쿠폰 정책</Link>
      </nav>
      <style>{`
        *{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:#172033;font-family:Arial,"Noto Sans KR",sans-serif}.legalWrap{width:min(840px,100%);margin:auto;padding:36px 18px 70px}.legalHeader,.legalBody,.draftNotice{background:#fff;border:1px solid #e2e7ef;border-radius:18px}.legalHeader{padding:28px}.eyebrow{margin:0;color:#2457d6;font-size:11px;font-weight:900;letter-spacing:1.6px}.legalHeader h1{margin:8px 0;font-size:30px}.legalHeader>p:not(.eyebrow){margin:0;color:#667085;line-height:1.6}.versionRow{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.versionRow span{padding:6px 9px;border-radius:999px;background:#eef4ff;color:#234ca5;font-size:11px;font-weight:800}.draftNotice{display:flex;gap:10px;margin:14px 0;padding:15px 18px;border-color:#fedf89;background:#fffaeb;color:#7a2e0e;font-size:13px;line-height:1.55}.legalBody{padding:28px}.legalBody section+section{margin-top:27px;padding-top:24px;border-top:1px solid #eaecf0}.legalBody h2{margin:0 0 11px;font-size:19px}.legalBody p,.legalBody li{color:#475467;line-height:1.75}.legalBody ul{margin:8px 0;padding-left:21px}.legalNav{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.legalNav a{padding:9px 12px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:#344054;font-size:12px;font-weight:800;text-decoration:none}@media(max-width:600px){.legalWrap{padding:18px 12px 48px}.legalHeader,.legalBody{padding:20px}.legalHeader h1{font-size:25px}.draftNotice{display:grid}}
      `}</style>
    </main>
  );
}
