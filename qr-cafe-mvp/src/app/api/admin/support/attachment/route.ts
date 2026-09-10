import { NextRequest } from "next/server";

import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  requireStoreRole,
} from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("storeId") || "").trim();
    const attachmentId = Number(req.nextUrl.searchParams.get("attachmentId") || 0);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) throw new ApiError(400, "첨부 파일 정보를 확인해 주세요.", "SUPPORT_ATTACHMENT_INVALID");

    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner", "manager", "staff"] });
    const attachment = await admin.from("support_ticket_attachments")
      .select("storage_path,original_filename")
      .eq("id", attachmentId)
      .eq("store_id", storeId)
      .is("deleted_at", null)
      .maybeSingle();
    if (attachment.error || !attachment.data) throw new ApiError(404, "첨부 파일을 찾을 수 없습니다.", "SUPPORT_ATTACHMENT_NOT_FOUND");

    const signed = await admin.storage.from("support-evidence").createSignedUrl(attachment.data.storage_path, 60);
    if (signed.error || !signed.data?.signedUrl) throw new ApiError(500, "첨부 파일을 열지 못했습니다.", "SUPPORT_ATTACHMENT_SIGN_FAILED");

    const response = Response.json({ ok: true, url: signed.data.signedUrl, filename: attachment.data.original_filename });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
