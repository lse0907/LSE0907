import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";
import { recordSecurityEvent } from "../_lib";
import { formatPasswordAuthError, getPasswordPolicyError } from "@/app/lib/passwordPolicy";

type Body = { storeId?: string; loginId?: string; email?: string; password?: string; role?: "manager" | "staff"; displayName?: string };

function normalizeLoginId(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 48);
}

function internalEmailFor(storeId: string, loginId: string, role: "manager" | "staff") {
  const safeStore = storeId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 18) || "store";
  const safeLogin = normalizeLoginId(loginId) || `${safeStore}-${role}`;
  return `${safeStore}.${safeLogin}@internal.qrcafe.local`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const storeId = String(body.storeId || "").trim();
    const role = body.role === "manager" ? "manager" : "staff";
    const loginId = normalizeLoginId(String(body.loginId || "")) || `${storeId.slice(0, 8).toLowerCase()}-${role}`;
    const email = String(body.email || internalEmailFor(storeId, loginId, role)).trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.displayName || (role === "manager" ? "매니저 공용 계정" : "직원 공용 계정")).trim();

    if (!storeId || !email) {
      return NextResponse.json({ ok: false, message: "매장과 로그인 ID가 필요합니다." }, { status: 400 });
    }

    const passwordError = getPasswordPolicyError(password);
    if (passwordError) {
      return NextResponse.json({ ok: false, message: passwordError }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, store_role: role, shared_store_id: storeId, login_id: loginId, is_shared_store_account: true },
    });
    if (created.error || !created.data.user) {
      return NextResponse.json(
        { ok: false, message: formatPasswordAuthError(created.error, "계정 생성 실패") },
        { status: 500 },
      );
    }

    const userId = created.data.user.id;
    const { error: memberErr } = await supabaseAdmin.from("store_members").insert({ store_id: storeId, user_id: userId, role });
    if (memberErr) return NextResponse.json({ ok: false, message: `멤버 연결 실패: ${memberErr.message}` }, { status: 500 });

    await recordSecurityEvent(supabaseAdmin, { storeId, userId: actor.userId, eventType: "shared_account_created", metadata: { targetUserId: userId, role, loginId, displayName } });
    return NextResponse.json({ ok: true, userId, role, email, loginId });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
