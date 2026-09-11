import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = String(process.env.SUPPORT_EVIDENCE_RETENTION_SECRET || "").trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, message: "허용되지 않은 요청입니다." }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const due = await admin.from("support_ticket_attachments")
    .select("id,storage_path").is("deleted_at", null).not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString()).limit(100);
  if (due.error) return Response.json({ ok: false, message: "보관 기한 목록을 확인하지 못했습니다." }, { status: 500 });
  let deleted = 0;
  let failed = 0;
  for (const row of due.data || []) {
    const removed = await admin.storage.from("support-evidence").remove([row.storage_path]);
    if (removed.error) { failed += 1; continue; }
    const marked = await admin.from("support_ticket_attachments").update({ deleted_at: new Date().toISOString() }).eq("id", row.id).is("deleted_at", null);
    if (marked.error) failed += 1; else deleted += 1;
  }
  return Response.json({ ok: true, deleted, failed }, { headers: { "Cache-Control": "private, no-store" } });
}
