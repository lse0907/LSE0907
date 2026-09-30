import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

const audiences = new Set(["owner", "staff"]);
const isAnnouncementSchemaMissing = (error: { code?: string | null } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("storeId") || "").trim();
    const audience = String(req.nextUrl.searchParams.get("audience") || "owner").trim();
    if (!storeId || !audiences.has(audience)) throw new ApiError(400, "알림 조회 정보를 확인해 주세요.", "ANNOUNCEMENT_QUERY_INVALID");

    const admin = createSupabaseAdminClient();
    await requireStoreRole({
      req,
      supabaseAdmin: admin,
      storeId,
      allowedRoles: audience === "staff" ? ["owner", "manager", "staff"] : ["owner", "manager"],
    });

    const now = new Date().toISOString();
    const result = await admin
      .from("platform_announcements")
      .select("id,title,body,kind,audience,starts_at,ends_at,pinned,link_path,updated_at")
      .eq("status", "published")
      .in("audience", ["all", audience])
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order("pinned", { ascending: false })
      .order("starts_at", { ascending: false })
      .limit(20);
    if (isAnnouncementSchemaMissing(result.error)) {
      throw new ApiError(503, "시스템 알림을 준비 중입니다. 잠시 후 다시 확인해 주세요.", "ANNOUNCEMENT_SCHEMA_PENDING");
    }
    if (result.error) throw new ApiError(500, "운영 알림을 불러오지 못했습니다.", "ANNOUNCEMENT_LOAD_FAILED");
    return Response.json({ ok: true, rows: result.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
