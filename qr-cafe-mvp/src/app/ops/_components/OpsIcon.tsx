import type { ReactNode, SVGProps } from "react";

export type OpsIconName =
  | "home"
  | "refresh"
  | "logout"
  | "dashboard"
  | "store"
  | "card"
  | "support"
  | "settings"
  | "shield"
  | "privacy";

type OpsIconProps = SVGProps<SVGSVGElement> & { name: OpsIconName; title?: string };

const paths: Record<OpsIconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z" /><path d="M8 21h8" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10" /><path d="M3 4v6h6" /><path d="M4 13a8 8 0 0 0 14.9 3.8L21 14" /><path d="M21 20v-6h-6" /></>,
  logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /><path d="m14 8 4 4-4 4" /><path d="M18 12H8" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  store: <><path d="M3 10h18" /><path d="m5 10 1-6h12l1 6" /><path d="M5 10v10h14V10" /><path d="M9 20v-5h6v5" /><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></>,
  support: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><path d="M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2Z" /><path d="M20 14a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z" /><path d="M17 19c-1 1.3-2.7 2-5 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3.2h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3.5h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V13h-.2a1.7 1.7 0 0 0-1.5 2Z" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.8 2.9 8.6 7 10 4.1-1.4 7-5.2 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  privacy: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></>,
};

export default function OpsIcon({ name, title, ...props }: OpsIconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...props}>{title ? <title>{title}</title> : null}{paths[name]}</svg>;
}
