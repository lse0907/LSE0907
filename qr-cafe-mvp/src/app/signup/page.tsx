"use client";

import Link from "next/link";
import AuthShell from "@/app/_components/AuthShell";
import styles from "./SignupChooser.module.css";

export default function SignupChooserPage() {
  return (
    <AuthShell compact eyebrow="CREATE ACCOUNT" title="회원가입" description="이용 목적에 맞는 계정을 선택해 주세요." footer={<><Link href="/login">이미 계정이 있으신가요? 로그인</Link><span> · </span><Link href="/">서비스 홈</Link></>}>
      <div className={styles.accountGrid}>
        <Link href="/signup-customer" className={`${styles.accountCard} ${styles.customerCard}`}>
          <span className={styles.accountIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.2-6 7-6s6.2 2 7 6"/><path d="M18.7 6.2c1.8-1.7 4.3.7 2.5 2.5l-2.5 2.4-2.5-2.4c-1.8-1.8.7-4.2 2.5-2.5Z"/></svg></span>
          <span className={styles.cardCopy}><span className={styles.cardTop}><strong>고객으로 가입</strong><em>개인</em></span><small>주문 내역을 확인하고 매장별 포인트와 쿠폰 혜택을 받아보세요.</small><span className={styles.features}>포인트 · 쿠폰 · 주문 내역</span></span>
          <span className={styles.arrow} aria-hidden="true">›</span>
        </Link>
        <Link href="/signup-owner" className={`${styles.accountCard} ${styles.ownerCard}`}>
          <span className={styles.accountIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M8 20v-6h8v6"/><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2"/></svg></span>
          <span className={styles.cardCopy}><span className={styles.cardTop}><strong>점주로 가입</strong><em>비즈니스</em></span><small>매장을 만들고 메뉴, 주문, 직원과 운영 현황을 관리하세요.</small><span className={styles.features}>매장 · 메뉴 · 주문 운영</span></span>
          <span className={styles.arrow} aria-hidden="true">›</span>
        </Link>
      </div>
    </AuthShell>
  );
}
