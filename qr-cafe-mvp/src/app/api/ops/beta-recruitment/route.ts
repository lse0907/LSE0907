import { NextRequest } from "next/server";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";
const statuses = new Set(["draft", "open", "closed"]);
const text = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const result = await admin.from("beta_recruitment_rounds").select("id,title,status,public_message,created_at,updated_at").order("created_at", { ascending: false });
    if (result.error) throw new ApiError(500, "모집 목록을 불러오지 못했습니다.", "BETA_RECRUITMENT_LOAD_FAILED");
    return Response.json({ ok: true, rows: result.data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const body = await req.json().catch(() => ({}));
    const title = text(body.title, 80);
    const status = text(body.status, 20);
    const publicMessage = text(body.publicMessage, 500);
    const id = Number(body.id);
    if (title.length < 2 || !statuses.has(status)) throw new ApiError(400, "모집명과 상태를 확인해 주세요.", "BETA_RECRUITMENT_INVALID");
    if (status === "open") {
      const current = await admin.from("beta_recruitment_rounds").select("id").eq("status", "open").maybeSingle();
      if (current.error) throw new ApiError(500, "현재 모집 상태를 확인하지 못했습니다.", "BETA_RECRUITMENT_OPEN_CHECK_FAILED");
      if (current.data && current.data.id !== id) throw new ApiError(409, "현재 모집 중인 차수를 먼저 마감해 주세요.", "BETA_RECRUITMENT_ALREADY_OPEN");
    }
    const values = { title, status, public_message: publicMessage, updated_at: new Date().toISOString() };
    const result = Number.isInteger(id) && id > 0 ? await admin.from("beta_recruitment_rounds").update(values).eq("id", id).select("id").single() : await admin.from("beta_recruitment_rounds").insert(values).select("id").single();
    if (result.error || !result.data) throw new ApiError(500, "모집 정보를 저장하지 못했습니다.", "BETA_RECRUITMENT_SAVE_FAILED");
    return Response.json({ ok: true, id: result.data.id });
  } catch (error) { return apiErrorResponse(error); }
}
