import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type SettingsBody = {
  storeId?: unknown;
  pointsEnabled?: unknown;
  couponsEnabled?: unknown;
  reason?: unknown;
  policy?: Record<string, unknown>;
};

const POLICY_FIELDS = [
  "tier_general_rate_pct",
  "tier_regular_rate_pct",
  "tier_vip_rate_pct",
  "thank_you_every_n_orders",
  "max_redeem_pct",
  "min_redeem_points",
  "point_expiry_months",
  "allow_point_or_coupon_only",
] as const;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SettingsBody;
    const storeId = String(body.storeId || "").trim();
    if (!storeId) throw new ApiError(400, "매장 정보가 필요합니다.", "STORE_ID_REQUIRED");

    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const currentRes = await admin
      .from("store_loyalty_settings")
      .select("points_enabled,coupons_enabled")
      .eq("store_id", storeId)
      .maybeSingle();
    if (currentRes.error) throw new ApiError(500, "운영 설정을 확인하지 못했습니다.", "LOYALTY_SETTINGS_LOOKUP_FAILED");

    const current = currentRes.data as { points_enabled?: boolean; coupons_enabled?: boolean } | null;
    const requestedPoints = typeof body.pointsEnabled === "boolean" ? body.pointsEnabled : current?.points_enabled === true;
    const requestedCoupons = typeof body.couponsEnabled === "boolean" ? body.couponsEnabled : current?.coupons_enabled === true;
    const reason = String(body.reason || "점주 운영 설정 변경").trim().slice(0, 500);

    if ((current?.points_enabled === true) !== requestedPoints) {
      const result = await admin.rpc("set_store_loyalty_program_state", {
        p_store_id: storeId,
        p_benefit_type: "points",
        p_enabled: requestedPoints,
        p_actor_user_id: actor.userId,
        p_reason: reason,
      });
      if (result.error) throw new ApiError(500, "포인트 운영 상태를 저장하지 못했습니다.", "POINT_PROGRAM_UPDATE_FAILED");
    }

    if ((current?.coupons_enabled === true) !== requestedCoupons) {
      const result = await admin.rpc("set_store_loyalty_program_state", {
        p_store_id: storeId,
        p_benefit_type: "coupons",
        p_enabled: requestedCoupons,
        p_actor_user_id: actor.userId,
        p_reason: reason,
      });
      if (result.error) throw new ApiError(500, "쿠폰 운영 상태를 저장하지 못했습니다.", "COUPON_PROGRAM_UPDATE_FAILED");
    }

    const policy = body.policy && typeof body.policy === "object" ? body.policy : {};
    const patch: Record<string, unknown> = { updated_by: actor.userId };
    for (const key of POLICY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(policy, key)) patch[key] = policy[key];
    }
    if (Object.keys(patch).length > 1) {
      const updateRes = await admin.from("store_loyalty_settings").update(patch).eq("store_id", storeId);
      if (updateRes.error) throw new ApiError(500, "포인트 정책을 저장하지 못했습니다.", "LOYALTY_POLICY_UPDATE_FAILED");
    }

    const savedRes = await admin
      .from("store_loyalty_settings")
      .select("store_id,points_enabled,coupons_enabled,points_program_status,coupons_program_status,points_closure_notice_at,points_redemption_ends_at,coupons_closure_notice_at,tier_general_rate_pct,tier_regular_rate_pct,tier_vip_rate_pct,thank_you_every_n_orders,max_redeem_pct,min_redeem_points,point_expiry_months,allow_point_or_coupon_only")
      .eq("store_id", storeId)
      .single();
    if (savedRes.error) throw new ApiError(500, "저장 결과를 불러오지 못했습니다.", "LOYALTY_SETTINGS_RESULT_FAILED");
    return NextResponse.json({ ok: true, settings: savedRes.data });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
