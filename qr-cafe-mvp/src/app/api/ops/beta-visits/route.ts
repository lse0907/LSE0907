import { NextRequest } from "next/server";
import { requireOpsUser } from "@/app/api/_lib/opsAuth";
import { ApiError, apiErrorResponse, createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    const admin = createSupabaseAdminClient();
    await requireOpsUser(req, admin, ["master", "support"]);
    const roundId = Number(req.nextUrl.searchParams.get("roundId"));
    if (!Number.isSafeInteger(roundId) || roundId < 1) throw new ApiError(400, "모집 차수를 확인해 주세요.", "VISIT_ROUND_INVALID");
    const [visits, applications] = await Promise.all([
      admin.from("beta_page_visits").select("session_id", { count: "exact", head: true }).eq("recruitment_round_id", roundId),
      admin.from("beta_applications").select("id", { count: "exact", head: true }).eq("recruitment_round_id", roundId),
    ]);
    return Response.json({
      ok: true,
      total: visits.error ? null : visits.count ?? 0,
      applications: applications.error ? null : applications.count ?? 0,
      message: visits.error || applications.error ? "통계 DB 설정을 확인해 주세요." : "",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
