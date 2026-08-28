import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  apiErrorResponse,
  createSupabaseAdminClient,
} from "../../_lib/storeAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomerOrderViewBody = {
  storeId?: string;
  orderId?: string;
  accessToken?: string;
};

type CustomerOrderDbRow = {
  id: string;
  created_at?: string | null;
  order_date?: string | null;
  display_no?: string | null;
  mode?: string | null;
  table_no?: string | null;
  buzzer_no?: string | null;
  request_note?: string | null;
  total_count?: number | null;
  total_price?: number | null;
  status?: string | null;
  payment_status?: string | null;
  earned_points?: number | null;
  points_rate_snapshot?: number | null;
  store_id?: string | null;
  access_token?: string | null;
};

const CUSTOMER_ORDER_COLUMNS = [
  "id",
  "created_at",
  "order_date",
  "display_no",
  "mode",
  "table_no",
  "buzzer_no",
  "request_note",
  "total_count",
  "total_price",
  "status",
  "payment_status",
  "earned_points",
  "points_rate_snapshot",
  "store_id",
  "access_token",
].join(",");

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};

function hasValidInputLength(storeId: string, orderId: string, accessToken: string) {
  return (
    storeId.length > 0 &&
    storeId.length <= 120 &&
    orderId.length > 0 &&
    orderId.length <= 80 &&
    accessToken.length > 0 &&
    accessToken.length <= 200
  );
}

function secureTokenMatches(expected: unknown, received: string) {
  const expectedBuffer = Buffer.from(String(expected || "").trim(), "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  if (!expectedBuffer.length || expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function notFoundResponse() {
  return NextResponse.json(
    {
      ok: false,
      code: "ORDER_NOT_FOUND",
      message: "주문 정보를 확인할 수 없습니다.",
    },
    { status: 404, headers: NO_STORE_HEADERS },
  );
}

export async function POST(req: NextRequest) {
  try {
    let body: CustomerOrderViewBody;
    try {
      body = (await req.json()) as CustomerOrderViewBody;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_REQUEST_BODY",
          message: "요청 형식이 올바르지 않습니다.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    const storeId = String(body?.storeId || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const accessToken = String(body?.accessToken || "").trim();

    if (!hasValidInputLength(storeId, orderId, accessToken)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_ORDER_ACCESS",
          message: "주문 확인 정보가 올바르지 않습니다.",
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(CUSTOMER_ORDER_COLUMNS)
      .eq("id", orderId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      console.error("[customer-order-view] lookup failed:", error.message);
      return NextResponse.json(
        {
          ok: false,
          code: "ORDER_LOOKUP_FAILED",
          message: "주문 정보를 불러오지 못했습니다.",
        },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }

    const order = data as unknown as CustomerOrderDbRow | null;
    if (!order || !secureTokenMatches(order.access_token, accessToken)) {
      return notFoundResponse();
    }

    const {
      access_token: _accessToken,
      ...customerSafeOrder
    } = order;
    void _accessToken;

    return NextResponse.json(
      { ok: true, order: customerSafeOrder },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    const response = apiErrorResponse(error);
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  }
}
