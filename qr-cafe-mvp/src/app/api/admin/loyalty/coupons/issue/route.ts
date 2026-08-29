import { NextRequest, NextResponse } from "next/server";
import {
  apiErrorResponse,
  createSupabaseAdminClient,
  requireStoreRole,
} from "../../../../_lib/storeAuth";

type IssueBody = {
  storeId?: string;
  templateId?: string;
  customerUserIds?: string[];
  excludeExisting?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IssueBody;
    const storeId = String(body.storeId || "").trim();
    const templateId = String(body.templateId || "").trim();
    const customerUserIds = Array.from(
      new Set((Array.isArray(body.customerUserIds) ? body.customerUserIds : []).map((id) => String(id).trim()).filter(Boolean)),
    );
    if (!storeId || !templateId || !customerUserIds.length) {
      return NextResponse.json(
        { ok: false, code: "COUPON_ISSUE_INPUT_INVALID", message: "쿠폰과 발급 고객을 확인해주세요." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    const settingsResult = await supabaseAdmin
      .from("store_loyalty_settings")
      .select("coupons_enabled")
      .eq("store_id", storeId)
      .maybeSingle();
    if (settingsResult.error && !/coupons_enabled|column/i.test(settingsResult.error.message)) {
      throw settingsResult.error;
    }
    if ((settingsResult.data as { coupons_enabled?: boolean } | null)?.coupons_enabled === false) {
      return NextResponse.json(
        { ok: false, code: "COUPON_ISSUANCE_DISABLED", message: "쿠폰 운영이 중지되어 새 쿠폰을 발급할 수 없습니다." },
        { status: 409 },
      );
    }
    const result = await supabaseAdmin.rpc("admin_issue_coupon_to_selected_customers", {
      p_store_id: storeId,
      p_template_id: templateId,
      p_customer_user_ids: customerUserIds,
      p_exclude_existing: body.excludeExisting !== false,
    });
    if (result.error) {
      const disabled = result.error.message.includes("COUPON_ISSUANCE_DISABLED");
      return NextResponse.json(
        {
          ok: false,
          code: disabled ? "COUPON_ISSUANCE_DISABLED" : "COUPON_ISSUE_FAILED",
          message: disabled ? "쿠폰 운영이 중지되어 새 쿠폰을 발급할 수 없습니다." : result.error.message,
        },
        { status: disabled ? 409 : 400 },
      );
    }
    const data = Array.isArray(result.data) ? result.data[0] || null : result.data;
    return NextResponse.json({ ok: true, result: data });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
