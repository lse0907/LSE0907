// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabaseMiddlewareClient(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: Record<string, unknown>) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  return { supabase, res };
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  const isProtected =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/staff") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/me") ||
    (pathname.startsWith("/ops") && pathname !== "/ops/login");

  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/signup-owner") ||
    pathname.startsWith("/signup-customer");

  const { supabase, res } = createSupabaseMiddlewareClient(req);

  // 세션 확인 (쿠키 기반)
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = !!data?.user;

  // 보호 구간: 로그인 없으면 /login
  if (isProtected && !isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.startsWith("/ops") ? "/ops/login" : "/login";
    // 원래 가려던 곳 리턴용
    url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  // 로그인 상태에서 login/signup 접근하면 역할에 맞는 기본 페이지로 이동
  if (isAuthPage && isLoggedIn) {
    const next = (searchParams.get("next") || "").trim();
    const url = req.nextUrl.clone();

    if (next && next.startsWith("/") && !next.startsWith("//")) {
      const nextUrl = new URL(next, req.nextUrl.origin);
      url.pathname = nextUrl.pathname;
      url.search = nextUrl.search;
      return NextResponse.redirect(url);
    }

    const uid = data?.user?.id || null;
    let roles: string[] = [];
    let hasCustomerProfile = false;

    if (uid) {
      const [memberResult, customerResult] = await Promise.all([
        supabase.from("store_members").select("role").eq("user_id", uid).limit(20),
        supabase.from("customer_profiles").select("user_id").eq("user_id", uid).maybeSingle(),
      ]);
      roles = (memberResult.data || []).map((row) => String(row.role || "").toLowerCase());
      hasCustomerProfile = Boolean(customerResult.data);
    }

    const isShared = data.user?.user_metadata?.is_shared_store_account === true;
    const canUseCustomer = hasCustomerProfile && !isShared;
    const canUseAdmin = roles.includes("owner");
    const canUseStaff = roles.some((role) => role === "owner" || role === "manager" || role === "staff");
    const canUseOps = String(data.user?.app_metadata?.role || "") === "ops";
    const destinationCount = [canUseCustomer, canUseAdmin, canUseStaff, canUseOps].filter(Boolean).length;
    url.pathname = destinationCount > 1
      ? "/"
      : canUseOps
        ? "/ops"
        : canUseAdmin
          ? "/admin"
          : canUseStaff
            ? "/staff"
            : "/me";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/staff/:path*", "/onboarding/:path*", "/me/:path*", "/ops/:path*", "/login", "/signup", "/signup-owner", "/signup-customer"],
};
