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
  referralDiscountKrw: number;
  creditAvailableKrw: number;
  creditRequestedKrw: number;
  creditAppliedKrw: number;
  externalAmountKrw: number;
  baseFinalBeforeCreditKrw: number;
  baseExternalAmountKrw: number;
  addonExternalAmountKrw: number;
  referralId: number | null;
  baseFinalAmountKrw: number;
  addonFinalAmountKrw: number;
  founderBase: boolean;
  founderAddon: boolean;
  multiStore: boolean;
  storeSequence: number;
  pricePolicyVersion: string;
  vatIncluded: boolean;
  discountLabels: string[];
  expectedBaseStartAt: string | null;
  expectedBaseEndAt: string | null;
  expectedAddonStartAt: string | null;
  expectedAddonEndAt: string | null;
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
  referrals_enabled?: boolean | null;
  referral_discount_krw?: number | null;
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

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function nextKstMidnight() {
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - KST_OFFSET_MS);
}

function addCalendarMonthsKst(anchor: Date, months: number) {
  const shifted = new Date(anchor.getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const targetFirst = new Date(Date.UTC(year, month + months, 1));
  const targetYear = targetFirst.getUTCFullYear();
  const targetMonth = targetFirst.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(day, lastDay),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
    shifted.getUTCMilliseconds(),
  ) - KST_OFFSET_MS);
}

function activeAnchor(value: unknown, fallback: Date) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) && parsed > fallback ? parsed : fallback;
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
  creditRequestedKrw?: number;
}): Promise<BillingQuote> {
  const { supabaseAdmin, storeId, userId, planMonths, payBase, payAddon } = params;
  const creditRequestedKrw = integer(params.creditRequestedKrw, 0);
  const [policyRes, accountRes, baseRes, addonRes, referralRes, previousBaseRes, creditRes] = await Promise.all([
    supabaseAdmin.from("billing_price_policies").select("*").eq("id", 1).maybeSingle(),
    supabaseAdmin
      .from("billing_accounts")
      .select("id,founder_member,billing_account_stores!inner(store_id,store_sequence,founder_base_discount,founder_addon_discount)")
      .eq("owner_user_id", userId)
      .eq("billing_account_stores.store_id", storeId)
      .maybeSingle(),
    supabaseAdmin.from("store_billing").select("base_plan_status,paid_until").eq("store_id", storeId).maybeSingle(),
    supabaseAdmin.from("store_addons").select("prepay_addon_status,addon_paid_until").eq("store_id", storeId).maybeSingle(),
    supabaseAdmin.from("billing_referrals").select("id,referring_store_id,referred_store_id,status,first_payment_id").eq("referred_user_id", userId).maybeSingle(),
    supabaseAdmin.from("billing_payments").select("id").eq("store_id", storeId).eq("base_paid", true).limit(1),
    supabaseAdmin.rpc("get_billing_credit_summary", { p_user_id: userId, p_store_id: storeId }),
  ]);

  if (policyRes.error) throw new Error(`가격 정책 조회 실패: ${policyRes.error.message}`);
  if (accountRes.error) throw new Error(`할인 자격 조회 실패: ${accountRes.error.message}`);
  if (baseRes.error || addonRes.error) throw new Error("현재 구독 기간을 확인하지 못했습니다.");
  if (referralRes.error || previousBaseRes.error) throw new Error("추천 혜택 자격을 확인하지 못했습니다.");
  if (creditRes.error) throw new Error("추천 크레딧 잔액을 확인하지 못했습니다.");

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
  let referralId: number | null = null;
  let referralDiscountKrw = 0;
  const referral = referralRes.data;
  if (
    policy.referrals_enabled !== false && payBase && storeSequence === 1 &&
    (previousBaseRes.data || []).length === 0 && referral && referral.first_payment_id == null &&
    ["registered", "eligible"].includes(String(referral.status || "")) &&
    (!referral.referred_store_id || referral.referred_store_id === storeId) && referral.referring_store_id !== storeId
  ) {
    const [refAccount, businessRows] = await Promise.all([
      supabaseAdmin.from("billing_account_stores").select("billing_account_id").eq("store_id", referral.referring_store_id).maybeSingle(),
      supabaseAdmin.from("stores").select("store_id,business_number").in("store_id", [storeId, referral.referring_store_id]),
    ]);
    const businessMap = new Map((businessRows.data || []).map((row) => [String(row.store_id), String(row.business_number || "").replace(/\D/g, "")]));
    const currentBusiness = businessMap.get(storeId) || "";
    const referringBusiness = businessMap.get(String(referral.referring_store_id)) || "";
    const sameAccount = Number(refAccount.data?.billing_account_id || 0) === Number(accountRes.data?.id || 0);
    const sameBusiness = Boolean(currentBusiness && referringBusiness && currentBusiness === referringBusiness);
    if (!sameAccount && !sameBusiness) {
      referralId = Number(referral.id);
      referralDiscountKrw = Math.min(baseFinal, integer(policy.referral_discount_krw, 3_000));
    }
  }
  const baseFinalBeforeCreditKrw = Math.max(0, baseFinal - referralDiscountKrw);
  const creditPayload = creditRes.data as { availableKrw?: unknown } | null;
  const creditAvailableKrw = payBase ? integer(creditPayload?.availableKrw, 0) : 0;
  const creditAppliedKrw = Math.min(baseFinalBeforeCreditKrw, creditAvailableKrw, creditRequestedKrw);
  const baseExternalAmountKrw = Math.max(0, baseFinalBeforeCreditKrw - creditAppliedKrw);
  const addonExternalAmountKrw = addonFinal;
  const listAmount = baseList + addonList;
  const finalAmount = baseExternalAmountKrw + addonExternalAmountKrw;
  const nextMidnight = nextKstMidnight();
  const baseStart = payBase ? activeAnchor(baseRes.data?.paid_until, nextMidnight) : null;
  const addonStart = payAddon ? activeAnchor(addonRes.data?.addon_paid_until, nextMidnight) : null;
  const baseEnd = baseStart ? addCalendarMonthsKst(baseStart, planMonths) : null;
  const addonEnd = addonStart ? addCalendarMonthsKst(addonStart, planMonths) : null;
  const projectedBaseEnd = payBase ? baseEnd : new Date(String(baseRes.data?.paid_until || ""));
  const projectedBaseEndMs = projectedBaseEnd?.getTime() ?? Number.NaN;
  if (payAddon && (!Number.isFinite(projectedBaseEndMs) || !addonEnd || addonEnd.getTime() > projectedBaseEndMs)) {
    throw new Error("온라인 선결제 옵션 기간은 기본 구독 종료일을 넘을 수 없습니다. 기본 구독 기간을 먼저 늘려 주세요.");
  }
  const labels: string[] = [];
  if (founderBase && payBase) labels.push("기본 구독 베타 테스터 40%");
  if (founderAddon && payAddon) labels.push("선결제 옵션 베타 테스터 40%");
  if (multiStore && payBase && !founderBase) labels.push("추가 매장 기본 구독 15%");
  if (selectedTermBps && ((payBase && !founderBase) || (payAddon && !founderAddon))) labels.push(`${planMonths}개월 장기 구독 ${selectedTermBps / 100}%`);
  if (multiStore && baseDiscountBps === multiStoreCapBps && selectedTermBps) labels.push("기본 구독 총 할인 25% 상한");
  if (referralDiscountKrw) labels.push("첫 구독 추천 3,000원");

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
    discountAmountKrw: listAmount - (baseFinalBeforeCreditKrw + addonFinal),
    referralDiscountKrw,
    creditAvailableKrw,
    creditRequestedKrw,
    creditAppliedKrw,
    externalAmountKrw: finalAmount,
    baseFinalBeforeCreditKrw,
    baseExternalAmountKrw,
    addonExternalAmountKrw,
    referralId,
    baseFinalAmountKrw: baseFinalBeforeCreditKrw,
    addonFinalAmountKrw: addonFinal,
    founderBase,
    founderAddon,
    multiStore,
    storeSequence,
    pricePolicyVersion: String(policy.version || DEFAULT_POLICY.version),
    vatIncluded: policy.vat_included !== false,
    discountLabels: labels,
    expectedBaseStartAt: baseStart?.toISOString() || null,
    expectedBaseEndAt: baseEnd?.toISOString() || null,
    expectedAddonStartAt: addonStart?.toISOString() || null,
    expectedAddonEndAt: addonEnd?.toISOString() || null,
  };
}
