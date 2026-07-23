/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";

async function safeSelect(supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>, table: string, query: string, storeId: string): Promise<{ rows: any[]; error: string }> {
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

    const [membersRaw, pins, devices, events] = await Promise.all([
      safeSelect(supabaseAdmin, "store_members", "id,store_id,user_id,role,created_at", storeId),
      safeSelect(supabaseAdmin, "store_staff_pins", "id,display_name,contact_hint,pin_role,approval_status,is_active,failed_attempts,locked_until,last_used_at,requested_at,approved_at,rejected_at,created_at", storeId),
      safeSelect(supabaseAdmin, "store_devices", "id,user_id,device_name,device_type,browser,os,status,last_seen_at,approved_at,created_at", storeId),
      safeSelect(supabaseAdmin, "security_events", "id,event_type,user_id,device_id,metadata,created_at", storeId),
    ]);

    let members = membersRaw;
    if (!membersRaw.error && membersRaw.rows.length > 0) {
      const listed = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!listed.error) {
        const authById = new Map((listed.data.users || []).map((user) => [user.id, user]));
        members = {
          ...membersRaw,
          rows: (membersRaw.rows as Array<Record<string, any>>).map((member) => {
            const authUser = authById.get(String(member.user_id || ""));
            return {
              ...member,
              login_id: authUser?.user_metadata?.login_id || "",
              display_name: authUser?.user_metadata?.display_name || "",
              is_shared_store_account: Boolean(authUser?.user_metadata?.is_shared_store_account),
              email: authUser?.email || "",
            };
          }),
        };
      }
    }

    return NextResponse.json({ ok: true, members, pins, devices, events });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
