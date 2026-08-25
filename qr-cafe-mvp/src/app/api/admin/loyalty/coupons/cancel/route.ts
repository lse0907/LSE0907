import { NextRequest, NextResponse } from "next/server";
import {
  apiErrorResponse,
  createSupabaseAdminClient,
  requireStoreRole,
} from "../../../../_lib/storeAuth";

type CancelBody = {
  storeId?: string;
  couponId?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CancelBody;
    const storeId = String(body.storeId || "").trim();
    const couponId = String(body.couponId || "").trim();
    if (!storeId || !couponId) {
      return NextResponse.json(
        { ok: false, code: "COUPON_CANCEL_INPUT_INVALID", message: "취소할 쿠폰을 확인해주세요." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    const result = await supabaseAdmin.rpc("admin_cancel_customer_coupon", {
      p_store_id: storeId,
      p_coupon_id: couponId,
    });
    if (result.error) {
      return NextResponse.json(
        { ok: false, code: "COUPON_CANCEL_FAILED", message: result.error.message },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
