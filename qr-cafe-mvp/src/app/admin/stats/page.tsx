// src/app/admin/stats/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";

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
type TimeBucket = { key: string; label: string; range: string; count: number };

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
function csvCellText(v: unknown) { return String(v ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(); }
function csvCell(v: unknown) { return csvEscape(csvCellText(v)); }
function statusLabel(status: OrderStatus) {
  if (status === "checked") return "확인";
  if (status === "making") return "제조중";
  if (status === "ready_for_packing") return "포장준비";
  if (status === "completed") return "완료";
  if (status === "cancelled") return "취소";
  return "신규";
}
function orderModeLabel(mode: OrderMode) { return mode === "takeout" ? "포장" : "매장식사"; }
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
    totalCount: Math.max(0, toInt(row.total_count, 0) - toInt(row.refunded_count, 0)),
    totalPrice: Math.max(0, Math.round(Number(row.adjusted_total_price ?? row.total_price ?? 0))),
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
        .select("id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,refunded_count,total_price,adjusted_total_price,status,store_id")
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
        .select("id,order_id,menu_id,name,price,qty,refunded_qty,store_id")
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
          qty: Math.max(0, Math.round(getNumber(it, "qty") || 0) - Math.round(getNumber(it, "refunded_qty") || 0)),
        });
        itemsByOrder.set(oid, arr);
      }

      setOrders(base.map((o) => {
        const its = itemsByOrder.get(o.id) || [];
        return { ...o, items: its };
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
      { key: "morning", label: "오전", range: "06-11시", count: 0 },
      { key: "lunch", label: "점심", range: "11-14시", count: 0 },
      { key: "afternoon", label: "오후", range: "14-18시", count: 0 },
      { key: "evening", label: "저녁", range: "18-22시", count: 0 },
      { key: "night", label: "심야", range: "22-06시", count: 0 },
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
    const header = ["주문일자", "주문시간", "주문번호", "상품순번", "주문유형", "테이블", "진동벨", "주문상태", "요청사항", "메뉴명", "수량", "단가", "상품합계", "주문합계", "주문ID", "매장ID"];
    const rows = [header.map(csvCell).join(",")];
    for (const o of list) {
      const orderItems = o.items?.length ? o.items : [{ id: "", name: "상품 정보 없음", price: 0, qty: 0 }];
      orderItems.forEach((it, idx) => {
        const qty = Number(it.qty || 0);
        const price = Number(it.price || 0);
        rows.push([
          o.orderDate,
          formatTime(o.createdAt),
          o.displayNo,
          idx + 1,
          orderModeLabel(o.mode),
          o.table ?? "",
          o.buzzerNo ?? "",
          statusLabel(o.status),
          o.requestNote ?? "",
          it.name || "상품 정보 없음",
          qty || "",
          price || "",
          qty && price ? qty * price : "",
          o.totalPrice,
          o.id,
          String(o.storeId || o.store_id || storeId),
        ].map(csvCell).join(","));
      });
    }
    const csvContent = `\uFEFF${rows.join("\n")}`;
    downloadTextFile(`sales-detail-items_${storeId}_${effectiveStart}_to_${effectiveEnd}.csv`, csvContent, "text/csv;charset=utf-8");
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
  const peakBucket = useMemo(() => {
    const ranked = [...timeBuckets].sort((a, b) => b.count - a.count);
    return ranked[0]?.count > 0 ? ranked[0] : null;
  }, [timeBuckets]);

  const renderMetricCard = (title: string, period: string, summary: Summary, locked = false) => (
    <div className={`card metricCard ${locked ? "locked" : ""}`}>
      <div className="cardHead">
        <div>
          <h2 className="cardTitle">{title}</h2>
          <div className="cardPeriod desktopMetricOnly">{period}</div>
        </div>
        {locked ? <span className="lockBadge desktopMetricOnly">유료 전용</span> : <span className="miniBadge desktopMetricOnly">포장 {takeoutRate(summary)}%</span>}
      </div>
      {locked ? (
        <div className="lockBox">
          <strong>구독 후 확인</strong>
          <button className="linkBtn" type="button" onClick={goBilling}>구독 관리</button>
        </div>
      ) : (
        <>
          <div className="salesLine">{formatWonCompact(summary.sales)}</div>
          <div className="metricLine"><span>주문 {summary.orders}건</span><span>판매 {summary.qty}개</span></div>
          <div className="metricSub desktopMetricOnly">객단가 {formatWon(avgOrder(summary))} · 매장 {summary.dineIn} / 포장 {summary.takeout}</div>
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
              <p>구독하면 매장 운영에 필요한 상세 분석을 확인할 수 있습니다.</p>
              <ul className="featureList" aria-label="구독 후 제공되는 고급 통계">
                <li>오늘 vs 어제 매출 변화</li>
                <li>이번 주 vs 지난주 매출 변화</li>
                <li>객단가 변화와 포장 비율 변화</li>
                <li>시간대별 주문 흐름과 피크 시간대</li>
                <li>매출 TOP 5</li>
              </ul>
              <div className="btnRow">
                <button className="btn btnPrimary" type="button" onClick={goBilling}>구독 관리</button>
                <button className="btn" type="button" onClick={() => setAdvancedOpen(false)}>닫기</button>
              </div>
            </div>
          ) : (
            <div className="advancedGrid">
              <div className="advancedCard">
                <h3>오늘 vs 어제</h3>
                <div className="compareGrid">
                  <div><span>오늘</span><strong>{formatWon(daily.sales)}</strong></div>
                  <div><span>어제</span><strong>{formatWon(yesterday.sales)}</strong></div>
                  <div><span>증감</span><strong>{changeLabel(todayDiff)}</strong></div>
                  <div><span>증감률</span><strong>{changeRateLabel(changeRate(daily.sales, yesterday.sales))}</strong></div>
                </div>
              </div>

              <div className="advancedCard">
                <h3>이번 주 vs 지난주</h3>
                <div className="compareGrid">
                  <div><span>이번 주</span><strong>{formatWon(weekly.sales)}</strong></div>
                  <div><span>지난주</span><strong>{formatWon(lastWeek.sales)}</strong></div>
                  <div><span>증감</span><strong>{changeLabel(weekDiff)}</strong></div>
                  <div><span>증감률</span><strong>{changeRateLabel(changeRate(weekly.sales, lastWeek.sales))}</strong></div>
                </div>
              </div>

              <div className="advancedCard">
                <h3>객단가 변화</h3>
                <div className="compareGrid">
                  <div><span>오늘</span><strong>{formatWon(avgOrder(daily))}</strong></div>
                  <div><span>어제</span><strong>{formatWon(avgOrder(yesterday))}</strong></div>
                  <div><span>증감</span><strong>{changeLabel(changeAmount(avgOrder(daily), avgOrder(yesterday)))}</strong></div>
                  <div><span>이번 달 평균</span><strong>{formatWon(avgOrder(monthly))}</strong></div>
                </div>
              </div>

              <div className="advancedCard">
                <h3>포장 비율 변화</h3>
                <div className="compareGrid">
                  <div><span>오늘</span><strong>{takeoutRate(daily)}%</strong></div>
                  <div><span>이번 주</span><strong>{takeoutRate(weekly)}%</strong></div>
                  <div><span>이번 달</span><strong>{takeoutRate(monthly)}%</strong></div>
                  <div><span>선택 기간</span><strong>{takeoutRate(rangeTotals)}%</strong></div>
                </div>
              </div>

              <div className="advancedCard wide">
                <h3>시간대별 주문</h3>
                {peakBucket ? (
                  <div className="peakBox">
                    <span>피크 시간대</span>
                    <strong>{peakBucket.label} {peakBucket.range} · {peakBucket.count}건</strong>
                  </div>
                ) : (
                  <div className="peakBox mutedPeak">
                    <span>피크 시간대</span>
                    <strong>이번 주 주문 데이터가 아직 없습니다.</strong>
                  </div>
                )}
                <div className="barList">
                  {timeBuckets.map((bucket) => (
                    <div key={bucket.key} className="barRow">
                      <span>{bucket.label} {bucket.range}</span>
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
    <main className="statsPage">
      <style jsx global>{`:root{--bg:#f6f7f9;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#111827;--radius:16px}body{background:var(--bg);color:var(--text)}`}</style>
      {/* These styles must be global because metric cards and the advanced modal are returned from helper render functions. */}
      <style jsx global>{`
        .statsPage {
          width: min(100% - 32px, 1120px);
          margin: 0 auto;
          padding: 18px 0 24px;
          display: grid;
          gap: 14px;
          color: var(--text);
        }
        .heroCard,
        .card {
          background: var(--card);
          border: 1px solid #dbe3ef;
          border-radius: 20px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
        }
        .heroCard {
          padding: 18px;
          display: grid;
          gap: 10px;
          background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
        }
        .titleRow,
        .cardHead,
        .sectionHead,
        .notice,
        .lockBox,
        .modalHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .titleRow,
        .sectionHead { flex-wrap: wrap; }
        .eyebrow {
          margin: 0 0 6px;
          color: #2563eb;
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.04em;
        }
        .h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 950;
          letter-spacing: -0.04em;
          line-height: 1.12;
        }
        .heroDesc {
          margin: 7px 0 0;
          color: var(--muted);
          font-size: 14px;
          font-weight: 750;
          line-height: 1.45;
        }
        .metaRow,
        .btnRow,
        .heroActions,
        .quickRow {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .metaRow { margin-top: 10px; }
        .pill,
        .miniBadge,
        .lockBadge {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 5px 10px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }
        .miniBadge { background: #f8fafc; }
        .lockBadge {
          background: #fff7ed;
          border-color: #fed7aa;
          color: #9a3412;
        }
        .btn,
        .quickBtn,
        .linkBtn,
        .closeBtn {
          border: 1px solid #cbd5e1;
          background: #fff;
          color: inherit;
          cursor: pointer;
          font-family: inherit;
          font-weight: 900;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .btn:disabled,
        .quickBtn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .btn {
          min-height: 40px;
          padding: 0 14px;
          border-radius: 12px;
          font-size: 13px;
          line-height: 1;
          white-space: nowrap;
        }
        .quickBtn {
          min-height: 36px;
          padding: 0 12px;
          border-radius: 999px;
          font-size: 13px;
        }
        .heroActions .btn { min-width: 104px; }
        .btnPrimary {
          background: var(--brand);
          border-color: var(--brand);
          color: #fff;
        }
        .linkBtn {
          min-height: 34px;
          padding: 0 10px;
          border-radius: 10px;
          font-size: 12px;
        }
        .closeBtn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          font-size: 24px;
          line-height: 1;
        }
        .card {
          padding: 16px;
          display: grid;
          gap: 10px;
        }
        .notice {
          align-items: center;
          background: #fffbeb;
          border-color: #fde68a;
        }
        .notice .btnPrimary {
          flex: 0 0 auto;
          min-width: 128px;
        }
        .noticeText {
          margin: 0;
          color: #92400e;
          font-size: 13px;
          font-weight: 850;
          line-height: 1.4;
        }
        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .premiumInsight{position:relative;min-height:112px;padding:19px 20px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:15px;overflow:hidden;border:1px solid #304e7b;border-radius:18px;background:linear-gradient(135deg,#0f2344,#1d477d);color:#fff;box-shadow:0 14px 30px rgba(15,35,66,.15)}
        .premiumInsight:after{content:"";position:absolute;right:-60px;top:-90px;width:210px;height:210px;border:35px solid rgba(255,255,255,.05);border-radius:50%}
        .premiumIcon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(224,181,84,.16);color:#f0ca70;z-index:1}.premiumIcon svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
        .premiumCopy{min-width:0;display:grid;gap:5px;z-index:1}.premiumTop{display:flex;align-items:center;gap:8px}.premiumTop strong{font-size:16px;font-weight:950}.premiumBadge{padding:3px 7px;border:1px solid rgba(240,202,112,.44);border-radius:999px;background:rgba(240,202,112,.12);color:#f4d58b;font-size:8px;font-weight:950;letter-spacing:.1em}.premiumCopy p{margin:0;color:#c8d6e8;font-size:11px;font-weight:700;line-height:1.5}.premiumButton{z-index:1;min-height:42px;padding:0 14px;border:1px solid rgba(255,255,255,.3);border-radius:12px;background:#fff;color:#173e73;font-weight:950;cursor:pointer;white-space:nowrap}
        .metricCard {
          position: relative;
          min-height: 154px;
          overflow: hidden;
        }
        .metricCard::before {
          content: "";
          position: absolute;
          left: 0;
          top: 18px;
          bottom: 18px;
          width: 4px;
          border-radius: 999px;
          background: #111827;
        }
        .cardTitle {
          margin: 0;
          font-size: 17px;
          font-weight: 950;
          line-height: 1.2;
          letter-spacing: -0.02em;
        }
        .cardPeriod {
          margin-top: 5px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.2;
        }
        .salesLine {
          margin-top: 4px;
          font-size: 30px;
          font-weight: 950;
          letter-spacing: -0.04em;
          line-height: 1.05;
          white-space: nowrap;
        }
        .metricLine {
          margin-top: 2px;
          font-size: 13px;
          font-weight: 950;
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
          align-items: center;
        }
        .metricLine span + span::before {
          content: "·";
          margin-right: 4px;
        }
        .metricSub {
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.35;
        }
        .locked {
          background: linear-gradient(180deg, #fff, #fafafa);
        }
        .lockBox {
          align-items: center;
          color: var(--muted);
          border: 1px dashed #cbd5e1;
          border-radius: 14px;
          padding: 10px;
          background: #f8fafc;
        }
        .twoCol {
          display: grid;
          grid-template-columns: 1.08fr 0.92fr;
          gap: 12px;
        }
        .topList,
        .mobileRows,
        .barList,
        .subscribeBox,
        .featureList {
          display: grid;
          gap: 8px;
        }
        .topItem,
        .dayCard {
          border: 1px solid var(--line);
          border-radius: 15px;
          padding: 11px 12px;
          background: #fff;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .rank {
          min-width: 28px;
          height: 28px;
          border-radius: 999px;
          display: inline-grid;
          place-items: center;
          background: #111827;
          color: #fff;
          font-size: 12px;
          font-weight: 950;
        }
        .topMain {
          display: flex;
          gap: 9px;
          align-items: center;
          min-width: 0;
        }
        .topName {
          font-weight: 950;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .topSub,
        .daySub {
          margin-top: 3px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.25;
        }
        .topMeta,
        .daySales {
          color: #334155;
          font-size: 13px;
          font-weight: 950;
          text-align: right;
          white-space: nowrap;
        }
        .rangeRow {
          display: grid;
          grid-template-columns: 1fr 1fr auto;
          gap: 8px;
          align-items: end;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          width: 100%;
          min-height: 42px;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid #cbd5e1;
          background: #fff;
          font-weight: 850;
        }
        .totals {
          border-top: 1px solid var(--line);
          padding-top: 10px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .totalBox {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px;
          background: #f8fafc;
        }
        .totalLabel {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .totalValue {
          margin-top: 3px;
          font-size: 15px;
          font-weight: 950;
        }
        .tableWrap {
          overflow: auto;
          border-radius: 16px;
          border: 1px solid var(--line);
          background: #fff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 720px;
        }
        th,
        td {
          padding: 12px;
          border-bottom: 1px solid var(--line);
          text-align: left;
          font-size: 14px;
        }
        th {
          color: var(--muted);
          font-size: 13px;
          font-weight: 950;
          background: #f8fafc;
        }
        .tfoot {
          background: #f9fafb;
          font-weight: 950;
        }
        .desktopMetricOnly { display: revert; }
        .muted { color: var(--muted); }
        .err,
        .rangeMsg {
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
        }
        .emptyBox {
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          padding: 16px;
          background: #f8fafc;
          color: #475569;
        }
        .emptyBox strong {
          display: block;
          color: #111827;
          font-size: 15px;
          font-weight: 950;
        }
        .emptyBox p {
          margin: 6px 0 0;
          font-size: 13px;
          font-weight: 750;
          line-height: 1.45;
        }
        .emptyError {
          border-color: #fecaca;
          background: #fef2f2;
        }
        .mobileRows { display: none; }
        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(15, 23, 42, 0.48);
          display: grid;
          place-items: center;
          padding: 18px;
        }
        .modalPanel {
          width: min(780px, 100%);
          max-height: min(780px, calc(100vh - 36px));
          overflow: auto;
          background: #fff;
          border-radius: 24px;
          border: 1px solid #dbe3ef;
          padding: 18px;
          box-shadow: 0 28px 70px rgba(15, 23, 42, 0.28);
        }
        .modalHead {
          align-items: center;
          margin-bottom: 12px;
        }
        .advancedGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .advancedCard {
          border: 1px solid var(--line);
          border-radius: 18px;
          padding: 14px;
          background: #fff;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
        }
        .advancedCard.wide { grid-column: 1 / -1; }
        .advancedCard h3 {
          margin: 0 0 11px;
          font-size: 15px;
          font-weight: 950;
        }
        .compareGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .compareGrid div {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 10px;
          background: #f8fafc;
        }
        .compareGrid span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .compareGrid strong {
          display: block;
          margin-top: 5px;
          font-size: 15px;
        }
        .peakBox {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
          border: 1px solid #bfdbfe;
          border-radius: 14px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 10px 12px;
          margin-bottom: 10px;
        }
        .peakBox span {
          font-size: 12px;
          font-weight: 900;
        }
        .peakBox strong {
          font-size: 14px;
          font-weight: 950;
          text-align: right;
        }
        .mutedPeak {
          border-color: var(--line);
          background: #f8fafc;
          color: var(--muted);
        }
        .barRow {
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr) 50px;
          gap: 8px;
          align-items: center;
          font-size: 13px;
          font-weight: 900;
        }
        .barTrack {
          height: 11px;
          border-radius: 999px;
          background: #f1f5f9;
          overflow: hidden;
        }
        .barFill {
          height: 100%;
          border-radius: 999px;
          background: #111827;
        }
        .subscribeBox p {
          margin: 0;
          color: var(--muted);
          font-weight: 900;
        }
        .featureList {
          margin: 0;
          padding-left: 18px;
          color: #475569;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.45;
        }
        @media (max-width: 900px) {
          .twoCol {
            grid-template-columns: 1fr;
          }
          .metricCard { min-height: 0; }
        }
        @media (min-width: 701px) and (max-width: 900px) {
          .titleRow {
            display: grid;
          }
          .heroActions {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 700px) {
          .statsPage {
            width: min(100% - 20px, 1120px);
            padding: 10px 0 18px;
            gap: 10px;
          }
          .heroCard,
          .card {
            border-radius: 16px;
            padding: 13px;
          }
          .titleRow,
          .notice,
          .lockBox {
            display: grid;
          }
          .h1 { font-size: 24px; }
          .heroDesc { font-size: 13px; }
          .heroActions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            width: 100%;
          }
          .premiumInsight{min-height:0;padding:15px;grid-template-columns:36px minmax(0,1fr);gap:11px}.premiumIcon{width:36px;height:36px}.premiumButton{grid-column:1/-1;width:100%}.premiumCopy p{font-size:10px}
          .btnRow {
            display: grid;
            grid-template-columns: 1fr 1fr;
            width: 100%;
          }
          .btn,
          .quickBtn {
            width: 100%;
          }
          .notice .btnPrimary {
            min-width: 0;
          }
          .summaryGrid { gap: 10px; }
          .metricCard { gap: 6px; }
          .metricCard::before {
            top: 14px;
            bottom: 14px;
            width: 3px;
          }
          .salesLine {
            font-size: 24px;
            margin-top: 2px;
          }
          .metricLine {
            margin-top: 0;
            font-size: 12px;
            display: grid;
            gap: 2px;
            line-height: 1.35;
          }
          .metricLine span + span::before {
            content: "";
            margin-right: 0;
          }
          .metricSub { font-size: 11px; }
          .desktopMetricOnly { display: none; }
          .quickRow {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .rangeRow {
            grid-template-columns: 1fr;
          }
          .totals {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .tableWrap { display: none; }
          .mobileRows { display: grid; }
          .dayCard {
            align-items: flex-start;
          }
          .modalBackdrop {
            align-items: end;
            place-items: end stretch;
            padding: 0;
          }
          .modalPanel {
            width: 100%;
            max-height: 88vh;
            border-radius: 24px 24px 0 0;
            padding: 14px;
          }
          .advancedGrid,
          .compareGrid {
            grid-template-columns: 1fr;
          }
          .barRow {
            grid-template-columns: 82px minmax(0, 1fr) 44px;
          }
          .peakBox {
            display: grid;
            gap: 4px;
          }
          .peakBox strong {
            text-align: left;
          }
          .topItem,
          .dayCard {
            padding: 9px 10px;
          }
          .rank {
            min-width: 26px;
            height: 26px;
          }
        }
        @media (max-width: 420px) {
          .heroDesc { display: none; }
          .metricCard .cardTitle { font-size: 15px; }
          .salesLine { font-size: 22px; }
          .metricLine { font-size: 11px; }
        }
      `}</style>

      <AdminPageHeader title="매출 통계" description="주문 흐름, 인기 메뉴와 기간별 매출을 한 화면에서 확인하세요." storeId={storeId} storeName={displayStoreName} eyebrow="SALES DASHBOARD" actions={<button className="btn refreshBtn" type="button" onClick={fetchFromDb} disabled={loading}>{loading ? "새로고침 중" : "새로고침"}</button>} />
      <div className="metaRow" aria-label="통계 조회 조건">
        <span className="pill">취소 주문 제외</span>
        <span className="pill">{isPaidSubscriber ? "유료 구독 중" : "일부 제한"}</span>
        <span className="pill">{modeLabel}</span>
      </div>
      {errMsg ? <div className="err">오류: {errMsg}</div> : null}

      {!isPaidSubscriber ? (
        <section className="card notice">
          <p className="noticeText">주간 상세, 기간 조회, CSV 다운로드, 고급 통계는 구독 후 확인할 수 있습니다.</p>
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
              <div className="cardPeriod desktopMetricOnly">{month}</div>
            </div>
            {isPaidSubscriber ? <span className="miniBadge desktopMetricOnly">포장 {takeoutRate(monthly)}%</span> : <span className="lockBadge desktopMetricOnly">상세 유료</span>}
          </div>
          <div className="salesLine">{formatWonCompact(monthly.sales)}</div>
          {isPaidSubscriber ? (
            <>
              <div className="metricLine"><span>주문 {monthly.orders}건</span><span>판매 {monthly.qty}개</span></div>
              <div className="metricSub desktopMetricOnly">객단가 {formatWon(avgOrder(monthly))} · 매장 {monthly.dineIn} / 포장 {monthly.takeout}</div>
            </>
          ) : (
            <div className="metricSub desktopMetricOnly">상세 지표는 구독 후 확인</div>
          )}
        </div>
      </section>

      <section className="premiumInsight" aria-label="프리미엄 통계">
        <span className="premiumIcon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7Z"/><path d="M4 14v6h10"/><path d="m5 17 3-3 2 2 4-5"/></svg></span>
        <span className="premiumCopy"><span className="premiumTop"><strong>{isPaidSubscriber ? "고급 통계" : "프리미엄 분석"}</strong><span className="premiumBadge">{isPaidSubscriber ? "이용 중" : "PREMIUM"}</span></span><p>시간대별 매출과 메뉴 흐름을 더 깊게 분석해 매장 운영에 활용하세요.</p></span>
        <button className="premiumButton" type="button" onClick={() => setAdvancedOpen(true)}>{isPaidSubscriber ? "고급 통계 열기" : "프리미엄 통계 미리보기"}</button>
      </section>

      <section className="twoCol">
        <div className="card">
          <div className="sectionHead">
            <h2 className="cardTitle">판매수량 TOP 5</h2>
            {!isPaidSubscriber ? <span className="lockBadge">일부 공개</span> : null}
          </div>
          {top5.length === 0 ? (
            <div className="emptyBox"><strong>아직 판매된 메뉴가 없습니다.</strong><p>주문이 들어오면 인기 메뉴가 자동으로 집계됩니다.</p></div>
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
            <button className="btn btnPrimary" type="button" onClick={downloadRangeCsv} disabled={loading}>엑셀용 CSV 다운로드</button>
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
          <div className="emptyBox"><strong>기간을 선택해 주세요.</strong><p>조회할 시작일과 종료일을 선택하면 일자별 요약을 확인할 수 있습니다.</p></div>
        ) : effectiveStart > effectiveEnd ? (
          <div className="emptyBox emptyError"><strong>기간을 다시 확인해 주세요.</strong><p>시작일은 종료일보다 늦을 수 없습니다.</p></div>
        ) : rangeSummaryRows.length === 0 ? (
          <div className="emptyBox"><strong>선택한 기간에 주문이 없습니다.</strong><p>다른 기간을 선택하거나 새로고침 후 다시 확인해 주세요.</p></div>
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
