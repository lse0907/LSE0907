import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

function privateResponse(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function fail(error: unknown) {
  const response = apiErrorResponse(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function receiptTableNotReady(error: { code?: string | null } | null) {
  return ["42P01", "PGRST205"].includes(String(error?.code || ""));
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const now = new Date().toISOString();
    const { data: latest, error: latestError } = await admin
      .from("ai_briefs")
      .select("id,brief_period,headline,summary,generated_at")
      .eq("store_id", storeId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new ApiError(500, "AI 브리핑 알림을 확인하지 못했습니다.", "AI_BRIEF_NOTICE_LOAD_FAILED");
    if (!latest) return privateResponse({ ok: true, ready: true, brief: null });

    const { data: receipt, error: receiptError } = await admin
      .from("ai_brief_read_receipts")
      .select("id")
      .eq("brief_id", latest.id)
      .eq("reader_user_id", userId)
      .maybeSingle();
    if (receiptError) {
      if (receiptTableNotReady(receiptError)) return privateResponse({ ok: true, ready: false, brief: null });
      throw new ApiError(500, "AI 브리핑 읽음 상태를 확인하지 못했습니다.", "AI_BRIEF_NOTICE_RECEIPT_LOAD_FAILED");
    }
    return privateResponse({ ok: true, ready: true, brief: receipt ? null : latest });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") !== req.nextUrl.origin || req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ApiError(403, "허용되지 않은 요청입니다.", "ORIGIN_NOT_ALLOWED");
    }
    const body = await req.json().catch(() => ({}));
    const storeId = String(body?.store || "").trim();
    const briefId = String(body?.briefId || "").trim();
    if (!briefId) throw new ApiError(400, "브리핑 정보를 확인해 주세요.", "AI_BRIEF_REQUIRED");

    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const { data: brief, error: briefError } = await admin
      .from("ai_briefs")
      .select("id")
      .eq("id", briefId)
      .eq("store_id", storeId)
      .maybeSingle();
    if (briefError) throw new ApiError(500, "AI 브리핑을 확인하지 못했습니다.", "AI_BRIEF_NOTICE_BRIEF_LOAD_FAILED");
    if (!brief) throw new ApiError(404, "이 매장의 브리핑을 찾을 수 없습니다.", "AI_BRIEF_NOTICE_NOT_FOUND");

    const { error } = await admin
      .from("ai_brief_read_receipts")
      .upsert({ brief_id: briefId, store_id: storeId, reader_user_id: userId, read_at: new Date().toISOString() }, { onConflict: "brief_id,reader_user_id" });
    if (error) {
      if (receiptTableNotReady(error)) throw new ApiError(503, "AI 브리핑 읽음 기록을 준비 중입니다.", "AI_BRIEF_NOTICE_NOT_READY");
      throw new ApiError(500, "AI 브리핑 읽음 기록을 저장하지 못했습니다.", "AI_BRIEF_NOTICE_SAVE_FAILED");
    }
    return privateResponse({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
