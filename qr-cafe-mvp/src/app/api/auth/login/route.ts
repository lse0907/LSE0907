import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type LoginRequest = {
  email?: unknown;
  password?: unknown;
};

type AuthCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

function json(body: unknown, status = 200, authCookies: AuthCookie[] = []) {
  const response = NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });

  authCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  return response;
}

export async function POST(request: NextRequest) {
  let body: LoginRequest;

  try {
    body = (await request.json()) as LoginRequest;
  } catch {
    return json({ error: { message: "요청 형식이 올바르지 않습니다." } }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return json({ error: { message: "이메일과 비밀번호를 입력해주세요." } }, 400);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: { message: "인증 서비스 설정을 확인할 수 없습니다." } }, 500);
  }

  const authCookies: AuthCookie[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        authCookies.push(...cookiesToSet);
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const status =
      typeof error?.status === "number" && error.status >= 400 && error.status < 500
        ? error.status
        : 401;
    return json(
      {
        error: {
          code: error?.code,
          message: error?.message || "로그인에 실패했습니다.",
        },
      },
      status,
      authCookies,
    );
  }

  const lifecycle = await supabase
    .from("account_lifecycle_states")
    .select("status")
    .eq("subject_user_id", data.user.id)
    .maybeSingle();
  const accountLifecycleStatus = lifecycle.error ? null : String(lifecycle.data?.status || "active");

  return json({ user: data.user, accountLifecycleStatus }, 200, authCookies);
}
