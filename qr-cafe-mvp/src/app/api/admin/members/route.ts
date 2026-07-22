import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

async function safeSelect(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>, table: string, query: string, storeId: string) {
  const { data, error } = await supabaseAdmin.from(table).select(query).eq("store_id", storeId).order("created_at", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: data || [], error: "" };
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });

    const supabaseAdmin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    const [members, pins, devices, events] = await Promise.all([
      safeSelect(supabaseAdmin, "store_members", "id,store_id,user_id,role,created_at", storeId),
      safeSelect(supabaseAdmin, "store_staff_pins", "id,display_name,pin_role,is_active,failed_attempts,locked_until,last_used_at,created_at", storeId),
      safeSelect(supabaseAdmin, "store_devices", "id,user_id,device_name,device_type,browser,os,status,last_seen_at,approved_at,created_at", storeId),
      safeSelect(supabaseAdmin, "security_events", "id,event_type,user_id,device_id,metadata,created_at", storeId),
    ]);

    return NextResponse.json({ ok: true, members, pins, devices, events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
