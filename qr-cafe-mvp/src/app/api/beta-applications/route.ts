import { NextRequest } from "next/server";

import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

const businessTypes = new Set(["cafe", "restaurant", "bar", "food_truck", "popup", "other"]);
const operationTypes = new Set(["dine_in", "takeout", "both"]);
const startTimes = new Set(["asap", "within_month", "later"]);
const contactMethods = new Set(["email", "phone"]);
const activeStatuses = ["submitted", "reviewing", "selected"];

function text(value: unknown, max: number) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req) || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new ApiError(400, "신청 내용을 확인해 주세요.", "BETA_APPLICATION_INVALID");
    if (text(body.website, 120)) return Response.json({ ok: true });

    const storeName = text(body.storeName, 80);
    const businessType = text(body.businessType, 30);
    const operationType = text(body.operationType, 30);
    const region = text(body.region, 80);
    const contactName = text(body.contactName, 80);
    const contactMethod = text(body.contactMethod, 20);
    const contactEmail = text(body.contactEmail, 254).toLowerCase();
    const contactPhone = text(body.contactPhone, 30).replace(/[^0-9]/g, "");
    const preferredStart = text(body.preferredStart, 30);
    const preferredStartDate = text(body.preferredStartDate, 10);
    const recruitmentRoundId = Number(body.recruitmentRoundId);
    const feedbackAvailable = body.feedbackAvailable === true;
    const note = text(body.note, 1000);

    if (storeName.length < 2 || region.length < 2 || contactName.length < 2) {
      throw new ApiError(400, "매장명, 지역, 연락받을 분의 이름을 입력해 주세요.", "BETA_APPLICATION_REQUIRED");
    }
    if (!businessTypes.has(businessType) || !operationTypes.has(operationType) || !startTimes.has(preferredStart)) {
      throw new ApiError(400, "선택 항목을 다시 확인해 주세요.", "BETA_APPLICATION_SELECTION_INVALID");
    }
    if (!contactMethods.has(contactMethod)) {
      throw new ApiError(400, "연락 방법을 선택해 주세요.", "BETA_APPLICATION_CONTACT_METHOD_INVALID");
    }
    if (!Number.isInteger(recruitmentRoundId) || recruitmentRoundId < 1) {
      throw new ApiError(409, "현재 모집이 마감되었거나 변경되었습니다. 페이지를 새로고침해 주세요.", "BETA_RECRUITMENT_NOT_OPEN");
    }
    if (preferredStart === "within_month" && !/^\d{4}-\d{2}-\d{2}$/.test(preferredStartDate)) {
      throw new ApiError(400, "희망 시작일을 선택해 주세요.", "BETA_APPLICATION_START_DATE_REQUIRED");
    }
    if (contactMethod === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new ApiError(400, "이메일 주소를 확인해 주세요.", "BETA_APPLICATION_EMAIL_INVALID");
    }
    if (contactMethod === "phone" && contactPhone.length < 8) {
      throw new ApiError(400, "연락처를 확인해 주세요.", "BETA_APPLICATION_PHONE_INVALID");
    }
    if (body.privacyConsent !== true) {
      throw new ApiError(400, "신청 검토를 위한 개인정보 수집·이용 안내에 동의해 주세요.", "BETA_APPLICATION_PRIVACY_REQUIRED");
    }

    const admin = createSupabaseAdminClient();
    const activeRound = await admin.from("beta_recruitment_rounds").select("id").eq("id", recruitmentRoundId).eq("status", "open").maybeSingle();
    if (activeRound.error) throw new ApiError(500, "모집 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BETA_RECRUITMENT_CHECK_FAILED");
    if (!activeRound.data) throw new ApiError(409, "현재 모집이 마감되었거나 변경되었습니다. 페이지를 새로고침해 주세요.", "BETA_RECRUITMENT_NOT_OPEN");
    const contactColumn = contactMethod === "email" ? "contact_email" : "contact_phone";
    const contactValue = contactMethod === "email" ? contactEmail : contactPhone;
    const duplicate = await admin.from("beta_applications")
      .select("id")
      .eq("store_name", storeName)
      .eq(contactColumn, contactValue)
      .in("status", activeStatuses)
      .limit(1);
    if (duplicate.error) throw new ApiError(500, "신청 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BETA_APPLICATION_DUPLICATE_CHECK_FAILED");
    if (duplicate.data?.length) throw new ApiError(409, "같은 매장과 연락 방법으로 접수된 신청이 이미 있습니다. 검토 결과를 기다려 주세요.", "BETA_APPLICATION_DUPLICATE");

    const recent = await admin.from("beta_applications")
      .select("id", { count: "exact", head: true })
      .eq(contactColumn, contactValue)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (recent.error) throw new ApiError(500, "신청 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BETA_APPLICATION_RATE_CHECK_FAILED");
    if ((recent.count || 0) >= 3) throw new ApiError(429, "신청 횟수가 많습니다. 잠시 후 다시 시도해 주세요.", "BETA_APPLICATION_RATE_LIMITED");

    const saved = await admin.from("beta_applications").insert({
      store_name: storeName,
      business_type: businessType,
      operation_type: operationType,
      region,
      contact_name: contactName,
      contact_method: contactMethod,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      preferred_start: preferredStart,
      preferred_start_date: preferredStart === "within_month" ? preferredStartDate : null,
      recruitment_round_id: recruitmentRoundId,
      feedback_available: feedbackAvailable,
      note,
      source: "landing",
    }).select("id").single();

    if (saved.error || !saved.data) {
      console.error("[beta-application] insert failed", saved.error?.message);
      throw new ApiError(500, "신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", "BETA_APPLICATION_SAVE_FAILED");
    }

    return Response.json({ ok: true, applicationId: saved.data.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
