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

function isTemporaryGatewayError(message: string) {
  const normalized = String(message || "").trim().toLowerCase();
  return (
    normalized.includes("gateway timeout") ||
    normalized.includes("timeout") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    // This mutation is idempotent: repeating the same status/batch for the same
    // menu item cannot duplicate an order or a payment. A transient REST gateway
    // failure should therefore be recovered here, not shown as a failed kitchen action.
    let updateError: { message?: string } | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const updateRes = await supabaseAdmin
        .from("order_items")
        .update(payload)
        .eq("store_id", storeId)
        .in("id", itemIds);
      if (!updateRes.error) {
        return NextResponse.json({ ok: true });
      }

      updateError = updateRes.error;
      if (!isTemporaryGatewayError(updateRes.error.message) || attempt === 3) break;
      await wait(150 * attempt);
    }

    // A gateway can time out after PostgREST has committed the update. Read the
    // exact target rows before reporting a failure so staff never repeats work
    // just because the response was lost.
    const { data: verifiedRows, error: verificationError } = await supabaseAdmin
      .from("order_items")
      .select("id,status,batch")
      .eq("store_id", storeId)
      .in("id", itemIds);
    const expectedBatch = typeof payload.batch === "number" ? payload.batch : undefined;
    const updateWasPersisted =
      !verificationError &&
      Array.isArray(verifiedRows) &&
      verifiedRows.length === itemIds.length &&
      verifiedRows.every(
        (row) =>
          String(row.status || "") === status &&
          (typeof expectedBatch === "undefined" || Number(row.batch) === expectedBatch),
      );

    if (updateWasPersisted) {
      return NextResponse.json({ ok: true, recovered: true });
    }

    console.error("[orders/items/status] item status save unavailable", {
      storeId,
      itemCount: itemIds.length,
      status,
      message: updateError?.message || "unknown update error",
      verificationMessage: verificationError?.message || null,
    });

    if (isTemporaryGatewayError(updateError?.message || "")) {
      return NextResponse.json(
        {
          ok: false,
          code: "ITEM_STATUS_SAVE_TEMPORARILY_UNAVAILABLE",
          message: "메뉴 상태 저장이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, message: `아이템 상태 저장 실패: ${updateError?.message || "알 수 없는 오류"}` },
      { status: 500 },
    );

  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
