import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type StorePgConfigBody = {
  storeId?: unknown;
  mid?: unknown;
  clientKey?: unknown;
  secretKey?: unknown;
};

function configResponse(row: {
  mid?: unknown;
  client_key?: unknown;
  secret_key?: unknown;
  updated_at?: unknown;
}) {
  return {
    mid: String(row.mid || ""),
    clientKey: String(row.client_key || ""),
    hasSecret: Boolean(String(row.secret_key || "").trim()),
    updatedAt: String(row.updated_at || "").trim() || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) {
      return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const { data, error } = await supabaseAdmin
      .from("store_pg_config")
      .select("mid,client_key,secret_key,updated_at")
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, code: "STORE_PG_LOOKUP_FAILED", message: `PG 설정 확인 실패: ${error.message}` }, { status: 500 });
    }

    // Secret Key 원문은 브라우저로 보내지 않고 등록 여부만 전달합니다.
    return NextResponse.json({ ok: true, config: data ? configResponse(data) : null });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as StorePgConfigBody;
    const storeId = String(body.storeId || "").trim();
    const mid = String(body.mid || "").trim();
    const clientKey = String(body.clientKey || "").trim();
    const secretKey = String(body.secretKey || "").trim();

    if (!storeId) {
      return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });
    }
    if (!mid || !clientKey) {
      return NextResponse.json({ ok: false, code: "PG_CONFIG_REQUIRED", message: "MID와 Client Key를 입력해주세요." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const payload: {
      store_id: string;
      mid: string;
      client_key: string;
      updated_at: string;
      secret_key?: string;
    } = {
      store_id: storeId,
      mid,
      client_key: clientKey,
      updated_at: new Date().toISOString(),
    };
    // 빈 값은 기존 Secret Key를 유지하고, 새 값이 입력된 경우에만 교체합니다.
    if (secretKey) payload.secret_key = secretKey;

    const { data, error } = await supabaseAdmin
      .from("store_pg_config")
      .upsert(payload, { onConflict: "store_id" })
      .select("mid,client_key,secret_key,updated_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, code: "STORE_PG_SAVE_FAILED", message: `PG 설정 저장 실패: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, config: configResponse(data) });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
