import Link from "next/link";
import styles from "./MenuAdminNav.module.css";

type MenuAdminNavProps = {
  active: "categories" | "options" | "menu" | "connect" | "import";
  storeId?: string | null;
};

const primaryItems = [
  { key: "categories", label: "카테고리", href: "/admin/categories" },
  { key: "options", label: "옵션", href: "/admin/options" },
  { key: "menu", label: "메뉴", href: "/admin/menu" },
] as const;

const toolItems = [
  {
    key: "connect",
    label: "옵션 연결 점검",
    description: "연결 누락 확인 및 일괄 정리",
    href: "/admin/menu/option-connect",
  },
  {
    key: "import",
    label: "CSV 일괄 등록",
    description: "파일로 여러 항목을 빠르게 등록",
    href: "/admin/import",
  },
] as const;

export default function MenuAdminNav({ active, storeId }: MenuAdminNavProps) {
  const query = storeId ? `?store=${encodeURIComponent(storeId)}` : "";
  const toolActive = active === "connect" || active === "import";

  return (
    <nav className={styles.workspaceNav} aria-label="메뉴 관리 페이지 이동">
      <div className={styles.primaryNav}>
        {primaryItems.map((item) => (
          <Link
            key={item.key}
            href={`${item.href}${query}`}
            className={`${styles.primaryLink} ${active === item.key ? styles.active : ""}`}
            aria-current={active === item.key ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <details
        className={`${styles.tools} ${toolActive ? styles.toolsActive : ""}`}
        open={toolActive || undefined}
      >
        <summary className={styles.toolsSummary}>
          <span>
            <span className={styles.toolsEyebrow}>UTILITY</span>
            <strong>관리 도구</strong>
          </span>
          <span className={styles.toolsChevron} aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className={styles.toolMenu}>
          {toolItems.map((item) => (
            <Link
              key={item.key}
              href={`${item.href}${query}`}
              className={`${styles.toolLink} ${active === item.key ? styles.toolLinkActive : ""}`}
              aria-current={active === item.key ? "page" : undefined}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
