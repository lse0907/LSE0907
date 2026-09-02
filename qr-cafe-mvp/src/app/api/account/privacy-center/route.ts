import { NextRequest } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  getOptionalRequestUserId,
} from "../../_lib/storeAuth";

type Audience = "customer" | "owner";

function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
  }
}

async function requireUser(req: NextRequest) {
  const userId = await getOptionalRequestUserId(req, { allowRestricted: true });
  if (!userId) throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
  return userId;
}

async function resolveAudience(userId: string): Promise<Audience> {
  const admin = createSupabaseAdminClient();
  const { data: confirmation, error } = await admin
    .from("signup_policy_confirmations")
    .select("audience")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ApiError(500, "계정 유형을 확인하지 못했습니다.", "AUDIENCE_CHECK_FAILED");
  if (confirmation?.audience === "owner") return "owner";
  if (confirmation?.audience === "customer") return "customer";

  const { data: ownerProfile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return ownerProfile ? "owner" : "customer";
}

function cleanDetail(value: unknown) {
  return String(value || "").trim().slice(0, 1000);
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const audience = await resolveAudience(userId);
    const admin = createSupabaseAdminClient();
    const [{ data: center, error: centerError }, { data: profile }, { data: marketingDocument }] = await Promise.all([
      admin.rpc("get_account_privacy_center", { p_user_id: userId }),
      audience === "customer"
        ? admin.from("customer_profiles").select("phone,marketing_consent").eq("user_id", userId).maybeSingle()
        : admin.from("profiles").select("phone").eq("user_id", userId).maybeSingle(),
      admin.from("policy_documents").select("id").eq("document_type", "marketing").eq("audience", audience).eq("status", "published").order("effective_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (centerError) throw new ApiError(500, "개인정보 요청 상태를 불러오지 못했습니다.", "PRIVACY_CENTER_LOAD_FAILED");

    const accountProfile = profile as { phone?: string | null; marketing_consent?: boolean | null } | null;
    const { data: marketingEvent } = marketingDocument?.id
      ? await admin.from("policy_acceptance_events").select("action").eq("user_id", userId).eq("document_id", marketingDocument.id).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle()
      : { data: null };
    const marketingConsent = marketingEvent
      ? marketingEvent.action === "accepted"
      : audience === "customer" ? Boolean(accountProfile?.marketing_consent) : false;
    return Response.json({
      ok: true,
      audience,
      phonePresent: Boolean(accountProfile?.phone),
      marketingConsent,
      center: center || { lifecycle: null, withdrawal: null, requests: [] },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const userId = await requireUser(req);
    const audience = await resolveAudience(userId);
    const admin = createSupabaseAdminClient();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "");
    let result: unknown = null;
    let error: { message?: string } | null = null;

    if (action === "delete_phone") {
      if (audience !== "customer") {
        throw new ApiError(409, "사업자 회원의 업무용 연락처는 활성 계약·매장 확인 후 변경 또는 삭제할 수 있습니다.", "OWNER_PHONE_REVIEW_REQUIRED");
      }
      ({ data: result, error } = await admin.rpc("delete_customer_optional_phone", { p_user_id: userId }));
    } else if (action === "withdraw_marketing") {
      ({ data: result, error } = await admin.rpc("withdraw_account_marketing_consent", {
        p_user_id: userId,
        p_audience: audience,
        p_source: "privacy_center",
      }));
    } else if (action === "create_rights_request") {
      const requestType = String(body.requestType || "");
      if (!new Set(["access", "correction", "deletion", "restriction"]).has(requestType)) {
        throw new ApiError(400, "요청 종류를 확인해 주세요.", "INVALID_RIGHTS_REQUEST_TYPE");
      }
      ({ data: result, error } = await admin.rpc("create_privacy_rights_request", {
        p_user_id: userId,
        p_audience: audience,
        p_request_type: requestType,
        p_request_detail: { note: cleanDetail(body.detail) },
      }));
    } else if (action === "request_withdrawal") {
      ({ data: result, error } = await admin.rpc("request_account_withdrawal", {
        p_user_id: userId,
        p_audience: audience,
        p_reason: cleanDetail(body.reason).slice(0, 500) || null,
      }));
    } else if (action === "cancel_withdrawal") {
      ({ data: result, error } = await admin.rpc("cancel_account_withdrawal", { p_user_id: userId }));
    } else {
      throw new ApiError(400, "지원하지 않는 요청입니다.", "INVALID_PRIVACY_ACTION");
    }

    if (error) {
      const message = String(error.message || "");
      if (message.includes("ACTIVE_WITHDRAWAL_REQUEST_EXISTS")) {
        throw new ApiError(409, "이미 처리 중인 탈퇴 요청이 있습니다.", "ACTIVE_WITHDRAWAL_REQUEST_EXISTS");
      }
      if (message.includes("RECOVERABLE_WITHDRAWAL_NOT_FOUND")) {
        throw new ApiError(409, "복구할 수 있는 탈퇴 요청이 없습니다.", "RECOVERABLE_WITHDRAWAL_NOT_FOUND");
      }
      throw new ApiError(500, "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", "PRIVACY_ACTION_FAILED");
    }
    return Response.json({ ok: true, result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
