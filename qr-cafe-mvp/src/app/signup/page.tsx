"use client";

import Link from "next/link";
import AuthShell from "@/app/_components/AuthShell";

export default function SignupChooserPage() {
  return (
    <AuthShell compact eyebrow="CREATE ACCOUNT" title="회원가입" description="이용 목적에 맞는 계정을 선택해 주세요." footer={<><Link href="/login">이미 계정이 있으신가요? 로그인</Link><span> · </span><Link href="/">서비스 홈</Link></>}>
      <div className="accountGrid">
        <Link href="/signup-customer" className="accountCard customerCard">
          <span className="accountIcon" aria-hidden="true">♡</span>
          <span><strong>고객으로 가입</strong><small>주문 내역을 확인하고 매장별 포인트와 쿠폰 혜택을 받아보세요.</small></span>
          <span className="arrow" aria-hidden="true">›</span>
        </Link>
        <Link href="/signup-owner" className="accountCard ownerCard">
          <span className="accountIcon" aria-hidden="true">▣</span>
          <span><strong>점주로 가입</strong><small>매장을 만들고 메뉴, 주문, 직원과 운영 현황을 관리하세요.</small></span>
          <span className="arrow" aria-hidden="true">›</span>
        </Link>
      </div>
      <style jsx>{`.accountGrid{display:grid;gap:11px}.accountCard{min-height:105px;padding:16px;display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:12px;border:1px solid #dce4ef;border-radius:16px;color:#172640;text-decoration:none;transition:.17s}.accountCard:hover{border-color:#9db7da;box-shadow:0 9px 22px rgba(26,58,99,.09);transform:translateY(-1px)}.accountIcon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:#edf4ff;color:#215eaa;font-size:20px;font-weight:900}.ownerCard .accountIcon{background:#102342;color:#fff}.accountCard>span:nth-child(2){display:grid;gap:5px}.accountCard strong{font-size:15px}.accountCard small{color:#69788d;font-size:11px;font-weight:700;line-height:1.5}.arrow{color:#8ea0b7;font-size:24px}@media(max-width:420px){.accountCard{min-height:96px;padding:13px}.accountIcon{width:36px;height:36px}}`}</style>
    </AuthShell>
  );
}
