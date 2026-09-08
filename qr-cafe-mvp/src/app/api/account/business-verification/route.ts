import { NextRequest } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  getOptionalRequestUserId,
} from "@/app/api/_lib/storeAuth";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

async function requireUser(req: NextRequest) {
  const userId = await getOptionalRequestUserId(req);
  if (!userId) throw new ApiError(401, "로그인이 필요합니다.", "LOGIN_REQUIRED");
  return userId;
}

function text(form: FormData, key: string, max = 200) {
  return String(form.get(key) || "").trim().slice(0, max);
}

function validateFile(value: FormDataEntryValue | null, required: boolean) {
  if (!(value instanceof File) || value.size === 0) {
    if (required) throw new ApiError(400, "사업자등록증을 첨부해 주세요.", "BUSINESS_DOCUMENT_REQUIRED");
    return null;
  }
  if (value.size > 10 * 1024 * 1024 || !ALLOWED_TYPES.has(value.type)) {
    throw new ApiError(400, "PDF, JPG, PNG 또는 WEBP 파일을 10MB 이하로 첨부해 주세요.", "INVALID_BUSINESS_DOCUMENT");
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUser(req);
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("business_verification_requests")
      .select("id,status,applicant_role,business_phone,submitted_at,reviewed_at,review_note,business_entity_id,business_entities(*)")
      .eq("applicant_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new ApiError(500, "사업자 인증 상태를 불러오지 못했습니다.", "BUSINESS_VERIFICATION_LOAD_FAILED");
    return Response.json({ ok: true, verification: data || null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const userId = await requireUser(req);
    const admin = createSupabaseAdminClient();
    const { data: ownerRole } = await admin.from("account_roles").select("status").eq("user_id", userId).eq("audience", "owner").maybeSingle();
    if (!ownerRole) throw new ApiError(409, "먼저 사업자 기능을 추가해 주세요.", "OWNER_ROLE_REQUIRED");

    const form = await req.formData();
    const businessNumberNormalized = text(form, "businessNumber", 20).replace(/[^0-9]/g, "");
    const legalName = text(form, "legalName", 120);
    const representativeName = text(form, "representativeName", 80);
    const openingDate = text(form, "openingDate", 10);
    const registeredAddress = text(form, "registeredAddress", 300);
    const businessPhone = text(form, "businessPhone", 30);
    const businessType = text(form, "businessType", 30);
    const applicantRole = text(form, "applicantRole", 30);
    if (!/^\d{10}$/.test(businessNumberNormalized)) throw new ApiError(400, "사업자등록번호 10자리를 확인해 주세요.", "INVALID_BUSINESS_NUMBER");
    if (!legalName || !representativeName || !openingDate || !registeredAddress || !businessPhone) throw new ApiError(400, "사업자 필수 정보를 모두 입력해 주세요.", "BUSINESS_FIELDS_REQUIRED");
    if (!new Set(["sole_proprietor", "corporation", "other"]).has(businessType)) throw new ApiError(400, "사업자 유형을 확인해 주세요.", "INVALID_BUSINESS_TYPE");
    if (!new Set(["representative", "authorized_manager"]).has(applicantRole)) throw new ApiError(400, "신청자 권한을 확인해 주세요.", "INVALID_APPLICANT_ROLE");

    const profile = await admin.from("profiles").upsert({ user_id: userId, name: representativeName, phone: businessPhone }, { onConflict: "user_id" });
    if (profile.error) throw new ApiError(500, "사업자 회원 기본정보를 저장하지 못했습니다.", "OWNER_PROFILE_SAVE_FAILED");

    const businessDocument = validateFile(form.get("businessDocument"), true)!;
    const delegationDocument = validateFile(form.get("delegationDocument"), applicantRole === "authorized_manager");

    const { data: existingEntity } = await admin.from("business_entities").select("id,verification_status").eq("business_number_normalized", businessNumberNormalized).maybeSingle();
    let businessEntityId = existingEntity?.id as string | undefined;
    if (!businessEntityId) {
      const created = await admin.from("business_entities").insert({
        business_number: businessNumberNormalized.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3"),
        business_number_normalized: businessNumberNormalized,
        legal_name: legalName,
        representative_name: representativeName,
        business_type: businessType,
        opening_date: openingDate,
        registered_address: registeredAddress,
        verification_status: "submitted",
        verification_method: "ops_manual",
        created_by: userId,
      }).select("id").single();
      if (created.error || !created.data) throw new ApiError(500, "사업체 정보를 저장하지 못했습니다.", "BUSINESS_ENTITY_SAVE_FAILED");
      businessEntityId = String(created.data.id);
    } else if (["approved", "legacy_verified"].includes(String(existingEntity?.verification_status))) {
      throw new ApiError(409, "이미 등록된 사업자번호입니다. 해당 사업체의 대표자에게 초대를 요청하거나 지원센터에 문의해 주세요.", "BUSINESS_ALREADY_REGISTERED");
    } else {
      const updated = await admin.from("business_entities").update({ legal_name: legalName, representative_name: representativeName, business_type: businessType, opening_date: openingDate, registered_address: registeredAddress, verification_status: "submitted", updated_at: new Date().toISOString() }).eq("id", businessEntityId);
      if (updated.error) throw new ApiError(500, "사업체 정보를 갱신하지 못했습니다.", "BUSINESS_ENTITY_UPDATE_FAILED");
    }

    const member = await admin.from("business_entity_members").upsert({ business_entity_id: businessEntityId, user_id: userId, role: "applicant", status: "active", updated_at: new Date().toISOString() }, { onConflict: "business_entity_id,user_id" });
    if (member.error) throw new ApiError(500, "사업체 신청 권한을 저장하지 못했습니다.", "BUSINESS_MEMBER_SAVE_FAILED");

    const prior = await admin.from("business_verification_requests").select("id,status").eq("business_entity_id", businessEntityId).in("status", ["draft", "submitted", "changes_requested"]).maybeSingle();
    let requestId = String(prior.data?.id || "");
    if (!requestId) {
      const requestRow = await admin.from("business_verification_requests").insert({ business_entity_id: businessEntityId, applicant_user_id: userId, applicant_role: applicantRole, status: "draft", business_phone: businessPhone }).select("id").single();
      if (requestRow.error || !requestRow.data) throw new ApiError(500, "사업자 인증 신청을 만들지 못했습니다.", "BUSINESS_REQUEST_CREATE_FAILED");
      requestId = String(requestRow.data.id);
    }

    const upload = async (file: File, name: string) => {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const path = `${userId}/${requestId}/${name}.${ext}`;
      const result = await admin.storage.from("business-verification").upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: true });
      if (result.error) throw new ApiError(500, "인증 자료를 안전하게 저장하지 못했습니다.", "BUSINESS_DOCUMENT_UPLOAD_FAILED");
      return path;
    };
    const businessDocumentPath = await upload(businessDocument, "business-registration");
    const delegationDocumentPath = delegationDocument ? await upload(delegationDocument, "delegation") : null;

    const now = new Date().toISOString();
    const saved = await admin.from("business_verification_requests").update({ applicant_user_id: userId, applicant_role: applicantRole, status: "submitted", business_phone: businessPhone, business_document_path: businessDocumentPath, delegation_document_path: delegationDocumentPath, submitted_at: now, review_note: null, updated_at: now }).eq("id", requestId);
    if (saved.error) throw new ApiError(500, "사업자 인증 신청을 제출하지 못했습니다.", "BUSINESS_REQUEST_SUBMIT_FAILED");
    await Promise.all([
      admin.from("business_verification_events").insert({ request_id: requestId, actor_user_id: userId, event_type: prior.data?.status === "changes_requested" ? "resubmitted" : "submitted" }),
      admin.from("account_roles").update({ status: "verification_pending", updated_at: now }).eq("user_id", userId).eq("audience", "owner"),
    ]);
    return Response.json({ ok: true, requestId, status: "submitted" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
