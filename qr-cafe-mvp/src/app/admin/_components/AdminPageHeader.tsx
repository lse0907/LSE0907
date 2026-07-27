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
          <Link className={styles.headerButton} href={homeHref}><span className={styles.desktopHomeLabel}>관리자 홈</span><span className={styles.mobileHomeLabel}>홈</span></Link>
        </div>
      </div>
    </header>
  );
}
