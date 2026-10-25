import type { NextRequest } from "next/server";

export type MenuSetupScope = "preview" | "admin";
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);

function configuredOrigin(): string | null {
  try {
    const value = process.env.MENU_SETUP_ORIGIN || "";
    const url = new URL(value);
    // An explicit deployment origin, never a client Host/Forwarded header.
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || loopback.has(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function menuSetupRouteEnabled(scope: MenuSetupScope): boolean {
  if (scope === "preview") return process.env.NODE_ENV === "development";
  if (process.env.NODE_ENV === "development") return true;
  return process.env.NODE_ENV === "production" && process.env.MENU_SETUP_ENABLED === "true"
    && process.env.NEXT_PUBLIC_MENU_SETUP_ENABLED === "true" && configuredOrigin() !== null;
}

export function menuSetupOriginAllowed(req: NextRequest, scope: MenuSetupScope): boolean {
  try {
    const value = req.headers.get("origin") || "";
    const origin = new URL(value);
    // Reject URLs masquerading as Origin headers (credentials, paths, queries).
    if (value !== origin.origin) return false;
    const target = req.nextUrl;
    if (process.env.NODE_ENV === "development") {
      return loopback.has(origin.hostname) && loopback.has(target.hostname)
        && origin.protocol === target.protocol && origin.port === target.port;
    }
    const expected = configuredOrigin();
    return scope === "admin" && menuSetupRouteEnabled(scope) && expected !== null
      && origin.origin === expected && target.origin === expected;
  } catch { return false; }
}
