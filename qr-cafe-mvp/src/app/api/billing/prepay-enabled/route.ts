import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

type Body = { storeId?: unknown; enabled?: unknown; reason?: unknown };

async function state(admin: ReturnType<typeof createSupabaseAdminClient>, storeId: string) {
  const [base, addon, pg] = await Promise.all([
    admin.from("store_billing").select("base_plan_status,paid_until").eq("store_id", storeId).maybeSingle(),
    admin.from("store_addons").select("prepay_addon_status,addon_paid_until,prepay_enabled,prepay_enabled_at").eq("store_id", storeId).maybeSingle(),
    admin.from("store_pg_config").select("mid,client_key,secret_key,pg_verified_at").eq("store_id", storeId).maybeSingle(),
  ]);
  if (base.error || addon.error || pg.error) throw new Error("온라인 결제 상태를 확인하지 못했습니다.");
  const baseUntil = new Date(String(base.data?.paid_until || "")).getTime();
  const addonUntil = new Date(String(addon.data?.addon_paid_until || "")).getTime();
  const baseActive = base.data?.base_plan_status === "active" && Number.isFinite(baseUntil) && baseUntil > Date.now();
  const addonActive = addon.data?.prepay_addon_status === "active" && Number.isFinite(addonUntil) && addonUntil > Date.now();
  const pgReady = Boolean(String(pg.data?.mid || "").trim() && String(pg.data?.client_key || "").trim() && String(pg.data?.secret_key || "").trim());
  const reasons: string[] = [];
  if (!baseActive) reasons.push("기본 구독이 활성 상태가 아닙니다.");
  if (!addonActive) reasons.push("선결제 옵션 구독이 활성 상태가 아닙니다.");
  if (!pgReady) reasons.push("토스 PG의 MID, Client Key, Secret Key를 모두 등록해 주세요.");
  return { enabled: addon.data?.prepay_enabled === true, enabledAt: addon.data?.prepay_enabled_at || null, baseActive, addonActive, pgReady, canEnable: baseActive && addonActive && pgReady, blockedReasons: reasons };
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    return NextResponse.json({ ok: true, state: await state(admin, storeId) });
  } catch (error: unknown) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const enabled = body.enabled === true;
    const reason = String(body.reason || "").trim() || (enabled ? "점주가 온라인 선결제 기능을 켬" : "점주가 온라인 선결제 기능을 끔");
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const before = await state(admin, storeId);
    if (enabled && !before.canEnable) return NextResponse.json({ ok: false, message: before.blockedReasons.join(" "), state: before }, { status: 409 });
    const update = await admin.from("store_addons").update({ prepay_enabled: enabled, prepay_enabled_at: enabled ? new Date().toISOString() : null, prepay_enabled_by: actor.userId, updated_at: new Date().toISOString() }).eq("store_id", storeId).select("store_id").maybeSingle();
    if (update.error || !update.data) return NextResponse.json({ ok: false, message: "선결제 기능 상태를 저장하지 못했습니다." }, { status: 500 });
    const log = await admin.from("store_prepay_setting_logs").insert({ store_id: storeId, actor_user_id: actor.userId, before_enabled: before.enabled, after_enabled: enabled, reason });
    if (log.error) return NextResponse.json({ ok: false, message: "기능 상태는 변경되었지만 변경 이력 확인이 필요합니다." }, { status: 500 });
    return NextResponse.json({ ok: true, state: await state(admin, storeId) });
  } catch (error: unknown) { return apiErrorResponse(error); }
}
