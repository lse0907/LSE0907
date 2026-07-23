import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createValidatedOrder } from "../_lib/orderInsert";
import { OrderMode, PaymentStatus, validateOrderPayload } from "../_lib/orderValidation";

type ExistingOrder = {
  id: string;
  access_token: string | null;
  order_date: string | null;
  display_no: number | null;
  total_count: number | null;
  total_price: number | null;
  payment_status: string | null;
};

type CreateBody = {
  storeId?: string;
  cartLines?: unknown;
  mode?: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  usedPoints?: number;
  usedCouponId?: string | null;
  paymentStatus?: PaymentStatus;
  paymentKey?: string | null;
  tossOrderId?: string | null;
  paidAmount?: number;
};

function adminClient() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRole =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!supabaseUrl || !serviceRole) throw new Error("서버 환경변수(SUPABASE)가 필요합니다.");
  return createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function normalizeMode(raw: unknown): OrderMode {
  return raw === "takeout" ? "takeout" : "dine-in";
}

function normalizePaymentStatus(raw: unknown): PaymentStatus {
  return raw === "paid" || raw === "pending" ? raw : "not_required";
}

function orderResponse(row: ExistingOrder) {
  return {
    orderId: row.id,
    accessToken: row.access_token || "",
    orderDate: row.order_date || "",
    displayNo: row.display_no || 0,
    totalCount: row.total_count || 0,
    totalPrice: row.total_price || 0,
    payableAmount: row.total_price || 0,
  };
}

async function findExistingPaidOrder(
  supabaseAdmin: ReturnType<typeof adminClient>,
  storeId: string,
  paymentKey: string,
  tossOrderId: string
) {
  const paymentColumns = [
    { column: "payment_key", value: paymentKey },
    { column: "toss_order_id", value: tossOrderId },
  ].filter((x) => x.value);

  for (const item of paymentColumns) {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, access_token, order_date, display_no, total_count, total_price, payment_status")
      .eq("store_id", storeId)
      .eq(item.column, item.value)
      .maybeSingle();

    if (!error && data) return data as ExistingOrder;

    const message = String(error?.message || "").toLowerCase();
    if (message.includes("column") || message.includes("schema cache")) continue;
    if (error && error.code !== "PGRST116") throw error;
  }

  return null;
}

async function getRequestUserId(req: NextRequest) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !anonKey) return null;

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });

    const paymentStatus = normalizePaymentStatus(body.paymentStatus);
    const requestUserId = await getRequestUserId(req);
    const supabaseAdmin = adminClient();
    const validated = await validateOrderPayload({
      supabaseAdmin,
      storeId,
      cartLines: body.cartLines,
      customerUserId: requestUserId,
      usedPoints: requestUserId ? body.usedPoints || 0 : 0,
      usedCouponId: requestUserId ? body.usedCouponId || null : null,
    });

    if (paymentStatus === "paid") {
      const paidAmount = Number(body.paidAmount || 0);
      if (!Number.isFinite(paidAmount) || Math.round(paidAmount) !== validated.payableAmount) {
        return NextResponse.json(
          { ok: false, code: "AMOUNT_MISMATCH", message: "결제 금액이 달라요. 다시 확인해주세요.", expectedAmount: validated.payableAmount, actualAmount: paidAmount },
          { status: 409 }
        );
      }
      if (!String(body.paymentKey || "").trim() || !String(body.tossOrderId || "").trim()) {
        return NextResponse.json({ ok: false, code: "PAYMENT_IDENTIFIERS_MISSING", message: "결제 정보가 부족합니다." }, { status: 400 });
      }
    }

    if (paymentStatus === "paid") {
      const existing = await findExistingPaidOrder(
        supabaseAdmin,
        storeId,
        String(body.paymentKey || "").trim(),
        String(body.tossOrderId || "").trim()
      );
      if (existing) return NextResponse.json({ ok: true, order: orderResponse(existing), duplicate: true });
    }

    const created = await createValidatedOrder({
      supabaseAdmin,
      storeId,
      mode: normalizeMode(body.mode),
      table: body.table || null,
      requestNote: body.requestNote || "",
      paymentStatus,
      paymentKey: body.paymentKey || null,
      tossOrderId: body.tossOrderId || null,
      customerUserId: requestUserId,
      validated,
    });

    return NextResponse.json({ ok: true, order: created });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, code: "ORDER_CREATE_FAILED", message }, { status: 400 });
  }
}
