import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { getStoreBetaAccess } from "../_lib/betaAccess";

const TRIAL_DAYS = 30;

type TrialState = {
  eligible: boolean;
  reason: "ready" | "setup_required" | "first_store_only" | "beta_active" | "trial_active" | "paid";
  trialEndAt: string | null;
};

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function getTrialState(admin: ReturnType<typeof createSupabaseAdminClient>, storeId: string, userId: string): Promise<TrialState> {
  const [storeRes, accountRes, billingRes, beta] = await Promise.all([
    admin.from("stores").select("setup_completed").eq("store_id", storeId).maybeSingle(),
    admin
      .from("billing_accounts")
      .select("billing_account_stores!inner(store_id,store_sequence)")
      .eq("owner_user_id", userId)
      .eq("billing_account_stores.store_id", storeId)
      .maybeSingle(),
    admin.from("store_billing").select("base_plan_status,trial_end_at,paid_until").eq("store_id", storeId).maybeSingle(),
    getStoreBetaAccess(admin, storeId),
  ]);

  if (storeRes.error || !storeRes.data) throw new Error("매장 설정 상태를 확인하지 못했습니다.");
  if (accountRes.error || !accountRes.data) throw new Error("무료 체험 자격을 확인하지 못했습니다.");
  if (billingRes.error) throw new Error("구독 상태를 확인하지 못했습니다.");

  const relation = Array.isArray(accountRes.data.billing_account_stores)
    ? accountRes.data.billing_account_stores[0]
    : accountRes.data.billing_account_stores;
  const storeSequence = Number(relation?.store_sequence || 0);
  const trialEndAt = String(billingRes.data?.trial_end_at || "").trim() || null;
  const trialActive = billingRes.data?.base_plan_status === "trialing" && !!trialEndAt && new Date(trialEndAt).getTime() > Date.now();
  const paidActive = billingRes.data?.base_plan_status === "active" || (billingRes.data?.paid_until ? new Date(billingRes.data.paid_until).getTime() > Date.now() : false);

  if (beta.active) return { eligible: false, reason: "beta_active", trialEndAt: null };
  if (paidActive) return { eligible: false, reason: "paid", trialEndAt: null };
  if (trialActive) return { eligible: false, reason: "trial_active", trialEndAt };
  if (storeRes.data.setup_completed !== true) return { eligible: false, reason: "setup_required", trialEndAt: null };
  if (storeSequence !== 1) return { eligible: false, reason: "first_store_only", trialEndAt: null };
  return { eligible: true, reason: "ready", trialEndAt: null };
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    return NextResponse.json({ ok: true, trial: await getTrialState(admin, storeId, userId) });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { storeId?: unknown };
    const storeId = String(body.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const state = await getTrialState(admin, storeId, userId);
    if (!state.eligible) {
      const messages: Record<TrialState["reason"], string> = {
        ready: "",
        setup_required: "초기 설정을 완료한 뒤 무료 체험을 시작할 수 있습니다.",
        first_store_only: "무료 체험은 첫 매장에만 제공됩니다.",
        beta_active: "베타 이용 중인 매장은 무료 체험을 별도로 시작할 수 없습니다.",
        trial_active: "이미 무료 체험을 이용 중입니다.",
        paid: "유료 구독 중인 매장은 무료 체험을 시작할 수 없습니다.",
      };
      return NextResponse.json({ ok: false, code: state.reason, message: messages[state.reason], trial: state }, { status: 409 });
    }

    const trialEndAt = addDays(new Date(), TRIAL_DAYS).toISOString();
    const saved = await admin.from("store_billing").upsert({
      store_id: storeId,
      base_plan_status: "trialing",
      trial_end_at: trialEndAt,
      base_price_krw: 14_900,
      price_version: "standard",
      updated_at: new Date().toISOString(),
    }, { onConflict: "store_id" });
    if (saved.error) throw new Error(`무료 체험을 시작하지 못했습니다: ${saved.error.message}`);
    return NextResponse.json({ ok: true, trial: { eligible: false, reason: "trial_active", trialEndAt } });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
