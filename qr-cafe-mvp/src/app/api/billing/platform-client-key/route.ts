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
    // 플랫폼 PG는 특정 매장/점주 소유 PG가 아니라 리온오더 공통 구독 결제용 PG입니다.
    // storeId는 PG 조회용 키가 아니라, 구독 결제를 요청한 사용자가 해당 매장의 owner인지 확인하기 위한 권한 검증용 값입니다.
    // 고객 주문 선결제는 비회원도 가능해야 하므로 이 API는 점주 구독 결제용 Client Key 제공에만 사용합니다.
    // 클라이언트에는 결제창 호출에 필요한 client_key만 반환하고, secret_key는 서버 결제 승인/취소 API에서만 사용합니다.
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
