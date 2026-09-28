import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";
import { getStoreBetaAccess } from "../../billing/_lib/betaAccess";

type Body = { storeId?: unknown; active?: unknown; prepayIncluded?: unknown; reason?: unknown };

async function load(admin: ReturnType<typeof createSupabaseAdminClient>, storeId: string) {
  const [store, beta] = await Promise.all([
    admin.from("stores").select("store_id,store_name,owner_user_id").eq("store_id", storeId).maybeSingle(),
    getStoreBetaAccess(admin, storeId),
  ]);
  if (store.error || !store.data) throw new Error("매장 정보를 찾지 못했습니다.");
  return { storeId, storeName: String(store.data.store_name || storeId), ownerUserId: String(store.data.owner_user_id || ""), ...beta };
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장을 선택해 주세요." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "billing"]);
    return NextResponse.json({ ok: true, beta: await load(admin, storeId) });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const active = body.active === true;
    const prepayIncluded = body.prepayIncluded === true;
    const reason = String(body.reason || "").trim();
    if (!storeId || !reason) return NextResponse.json({ ok: false, message: "매장과 변경 사유를 입력해 주세요." }, { status: 400 });
    if (prepayIncluded && !active) return NextResponse.json({ ok: false, message: "선결제 포함은 베타 이용 중일 때만 설정할 수 있습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin, ["master", "billing"]);
    const before = await load(admin, storeId);
    if (!before.ownerUserId) return NextResponse.json({ ok: false, message: "매장 소유자 정보를 확인하지 못했습니다." }, { status: 409 });

    if (active) {
      const conflict = await admin.from("store_beta_access").select("store_id").eq("owner_user_id", before.ownerUserId).eq("status", "active").neq("store_id", storeId).maybeSingle();
      if (conflict.error && !["42P01", "PGRST205"].includes(String(conflict.error.code || ""))) throw new Error("기존 베타 매장을 확인하지 못했습니다.");
      if (conflict.data?.store_id) return NextResponse.json({ ok: false, code: "BETA_STORE_ALREADY_ASSIGNED", message: "이 계정에는 이미 베타 이용 매장이 있습니다. 기존 매장을 종료한 뒤 변경해 주세요." }, { status: 409 });
      const saved = await admin.from("store_beta_access").upsert({ store_id: storeId, owner_user_id: before.ownerUserId, status: "active", prepay_included: prepayIncluded, starts_at: before.startsAt || new Date().toISOString(), ends_at: null, post_beta_discount_bps: 4000, reason, assigned_by: actor.userId, ended_at: null, ended_by: null, updated_at: new Date().toISOString() }, { onConflict: "store_id" });
      if (saved.error) throw new Error(`베타 이용 권한을 저장하지 못했습니다: ${saved.error.message}`);
    } else {
      const saved = await admin.from("store_beta_access").update({ status: "ended", reason, ended_at: new Date().toISOString(), ended_by: actor.userId, updated_at: new Date().toISOString() }).eq("store_id", storeId);
      if (saved.error && !["42P01", "PGRST205"].includes(String(saved.error.code || ""))) throw new Error("베타 이용 종료를 저장하지 못했습니다.");
    }
    const after = await load(admin, storeId);
    const audit = await admin.from("billing_admin_audit_logs").insert({ actor_user_id: actor.userId, action: active ? "free_beta_access_assigned" : "free_beta_access_ended", store_id: storeId, billing_account_id: null, before_data: before, after_data: after, reason });
    if (audit.error) throw new Error("베타 변경은 저장되었지만 감사 기록을 남기지 못했습니다.");
    return NextResponse.json({ ok: true, beta: after });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
