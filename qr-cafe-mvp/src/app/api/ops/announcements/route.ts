import { NextRequest } from "next/server";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

const kinds = new Set(["important", "system", "update"]);
const audiences = new Set(["owner", "staff", "all"]);
const statuses = new Set(["draft", "published", "archived"]);
const isAnnouncementSchemaMissing = (error: { code?: string | null } | null) =>
  error?.code === "42P01" || error?.code === "PGRST205";
const compact = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
const nullableDate = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new ApiError(400, "날짜 형식을 확인해 주세요.", "ANNOUNCEMENT_DATE_INVALID");
  return parsed.toISOString();
};

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const result = await admin.from("platform_announcements").select("*").order("updated_at", { ascending: false }).limit(100);
    if (isAnnouncementSchemaMissing(result.error)) {
      throw new ApiError(503, "운영 알림 저장소가 아직 준비되지 않았습니다. 데이터베이스 마이그레이션을 적용한 뒤 다시 시도해 주세요.", "OPS_ANNOUNCEMENT_SCHEMA_PENDING");
    }
    if (result.error) throw new ApiError(500, "운영 알림 목록을 불러오지 못했습니다.", "OPS_ANNOUNCEMENT_LOAD_FAILED");
    return Response.json({ ok: true, rows: result.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    const ops = await requireOpsUser(req, admin, ["master", "support"]);
    const body = await req.json().catch(() => ({}));
    const id = Number(body.id);
    const title = compact(body.title, 100);
    const message = String(body.body || "").trim().slice(0, 1000);
    const kind = compact(body.kind, 20);
    const audience = compact(body.audience, 20);
    const status = compact(body.status, 20);
    const startsAt = nullableDate(body.startsAt) || new Date().toISOString();
    const endsAt = nullableDate(body.endsAt);
    const linkPath = compact(body.linkPath, 300) || null;
    if (title.length < 2 || message.length < 2 || !kinds.has(kind) || !audiences.has(audience) || !statuses.has(status)) throw new ApiError(400, "알림 내용을 확인해 주세요.", "OPS_ANNOUNCEMENT_INVALID");
    if (endsAt && endsAt <= startsAt) throw new ApiError(400, "종료 시점은 게시 시점 이후여야 합니다.", "ANNOUNCEMENT_END_INVALID");

    const values = { title, body: message, kind, audience, status, starts_at: startsAt, ends_at: endsAt, pinned: Boolean(body.pinned), link_path: linkPath, updated_at: new Date().toISOString() };
    const result = Number.isInteger(id) && id > 0
      ? await admin.from("platform_announcements").update(values).eq("id", id).select("id").single()
      : await admin.from("platform_announcements").insert({ ...values, created_by: ops.userId }).select("id").single();
    if (isAnnouncementSchemaMissing(result.error)) {
      throw new ApiError(503, "운영 알림 저장소가 아직 준비되지 않았습니다. 데이터베이스 마이그레이션을 적용한 뒤 다시 시도해 주세요.", "OPS_ANNOUNCEMENT_SCHEMA_PENDING");
    }
    if (result.error || !result.data) throw new ApiError(500, "운영 알림을 저장하지 못했습니다.", "OPS_ANNOUNCEMENT_SAVE_FAILED");
    return Response.json({ ok: true, id: result.data.id });
  } catch (error) { return apiErrorResponse(error); }
}
