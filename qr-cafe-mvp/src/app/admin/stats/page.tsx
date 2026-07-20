// src/app/admin/stats/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type RawOrderRow = Record<string, unknown>;
type RawItemRow = Record<string, unknown>;

type OrderItem = { id: string; name: string; price: number; qty: number };
type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  items: OrderItem[];
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
  storeId?: string;
  store_id?: string;
};

type Summary = { sales: number; orders: number; qty: number; dineIn: number; takeout: number };
type BillingState = { status: string; paidUntil: string | null };
type TopMenu = { id: string; name: string; qty: number; sales: number };
type TimeBucket = { key: string; label: string; count: number };

const emptySummary: Summary = { sales: 0, orders: 0, qty: 0, dineIn: 0, takeout: 0 };

function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseYmd(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function addDays(date: Date, days: number) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function clampYmd(s: string) { return s ? s.slice(0, 10) : ""; }
function formatWon(n: number) { return `${Number(n || 0).toLocaleString()}원`; }
function formatTime(ts: number) { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function monthKey(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function startOfWeekMon(d: Date) { const day = d.getDay(); return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((day + 6) % 7)); }
function endOfWeekMon(d: Date) { return addDays(startOfWeekMon(d), 6); }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function getString(row: Record<string, unknown> | null | undefined, key: string) { const v = row?.[key]; return v == null ? "" : String(v); }
function getNumber(row: Record<string, unknown> | null | undefined, key: string) { return Number(row?.[key] ?? 0); }
function summarize(orders: OrderRecord[]): Summary {
  const out = { ...emptySummary };
  for (const o of orders) {
    out.sales += Number(o.totalPrice || 0);
    out.orders += 1;
    out.qty += Number(o.totalCount || 0);
    if (o.mode === "dine-in") out.dineIn += 1;
    else out.takeout += 1;
  }
  return out;
}
function avgOrder(summary: Summary) { return summary.orders > 0 ? Math.round(summary.sales / summary.orders) : 0; }
function takeoutRate(summary: Summary) { return summary.orders > 0 ? Math.round((summary.takeout / summary.orders) * 100) : 0; }
function inRange(orderDate: string, startYmd: string, endYmd: string) { return Boolean(orderDate) && orderDate >= startYmd && orderDate <= endYmd; }
function downloadTextFile(filename: string, content: string, mime: string) { const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function csvEscape(v: string) { return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function normalizeStatus(v: unknown): OrderStatus { const s = String(v || "").trim(); if (s === "checked" || s === "making" || s === "ready_for_packing" || s === "completed" || s === "cancelled") return s; if (s === "ready") return "ready_for_packing"; if (s === "done") return "completed"; if (s === "canceled") return "cancelled"; return "new"; }
function normalizeMode(v: unknown): OrderMode { return v === "takeout" ? "takeout" : "dine-in"; }
function toInt(v: unknown, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : fallback; }
function formatWonCompact(n: number) { const v = Number(n || 0); if (v < 10000) return `₩${v.toLocaleString()}`; if (v < 1000000) return `₩${(v / 10000).toFixed(1)}만`; if (v < 100000000) return `₩${Math.floor(v / 10000).toLocaleString()}만`; return `₩${(v / 100000000).toFixed(1)}억`; }
function isPaidBilling(billing: BillingState) { const paidMs = billing.paidUntil ? new Date(billing.paidUntil).getTime() : NaN; return billing.status === "active" || (Number.isFinite(paidMs) && paidMs > Date.now()); }
function toErrorMessage(e: unknown) { return e instanceof Error ? e.message : String(e); }
function changeAmount(current: number, previous: number) { return current - previous; }
function changeRate(current: number, previous: number) { if (previous <= 0) return current > 0 ? 100 : 0; return Math.round(((current - previous) / previous) * 100); }
function changeLabel(value: number) { return value > 0 ? `+${formatWon(value)}` : formatWon(value); }
function changeRateLabel(value: number) { return value > 0 ? `+${value}%` : `${value}%`; }
function bucketForHour(hour: number) { if (hour >= 6 && hour < 11) return "morning"; if (hour >= 11 && hour < 14) return "lunch"; if (hour >= 14 && hour < 18) return "afternoon"; if (hour >= 18 && hour < 22) return "evening"; return "night"; }

function dbOrderToRecord(row: RawOrderRow, storeId: string): OrderRecord {
  const createdAtMs = getString(row, "created_at") ? Date.parse(getString(row, "created_at")) : Date.now();
  const createdAt = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  const rawOrderDate = getString(row, "order_date");
  const orderDate = rawOrderDate.length >= 10 ? rawOrderDate.slice(0, 10) : ymd(new Date(createdAt));
  const rawDisplayNo = getString(row, "display_no");
  return {
    id: getString(row, "id"),
    createdAt,
    orderDate,
    displayNo: rawDisplayNo ? rawDisplayNo : getString(row, "display_no").padStart(4, "0") || "0000",
    mode: normalizeMode(row.mode),
    table: getString(row, "table_no") || undefined,
    buzzerNo: getString(row, "buzzer_no") || undefined,
    requestNote: getString(row, "request_note"),
    items: [],
    totalCount: Math.max(0, toInt(row.total_count, 0)),
    totalPrice: Math.max(0, Math.round(getNumber(row, "total_price") || 0)),
    status: normalizeStatus(row.status),
    storeId,
    store_id: storeId,
  };
}

function AdminStatsPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [billing, setBilling] = useState<BillingState>({ status: "inactive", paidUntil: null });
  const [dataMode, setDataMode] = useState<"db" | "empty">("empty");
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeExpanded, setRangeExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rangeMsg, setRangeMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const sid = (sp.get("store") || "").trim() || (getCurrentStoreId() || "").trim();
    if (!sid) { router.replace("/admin"); return; }
    setStoreId(sid);
    const t = new Date();
    setRangeStart(ymd(startOfMonth(t)));
    setRangeEnd(ymd(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = useMemo(() => new Date(), []);
  const todayKey = ymd(today);
  const yesterdayKey = ymd(addDays(today, -1));
  const weekStartDate = startOfWeekMon(today);
  const weekEndDate = endOfWeekMon(today);
  const lastWeekStart = ymd(addDays(weekStartDate, -7));
  const lastWeekEnd = ymd(addDays(weekEndDate, -7));
  const weekStart = ymd(weekStartDate);
  const weekEnd = ymd(weekEndDate);
  const month = monthKey(today);
  const isPaidSubscriber = isPaidBilling(billing);

  const computedFetchRange = useMemo(() => {
    const safeStart = clampYmd(rangeStart) || ymd(startOfMonth(today));
    const safeEnd = clampYmd(rangeEnd) || todayKey;
    const monthStart = `${month}-01`;
    return {
      start: [safeStart, lastWeekStart, weekStart, monthStart, yesterdayKey].sort()[0],
      end: [safeEnd, weekEnd, todayKey].sort().slice(-1)[0],
    };
  }, [rangeStart, rangeEnd, lastWeekStart, weekStart, month, yesterdayKey, weekEnd, todayKey, today]);

  const fetchStoreMeta = async (sid: string) => {
    const [storeRes, billingRes] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", sid).maybeSingle(),
      supabase.from("store_billing").select("base_plan_status,paid_until").eq("store_id", sid).maybeSingle(),
    ]);
    if (!storeRes.error) setStoreName(String(storeRes.data?.store_name || "").trim());
    if (!billingRes.error) {
      setBilling({
        status: String(billingRes.data?.base_plan_status || "inactive"),
        paidUntil: String(billingRes.data?.paid_until || "").trim() || null,
      });
    }
  };

  const fetchFromDb = async () => {
    if (!storeId) return;
    const { start, end } = computedFetchRange;
    if (start > end) return;
    setLoading(true);
    setErrMsg("");
    try {
      await fetchStoreMeta(storeId);
      const { data: oData, error: oErr } = await supabase
        .from("orders")
        .select("id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,total_price,status,store_id")
        .eq("store_id", storeId)
        .gte("order_date", start)
        .lte("order_date", end)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true });
      if (oErr) throw new Error(`[orders] ${oErr.message}`);

      const orderRows = Array.isArray(oData) ? (oData as RawOrderRow[]) : [];
      if (orderRows.length === 0) { setOrders([]); setDataMode("empty"); return; }

      const base = orderRows.map((r) => dbOrderToRecord(r, storeId)).filter((x) => x.id);
      const { data: iData, error: iErr } = await supabase
        .from("order_items")
        .select("id,order_id,menu_id,name,price,qty,store_id")
        .eq("store_id", storeId)
        .in("order_id", base.map((o) => o.id));
      if (iErr) throw new Error(`[order_items] ${iErr.message}`);

      const itemsByOrder = new Map<string, OrderItem[]>();
      for (const it of Array.isArray(iData) ? (iData as RawItemRow[]) : []) {
        const oid = getString(it, "order_id");
        if (!oid) continue;
        const arr = itemsByOrder.get(oid) || [];
        arr.push({
          id: getString(it, "menu_id") || getString(it, "id"),
          name: getString(it, "name"),
          price: Math.max(0, Math.round(getNumber(it, "price") || 0)),
          qty: Math.max(0, Math.round(getNumber(it, "qty") || 0)),
        });
        itemsByOrder.set(oid, arr);
      }

      setOrders(base.map((o) => {
        const its = itemsByOrder.get(o.id) || [];
        const computedCount = its.reduce((s, x) => s + (x.qty || 0), 0);
        const computedPrice = its.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0);
        return { ...o, items: its, totalCount: o.totalCount || computedCount, totalPrice: o.totalPrice || computedPrice };
      }));
      setDataMode("db");
    } catch (e: unknown) {
      console.error(e);
      setErrMsg(toErrorMessage(e));
      setOrders([]);
      setDataMode("empty");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (storeId) fetchFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, computedFetchRange.start, computedFetchRange.end]);

  const nonCanceled = useMemo(() => orders.filter((o) => o.status !== "cancelled"), [orders]);
  const dailyOrders = useMemo(() => nonCanceled.filter((o) => o.orderDate === todayKey), [nonCanceled, todayKey]);
  const yesterdayOrders = useMemo(() => nonCanceled.filter((o) => o.orderDate === yesterdayKey), [nonCanceled, yesterdayKey]);
  const weeklyOrders = useMemo(() => nonCanceled.filter((o) => inRange(o.orderDate, weekStart, weekEnd)), [nonCanceled, weekStart, weekEnd]);
  const lastWeekOrders = useMemo(() => nonCanceled.filter((o) => inRange(o.orderDate, lastWeekStart, lastWeekEnd)), [nonCanceled, lastWeekStart, lastWeekEnd]);
  const monthlyOrders = useMemo(() => nonCanceled.filter((o) => (o.orderDate || "").startsWith(month)), [nonCanceled, month]);
  const daily = useMemo(() => summarize(dailyOrders), [dailyOrders]);
  const yesterday = useMemo(() => summarize(yesterdayOrders), [yesterdayOrders]);
  const weekly = useMemo(() => summarize(weeklyOrders), [weeklyOrders]);
  const lastWeek = useMemo(() => summarize(lastWeekOrders), [lastWeekOrders]);
  const monthly = useMemo(() => summarize(monthlyOrders), [monthlyOrders]);

  const top5 = useMemo<TopMenu[]>(() => {
    const map = new Map<string, { name: string; qty: number; sales: number }>();
    for (const o of monthlyOrders) {
      for (const it of o.items || []) {
        const key = it.id || it.name;
        const prev = map.get(key);
        const lineSales = (it.price || 0) * (it.qty || 0);
        if (!prev) map.set(key, { name: it.name, qty: it.qty, sales: lineSales });
        else { prev.qty += it.qty; prev.sales += lineSales; }
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
      .slice(0, 5);
  }, [monthlyOrders]);

  const salesTop5 = useMemo<TopMenu[]>(() => {
    const map = new Map<string, { name: string; qty: number; sales: number }>();
    for (const o of monthlyOrders) {
      for (const it of o.items || []) {
        const key = it.id || it.name;
        const prev = map.get(key);
        const lineSales = (it.price || 0) * (it.qty || 0);
        if (!prev) map.set(key, { name: it.name, qty: it.qty, sales: lineSales });
        else { prev.qty += it.qty; prev.sales += lineSales; }
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.sales - a.sales || b.qty - a.qty)
      .slice(0, 5);
  }, [monthlyOrders]);

  const timeBuckets = useMemo<TimeBucket[]>(() => {
    const base = [
      { key: "morning", label: "오전", count: 0 },
      { key: "lunch", label: "점심", count: 0 },
      { key: "afternoon", label: "오후", count: 0 },
      { key: "evening", label: "저녁", count: 0 },
      { key: "night", label: "심야", count: 0 },
    ];
    const byKey = new Map(base.map((b) => [b.key, b]));
    for (const o of weeklyOrders) {
      const hour = new Date(o.createdAt).getHours();
      const bucket = byKey.get(bucketForHour(hour));
      if (bucket) bucket.count += 1;
    }
    return base;
  }, [weeklyOrders]);

  const effectiveStart = clampYmd(rangeStart);
  const effectiveEnd = clampYmd(rangeEnd);
  const rangeSummaryRows = useMemo(() => {
    if (!effectiveStart || !effectiveEnd) return [];
    const start = parseYmd(effectiveStart);
    const end = parseYmd(effectiveEnd);
    if (start > end) return [];
    const bucket = new Map<string, Summary>();
    for (const o of nonCanceled) {
      if (!inRange(o.orderDate, effectiveStart, effectiveEnd)) continue;
      const prev = bucket.get(o.orderDate) || { ...emptySummary };
      prev.sales += o.totalPrice;
      prev.orders += 1;
      prev.qty += o.totalCount;
      if (o.mode === "dine-in") prev.dineIn += 1;
      else prev.takeout += 1;
      bucket.set(o.orderDate, prev);
    }
    const rows: Array<{ date: string } & Summary> = [];
    let cur = new Date(start);
    while (cur <= end) {
      const key = ymd(cur);
      rows.push({ date: key, ...(bucket.get(key) || emptySummary) });
      cur = addDays(cur, 1);
    }
    return rows;
  }, [nonCanceled, effectiveStart, effectiveEnd]);

  const rangeTotals = useMemo(() => rangeSummaryRows.reduce<Summary>((t, r) => ({
    sales: t.sales + r.sales,
    orders: t.orders + r.orders,
    qty: t.qty + r.qty,
    dineIn: t.dineIn + r.dineIn,
    takeout: t.takeout + r.takeout,
  }), { ...emptySummary }), [rangeSummaryRows]);

  const setPreset = (preset: "today" | "7days" | "month" | "lastMonth") => {
    const t = new Date();
    if (preset === "today") {
      setRangeStart(ymd(t));
      setRangeEnd(ymd(t));
    } else if (preset === "7days") {
      setRangeStart(ymd(addDays(t, -6)));
      setRangeEnd(ymd(t));
    } else if (preset === "month") {
      setRangeStart(ymd(startOfMonth(t)));
      setRangeEnd(ymd(t));
    } else {
      const last = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      setRangeStart(ymd(startOfMonth(last)));
      setRangeEnd(ymd(endOfMonth(last)));
    }
    setRangeExpanded(false);
    setRangeMsg("");
  };

  const goBilling = () => router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`);
  const downloadRangeCsv = () => {
    if (!isPaidSubscriber) { goBilling(); return; }
    if (!effectiveStart || !effectiveEnd) { setRangeMsg("기간을 선택해 주세요."); return; }
    if (effectiveStart > effectiveEnd) { setRangeMsg("시작일이 종료일보다 늦습니다."); return; }
    const list = nonCanceled.filter((o) => inRange(o.orderDate, effectiveStart, effectiveEnd)).sort((a, b) => a.createdAt - b.createdAt);
    if (list.length === 0) { setRangeMsg("선택한 기간에 주문이 없습니다."); return; }
    setRangeMsg("");
    const rows = [["orderDate", "time", "displayNo", "mode", "table", "status", "buzzerNo", "requestNote", "itemName", "qty", "unitPrice", "lineTotal", "orderTotal", "internalId", "storeId"].join(",")];
    for (const o of list) {
      const orderItems = o.items?.length ? o.items : [{ id: "", name: "", price: 0, qty: 0 }];
      for (const it of orderItems) {
        rows.push([
          o.orderDate,
          formatTime(o.createdAt),
          o.displayNo,
          o.mode === "dine-in" ? "매장" : "포장",
          o.table ?? "",
          o.status,
          o.buzzerNo ?? "",
          o.requestNote ?? "",
          it.name,
          it.qty ? String(it.qty) : "",
          it.price ? String(it.price) : "",
          it.price && it.qty ? String(it.price * it.qty) : "",
          String(o.totalPrice),
          o.id,
          String(o.storeId || o.store_id || storeId),
        ].map((x) => csvEscape(String(x))).join(","));
      }
    }
    downloadTextFile(`qr-cafe-sales-detail_${storeId}_${effectiveStart}_to_${effectiveEnd}.csv`, rows.join("\n"), "text/csv;charset=utf-8");
  };

  const previewCount = 3;
  const hasMoreRange = rangeSummaryRows.length > previewCount;
  const visibleRangeRows = useMemo(() => (
    isPaidSubscriber && rangeExpanded
      ? rangeSummaryRows
      : rangeSummaryRows.slice(Math.max(0, rangeSummaryRows.length - previewCount))
  ), [rangeSummaryRows, rangeExpanded, isPaidSubscriber]);
  const displayStoreName = storeName || storeId || "—";
  const modeLabel = loading ? "새로고침 중" : dataMode === "db" ? "최신 집계" : "데이터 없음";
  const todayDiff = changeAmount(daily.sales, yesterday.sales);
  const weekDiff = changeAmount(weekly.sales, lastWeek.sales);
  const maxBucketCount = Math.max(1, ...timeBuckets.map((b) => b.count));

  const renderMetricCard = (title: string, period: string, summary: Summary, locked = false) => (
    <div className={`card metricCard ${locked ? "locked" : ""}`}>
      <div className="cardHead">
        <div>
          <h2 className="cardTitle">{title}</h2>
          <div className="cardPeriod">{period}</div>
        </div>
        {locked ? <span className="lockBadge">유료 전용</span> : <span className="miniBadge">포장 {takeoutRate(summary)}%</span>}
      </div>
      {locked ? (
        <div className="lockBox">
          <strong>구독 후 확인</strong>
          <button className="linkBtn" type="button" onClick={goBilling}>구독 관리</button>
        </div>
      ) : (
        <>
          <div className="salesLine">{formatWonCompact(summary.sales)}</div>
          <div className="metricLine">주문 {summary.orders}건 · 수량 {summary.qty}개</div>
          <div className="metricSub">객단가 {formatWon(avgOrder(summary))} · 매장 {summary.dineIn} / 포장 {summary.takeout}</div>
        </>
      )}
    </div>
  );

  const renderAdvancedModal = () => {
    if (!advancedOpen) return null;
    return (
      <div className="modalBackdrop" role="presentation" onClick={() => setAdvancedOpen(false)}>
        <section className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="advanced-title" onClick={(e) => e.stopPropagation()}>
          <div className="modalHead">
            <h2 id="advanced-title" className="cardTitle">고급 통계</h2>
            <button className="closeBtn" type="button" onClick={() => setAdvancedOpen(false)} aria-label="닫기">×</button>
          </div>
          {!isPaidSubscriber ? (
            <div className="subscribeBox">
              <p>구독 후 확인할 수 있습니다.</p>
              <div className="btnRow">
                <button className="btn btnPrimary" type="button" onClick={goBilling}>구독 관리</button>
                <button className="btn" type="button" onClick={() => setAdvancedOpen(false)}>닫기</button>
              </div>
            </div>
          ) : (
            <div className="advancedGrid">
              <div className="advancedCard">
                <h3>오늘 비교</h3>
                <div className="compareGrid">
                  <div><span>오늘</span><strong>{formatWon(daily.sales)}</strong></div>
                  <div><span>어제</span><strong>{formatWon(yesterday.sales)}</strong></div>
                  <div><span>증감</span><strong>{changeLabel(todayDiff)}</strong></div>
                  <div><span>증감률</span><strong>{changeRateLabel(changeRate(daily.sales, yesterday.sales))}</strong></div>
                </div>
              </div>

              <div className="advancedCard">
                <h3>주간 비교</h3>
                <div className="compareGrid">
                  <div><span>이번 주</span><strong>{formatWon(weekly.sales)}</strong></div>
                  <div><span>지난주</span><strong>{formatWon(lastWeek.sales)}</strong></div>
                  <div><span>증감</span><strong>{changeLabel(weekDiff)}</strong></div>
                  <div><span>증감률</span><strong>{changeRateLabel(changeRate(weekly.sales, lastWeek.sales))}</strong></div>
                </div>
              </div>

              <div className="advancedCard wide">
                <h3>시간대별 주문</h3>
                <div className="barList">
                  {timeBuckets.map((bucket) => (
                    <div key={bucket.key} className="barRow">
                      <span>{bucket.label}</span>
                      <div className="barTrack"><div className="barFill" style={{ width: `${Math.max(5, (bucket.count / maxBucketCount) * 100)}%` }} /></div>
                      <strong>{bucket.count}건</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="advancedCard wide">
                <h3>매출 TOP 5</h3>
                {salesTop5.length === 0 ? (
                  <p className="muted">당월 판매 데이터가 없습니다.</p>
                ) : (
                  <div className="topList">
                    {salesTop5.map((m, idx) => (
                      <div key={m.id} className="topItem">
                        <div className="topMain">
                          <span className="rank">{idx + 1}</span>
                          <div>
                            <div className="topName">{m.name}</div>
                            <div className="topSub">판매 {m.qty}개</div>
                          </div>
                        </div>
                        <div className="topMeta">{formatWon(m.sales)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    );
  };

  return (
    <main className="wrap">
      <style jsx global>{`:root{--bg:#f6f7f9;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#111827;--radius:16px}body{background:var(--bg);color:var(--text)}`}</style>
      <style jsx>{`
        .wrap{max-width:1100px;margin:0 auto;padding:14px;display:grid;gap:10px}.topbar{display:grid;gap:8px}.titleRow{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}.h1{margin:0;font-size:28px;font-weight:950;letter-spacing:-.02em}.metaRow,.btnRow,.quickRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pill,.miniBadge,.lockBadge{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 9px;color:var(--muted);font-size:12px;font-weight:900;white-space:nowrap}.lockBadge{background:#fff7ed;border-color:#fed7aa;color:#9a3412}.btn,.quickBtn,.linkBtn,.closeBtn{border:1px solid var(--line);background:#fff;border-radius:12px;cursor:pointer;font-weight:900}.btn:disabled,.quickBtn:disabled{cursor:not-allowed;opacity:.55}.btn{padding:10px 13px;text-decoration:none;color:inherit}.quickBtn{padding:8px 10px;font-size:13px}.btnPrimary{background:var(--brand);border-color:var(--brand);color:#fff}.linkBtn{padding:7px 9px;font-size:12px}.closeBtn{width:36px;height:36px;font-size:22px;line-height:1}.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px;box-shadow:0 1px 0 rgba(0,0,0,.03)}.notice{display:flex;justify-content:space-between;align-items:center;gap:10px;background:#fffbeb;border-color:#fde68a}.noticeText{margin:0;color:#92400e;font-size:13px;font-weight:850;line-height:1.35}.summaryGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.cardHead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.cardTitle{margin:0;font-size:16px;font-weight:950;line-height:1.15}.cardPeriod{margin-top:5px;color:var(--muted);font-size:12px;font-weight:850;line-height:1.15}.salesLine{margin-top:9px;font-size:27px;font-weight:950;letter-spacing:-.02em;line-height:1.05;white-space:nowrap}.metricLine{margin-top:8px;font-size:13px;font-weight:950}.metricSub{margin-top:4px;color:var(--muted);font-size:12px;font-weight:850;line-height:1.25}.locked{background:linear-gradient(180deg,#fff,#fafafa)}.lockBox{margin-top:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;color:var(--muted)}.twoCol{display:grid;grid-template-columns:1.1fr .9fr;gap:10px}.topList,.mobileRows{margin-top:8px;display:grid;gap:6px}.topItem,.dayCard{border:1px solid var(--line);border-radius:14px;padding:8px 10px;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:10px}.rank{min-width:26px;height:26px;border-radius:999px;display:inline-grid;place-items:center;background:#111827;color:#fff;font-size:12px;font-weight:950}.topMain{display:flex;gap:8px;align-items:center;min-width:0}.topName{font-weight:950;line-height:1.2;overflow:hidden;text-overflow:ellipsis}.topSub,.daySub{margin-top:2px;color:var(--muted);font-size:12px;font-weight:850;line-height:1.15}.topMeta,.daySales{color:var(--muted);font-size:13px;font-weight:900;text-align:right;white-space:nowrap}.rangeRow{margin-top:8px;display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end}.field{display:grid;gap:5px}.label{font-size:12px;color:var(--muted);font-weight:900}.input{width:100%;padding:10px 11px;border-radius:12px;border:1px solid var(--line);background:#fff;font-weight:850}.totals{margin-top:10px;border-top:1px solid var(--line);padding-top:10px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.totalBox{border:1px solid var(--line);border-radius:14px;padding:9px;background:#fff}.totalLabel{color:var(--muted);font-size:12px;font-weight:900}.totalValue{margin-top:3px;font-size:14px;font-weight:950}.sectionHead{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}.tableWrap{margin-top:8px;overflow:auto;border-radius:14px;border:1px solid var(--line);background:#fff}table{width:100%;border-collapse:collapse;min-width:720px}th,td{padding:11px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}th{color:var(--muted);font-size:13px;font-weight:950;background:#fafafa}.tfoot{background:#f9fafb;font-weight:950}.muted{color:var(--muted)}.err,.rangeMsg{color:#b91c1c;font-weight:900;font-size:13px}.rangeMsg{margin-top:8px}.mobileRows{display:none}.modalBackdrop{position:fixed;inset:0;z-index:50;background:rgba(17,24,39,.42);display:grid;place-items:center;padding:16px}.modalPanel{width:min(760px,100%);max-height:min(760px,calc(100vh - 32px));overflow:auto;background:#fff;border-radius:22px;border:1px solid var(--line);padding:14px;box-shadow:0 24px 60px rgba(0,0,0,.22)}.modalHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.advancedGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.advancedCard{border:1px solid var(--line);border-radius:16px;padding:12px;background:#fff}.advancedCard.wide{grid-column:1/-1}.advancedCard h3{margin:0 0 10px;font-size:14px;font-weight:950}.compareGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.compareGrid div{border:1px solid var(--line);border-radius:14px;padding:9px}.compareGrid span{display:block;color:var(--muted);font-size:12px;font-weight:900}.compareGrid strong{display:block;margin-top:4px;font-size:15px}.barList{display:grid;gap:8px}.barRow{display:grid;grid-template-columns:42px 1fr 46px;gap:8px;align-items:center;font-size:13px;font-weight:900}.barTrack{height:10px;border-radius:999px;background:#f3f4f6;overflow:hidden}.barFill{height:100%;border-radius:999px;background:#111827}.subscribeBox{display:grid;gap:12px}.subscribeBox p{margin:0;color:var(--muted);font-weight:900}@media(max-width:900px){.summaryGrid,.twoCol{grid-template-columns:1fr}}@media(max-width:640px){.wrap{padding:10px;gap:8px}.h1{font-size:23px}.card{padding:10px}.summaryGrid{gap:8px}.salesLine{font-size:24px}.btn{padding:9px 11px}.notice{align-items:flex-start}.rangeRow{grid-template-columns:1fr 1fr}.rangeRow .btnPrimary{grid-column:1/-1}.totals{grid-template-columns:1fr 1fr;gap:6px}.tableWrap{display:none}.mobileRows{display:grid}.modalBackdrop{align-items:end;padding:0}.modalPanel{width:100%;max-height:88vh;border-radius:22px 22px 0 0;padding:12px}.advancedGrid,.compareGrid{grid-template-columns:1fr}.barRow{grid-template-columns:38px 1fr 42px}.topItem,.dayCard{padding:8px}}
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <div>
            <h1 className="h1">매출 통계</h1>
            <div className="metaRow" style={{ marginTop: 7 }}>
              <span className="pill">{displayStoreName}</span>
              <span className="pill">취소 주문 제외</span>
              <span className="pill">{isPaidSubscriber ? "유료 구독 중" : "일부 제한"}</span>
              <span className="pill">{modeLabel}</span>
            </div>
          </div>
          <div className="btnRow">
            <a className="btn" href="/admin">관리자 홈</a>
            <button className="btn" type="button" onClick={() => setAdvancedOpen(true)}>고급 통계</button>
            <button className="btn" type="button" onClick={fetchFromDb} disabled={loading}>{loading ? "새로고침 중" : "새로고침"}</button>
          </div>
        </div>
        {errMsg ? <div className="err">오류: {errMsg}</div> : null}
      </header>

      {!isPaidSubscriber ? (
        <section className="card notice">
          <p className="noticeText">일부 통계는 구독 후 확인할 수 있습니다.</p>
          <button className="btn btnPrimary" type="button" onClick={goBilling}>구독 관리</button>
        </section>
      ) : null}

      <section className="summaryGrid">
        {renderMetricCard("오늘", todayKey, daily)}
        {renderMetricCard("이번 주", `${weekStart} ~ ${weekEnd}`, weekly, !isPaidSubscriber)}
        <div className="card metricCard">
          <div className="cardHead">
            <div>
              <h2 className="cardTitle">이번 달</h2>
              <div className="cardPeriod">{month}</div>
            </div>
            {isPaidSubscriber ? <span className="miniBadge">포장 {takeoutRate(monthly)}%</span> : <span className="lockBadge">상세 유료</span>}
          </div>
          <div className="salesLine">{formatWonCompact(monthly.sales)}</div>
          {isPaidSubscriber ? (
            <>
              <div className="metricLine">주문 {monthly.orders}건 · 수량 {monthly.qty}개</div>
              <div className="metricSub">객단가 {formatWon(avgOrder(monthly))} · 매장 {monthly.dineIn} / 포장 {monthly.takeout}</div>
            </>
          ) : (
            <div className="metricSub">상세 지표는 구독 후 확인</div>
          )}
        </div>
      </section>

      <section className="twoCol">
        <div className="card">
          <div className="sectionHead">
            <h2 className="cardTitle">인기 메뉴 TOP 5</h2>
            {!isPaidSubscriber ? <span className="lockBadge">일부 공개</span> : null}
          </div>
          {top5.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>당월 판매 데이터가 없습니다.</p>
          ) : (
            <div className="topList">
              {(isPaidSubscriber ? top5 : top5.slice(0, 1)).map((m, idx) => (
                <div key={m.id} className="topItem">
                  <div className="topMain">
                    <span className="rank">{idx + 1}</span>
                    <div>
                      <div className="topName">{m.name}</div>
                      <div className="topSub">판매 {m.qty}개</div>
                    </div>
                  </div>
                  <div className="topMeta">{isPaidSubscriber ? formatWon(m.sales) : "구독 후"}</div>
                </div>
              ))}
              {!isPaidSubscriber ? (
                <div className="lockBox">
                  <strong>나머지는 구독 후 확인</strong>
                  <button className="linkBtn" type="button" onClick={goBilling}>구독 관리</button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="card">
          <div className="sectionHead">
            <h2 className="cardTitle">기간 조회</h2>
            {!isPaidSubscriber ? <span className="lockBadge">유료 전용</span> : null}
          </div>
          <div className="quickRow" style={{ marginTop: 8 }}>
            <button className="quickBtn" type="button" onClick={() => setPreset("today")} disabled={!isPaidSubscriber}>오늘</button>
            <button className="quickBtn" type="button" onClick={() => setPreset("7days")} disabled={!isPaidSubscriber}>7일</button>
            <button className="quickBtn" type="button" onClick={() => setPreset("month")} disabled={!isPaidSubscriber}>이번 달</button>
            <button className="quickBtn" type="button" onClick={() => setPreset("lastMonth")} disabled={!isPaidSubscriber}>지난 달</button>
          </div>
          <div className="rangeRow">
            <label className="field">
              <span className="label">시작일</span>
              <input className="input" type="date" value={rangeStart} disabled={!isPaidSubscriber} onChange={(e) => { setRangeStart(e.target.value); setRangeExpanded(false); setRangeMsg(""); }} />
            </label>
            <label className="field">
              <span className="label">종료일</span>
              <input className="input" type="date" value={rangeEnd} disabled={!isPaidSubscriber} onChange={(e) => { setRangeEnd(e.target.value); setRangeExpanded(false); setRangeMsg(""); }} />
            </label>
            <button className="btn btnPrimary" type="button" onClick={downloadRangeCsv} disabled={loading}>상세 내역 받기</button>
          </div>
          {rangeMsg ? <div className="rangeMsg">{rangeMsg}</div> : null}
          {isPaidSubscriber ? (
            <div className="totals">
              <div className="totalBox"><div className="totalLabel">매출</div><div className="totalValue">{formatWon(rangeTotals.sales)}</div></div>
              <div className="totalBox"><div className="totalLabel">주문</div><div className="totalValue">{rangeTotals.orders}건</div></div>
              <div className="totalBox"><div className="totalLabel">수량</div><div className="totalValue">{rangeTotals.qty}개</div></div>
              <div className="totalBox"><div className="totalLabel">포장</div><div className="totalValue">{takeoutRate(rangeTotals)}%</div></div>
            </div>
          ) : (
            <div className="lockBox">
              <strong>기간별 상세는 구독 후 확인</strong>
              <button className="linkBtn" type="button" onClick={goBilling}>구독 관리</button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2 className="cardTitle">일자별 요약</h2>
          {isPaidSubscriber && effectiveStart && effectiveEnd && effectiveStart <= effectiveEnd && hasMoreRange ? (
            <button className="btn" type="button" onClick={() => setRangeExpanded((v) => !v)}>{rangeExpanded ? "접기" : "전체 보기"}</button>
          ) : null}
        </div>
        {!effectiveStart || !effectiveEnd ? (
          <p className="muted" style={{ marginTop: 10 }}>기간을 선택해 주세요.</p>
        ) : effectiveStart > effectiveEnd ? (
          <p className="muted" style={{ marginTop: 10 }}>시작일이 종료일보다 늦습니다.</p>
        ) : rangeSummaryRows.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>선택한 기간에 주문이 없습니다.</p>
        ) : (
          <>
            <div className="tableWrap">
              <table>
                <thead><tr><th>일자</th><th>매출</th><th>주문</th><th>수량</th><th>매장</th><th>포장</th></tr></thead>
                <tbody>
                  {visibleRangeRows.map((r) => (
                    <tr key={r.date}><td style={{ fontWeight: 900 }}>{r.date}</td><td>{formatWon(r.sales)}</td><td>{r.orders}건</td><td>{r.qty}개</td><td>{r.dineIn}</td><td>{r.takeout}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="tfoot"><td>합계</td><td>{formatWon(rangeTotals.sales)}</td><td>{rangeTotals.orders}건</td><td>{rangeTotals.qty}개</td><td>{rangeTotals.dineIn}</td><td>{rangeTotals.takeout}</td></tr></tfoot>
              </table>
            </div>
            <div className="mobileRows">
              {visibleRangeRows.map((r) => (
                <div key={r.date} className="dayCard">
                  <div><strong>{r.date}</strong><div className="daySub">주문 {r.orders} · 수량 {r.qty} · 매장 {r.dineIn} / 포장 {r.takeout}</div></div>
                  <div className="daySales">{formatWon(r.sales)}</div>
                </div>
              ))}
            </div>
            {!isPaidSubscriber && hasMoreRange ? (
              <div className="lockBox">
                <strong>최근 3일만 표시</strong>
                <button className="linkBtn" type="button" onClick={goBilling}>구독 관리</button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {renderAdvancedModal()}
    </main>
  );
}

export default function AdminStatsPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminStatsPageInner />
    </Suspense>
  );
}
