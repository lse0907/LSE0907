import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type PackingBody = {
  storeId?: string;
  orderId?: string;
  itemIds?: string[];
  checked?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PackingBody;
    const storeId = String(body.storeId || "").trim();
    const orderId = String(body.orderId || "").trim();
    const itemIds = Array.isArray(body.itemIds) ? Array.from(new Set(body.itemIds.map((id) => String(id || "").trim()).filter(Boolean))) : [];
    const checked = !!body.checked;

    if (!storeId || !orderId || !itemIds.length) {
      return NextResponse.json({ ok: false, message: "필수 파라미터(storeId, orderId, itemIds)가 누락되었습니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner", "manager", "staff"] });

    const { data, error } = await supabaseAdmin
      .from("order_items")
      .select("id,order_id,store_id,status")
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .in("id", itemIds);
    if (error) return NextResponse.json({ ok: false, message: `준비 확인 대상 조회 실패: ${error.message}` }, { status: 500 });

    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== itemIds.length) {
      return NextResponse.json({ ok: false, message: "다른 매장의 주문 아이템이 포함되었거나 아이템을 찾을 수 없습니다." }, { status: 403 });
    }
    const notDone = rows.find((row) => String((row as { status?: string | null }).status || "") !== "done");
    if (notDone) {
      return NextResponse.json({ ok: false, message: "제조 완료된 아이템만 준비 확인할 수 있습니다." }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const upsertRows = itemIds.map((itemId) => ({
      store_id: storeId,
      order_id: orderId,
      order_item_id: itemId,
      checked,
      checked_at: checked ? nowIso : null,
    }));

    const upsertRes = await supabaseAdmin.from("order_item_packing_checks").upsert(upsertRows, { onConflict: "order_item_id" });
    if (upsertRes.error) return NextResponse.json({ ok: false, message: `준비 확인 저장 실패: ${upsertRes.error.message}` }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
