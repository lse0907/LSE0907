import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getPasswordPolicyError } from "@/app/lib/passwordPolicy";

export const dynamic = "force-dynamic";

type SignupRequest = {
  email?: unknown;
  password?: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  let body: SignupRequest;

  try {
    body = (await request.json()) as SignupRequest;
  } catch {
    return json({ error: { message: "요청 형식이 올바르지 않습니다." } }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return json({ error: { message: "이메일과 비밀번호를 입력해주세요." } }, 400);
  }

  const passwordError = getPasswordPolicyError(password);
  if (passwordError) {
    return json({ error: { code: "weak_password", message: passwordError } }, 400);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return json({ error: { message: "인증 서비스 설정을 확인할 수 없습니다." } }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    const status =
      typeof error.status === "number" && error.status >= 400 && error.status < 500
        ? error.status
        : 400;
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          name: error.name,
        },
      },
      status,
    );
  }

  return json({
    userId: data.user?.id ?? null,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      : null,
  });
}
