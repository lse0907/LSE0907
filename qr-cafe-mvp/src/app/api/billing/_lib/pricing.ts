import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanMonths = 1 | 3 | 6 | 12;

export type BillingQuote = {
  storeId: string;
  planMonths: PlanMonths;
  payBase: boolean;
  payAddon: boolean;
  baseMonthlyKrw: number;
  addonMonthlyKrw: number;
  baseDiscountBps: number;
  addonDiscountBps: number;
  termDiscountBps: number;
  listAmountKrw: number;
  finalAmountKrw: number;
  discountAmountKrw: number;
  baseFinalAmountKrw: number;
  addonFinalAmountKrw: number;
  founderBase: boolean;
  founderAddon: boolean;
  multiStore: boolean;
  storeSequence: number;
  pricePolicyVersion: string;
  vatIncluded: boolean;
  discountLabels: string[];
};

type PolicyRow = {
  base_monthly_krw?: number | null;
  addon_monthly_krw?: number | null;
  three_month_discount_bps?: number | null;
  six_month_discount_bps?: number | null;
  twelve_month_discount_bps?: number | null;
  founder_discount_bps?: number | null;
  multi_store_discount_bps?: number | null;
  multi_store_total_cap_bps?: number | null;
  version?: string | null;
  vat_included?: boolean | null;
};

const DEFAULT_POLICY = {
  baseMonthly: 14_900,
  addonMonthly: 5_000,
  founderBps: 4_000,
  multiStoreBps: 1_500,
  multiStoreCapBps: 2_500,
  version: "live-v2",
  vatIncluded: true,
};

function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function termBps(row: PolicyRow, months: PlanMonths) {
  if (months === 3) return integer(row.three_month_discount_bps, 500);
  if (months === 6) return integer(row.six_month_discount_bps, 1_000);
  if (months === 12) return integer(row.twelve_month_discount_bps, 1_500);
  return 0;
}

function discounted(amount: number, bps: number) {
  return Math.round((amount * (10_000 - bps)) / 10_000);
}

export function normalizePlanMonths(value: unknown): PlanMonths | null {
  const months = Number(value);
  return months === 1 || months === 3 || months === 6 || months === 12 ? months : null;
}

export async function buildBillingQuote(params: {
  supabaseAdmin: SupabaseClient;
  storeId: string;
  userId: string;
  planMonths: PlanMonths;
  payBase: boolean;
  payAddon: boolean;
}): Promise<BillingQuote> {
  const { supabaseAdmin, storeId, userId, planMonths, payBase, payAddon } = params;
  const [policyRes, accountRes, baseRes] = await Promise.all([
    supabaseAdmin.from("billing_price_policies").select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin
      .from("billing_accounts")
      .select("id,founder_member,billing_account_stores!inner(store_id,store_sequence,founder_base_discount,founder_addon_discount)")
      .eq("owner_user_id", userId)
      .eq("billing_account_stores.store_id", storeId)
      .maybeSingle(),
    supabaseAdmin.from("store_billing").select("base_plan_status,paid_until").eq("store_id", storeId).maybeSingle(),
  ]);

  if (policyRes.error) throw new Error(`가격 정책 조회 실패: ${policyRes.error.message}`);
  if (accountRes.error) throw new Error(`할인 자격 조회 실패: ${accountRes.error.message}`);

  const policy = (policyRes.data || {}) as PolicyRow;
  const relation = Array.isArray(accountRes.data?.billing_account_stores)
    ? accountRes.data.billing_account_stores[0]
    : accountRes.data?.billing_account_stores;
  const storeSequence = integer(relation?.store_sequence, 1) || 1;
  const founderMember = accountRes.data?.founder_member === true;
  const founderBase = founderMember && relation?.founder_base_discount === true;
  const founderAddon = founderMember && relation?.founder_addon_discount === true;
  const multiStore = storeSequence > 1;
  const baseMonthlyKrw = integer(policy.base_monthly_krw, DEFAULT_POLICY.baseMonthly);
  const addonMonthlyKrw = integer(policy.addon_monthly_krw, DEFAULT_POLICY.addonMonthly);
  const founderDiscountBps = integer(policy.founder_discount_bps, DEFAULT_POLICY.founderBps);
  const multiStoreDiscountBps = integer(policy.multi_store_discount_bps, DEFAULT_POLICY.multiStoreBps);
  const multiStoreCapBps = integer(policy.multi_store_total_cap_bps, DEFAULT_POLICY.multiStoreCapBps);
  const selectedTermBps = termBps(policy, planMonths);

  if (!payBase && payAddon) {
    const paidUntil = new Date(String(baseRes.data?.paid_until || "")).getTime();
    const baseActive = baseRes.data?.base_plan_status === "active" || (Number.isFinite(paidUntil) && paidUntil > Date.now());
    if (!baseActive) throw new Error("옵션 단독 결제는 기본 구독이 활성 상태일 때만 가능합니다.");
  }

  let baseDiscountBps = 0;
  let addonDiscountBps = 0;
  if (founderBase) {
    baseDiscountBps = founderDiscountBps;
  } else if (multiStore) {
    const combined = 10_000 - Math.round(((10_000 - multiStoreDiscountBps) * (10_000 - selectedTermBps)) / 10_000);
    baseDiscountBps = Math.min(combined, multiStoreCapBps);
  } else {
    baseDiscountBps = selectedTermBps;
  }
  addonDiscountBps = founderAddon ? founderDiscountBps : selectedTermBps;

  const baseList = payBase ? baseMonthlyKrw * planMonths : 0;
  const addonList = payAddon ? addonMonthlyKrw * planMonths : 0;
  const baseFinal = payBase ? discounted(baseList, baseDiscountBps) : 0;
  const addonFinal = payAddon ? discounted(addonList, addonDiscountBps) : 0;
  const listAmount = baseList + addonList;
  const finalAmount = baseFinal + addonFinal;
  const labels: string[] = [];
  if (founderBase && payBase) labels.push("기본 구독 창립 멤버 40%");
  if (founderAddon && payAddon) labels.push("선결제 옵션 창립 멤버 40%");
  if (multiStore && payBase && !founderBase) labels.push("추가 매장 기본 구독 15%");
  if (selectedTermBps && ((payBase && !founderBase) || (payAddon && !founderAddon))) labels.push(`${planMonths}개월 장기 구독 ${selectedTermBps / 100}%`);
  if (multiStore && baseDiscountBps === multiStoreCapBps && selectedTermBps) labels.push("기본 구독 총 할인 25% 상한");

  return {
    storeId,
    planMonths,
    payBase,
    payAddon,
    baseMonthlyKrw,
    addonMonthlyKrw,
    baseDiscountBps,
    addonDiscountBps,
    termDiscountBps: selectedTermBps,
    listAmountKrw: listAmount,
    finalAmountKrw: finalAmount,
    discountAmountKrw: listAmount - finalAmount,
    baseFinalAmountKrw: baseFinal,
    addonFinalAmountKrw: addonFinal,
    founderBase,
    founderAddon,
    multiStore,
    storeSequence,
    pricePolicyVersion: String(policy.version || DEFAULT_POLICY.version),
    vatIncluded: policy.vat_included !== false,
    discountLabels: labels,
  };
}
