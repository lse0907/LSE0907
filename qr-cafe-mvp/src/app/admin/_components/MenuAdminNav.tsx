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

export default function MenuAdminNav({ active, storeId }: MenuAdminNavProps) {
  const query = storeId ? `?store=${encodeURIComponent(storeId)}` : "";

  return (
    <nav className={styles.nav} aria-label="메뉴 관리 페이지 이동">
      {primaryItems.map((item) => (
        <Link
          key={item.key}
          href={`${item.href}${query}`}
          className={`${styles.link} ${active === item.key ? styles.active : ""}`}
          aria-current={active === item.key ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
