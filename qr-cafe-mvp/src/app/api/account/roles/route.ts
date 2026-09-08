import { NextRequest } from "next/server";

import { SIGNUP_POLICY_VERSION, type SignupAudience } from "@/app/lib/signupPolicy";
import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  getOptionalRequestUserId,
} from "@/app/api/_lib/storeAuth";

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
}

async function requireUser(req: NextRequest) {
  const userId = await getOptionalRequestUserId(req, { allowRestricted: true });
  if (!userId) throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
  return userId;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const admin = createSupabaseAdminClient();
    const [{ data: roles, error: roleError }, { data: verification, error: verificationError }, { data: businesses, error: businessError }] = await Promise.all([
      admin.from("account_roles").select("audience,status,activated_at,updated_at").eq("user_id", userId).order("audience"),
      admin
        .from("business_verification_requests")
        .select("id,status,submitted_at,review_note,business_entity_id,business_entities(legal_name,business_number,verification_status)")
        .eq("applicant_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("business_entity_members")
        .select("role,status,business_entity_id,business_entities(id,legal_name,business_number,verification_status,business_status)")
        .eq("user_id", userId)
        .eq("status", "active"),
    ]);
    if (roleError || verificationError || businessError) throw new ApiError(500, "이용 서비스 상태를 불러오지 못했습니다.", "ROLE_STATUS_LOAD_FAILED");
    return Response.json({ ok: true, roles: roles || [], businesses: businesses || [], businessVerification: verification || null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const userId = await requireUser(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const audience = body.audience === "customer" || body.audience === "owner" ? body.audience : null;
    if (!audience) throw new ApiError(400, "추가할 서비스를 확인해 주세요.", "INVALID_ROLE_AUDIENCE");
    if (body.termsAccepted !== true || body.privacyNoticeAcknowledged !== true) {
      throw new ApiError(400, "이용정책 동의와 개인정보 처리 안내 확인이 필요합니다.", "REQUIRED_POLICY_CONFIRMATION");
    }

    const admin = createSupabaseAdminClient();
    const { data: existing } = await admin
      .from("signup_policy_confirmations")
      .select("audience,minimum_age_confirmed")
      .eq("user_id", userId);
    const ownerAgeAlreadyConfirmed = (existing || []).some((row) => row.audience === "owner" && row.minimum_age_confirmed === true);
    if (body.minimumAgeConfirmed !== true && !(audience === "customer" && ownerAgeAlreadyConfirmed)) {
      throw new ApiError(400, audience === "owner" ? "만 19세 이상 확인이 필요합니다." : "만 14세 이상 확인이 필요합니다.", "MINIMUM_AGE_REQUIRED");
    }
    if (audience === "owner" && body.businessAuthorityConfirmed !== true) {
      throw new ApiError(400, "대표자 또는 위임받은 담당자 확인이 필요합니다.", "BUSINESS_AUTHORITY_REQUIRED");
    }

    const { data: sourceProfile } = audience === "customer"
      ? await admin.from("profiles").select("name,phone").eq("user_id", userId).maybeSingle()
      : { data: null };
    const name = String(body.name || sourceProfile?.name || "").trim().slice(0, 80);
    const phone = String(body.phone || sourceProfile?.phone || "").trim().slice(0, 30);
    if (audience === "customer" && !name) throw new ApiError(400, "기존 계정 이름을 확인하지 못했습니다. 계정 정보를 먼저 확인해 주세요.", "NAME_REQUIRED");

    const policy = await admin.rpc("record_signup_policy_acceptances", {
      p_user_id: userId,
      p_audience: audience satisfies SignupAudience,
      p_minimum_age_confirmed: true,
      p_business_authority_confirmed: audience === "owner",
      p_terms_version: SIGNUP_POLICY_VERSION,
      p_privacy_version: SIGNUP_POLICY_VERSION,
      p_marketing_version: SIGNUP_POLICY_VERSION,
      p_marketing_accepted: body.marketingConsent === true,
      p_source: "role_addition",
    });
    if (policy.error) throw new ApiError(500, "서비스 약관 동의 기록을 저장하지 못했습니다.", "ROLE_POLICY_SAVE_FAILED");

    if (audience === "customer") {
      const profile = await admin.from("customer_profiles").upsert({ user_id: userId, name, phone: phone || null, marketing_consent: body.marketingConsent === true }, { onConflict: "user_id" });
      if (profile.error) throw new ApiError(500, "고객 서비스 이용 정보를 저장하지 못했습니다.", "ROLE_PROFILE_SAVE_FAILED");
    }

    return Response.json({ ok: true, audience, next: audience === "owner" ? "/account/business/start" : "/me" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
