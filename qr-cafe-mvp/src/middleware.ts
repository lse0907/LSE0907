// src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function createSupabaseMiddlewareClient(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
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
    pathname.startsWith("/onboarding");

  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");

  const { supabase, res } = createSupabaseMiddlewareClient(req);

  // 세션 확인 (쿠키 기반)
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = !!data?.user;

  // 보호 구간: 로그인 없으면 /login
  if (isProtected && !isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // 원래 가려던 곳 리턴용
    url.searchParams.set("next", pathname + (req.nextUrl.search || ""));
    return NextResponse.redirect(url);
  }

  // 로그인 상태에서 login/signup 접근하면 admin으로 보내기(선택)
  if (isAuthPage && isLoggedIn) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin";
    // 혹시 next가 있으면 그쪽으로
    const next = searchParams.get("next");
    if (next) url.pathname = next;
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/staff/:path*", "/onboarding/:path*", "/login", "/signup"],
};
