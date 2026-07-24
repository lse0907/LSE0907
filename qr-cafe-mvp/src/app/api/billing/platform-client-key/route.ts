import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const storeId = String(searchParams.get("storeId") || "").trim();
    if (!storeId) {
      return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const { data, error } = await supabaseAdmin
      .from("platform_pg_config")
      .select("client_key")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, code: "PLATFORM_PG_LOOKUP_FAILED", message: `구독 결제 설정 확인 실패: ${error.message}` }, { status: 500 });
    }

    const clientKey = String(data?.client_key || "").trim();
    if (!clientKey) {
      return NextResponse.json({ ok: false, code: "PLATFORM_CLIENT_KEY_MISSING", message: "구독 결제 설정이 아직 완료되지 않았습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, clientKey });
  } catch (e: unknown) {
    return apiErrorResponse(e);
  }
}
