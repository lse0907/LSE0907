import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient } from "../../_lib/storeAuth";
import { requireOpsUser } from "../../_lib/opsAuth";

type Body = { mid?: unknown; clientKey?: unknown; secretKey?: unknown; reason?: unknown };
const view = (row: Record<string, unknown> | null) => ({
  mid: String(row?.mid || ""), clientKey: String(row?.client_key || ""),
  hasSecret: Boolean(String(row?.secret_key || "").trim()), updatedAt: String(row?.updated_at || "") || null,
  verifiedAt: String(row?.pg_verified_at || "") || null,
});

export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin);
    const { data, error } = await admin.from("platform_pg_config").select("mid,client_key,secret_key,updated_at,pg_verified_at").eq("id", 1).maybeSingle();
    if (error) throw new Error("플랫폼 PG 설정을 불러오지 못했습니다.");
    return NextResponse.json({ ok: true, config: view(data) });
  } catch (error: unknown) { return apiErrorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const mid = String(body.mid || "").trim();
    const clientKey = String(body.clientKey || "").trim();
    const secretKey = String(body.secretKey || "").trim();
    const reason = String(body.reason || "").trim();
    if (!mid || !clientKey || !reason) return NextResponse.json({ ok: false, message: "MID, Client Key, 변경 사유를 입력해 주세요." }, { status: 400 });
    const admin = createSupabaseAdminClient();
    const actor = await requireOpsUser(req, admin);
    const before = await admin.from("platform_pg_config").select("mid,client_key,secret_key,updated_at,pg_verified_at").eq("id", 1).maybeSingle();
    const payload: Record<string, unknown> = { id: 1, mid, client_key: clientKey, updated_at: new Date().toISOString(), pg_verified_at: null };
    if (secretKey) payload.secret_key = secretKey;
    const saved = await admin.from("platform_pg_config").upsert(payload, { onConflict: "id" }).select("mid,client_key,secret_key,updated_at,pg_verified_at").single();
    if (saved.error) throw new Error("플랫폼 PG 설정을 저장하지 못했습니다.");
    await admin.from("billing_admin_audit_logs").insert({ actor_user_id: actor.userId, action: "platform_pg_updated", reason, before_data: view(before.data), after_data: view(saved.data) });
    return NextResponse.json({ ok: true, config: view(saved.data) });
  } catch (error: unknown) { return apiErrorResponse(error); }
}
