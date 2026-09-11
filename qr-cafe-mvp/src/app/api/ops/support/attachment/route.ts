import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";

export async function GET(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get("attachmentId") || 0);
    if (!Number.isInteger(id) || id < 1) throw new ApiError(400, "첨부 파일 정보를 확인해 주세요.");
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const row = await admin.from("support_ticket_attachments").select("storage_path,original_filename").eq("id", id).is("deleted_at", null).maybeSingle();
    if (row.error || !row.data) throw new ApiError(404, "첨부 파일을 찾을 수 없습니다.");
    const signed = await admin.storage.from("support-evidence").createSignedUrl(row.data.storage_path, 60);
    if (signed.error || !signed.data?.signedUrl) throw new ApiError(500, "첨부 파일을 열지 못했습니다.");
    return Response.json({ ok: true, url: signed.data.signedUrl, filename: row.data.original_filename }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
