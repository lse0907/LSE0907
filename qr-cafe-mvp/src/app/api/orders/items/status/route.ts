import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type ItemStatus = "waiting" | "making" | "done";

type ItemsStatusBody = {
  storeId?: string;
  itemIds?: string[];
  status?: ItemStatus;
  batch?: number | null;
};

function normalizeItemStatus(raw: unknown): ItemStatus | null {
  const status = String(raw || "").trim();
  if (status === "waiting" || status === "making" || status === "done") return status;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ItemsStatusBody;
    const storeId = String(body.storeId || "").trim();
    const itemIds = Array.isArray(body.itemIds) ? Array.from(new Set(body.itemIds.map((id) => String(id || "").trim()).filter(Boolean))) : [];
    const status = normalizeItemStatus(body.status);

    if (!storeId || !itemIds.length || !status) {
      return NextResponse.json({ ok: false, message: "필수 파라미터(storeId, itemIds, status)가 누락되었습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("id,store_id")
      .eq("store_id", storeId)
      .in("id", itemIds);
    if (error) return NextResponse.json({ ok: false, message: `주문 아이템 조회 실패: ${error.message}` }, { status: 500 });

    const foundIds = new Set((Array.isArray(data) ? data : []).map((row) => String((row as { id?: string }).id || "")));
    if (foundIds.size !== itemIds.length) {
      return NextResponse.json({ ok: false, message: "다른 매장의 주문 아이템이 포함되었거나 아이템을 찾을 수 없습니다." }, { status: 403 });
    }

    const payload: Record<string, unknown> = { status };
    if (typeof body.batch !== "undefined" && body.batch !== null) {
      const batch = Number(body.batch);
      if (!Number.isFinite(batch) || batch < 0) {
        return NextResponse.json({ ok: false, message: "제조 순번(batch)은 0 이상의 숫자여야 합니다." }, { status: 400 });
      }
      payload.batch = Math.floor(batch);
    }

    const updateRes = await supabaseAdmin.from("order_items").update(payload).eq("store_id", storeId).in("id", itemIds);
    if (updateRes.error) return NextResponse.json({ ok: false, message: `아이템 상태 저장 실패: ${updateRes.error.message}` }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
