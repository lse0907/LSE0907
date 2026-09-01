import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getPasswordPolicyError } from "@/app/lib/passwordPolicy";
import { SIGNUP_POLICY_VERSION, type SignupAudience } from "@/app/lib/signupPolicy";

export const dynamic = "force-dynamic";

type SignupRequest = {
  email?: unknown;
  password?: unknown;
  referralCode?: unknown;
  audience?: unknown;
  minimumAgeConfirmed?: unknown;
  businessAuthorityConfirmed?: unknown;
  termsAccepted?: unknown;
  privacyNoticeAcknowledged?: unknown;
  marketingConsent?: unknown;
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
  const referralCode = typeof body.referralCode === "string" ? body.referralCode.trim().toUpperCase() : "";
  const audience = body.audience === "customer" || body.audience === "owner" ? body.audience : null;

  if (!email || !password) {
    return json({ error: { message: "이메일과 비밀번호를 입력해주세요." } }, 400);
  }

  const passwordError = getPasswordPolicyError(password);
  if (passwordError) {
    return json({ error: { code: "weak_password", message: passwordError } }, 400);
  }

  if (!audience) {
    return json({ error: { code: "invalid_signup_audience", message: "가입 유형을 다시 확인해 주세요." } }, 400);
  }
  if (body.minimumAgeConfirmed !== true) {
    return json({ error: { code: "minimum_age_required", message: audience === "owner" ? "만 19세 이상 확인이 필요합니다." : "만 14세 이상 확인이 필요합니다." } }, 400);
  }
  if (audience === "owner" && body.businessAuthorityConfirmed !== true) {
    return json({ error: { code: "business_authority_required", message: "사업자 대표자 또는 위임받은 담당자 확인이 필요합니다." } }, 400);
  }
  if (body.termsAccepted !== true || body.privacyNoticeAcknowledged !== true) {
    return json({ error: { code: "required_policy_confirmation", message: "이용정책 동의와 개인정보 처리 안내 확인이 필요합니다." } }, 400);
  }

  if (referralCode && !/^[A-Z0-9]{6,16}$/.test(referralCode)) {
    return json({ error: { code: "invalid_referral_code", message: "추천코드를 다시 확인해 주세요." } }, 400);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRole) {
    return json({ error: { message: "인증 서비스 설정을 확인할 수 없습니다." } }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const admin = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
  let referral: { id: number; store_id: string } | null = null;
  if (referralCode) {
    const referralRes = await admin
      .from("store_referral_codes")
      .select("id,store_id")
      .eq("code_normalized", referralCode)
      .eq("is_active", true)
      .maybeSingle();
    if (referralRes.error || !referralRes.data) {
      return json({ error: { code: "invalid_referral_code", message: "사용할 수 없는 추천코드입니다." } }, 400);
    }
    referral = { id: Number(referralRes.data.id), store_id: String(referralRes.data.store_id) };
  }

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


  const isNewIdentity = Boolean(data.user && Array.isArray(data.user.identities) && data.user.identities.length > 0);
  if (!data.user?.id || !isNewIdentity) {
    return json({ userId: null, referralRegistered: false, referralWarning: null, session: null });
  }

  const policyResult = await admin.rpc("record_signup_policy_acceptances", {
    p_user_id: data.user.id,
    p_audience: audience satisfies SignupAudience,
    p_minimum_age_confirmed: true,
    p_business_authority_confirmed: audience === "owner",
    p_terms_version: SIGNUP_POLICY_VERSION,
    p_privacy_version: SIGNUP_POLICY_VERSION,
    p_marketing_version: SIGNUP_POLICY_VERSION,
    p_marketing_accepted: body.marketingConsent === true,
    p_source: "web_signup",
  });

  if (policyResult.error) {
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: { code: "policy_record_failed", message: "가입 확인 이력을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." } }, 500);
  }

  let referralWarning: string | null = null;
  if (referral) {
    const referralInsert = await admin.from("billing_referrals").insert({
      referred_user_id: data.user.id,
      referral_code_id: referral.id,
      referring_store_id: referral.store_id,
      status: "registered",
    });
    if (referralInsert.error) referralWarning = "가입은 완료됐지만 추천코드 연결을 확인하지 못했습니다. 지원센터에 문의해 주세요.";
  }

  return json({
    userId: data.user?.id ?? null,
    referralRegistered: Boolean(referral && !referralWarning),
    referralWarning,
    session: data.session
      ? {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }
      : null,
  });
}
