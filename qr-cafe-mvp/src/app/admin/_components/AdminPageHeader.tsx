"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import RionBrand from "@/app/components/RionBrand";
import styles from "./AdminPageHeader.module.css";

type AdminPageHeaderProps = {
  title: string;
  description: string;
  storeId?: string | null;
  storeName?: string | null;
  eyebrow?: string;
  actions?: ReactNode;
};

export default function AdminPageHeader({ title, description, storeId, storeName, eyebrow = "STORE ADMIN", actions }: AdminPageHeaderProps) {
  const homeHref = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin";

  return (
    <header className={styles.adminPageHeader}>
      <div className={styles.brandLine}>
        <RionBrand product admin compact />
        <span className={styles.workspaceBadge}>{eyebrow}</span>
      </div>
      <div className={styles.pageLine}>
        <div className={styles.pageCopy}>
          <span className={styles.mobileEyebrow}>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
          {storeName || storeId ? <span className={styles.storeChip}>현재 매장 · {storeName || storeId}</span> : null}
        </div>
        <div className={styles.headerActions}>
          {actions}
          <Link className={styles.headerButton} href={homeHref} aria-label="관리자 홈으로 이동">
            <svg className={styles.homeIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.2 10 3l7 6.2v7.3a.5.5 0 0 1-.5.5h-4.2v-5H7.7v5H3.5a.5.5 0 0 1-.5-.5V9.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
            <span>관리자 홈</span>
          </Link>
          <details className={styles.accountMenu}>
            <summary className={styles.headerButton} aria-label="계정 메뉴 열기">
              <span className={styles.profileAvatar} aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="6.2" r="3" /><path d="M3.8 17c.8-3.1 3.1-4.8 6.2-4.8s5.4 1.7 6.2 4.8" /></svg>
              </span>
              <span className={styles.profileCopy}><strong>내 계정</strong></span>
            </summary>
            <div className={styles.accountMenuList}>
              <div className={styles.accountMenuHeading}>개인 계정 관리</div>
              <Link href={`/account?from=admin${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`}>내 계정</Link>
              <Link href={`/account/privacy?from=account${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`}>개인정보·탈퇴 관리</Link>
              <Link href="/logout">로그아웃</Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
