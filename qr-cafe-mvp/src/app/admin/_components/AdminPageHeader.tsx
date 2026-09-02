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
          <Link className={styles.headerButton} href={`/account/privacy?from=admin${storeId ? `&store=${encodeURIComponent(storeId)}` : ""}`}>
            <span>계정·개인정보</span>
          </Link>
          <Link className={styles.headerButton} href={homeHref} aria-label="관리자 홈으로 이동">
            <svg className={styles.homeIcon} viewBox="0 0 20 20" aria-hidden="true"><path d="M3 9.2 10 3l7 6.2v7.3a.5.5 0 0 1-.5.5h-4.2v-5H7.7v5H3.5a.5.5 0 0 1-.5-.5V9.2Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
            <span>관리자 홈</span>
          </Link>
          <Link className={styles.headerButton} href="/logout" aria-label="로그아웃">
            <svg className={styles.logoutIcon} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" /><path d="M12.5 6.5 16 10l-3.5 3.5M7 10h9" /></svg>
            <span>로그아웃</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
