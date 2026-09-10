import { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  const result = Response.json(body, { status });
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

function dayKey(days = 0) {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 86400000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const storeId = String(req.nextUrl.searchParams.get("store") || "").trim();
    const admin = createSupabaseAdminClient();
    await requireStoreRole({ req, supabaseAdmin: admin, storeId, allowedRoles: ["owner"] });
    const start = dayKey(-55);
    const { data, error } = await admin.from("orders")
      .select("id,order_date,total_price,adjusted_total_price,status")
      .eq("store_id", storeId).gte("order_date", start).neq("status", "cancelled");
    if (error) throw new ApiError(500, "AI 브리핑용 주문 정보를 불러오지 못했습니다.", "AI_BRIEF_LOAD_FAILED");
    const orders = data || [];
    const total = orders.length;
    const recent = orders.filter((row) => String(row.order_date || "") >= dayKey(-13));
    const previous = orders.filter((row) => String(row.order_date || "") >= dayKey(-55) && String(row.order_date || "") < dayKey(-13));
    const amount = (rows: typeof orders) => rows.reduce((sum, row) => sum + Math.max(0, Number(row.adjusted_total_price ?? row.total_price ?? 0)), 0);
    const today = orders.filter((row) => String(row.order_date || "") === dayKey());
    const recentAvg = recent.length / 14;
    const previousAvg = previous.length / 42;
    const change = previousAvg > 0 ? Math.round(((recentAvg - previousAvg) / previousAvg) * 100) : null;
    const stage = total < 1 ? "data_waiting" : total < 200 ? "data_collection" : "observation";
    const direction = change === null ? "stable" : change <= -12 ? "down" : change >= 12 ? "up" : "stable";
    const headline = stage === "data_waiting"
      ? "첫 주문이 들어오면 이 매장의 AI 브리핑이 시작됩니다."
      : stage === "data_collection"
        ? `현재 ${total}건의 주문 데이터를 수집하고 있습니다.`
        : direction === "down"
          ? `최근 2주 일평균 주문 수가 이전 기준보다 ${Math.abs(change || 0)}% 낮습니다.`
          : direction === "up"
            ? `최근 2주 일평균 주문 수가 이전 기준보다 ${change}% 높습니다.`
            : "최근 주문 흐름은 이전 기준과 큰 차이가 없습니다.";
    return response({ ok: true, brief: {
      storeId, generatedAt: new Date().toISOString(), stage, headline, totalOrders: total,
      todayOrders: today.length, todaySales: amount(today), recentOrders: recent.length,
      recentDailyAverage: Number(recentAvg.toFixed(1)), previousDailyAverage: Number(previousAvg.toFixed(1)), changePercent: change,
      confidence: total >= 200 && previous.length >= 50 ? "medium" : "low",
      fact: stage === "data_waiting" ? "다른 매장의 데이터로 대신 분석하지 않습니다." : "주문 수 변화는 기록된 주문 데이터로 확인한 사실입니다.",
      hypothesis: stage === "observation" && direction !== "stable" ? "메뉴 노출, 재고 또는 고객 구성 변화가 영향을 줬을 수 있습니다. 현재 데이터만으로 원인을 단정하지 않습니다." : null,
      recommendation: stage === "observation" && direction === "down" ? "다음 2주 동안 동일 시간대 주문 흐름을 관찰해 보세요. 점주 승인 전에는 어떤 설정도 바뀌지 않습니다." : null,
    }});
  } catch (error) {
    const result = apiErrorResponse(error); result.headers.set("Cache-Control", "private, no-store"); return result;
  }
}
