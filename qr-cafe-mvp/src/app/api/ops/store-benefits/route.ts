import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";

type Body = {
  storeId?: unknown; founderMember?: unknown; founderBase?: unknown; founderAddon?: unknown;
  founderReason?: unknown; trialEndAt?: unknown; trialReason?: unknown;
};

async function load(admin: ReturnType<typeof createSupabaseAdminClient>, storeId: string) {
  const [link, billing] = await Promise.all([
    admin.from("billing_account_stores").select("billing_account_id,store_id,store_sequence,founder_base_discount,founder_addon_discount,founder_discount_started_at,founder_discount_reason,billing_accounts!inner(owner_user_id,founder_member,founder_designated_at,founder_reason)").eq("store_id", storeId).maybeSingle(),
    admin.from("store_billing").select("base_plan_status,trial_end_at,paid_until").eq("store_id", storeId).maybeSingle(),
  ]);
  if (link.error || billing.error) throw new Error("매장 혜택 정보를 불러오지 못했습니다.");
  const account = Array.isArray(link.data?.billing_accounts) ? link.data.billing_accounts[0] : link.data?.billing_accounts;
  return {
    billingAccountId: link.data?.billing_account_id || null, ownerUserId: account?.owner_user_id || null,
    founderMember: account?.founder_member === true, founderBase: link.data?.founder_base_discount === true,
    founderAddon: link.data?.founder_addon_discount === true, founderReason: link.data?.founder_discount_reason || account?.founder_reason || "",
    founderDesignatedAt: account?.founder_designated_at || null, storeSequence: Number(link.data?.store_sequence || 1),
    baseStatus: billing.data?.base_plan_status || "inactive", trialEndAt: billing.data?.trial_end_at || null, paidUntil: billing.data?.paid_until || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient(); await requireOpsUser(req, admin);
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장을 선택해 주세요." }, { status: 400 });
    return NextResponse.json({ ok: true, benefit: await load(admin, storeId) });
  } catch (error: unknown) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const founderReason = String(body.founderReason || "").trim();
    const trialReason = String(body.trialReason || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장을 선택해 주세요." }, { status: 400 });
    const admin = createSupabaseAdminClient(); const actor = await requireOpsUser(req, admin);
    const before = await load(admin, storeId);
    if (typeof body.founderMember === "boolean") {
      if (!founderReason) return NextResponse.json({ ok: false, message: "창립 멤버 설정 사유를 입력해 주세요." }, { status: 400 });
      await admin.from("billing_accounts").update({ founder_member: body.founderMember, founder_designated_at: body.founderMember ? new Date().toISOString() : null, founder_designated_by: actor.userId, founder_reason: founderReason }).eq("id", before.billingAccountId);
      await admin.from("billing_account_stores").update({ founder_base_discount: body.founderMember && body.founderBase === true, founder_addon_discount: body.founderMember && body.founderAddon === true, founder_discount_started_at: body.founderMember ? new Date().toISOString() : null, founder_discount_reason: founderReason }).eq("store_id", storeId);
    }
    if (body.trialEndAt !== undefined) {
      if (!trialReason) return NextResponse.json({ ok: false, message: "무료 체험 조정 사유를 입력해 주세요." }, { status: 400 });
      const trialEndAt = String(body.trialEndAt || "").trim() || null;
      if (before.baseStatus === "active" || before.paidUntil) return NextResponse.json({ ok: false, message: "유료 매장은 무료 체험이 아니라 구독 보상 기능으로 조정해야 합니다." }, { status: 409 });
      await admin.from("store_billing").upsert({ store_id: storeId, base_plan_status: trialEndAt && new Date(trialEndAt).getTime() > Date.now() ? "trialing" : "inactive", trial_end_at: trialEndAt, base_price_krw: 14900, price_version: "standard", updated_at: new Date().toISOString() }, { onConflict: "store_id" });
    }
    const after = await load(admin, storeId);
    await admin.from("billing_admin_audit_logs").insert({ actor_user_id: actor.userId, action: body.trialEndAt !== undefined ? "trial_adjusted" : "founder_benefit_updated", store_id: storeId, billing_account_id: before.billingAccountId, before_data: before, after_data: after, reason: body.trialEndAt !== undefined ? trialReason : founderReason });
    return NextResponse.json({ ok: true, benefit: after });
  } catch (error: unknown) { return apiErrorResponse(error); }
}
