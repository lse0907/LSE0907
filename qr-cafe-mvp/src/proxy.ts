import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type AuthClaims = {
  sub?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function createSupabaseProxyClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  return {
    supabase,
    getResponse: () => response,
  };
}

function redirectWithAuthCookies(url: URL, authResponse: NextResponse) {
  const response = NextResponse.redirect(url);

  authResponse.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });

  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

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

  const { supabase, getResponse } = createSupabaseProxyClient(request);
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as AuthClaims | undefined;
  const uid = typeof claims?.sub === "string" ? claims.sub : null;
  const isLoggedIn = Boolean(uid);

  if (isProtected && !isLoggedIn) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/ops") ? "/ops/login" : "/login";
    url.searchParams.set("next", pathname + (request.nextUrl.search || ""));
    return redirectWithAuthCookies(url, getResponse());
  }

  if (isAuthPage && isLoggedIn) {
    const next = (searchParams.get("next") || "").trim();
    const url = request.nextUrl.clone();

    if (next && next.startsWith("/") && !next.startsWith("//")) {
      const nextUrl = new URL(next, request.nextUrl.origin);
      url.pathname = nextUrl.pathname;
      url.search = nextUrl.search;
      return redirectWithAuthCookies(url, getResponse());
    }

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

    const isShared = claims?.user_metadata?.is_shared_store_account === true;
    const canUseCustomer = hasCustomerProfile && !isShared;
    const canUseAdmin = roles.includes("owner");
    const canUseStaff = roles.some((role) => role === "owner" || role === "manager" || role === "staff");
    const canUseOps = String(claims?.app_metadata?.role || "") === "ops";
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
    return redirectWithAuthCookies(url, getResponse());
  }

  return getResponse();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/staff/:path*",
    "/onboarding/:path*",
    "/me/:path*",
    "/ops/:path*",
    "/login",
    "/signup",
    "/signup-owner",
    "/signup-customer",
  ],
};
