import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOptionalRequestUserId } from "../../_lib/storeAuth";
import {
  createCheckoutAttempt,
  finalizeCheckoutAttempt,
  normalizeClientRequestId,
  orderResponse,
} from "../_lib/checkoutAttempts";
import { CheckoutPolicyError, requireStoreCheckoutMode } from "../_lib/checkoutPolicy";
import { OrderMode, validateOrderPayload } from "../_lib/orderValidation";

type CreateBody = {
  storeId?: string;
  cartLines?: unknown;
  clientRequestId?: string;
  mode?: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  usedPoints?: number;
  usedCouponId?: string | null;
  paymentStatus?: string;
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });

    if (body.paymentStatus === "paid" || body.paymentStatus === "pending" || body.paymentKey || body.tossOrderId) {
      return NextResponse.json(
        {
          ok: false,
          code: "PAID_ORDER_REQUIRES_APPROVED_ATTEMPT",
          message: "선결제 주문은 서버에서 승인된 결제시도를 통해서만 접수할 수 있습니다.",
        },
        { status: 409 },
      );
    }

    const clientRequestId = normalizeClientRequestId(body.clientRequestId);
    const requestUserId = await getOptionalRequestUserId(req);
    const supabaseAdmin = adminClient();
    await requireStoreCheckoutMode({
      supabaseAdmin,
      storeId,
      checkoutType: "postpaid",
    });
    const validated = await validateOrderPayload({
      supabaseAdmin,
      storeId,
      cartLines: body.cartLines,
      customerUserId: requestUserId,
      usedPoints: requestUserId ? body.usedPoints || 0 : 0,
      usedCouponId: requestUserId ? body.usedCouponId || null : null,
    });

    const checkout = await createCheckoutAttempt({
      supabaseAdmin,
      storeId,
      clientRequestId,
      checkoutType: "postpaid",
      mode: normalizeMode(body.mode),
      table: body.table || null,
      requestNote: body.requestNote || "",
      customerUserId: requestUserId,
      validated,
    });
    const finalized = await finalizeCheckoutAttempt(supabaseAdmin, checkout.attempt.id);

    return NextResponse.json({
      ok: true,
      order: orderResponse(finalized),
      duplicate: checkout.duplicate,
    });
  } catch (e: unknown) {
    if (e instanceof CheckoutPolicyError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message },
        { status: e.status },
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    const conflict = message.includes("CLIENT_REQUEST_ID_REUSED_WITH_DIFFERENT_ORDER");
    return NextResponse.json(
      { ok: false, code: conflict ? "CLIENT_REQUEST_CONFLICT" : "ORDER_CREATE_FAILED", message },
      { status: conflict ? 409 : 400 },
    );
  }
}
