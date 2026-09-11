import { SupabaseClient } from "@supabase/supabase-js";

export type BriefPeriod = "daily" | "weekly" | "monthly";

type OrderRow = {
  order_date: string | null;
  total_price: number | null;
  adjusted_total_price: number | null;
};

export type BriefSnapshot = {
  id: string;
  brief_period: BriefPeriod;
  period_start: string;
  period_end: string;
  headline: string;
  summary: string;
  brief_status: string;
  data_confidence: string;
  generated_at: string;
  source_order_count: number;
  source_sales_won: number;
};

export type BriefRange = { start: string; end: string };

function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function dateAtKst(date: Date, days: number) {
  return kstDate(new Date(date.getTime() + days * 86400000));
}

function monthStart(date: Date) {
  const [year, month] = kstDate(date).split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function rangeForCurrentPeriod(period: BriefPeriod, now = new Date()): BriefRange {
  const today = kstDate(now);
  if (period === "daily") return { start: today, end: today };
  if (period === "weekly") {
    const day = new Date(`${today}T00:00:00+09:00`).getDay() || 7;
    return { start: dateAtKst(now, -(day - 1)), end: today };
  }
  return { start: monthStart(now), end: today };
}

/** A scheduled run always describes a finished Korean calendar period. */
export function rangeForCompletedPeriod(period: BriefPeriod, now = new Date()): BriefRange {
  if (period === "daily") {
    const yesterday = dateAtKst(now, -1);
    return { start: yesterday, end: yesterday };
  }

  const today = kstDate(now);
  if (period === "weekly") {
    const day = new Date(`${today}T00:00:00+09:00`).getDay() || 7;
    const end = dateAtKst(now, -day);
    return { start: dateAtKst(now, -(day + 6)), end };
  }

  const currentMonthStart = monthStart(now);
  const previousMonthEnd = kstDate(new Date(new Date(`${currentMonthStart}T12:00:00+09:00`).getTime() - 86400000));
  const [year, month] = previousMonthEnd.split("-").map(Number);
  return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: previousMonthEnd };
}

function retentionDate(period: BriefPeriod) {
  const days = period === "daily" ? 90 : period === "weekly" ? 365 : 730;
  return new Date(Date.now() + days * 86400000).toISOString();
}

function stageFor(orderCount: number) {
  if (orderCount < 1) return { dataStage: "collection", briefStatus: "data_collection", confidence: "insufficient" } as const;
  if (orderCount < 200) return { dataStage: "collection", briefStatus: "data_collection", confidence: "low" } as const;
  return { dataStage: "early_observation", briefStatus: "early_observation", confidence: "medium" } as const;
}

function periodLabel(period: BriefPeriod) {
  return period === "daily" ? "오늘" : period === "weekly" ? "이번 주" : "이번 달";
}

function analysisType(period: BriefPeriod) {
  return period === "daily" ? "daily_brief" : period === "weekly" ? "weekly_brief" : "monthly_brief";
}

const briefSelect = "id,brief_period,period_start,period_end,headline,summary,brief_status,data_confidence,generated_at,source_order_count,source_sales_won";

export async function createBriefSnapshot(params: {
  admin: SupabaseClient;
  storeId: string;
  period: BriefPeriod;
  range: BriefRange;
  requestedByUserId?: string | null;
}): Promise<{ created: boolean; brief: BriefSnapshot }> {
  const { admin, storeId, period, range, requestedByUserId = null } = params;
  const { start, end } = range;

  const { data: existing, error: existingError } = await admin
    .from("ai_briefs")
    .select(briefSelect)
    .eq("store_id", storeId)
    .eq("brief_period", period)
    .eq("period_start", start)
    .maybeSingle();
  if (existingError && existingError.code !== "PGRST116") throw new Error("AI_BRIEF_HISTORY_LOOKUP_FAILED");
  if (existing) return { created: false, brief: existing as BriefSnapshot };

  const { data: orderRows, error: orderError } = await admin
    .from("orders")
    .select("order_date,total_price,adjusted_total_price")
    .eq("store_id", storeId)
    .gte("order_date", start)
    .lte("order_date", end)
    .neq("status", "cancelled");
  if (orderError) throw new Error("AI_BRIEF_SOURCE_LOAD_FAILED");

  const orders = (orderRows || []) as OrderRow[];
  const orderCount = orders.length;
  const sales = orders.reduce((total, order) => total + Math.max(0, Number(order.adjusted_total_price ?? order.total_price ?? 0)), 0);
  const stage = stageFor(orderCount);
  const label = periodLabel(period);
  const headline = orderCount < 1
    ? `${label} 주문 기록을 기다리고 있습니다.`
    : `${label} ${orderCount.toLocaleString()}건의 주문 기록을 정리했습니다.`;
  const summary = orderCount < 1
    ? "주문이 쌓이면 이 매장만의 흐름을 바탕으로 브리핑을 안내합니다."
    : "기록된 주문 데이터만 사용했으며, 다른 매장의 데이터를 섞지 않았습니다.";
  const sourceSummary = { period, periodStart: start, periodEnd: end, orderCount, salesWon: sales };

  const { data: run, error: runError } = await admin
    .from("ai_analysis_runs")
    .insert({
      store_id: storeId,
      requested_by_user_id: requestedByUserId,
      analysis_type: analysisType(period),
      data_stage: stage.dataStage,
      status: "succeeded",
      source_period_start: start,
      source_period_end: end,
      source_summary: sourceSummary,
      output_schema_version: "ai-brief-v1",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runError || !run?.id) throw new Error("AI_BRIEF_RUN_CREATE_FAILED");

  const { data: created, error: briefError } = await admin
    .from("ai_briefs")
    .insert({
      analysis_run_id: run.id,
      store_id: storeId,
      brief_period: period,
      period_start: start,
      period_end: end,
      headline,
      summary,
      brief_status: stage.briefStatus,
      facts: [{ kind: "aggregate_order_summary", text: summary, source: sourceSummary }],
      hypotheses: [],
      recommendation: null,
      data_confidence: stage.confidence,
      source_order_count: orderCount,
      source_sales_won: sales,
      schema_version: "ai-brief-v1",
      expires_at: retentionDate(period),
    })
    .select(briefSelect)
    .single();
  if (briefError?.code === "23505") {
    // A second scheduler invocation may race after both requests passed the
    // initial lookup. Keep one immutable snapshot and remove the unused run.
    await admin.from("ai_analysis_runs").delete().eq("id", run.id);
    const { data: duplicate } = await admin
      .from("ai_briefs")
      .select(briefSelect)
      .eq("store_id", storeId)
      .eq("brief_period", period)
      .eq("period_start", start)
      .maybeSingle();
    if (duplicate) return { created: false, brief: duplicate as BriefSnapshot };
  }
  if (briefError || !created) throw new Error("AI_BRIEF_CREATE_FAILED");
  return { created: true, brief: created as BriefSnapshot };
}
