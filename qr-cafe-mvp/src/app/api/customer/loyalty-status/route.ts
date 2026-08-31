import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdminClient } from "../../_lib/storeAuth";

type StatusBody = { storeIds?: string[] };

export async function POST(req: NextRequest) {
  try {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    if (!url || !anon) throw new Error("서버 설정을 확인해 주세요.");
    const auth = createServerClient(url, anon, {
      cookies: {
        get: (name) => req.cookies.get(name)?.value,
        set() {},
        remove() {},
      },
    });
    const { data } = await auth.auth.getUser();
    if (!data.user) {
      return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = (await req.json()) as StatusBody;
    const requested = Array.from(new Set(
      (Array.isArray(body.storeIds) ? body.storeIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )).slice(0, 50);
    if (!requested.length) return NextResponse.json({ ok: true, stores: [] });

    const admin = createSupabaseAdminClient();
    const walletResult = await admin
      .from("customer_store_wallets")
      .select("store_id")
      .eq("customer_user_id", data.user.id)
      .in("store_id", requested);
    if (walletResult.error) throw walletResult.error;
    const allowed = Array.from(new Set((walletResult.data || []).map((row) => String(row.store_id || "")).filter(Boolean)));
    if (!allowed.length) return NextResponse.json({ ok: true, stores: [] });

    await Promise.all(allowed.map((storeId) => admin.rpc("refresh_store_loyalty_program_status", { p_store_id: storeId })));

    const settingsResult = await admin
      .from("store_loyalty_settings")
      .select("store_id,points_enabled,coupons_enabled,points_program_status,coupons_program_status,points_redemption_ends_at")
      .in("store_id", allowed);
    if (settingsResult.error && /points_enabled|coupons_enabled|column/i.test(settingsResult.error.message)) {
      return NextResponse.json({
        ok: true,
        stores: allowed.map((storeId) => ({ storeId, pointsEnabled: true, couponsEnabled: true })),
      });
    }
    if (settingsResult.error) throw settingsResult.error;
    const byStore = new Map((settingsResult.data || []).map((row) => [String(row.store_id), row]));

    return NextResponse.json({
      ok: true,
      stores: allowed.map((storeId) => {
        const row = byStore.get(storeId) as {
          points_enabled?: boolean;
          coupons_enabled?: boolean;
          points_program_status?: string;
          coupons_program_status?: string;
          points_redemption_ends_at?: string | null;
        } | undefined;
        return {
          storeId,
          pointsEnabled: row?.points_enabled === true,
          couponsEnabled: row?.coupons_enabled === true,
          pointsProgramStatus: row?.points_program_status || (row?.points_enabled ? "active" : "inactive"),
          couponsProgramStatus: row?.coupons_program_status || (row?.coupons_enabled ? "active" : "inactive"),
          pointsRedemptionEndsAt: row?.points_redemption_ends_at || null,
        };
      }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "운영 상태를 불러오지 못했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
