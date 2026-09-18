import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });

    const account = await admin
      .from("billing_accounts")
      .select("id,billing_account_stores(store_id)")
      .eq("owner_user_id", userId)
      .maybeSingle();
    if (account.error) throw new Error(`크레딧 계정을 확인하지 못했습니다: ${account.error.message}`);

    const accountId = Number(account.data?.id || 0);
    const ownedStoreIds = (account.data?.billing_account_stores || [])
      .map((row: { store_id?: string | null }) => String(row.store_id || ""))
      .filter(Boolean);
    const [summary, entries, pendingRewards] = await Promise.all([
      admin.rpc("get_billing_credit_summary", { p_user_id: userId, p_store_id: storeId }),
      accountId
        ? admin
          .from("billing_credit_ledger")
          .select("id,entry_type,amount_krw,reason,created_at")
          .eq("billing_account_id", accountId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(30)
        : Promise.resolve({ data: [], error: null }),
      ownedStoreIds.length
        ? admin
          .from("billing_referrals")
          .select("id,hold_until")
          .in("referring_store_id", ownedStoreIds)
          .eq("status", "reward_pending")
          .order("hold_until", { ascending: true })
          .limit(10)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (summary.error) throw new Error(`크레딧 잔액을 확인하지 못했습니다: ${summary.error.message}`);
    if (entries.error) throw new Error(`크레딧 내역을 확인하지 못했습니다: ${entries.error.message}`);
    if (pendingRewards.error) throw new Error(`적립 예정 내역을 확인하지 못했습니다: ${pendingRewards.error.message}`);

    const availableKrw = Math.max(0, Math.round(Number((summary.data as { availableKrw?: unknown } | null)?.availableKrw || 0)));
    return NextResponse.json({
      ok: true,
      availableKrw,
      entries: (entries.data || []).map((entry) => ({
        id: Number(entry.id),
        entryType: String(entry.entry_type || ""),
        amountKrw: Number(entry.amount_krw || 0),
        reason: String(entry.reason || "크레딧 변동"),
        createdAt: String(entry.created_at || ""),
      })),
      pendingRewards: (pendingRewards.data || []).map((reward) => ({
        id: Number(reward.id),
        holdUntil: reward.hold_until ? String(reward.hold_until) : null,
      })),
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
