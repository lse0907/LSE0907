import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOptionalRequestUserId } from "../../_lib/storeAuth";
import { createCheckoutAttempt, normalizeClientRequestId } from "../_lib/checkoutAttempts";
import { CheckoutPolicyError, requireStoreCheckoutMode } from "../_lib/checkoutPolicy";
import { OrderMode } from "../_lib/orderValidation";
import { validateOrderPayload } from "../_lib/orderValidation";

type QuoteBody = {
  storeId?: string;
  cartLines?: unknown;
  clientRequestId?: string;
  mode?: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  usedPoints?: number;
  usedCouponId?: string | null;
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuoteBody;
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });

    const requestUserId = await getOptionalRequestUserId(req);
    const clientRequestId = normalizeClientRequestId(body.clientRequestId);
    const mode: OrderMode = body.mode === "takeout" ? "takeout" : "dine-in";
    const supabaseAdmin = adminClient();
    await requireStoreCheckoutMode({
      supabaseAdmin,
      storeId,
      checkoutType: "prepaid",
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
      checkoutType: "prepaid",
      mode,
      table: body.table || null,
      requestNote: body.requestNote || "",
      customerUserId: requestUserId,
      validated,
    });

    return NextResponse.json({
      ok: true,
      quote: validated,
      checkout: {
        attemptId: checkout.attempt.id,
        clientRequestId: checkout.attempt.client_request_id,
        tossOrderId: checkout.attempt.toss_order_id,
        payableAmount: checkout.attempt.payable_amount,
        recoveryToken: checkout.recoveryToken,
        duplicate: checkout.duplicate,
      },
    });
  } catch (e: unknown) {
    if (e instanceof CheckoutPolicyError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message },
        { status: e.status },
      );
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, code: "ORDER_QUOTE_FAILED", message }, { status: 400 });
  }
}
