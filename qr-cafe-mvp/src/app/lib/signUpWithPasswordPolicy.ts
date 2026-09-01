import { supabase } from "@/app/lib/supabaseClient";
import type { SignupPolicyInput } from "@/app/lib/signupPolicy";

type SignupApiError = {
  code?: string;
  message: string;
  name?: string;
};

type SignupApiResponse = {
  error?: SignupApiError;
  userId?: string | null;
  referralRegistered?: boolean;
  referralWarning?: string | null;
  session?: {
    access_token: string;
    refresh_token: string;
  } | null;
};

export async function signUpWithPasswordPolicy(
  email: string,
  password: string,
  policy: SignupPolicyInput,
  referralCode = "",
) {
  let response: Response;

  try {
    response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, referralCode, ...policy }),
      cache: "no-store",
    });
  } catch {
    return {
      data: null,
      error: { message: "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." } satisfies SignupApiError,
    };
  }

  const payload = (await response.json().catch(() => null)) as SignupApiResponse | null;

  if (!response.ok || payload?.error) {
    return {
      data: null,
      error: payload?.error ?? { message: "회원가입에 실패했습니다." },
    };
  }

  if (!payload?.session) {
    return {
      data: { userId: payload?.userId ?? null, sessionEstablished: false, referralRegistered: payload?.referralRegistered === true, referralWarning: payload?.referralWarning || null },
      error: null,
    };
  }

  const { error } = await supabase.auth.setSession(payload.session);

  if (error) {
    return {
      data: null,
      error: { code: error.code, message: error.message, name: error.name },
    };
  }

  return {
    data: { userId: payload.userId ?? null, sessionEstablished: true, referralRegistered: payload.referralRegistered === true, referralWarning: payload.referralWarning || null },
    error: null,
  };
}
