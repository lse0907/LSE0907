import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseAdminClient,
  getOptionalRequestUserId,
} from "../../_lib/storeAuth";
import { validateOrderPayload } from "../_lib/orderValidation";

type PreviewBody = {
  storeId?: string;
  cartLines?: unknown;
  usedPoints?: number;
  usedCouponId?: string | null;
};

type SettingsRow = {
  points_enabled?: boolean;
  coupons_enabled?: boolean;
  tier_general_rate_pct?: number;
  tier_regular_rate_pct?: number;
  tier_vip_rate_pct?: number;
};

function rateForTier(settings: SettingsRow | null, tier: string) {
  if (tier === "vip") return Math.max(0, Number(settings?.tier_vip_rate_pct ?? 5));
  if (tier === "regular") return Math.max(0, Number(settings?.tier_regular_rate_pct ?? 3));
  return Math.max(0, Number(settings?.tier_general_rate_pct ?? 2));
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PreviewBody;
    const storeId = String(body.storeId || "").trim();
    if (!storeId) {
      return NextResponse.json({ ok: false, code: "STORE_REQUIRED", message: "매장 정보가 없습니다." }, { status: 400 });
    }

    const userId = await getOptionalRequestUserId(req);
    const admin = createSupabaseAdminClient();
    const validated = await validateOrderPayload({
      supabaseAdmin: admin,
      storeId,
      cartLines: body.cartLines,
      customerUserId: userId,
      usedPoints: userId ? body.usedPoints || 0 : 0,
      usedCouponId: userId ? body.usedCouponId || null : null,
    });

    let settingsResult = await admin
      .from("store_loyalty_settings")
      .select("points_enabled,coupons_enabled,tier_general_rate_pct,tier_regular_rate_pct,tier_vip_rate_pct")
      .eq("store_id", storeId)
      .maybeSingle();
    if (settingsResult.error && /points_enabled|coupons_enabled|column/i.test(settingsResult.error.message)) {
      settingsResult = await admin
        .from("store_loyalty_settings")
        .select("tier_general_rate_pct,tier_regular_rate_pct,tier_vip_rate_pct")
        .eq("store_id", storeId)
        .maybeSingle() as typeof settingsResult;
    }
    if (settingsResult.error) throw settingsResult.error;

    let tier = "general";
    if (userId) {
      const walletResult = await admin
        .from("customer_store_wallets")
        .select("tier")
        .eq("store_id", storeId)
        .eq("customer_user_id", userId)
        .maybeSingle();
      if (walletResult.error) throw walletResult.error;
      tier = String((walletResult.data as { tier?: string } | null)?.tier || "general");
    }

    const settings = settingsResult.data as SettingsRow | null;
    const pointsEnabled = settings?.points_enabled !== false;
    const ratePct = rateForTier(settings, userId ? tier : "general");
    const estimatedEarnedPoints = userId && pointsEnabled
      ? Math.floor((validated.payableAmount * ratePct) / 100)
      : 0;

    return NextResponse.json({
      ok: true,
      loyalty: {
        pointsEnabled,
        couponsEnabled: settings?.coupons_enabled !== false,
        eligible: Boolean(userId),
        tier,
        ratePct,
        estimatedEarnedPoints,
        payableAmount: validated.payableAmount,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "포인트 안내를 불러오지 못했습니다.";
    return NextResponse.json({ ok: false, code: "LOYALTY_PREVIEW_FAILED", message }, { status: 400 });
  }
}
