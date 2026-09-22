import { createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const open = await admin.from("beta_recruitment_rounds").select("id,title,status,public_message,updated_at").eq("status", "open").maybeSingle();
  if (open.error) return Response.json({ ok: false, message: "모집 정보를 불러오지 못했습니다." }, { status: 500 });
  if (open.data) return Response.json({ ok: true, round: open.data }, { headers: { "Cache-Control": "no-store" } });

  const latest = await admin.from("beta_recruitment_rounds").select("id,title,status,public_message,updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) return Response.json({ ok: false, message: "모집 정보를 불러오지 못했습니다." }, { status: 500 });
  return Response.json({ ok: true, round: latest.data || null }, { headers: { "Cache-Control": "no-store" } });
}
