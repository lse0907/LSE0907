import { NextRequest } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  requireStoreRole,
} from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type IntakeType = "help" | "billing" | "incident";

function privateResponse(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function intakeMeta(intakeType: IntakeType) {
  if (intakeType === "billing") return { category: "billing", label: "결제·구독 문의" };
  if (intakeType === "incident") return { category: "bug", label: "오류 신고" };
  return { category: "inquiry", label: "사용·설정 도움" };
}

function sanitizeFilename(value: string) {
  const normalized = value.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (normalized || "evidence").slice(0, 120);
}

function toIntakeType(value: FormDataEntryValue | null): IntakeType {
  const type = String(value || "").trim();
  if (type === "help" || type === "billing" || type === "incident") return type;
  throw new ApiError(400, "문의 유형을 선택해 주세요.", "SUPPORT_INTAKE_TYPE_INVALID");
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("storeId") || "").trim();
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const [ticketsRes, storeRes] = await Promise.all([
      admin.from("support_tickets")
        .select("id,category,priority,status,title,body,ops_note,created_at,updated_at,intake_type,error_message,has_attachments")
        .eq("store_id", storeId).order("created_at", { ascending: false }).limit(100),
      admin.from("stores").select("store_name").eq("store_id", storeId).maybeSingle(),
    ]);
    if (ticketsRes.error) throw new ApiError(500, "문의 이력을 불러오지 못했습니다.", "SUPPORT_TICKETS_LOAD_FAILED");

    const tickets = ticketsRes.data || [];
    const ids = tickets.map((ticket) => Number(ticket.id)).filter((id) => Number.isInteger(id) && id > 0);
    const storeName = String(storeRes.data?.store_name || storeId);
    if (!ids.length) return privateResponse({ ok: true, storeName, tickets: [], events: [], attachments: [] });

    const [eventsRes, attachmentsRes] = await Promise.all([
      admin.from("support_ticket_events").select("id,ticket_id,actor_kind,event_type,body,created_at").in("ticket_id", ids).order("created_at", { ascending: true }),
      admin.from("support_ticket_attachments").select("id,ticket_id,original_filename,content_type,byte_size,created_at").in("ticket_id", ids).is("deleted_at", null).order("created_at", { ascending: true }),
    ]);
    if (eventsRes.error) throw new ApiError(500, "문의 처리 이력을 불러오지 못했습니다.", "SUPPORT_EVENTS_LOAD_FAILED");
    if (attachmentsRes.error) throw new ApiError(500, "첨부 정보를 불러오지 못했습니다.", "SUPPORT_ATTACHMENTS_LOAD_FAILED");

    return privateResponse({ ok: true, storeName, tickets, events: eventsRes.data || [], attachments: attachmentsRes.data || [] });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const uploadedPaths: string[] = [];
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }

    const formData = await req.formData();
    const storeId = String(formData.get("storeId") || "").trim();
    const intakeType = toIntakeType(formData.get("intakeType"));
    const body = String(formData.get("body") || "").trim();
    const errorMessage = String(formData.get("errorMessage") || "").trim();
    const files = formData.getAll("evidence").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (body.length < 2 || body.length > 5000) throw new ApiError(400, "문의 내용은 2~5,000자로 작성해 주세요.", "SUPPORT_BODY_INVALID");
    if (errorMessage.length > 2000) throw new ApiError(400, "오류 문구는 2,000자 이하로 작성해 주세요.", "SUPPORT_ERROR_MESSAGE_INVALID");
    if (intakeType !== "incident" && (errorMessage || files.length)) throw new ApiError(400, "오류 문구와 캡처는 오류 신고에서만 첨부할 수 있습니다.", "SUPPORT_EVIDENCE_TYPE_INVALID");
    if (files.length > MAX_FILES) throw new ApiError(400, "오류 캡처는 최대 3장까지 첨부할 수 있습니다.", "SUPPORT_EVIDENCE_COUNT_INVALID");
    for (const file of files) {
      if (!ACCEPTED_TYPES.has(file.type) || file.size > MAX_FILE_BYTES) {
        throw new ApiError(400, "PNG, JPG, WEBP 형식의 5MB 이하 이미지로 첨부해 주세요.", "SUPPORT_EVIDENCE_FILE_INVALID");
      }
    }

    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager", "staff"] });
    const meta = intakeMeta(intakeType);
    const shortBody = body.replace(/\s+/g, " ").slice(0, 72);
    const ticketRes = await admin.from("support_tickets").insert({
      store_id: storeId,
      requester_user_id: actor.userId,
      category: meta.category,
      priority: "normal",
      title: `[${meta.label}] ${shortBody}`,
      body,
      status: "open",
      intake_type: intakeType,
      error_message: intakeType === "incident" && errorMessage ? errorMessage : null,
      has_attachments: files.length > 0,
    }).select("id").single();
    if (ticketRes.error || !ticketRes.data) throw new ApiError(500, "문의를 접수하지 못했습니다.", "SUPPORT_TICKET_CREATE_FAILED");
    const ticketId = Number(ticketRes.data.id);

    const eventRes = await admin.from("support_ticket_events").insert({
      ticket_id: ticketId,
      actor_kind: "owner",
      event_type: "submitted",
      body: "문의가 접수되었습니다. 운영팀이 확인한 뒤 이력에 안내를 남깁니다.",
    });
    if (eventRes.error) throw new ApiError(500, "문의 처리 이력을 저장하지 못했습니다.", "SUPPORT_EVENT_CREATE_FAILED");

    if (files.length) {
      const attachmentRows: Array<{ ticket_id: number; store_id: string; storage_path: string; original_filename: string; content_type: string; byte_size: number }> = [];
      for (const file of files) {
        const path = `${storeId}/${ticketId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
        const upload = await admin.storage.from("support-evidence").upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error) throw new ApiError(500, "오류 캡처를 안전하게 저장하지 못했습니다.", "SUPPORT_EVIDENCE_UPLOAD_FAILED");
        uploadedPaths.push(path);
        attachmentRows.push({ ticket_id: ticketId, store_id: storeId, storage_path: path, original_filename: sanitizeFilename(file.name), content_type: file.type, byte_size: file.size });
      }
      const attachmentsRes = await admin.from("support_ticket_attachments").insert(attachmentRows);
      if (attachmentsRes.error) throw new ApiError(500, "오류 캡처 정보를 저장하지 못했습니다.", "SUPPORT_EVIDENCE_RECORD_FAILED");
    }

    return privateResponse({ ok: true, ticketId }, 201);
  } catch (error) {
    if (uploadedPaths.length) {
      try { await createSupabaseAdminClient().storage.from("support-evidence").remove(uploadedPaths); } catch {}
    }
    return apiErrorResponse(error);
  }
}
