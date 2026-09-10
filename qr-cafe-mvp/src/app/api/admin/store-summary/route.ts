import { NextRequest } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  createSupabaseAdminClient,
  requireStoreRole,
} from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(days = 0) {
  return new Date(Date.now() + KST_OFFSET_MS + days * DAY_MS);
}

function dayKey(days = 0) {
  return kstDate(days).toISOString().slice(0, 10);
}

function mondayKey() {
  const today = kstDate();
  return dayKey(-((today.getUTCDay() + 6) % 7));
}

function sundayKey() {
  const today = kstDate();
  return dayKey(6 - ((today.getUTCDay() + 6) % 7));
}

function monthStartKey() {
  const today = kstDate();
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  return `${today.getUTCFullYear()}-${month}-01`;
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const admin = createSupabaseAdminClient();
    await requireStoreRole({
      req,
      supabaseAdmin: admin,
      storeId,
      allowedRoles: ["owner"],
    });

    const today = dayKey();
    const weekStart = mondayKey();
    const weekEnd = sundayKey();
    const monthStart = monthStartKey();
    const rangeStart = [monthStart, weekStart].sort()[0];

    const { data, error } = await admin
      .from("orders")
      .select("order_date,total_price,adjusted_total_price,status")
      .eq("store_id", storeId)
      .gte("order_date", rangeStart)
      .lte("order_date", weekEnd)
      .neq("status", "cancelled");

    if (error) {
      throw new ApiError(500, "매출 요약을 불러오지 못했습니다.", "STORE_SUMMARY_LOAD_FAILED");
    }

    const rows = data || [];
    const amount = (items: typeof rows) =>
      items.reduce(
        (sum, row) =>
          sum + Math.max(0, Number(row.adjusted_total_price ?? row.total_price ?? 0)),
        0,
      );

    const result = Response.json({
      ok: true,
      summary: {
        daily: amount(rows.filter((row) => String(row.order_date || "") === today)),
        weekly: amount(
          rows.filter((row) => {
            const orderDate = String(row.order_date || "");
            return orderDate >= weekStart && orderDate <= weekEnd;
          }),
        ),
        monthly: amount(rows.filter((row) => String(row.order_date || "").startsWith(monthStart.slice(0, 7)))),
      },
    });
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch (error) {
    const result = apiErrorResponse(error);
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  }
}
