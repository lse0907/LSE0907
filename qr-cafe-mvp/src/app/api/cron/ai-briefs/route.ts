import { NextRequest } from "next/server";
import { BriefPeriod, createBriefSnapshot, rangeForCompletedPeriod } from "@/app/api/_lib/aiBriefSnapshot";
import { createSupabaseAdminClient } from "@/app/api/_lib/storeAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function unauthorized() {
  return Response.json({ ok: false, code: "CRON_UNAUTHORIZED" }, { status: 401 });
}

function scheduledPeriods(now = new Date()): BriefPeriod[] {
  const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const day = new Date(`${kst}T00:00:00+09:00`).getDay() || 7;
  const date = Number(kst.slice(-2));
  return ["daily", ...(day === 1 ? ["weekly" as const] : []), ...(date === 1 ? ["monthly" as const] : [])];
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency = 6) {
  const results: T[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      results.push(await task());
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

/**
 * Vercel invokes this once daily at 03:20 KST. It only stores aggregate,
 * completed-period snapshots for enrolled stores; it never calls an AI provider.
 */
export async function GET(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return unauthorized();

  try {
    const admin = createSupabaseAdminClient();
    const { data: settings, error } = await admin
      .from("ai_store_settings")
      .select("store_id")
      .eq("beta_status", "enrolled")
      .eq("ai_enabled", true)
      .order("store_id", { ascending: true })
      .limit(100);
    if (error) throw error;

    const periods = scheduledPeriods();
    const tasks = (settings || []).flatMap(({ store_id }) => periods.map((period) => async () => {
      try {
        const result = await createBriefSnapshot({
          admin,
          storeId: store_id,
          period,
          range: rangeForCompletedPeriod(period),
        });
        return { storeId: store_id, period, created: result.created };
      } catch (error) {
        return { storeId: store_id, period, created: false, error: error instanceof Error ? error.message : "AI_BRIEF_CRON_FAILED" };
      }
    }));
    const outcomes = await runWithConcurrency(tasks);

    return Response.json({
      ok: true,
      periods,
      enrolledStoreCount: settings?.length || 0,
      createdCount: outcomes.filter((outcome) => outcome.created).length,
      skippedCount: outcomes.filter((outcome) => !outcome.created && !outcome.error).length,
      failedCount: outcomes.filter((outcome) => outcome.error).length,
      outcomes,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, code: "AI_BRIEF_CRON_FAILED", message: error instanceof Error ? error.message : "AI brief cron failed" }, { status: 500 });
  }
}
