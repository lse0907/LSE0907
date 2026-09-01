import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeCode() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

async function currentCode(admin: ReturnType<typeof createSupabaseAdminClient>, storeId: string) {
  return admin
    .from("store_referral_codes")
    .select("id,code,created_at")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .maybeSingle();
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const result = await currentCode(admin, storeId);
    if (result.error) throw new Error(`추천코드 조회 실패: ${result.error.message}`);
    return NextResponse.json({ ok: true, referralCode: result.data?.code || null });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { storeId?: unknown };
    const storeId = String(body.storeId || "").trim();
    const admin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const existing = await currentCode(admin, storeId);
    if (existing.error) throw new Error(`추천코드 조회 실패: ${existing.error.message}`);
    if (existing.data?.code) return NextResponse.json({ ok: true, referralCode: existing.data.code, alreadyIssued: true });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = makeCode();
      const created = await admin.from("store_referral_codes").insert({
        store_id: storeId,
        code,
        issued_by: userId,
        issued_reason: "점주 추천코드 최초 발급",
      }).select("code").single();
      if (!created.error && created.data?.code) {
        return NextResponse.json({ ok: true, referralCode: created.data.code, alreadyIssued: false });
      }
      if (!String(created.error?.message || "").toLowerCase().includes("duplicate")) {
        throw new Error(`추천코드 발급 실패: ${created.error?.message || "알 수 없는 오류"}`);
      }
    }
    throw new Error("추천코드를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
