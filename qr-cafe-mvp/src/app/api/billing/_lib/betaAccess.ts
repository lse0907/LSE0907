import type { SupabaseClient } from "@supabase/supabase-js";

export type BetaAccess = {
  active: boolean;
  prepayIncluded: boolean;
  startsAt: string | null;
  endsAt: string | null;
  postBetaDiscountBps: number;
  reason: string;
};

const INACTIVE: BetaAccess = {
  active: false,
  prepayIncluded: false,
  startsAt: null,
  endsAt: null,
  postBetaDiscountBps: 4000,
  reason: "",
};

function missingRelation(error: { code?: string | null } | null) {
  return ["42P01", "PGRST205"].includes(String(error?.code || ""));
}

export async function getStoreBetaAccess(admin: SupabaseClient, storeId: string): Promise<BetaAccess> {
  const result = await admin
    .from("store_beta_access")
    .select("status,prepay_included,starts_at,ends_at,post_beta_discount_bps,reason")
    .eq("store_id", storeId)
    .maybeSingle();
  if (result.error) {
    // Deploying application code before the migration must not make a store
    // unusable. Once the migration is applied, other lookup failures surface.
    if (missingRelation(result.error)) return INACTIVE;
    throw new Error("베타 이용 상태를 확인하지 못했습니다.");
  }
  const row = result.data;
  const endsAt = String(row?.ends_at || "").trim() || null;
  const endTime = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  const active = row?.status === "active" && (!endsAt || (Number.isFinite(endTime) && endTime > Date.now()));
  return {
    active,
    prepayIncluded: active && row?.prepay_included === true,
    startsAt: String(row?.starts_at || "").trim() || null,
    endsAt,
    postBetaDiscountBps: Math.max(0, Math.min(10000, Number(row?.post_beta_discount_bps || 4000))),
    reason: String(row?.reason || "").trim(),
  };
}

export function betaPaymentMessage() {
  return "베타 이용 중인 매장은 정식 출시 전까지 별도 구독 결제가 필요하지 않습니다.";
}
