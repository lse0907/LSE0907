import type { ReactNode } from "react";
import RionBrand from "@/app/components/RionBrand";
import styles from "./AuthShell.module.css";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
};

export default function AuthShell({ eyebrow, title, description, children, footer, compact = false }: AuthShellProps) {
  return (
    <main className={styles.page}>
      <section className={`${styles.shell} ${compact ? styles.compact : ""}`}>
        <aside className={styles.brandPanel} aria-label="RION Order 소개">
          <RionBrand product auth inverse />
          <div className={styles.brandCopy}>
            <span>ORDER &amp; STORE PLATFORM</span>
            <strong>주문과 매장 운영을<br />하나의 흐름으로 연결합니다.</strong>
            <p>고객의 주문부터 점주의 매장 관리까지 쉽고 안전하게 시작하세요.</p>
          </div>
          <div className={styles.brandMeta}>RION ORDER · SECURE ACCOUNT</div>
        </aside>
        <div className={styles.formPanel}>
          <header className={styles.header}>
            <span className={styles.mobileBrand}><RionBrand product auth /></span>
            <span className={styles.eyebrow}>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          <div className={styles.content}>{children}</div>
          {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
      </section>
    </main>
  );
}
