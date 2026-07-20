// src/app/admin/stats/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";

type OrderMode = "dine-in" | "takeout";
type OrderStatus =
  | "new"
  | "checked"
  | "making"
  | "ready_for_packing"
  | "completed"
  | "cancelled";
type PresetRange = "today" | "7days" | "month" | "lastMonth";
type RawOrderRow = Record<string, unknown>;
type RawItemRow = Record<string, unknown>;

type OrderItemRecord = {
  id: string;
  name: string;
  price: number;
  qty: number;
};

type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  items: OrderItemRecord[];
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
  storeId?: string;
  store_id?: string;
};

type Summary = {
  sales: number;
  orders: number;
  qty: number;
  dineIn: number;
  takeout: number;
};

type BillingState = {
  status: string;
  paidUntil: string | null;
};

type MenuRank = {
  id: string;
  name: string;
  qty: number;
  sales: number;
};

type TimeBucket = {
  key: string;
  label: string;
  orders: number;
  sales: number;
};

const emptySummary: Summary = {
  sales: 0,
  orders: 0,
  qty: 0,
  dineIn: 0,
  takeout: 0,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function clampYmd(s: string) {
  return s ? s.slice(0, 10) : "";
}

function formatWon(n: number) {
  return `${Number(n || 0).toLocaleString()}원`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function startOfWeekMon(d: Date) {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -diff);
}

function endOfWeekMon(d: Date) {
  return addDays(startOfWeekMon(d), 6);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function getString(row: Record<string, unknown> | null | undefined, key: string) {
  const v = row?.[key];
  return v == null ? "" : String(v);
}

function getNumber(row: Record<string, unknown> | null | undefined, key: string) {
  return Number(row?.[key] ?? 0);
}

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

function avgOrder(summary: Summary) {
  return summary.orders > 0 ? Math.round(summary.sales / summary.orders) : 0;
}

function takeoutRate(summary: Summary) {
  return summary.orders > 0 ? Math.round((summary.takeout / summary.orders) * 100) : 0;
}

function inRange(orderDate: string, startYmd: string, endYmd: string) {
  return Boolean(orderDate) && orderDate >= startYmd && orderDate <= endYmd;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function normalizeStatus(v: unknown): OrderStatus {
  const s = String(v || "").trim();
  if (
    s === "checked" ||
    s === "making" ||
    s === "ready_for_packing" ||
    s === "completed" ||
    s === "cancelled"
  ) {
    return s;
  }
  if (s === "ready") return "ready_for_packing";
  if (s === "done") return "completed";
  if (s === "canceled") return "cancelled";
  return "new";
}

function normalizeMode(v: unknown): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}

function toInt(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function formatWonCompact(n: number) {
  const v = Number(n || 0);
  if (v < 10000) return `₩${v.toLocaleString()}`;
  if (v < 1000000) return `₩${(v / 10000).toFixed(1)}만`;
  if (v < 100000000) return `₩${Math.floor(v / 10000).toLocaleString()}만`;
  return `₩${(v / 100000000).toFixed(1)}억`;
}

function isPaidBilling(billing: BillingState) {
  const paidMs = billing.paidUntil ? new Date(billing.paidUntil).getTime() : NaN;
  return billing.status === "active" || (Number.isFinite(paidMs) && paidMs > Date.now());
}

function toErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function percentDelta(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function deltaText(current: number, previous: number) {
  const diff = current - previous;
  const pct = percentDelta(current, previous);
  const sign = diff > 0 ? "+" : "";
  return `${sign}${formatWon(diff)} · ${sign}${pct}%`;
}

function deltaTone(current: number, previous: number) {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function dbOrderToRecord(row: RawOrderRow, storeId: string): OrderRecord {
  const createdAtValue = getString(row, "created_at");
  const createdAtMs = createdAtValue ? Date.parse(createdAtValue) : Date.now();
  const createdAt = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  const rawOrderDate = getString(row, "order_date");
  const orderDate = rawOrderDate.length >= 10 ? rawOrderDate.slice(0, 10) : ymd(new Date(createdAt));
  const rawDisplayNo = getString(row, "display_no");

  return {
    id: getString(row, "id"),
    createdAt,
    orderDate,
    displayNo: rawDisplayNo || "0000",
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

function buildMenuRanks(orders: OrderRecord[], sortBy: "qty" | "sales"): MenuRank[] {
  const map = new Map<string, Omit<MenuRank, "id">>();

  for (const order of orders) {
    for (const item of order.items || []) {
      const key = item.id || item.name;
      const prev = map.get(key);
      const lineSales = (item.price || 0) * (item.qty || 0);

      if (!prev) {
        map.set(key, { name: item.name, qty: item.qty, sales: lineSales });
      } else {
        prev.qty += item.qty;
        prev.sales += lineSales;
      }
    }
  }

  return [...map.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) =>
      sortBy === "qty" ? b.qty - a.qty || b.sales - a.sales : b.sales - a.sales || b.qty - a.qty,
    )
    .slice(0, 5);
}

function buildTimeBuckets(orders: OrderRecord[]): TimeBucket[] {
  const buckets: TimeBucket[] = [
    { key: "morning", label: "오전", orders: 0, sales: 0 },
    { key: "lunch", label: "점심", orders: 0, sales: 0 },
    { key: "afternoon", label: "오후", orders: 0, sales: 0 },
    { key: "evening", label: "저녁", orders: 0, sales: 0 },
    { key: "night", label: "심야", orders: 0, sales: 0 },
  ];
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const order of orders) {
    const hour = new Date(order.createdAt).getHours();
    let key = "night";
    if (hour >= 6 && hour <= 10) key = "morning";
    else if (hour >= 11 && hour <= 13) key = "lunch";
    else if (hour >= 14 && hour <= 16) key = "afternoon";
    else if (hour >= 17 && hour <= 20) key = "evening";

    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    bucket.sales += order.totalPrice;
  }

  return buckets;
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
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    const sid = (sp.get("store") || "").trim() || (getCurrentStoreId() || "").trim();
    if (!sid) {
      router.replace("/admin");
      return;
    }

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
  const weekStart = ymd(weekStartDate);
  const weekEnd = ymd(endOfWeekMon(today));
  const lastWeekStart = ymd(addDays(weekStartDate, -7));
  const lastWeekEnd = ymd(addDays(weekStartDate, -1));
  const month = monthKey(today);
  const isPaidSubscriber = isPaidBilling(billing);

  const computedFetchRange = useMemo(() => {
    const safeStart = clampYmd(rangeStart) || ymd(startOfMonth(today));
    const safeEnd = clampYmd(rangeEnd) || todayKey;
    const monthStart = `${month}-01`;
    const start = [safeStart, weekStart, monthStart, yesterdayKey, lastWeekStart].sort()[0];
    const end = [safeEnd, weekEnd, todayKey, lastWeekEnd].sort().slice(-1)[0];

    return { start, end };
  }, [rangeStart, rangeEnd, weekStart, weekEnd, month, todayKey, yesterdayKey, lastWeekStart, lastWeekEnd, today]);

  const fetchStoreMeta = async (sid: string) => {
    const [storeRes, billingRes] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", sid).maybeSingle(),
      supabase
        .from("store_billing")
        .select("base_plan_status,paid_until")
        .eq("store_id", sid)
        .maybeSingle(),
    ]);

    if (!storeRes.error) {
      setStoreName(String(storeRes.data?.store_name || "").trim());
    }

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
        .select(
          "id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,total_price,status,store_id",
        )
        .eq("store_id", storeId)
        .gte("order_date", start)
        .lte("order_date", end)
        .neq("status", "cancelled")
        .order("created_at", { ascending: true });

      if (oErr) throw new Error(`[orders] ${oErr.message}`);

      const orderRows = Array.isArray(oData) ? (oData as RawOrderRow[]) : [];
      if (orderRows.length === 0) {
        setOrders([]);
        setDataMode("empty");
        return;
      }

      const base = orderRows.map((row) => dbOrderToRecord(row, storeId)).filter((order) => order.id);
      const { data: iData, error: iErr } = await supabase
        .from("order_items")
        .select("id,order_id,menu_id,name,price,qty,store_id")
        .eq("store_id", storeId)
        .in(
          "order_id",
          base.map((order) => order.id),
        );

      if (iErr) throw new Error(`[order_items] ${iErr.message}`);

      const itemsByOrder = new Map<string, OrderItemRecord[]>();
      for (const item of Array.isArray(iData) ? (iData as RawItemRow[]) : []) {
        const orderId = getString(item, "order_id");
        if (!orderId) continue;

        const arr = itemsByOrder.get(orderId) || [];
        arr.push({
          id: getString(item, "menu_id") || getString(item, "id"),
          name: getString(item, "name"),
          price: Math.max(0, Math.round(getNumber(item, "price") || 0)),
          qty: Math.max(0, Math.round(getNumber(item, "qty") || 0)),
        });
        itemsByOrder.set(orderId, arr);
      }

      const merged = base.map((order) => {
        const items = itemsByOrder.get(order.id) || [];
        const computedCount = items.reduce((sum, item) => sum + (item.qty || 0), 0);
        const computedPrice = items.reduce(
          (sum, item) => sum + (item.qty || 0) * (item.price || 0),
          0,
        );

        return {
          ...order,
          items,
          totalCount: order.totalCount || computedCount,
          totalPrice: order.totalPrice || computedPrice,
        };
      });

      setOrders(merged);
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

  const nonCanceled = useMemo(() => orders.filter((order) => order.status !== "cancelled"), [orders]);
  const dailyOrders = useMemo(
    () => nonCanceled.filter((order) => order.orderDate === todayKey),
    [nonCanceled, todayKey],
  );
  const yesterdayOrders = useMemo(
    () => nonCanceled.filter((order) => order.orderDate === yesterdayKey),
    [nonCanceled, yesterdayKey],
  );
  const weeklyOrders = useMemo(
    () => nonCanceled.filter((order) => inRange(order.orderDate, weekStart, weekEnd)),
    [nonCanceled, weekStart, weekEnd],
  );
  const lastWeekOrders = useMemo(
    () => nonCanceled.filter((order) => inRange(order.orderDate, lastWeekStart, lastWeekEnd)),
    [nonCanceled, lastWeekStart, lastWeekEnd],
  );
  const monthlyOrders = useMemo(
    () => nonCanceled.filter((order) => (order.orderDate || "").startsWith(month)),
    [nonCanceled, month],
  );

  const daily = useMemo(() => summarize(dailyOrders), [dailyOrders]);
  const yesterday = useMemo(() => summarize(yesterdayOrders), [yesterdayOrders]);
  const weekly = useMemo(() => summarize(weeklyOrders), [weeklyOrders]);
  const lastWeek = useMemo(() => summarize(lastWeekOrders), [lastWeekOrders]);
  const monthly = useMemo(() => summarize(monthlyOrders), [monthlyOrders]);
  const top5 = useMemo(() => buildMenuRanks(monthlyOrders, "qty"), [monthlyOrders]);
  const top5BySales = useMemo(() => buildMenuRanks(monthlyOrders, "sales"), [monthlyOrders]);
  const timeBuckets = useMemo(() => buildTimeBuckets(dailyOrders), [dailyOrders]);

  const effectiveStart = clampYmd(rangeStart);
  const effectiveEnd = clampYmd(rangeEnd);
  const rangeSummaryRows = useMemo(() => {
    if (!effectiveStart || !effectiveEnd) return [];

    const start = parseYmd(effectiveStart);
    const end = parseYmd(effectiveEnd);
    if (start > end) return [];

    const bucket = new Map<string, Summary>();
    for (const order of nonCanceled) {
      if (!inRange(order.orderDate, effectiveStart, effectiveEnd)) continue;

      const prev = bucket.get(order.orderDate) || { ...emptySummary };
      prev.sales += order.totalPrice;
      prev.orders += 1;
      prev.qty += order.totalCount;
      if (order.mode === "dine-in") prev.dineIn += 1;
      else prev.takeout += 1;
      bucket.set(order.orderDate, prev);
    }

    const rows: Array<{ date: string } & Summary> = [];
    let cur = new Date(start);
    while (cur <= end) {
      const key = ymd(cur);
      rows.push({ date: key, ...(bucket.get(key) || { ...emptySummary }) });
      cur = addDays(cur, 1);
    }

    return rows;
  }, [nonCanceled, effectiveStart, effectiveEnd]);

  const rangeTotals = useMemo(
    () =>
      rangeSummaryRows.reduce<Summary>(
        (total, row) => ({
          sales: total.sales + row.sales,
          orders: total.orders + row.orders,
          qty: total.qty + row.qty,
          dineIn: total.dineIn + row.dineIn,
          takeout: total.takeout + row.takeout,
        }),
        { ...emptySummary },
      ),
    [rangeSummaryRows],
  );

  const setPreset = (preset: PresetRange) => {
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
  };

  const goBilling = () => {
    router.push(`/admin/billing/pay?store=${encodeURIComponent(storeId)}`);
  };

  const downloadRangeCsv = () => {
    if (!isPaidSubscriber) {
      goBilling();
      return;
    }
    if (!effectiveStart || !effectiveEnd) {
      alert("기간을 선택해 주세요.");
      return;
    }
    if (effectiveStart > effectiveEnd) {
      alert("시작일이 종료일보다 늦습니다.");
      return;
    }

    const rows = [
      [
        "orderDate",
        "time",
        "displayNo",
        "mode",
        "table",
        "status",
        "buzzerNo",
        "requestNote",
        "itemName",
        "qty",
        "unitPrice",
        "lineTotal",
        "orderTotal",
        "internalId",
        "storeId",
      ].join(","),
    ];
    const list = nonCanceled
      .filter((order) => inRange(order.orderDate, effectiveStart, effectiveEnd))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const order of list) {
      const orderItems = order.items?.length ? order.items : [{ id: "", name: "", price: 0, qty: 0 }];
      for (const item of orderItems) {
        rows.push(
          [
            order.orderDate,
            formatTime(order.createdAt),
            order.displayNo,
            order.mode === "dine-in" ? "매장" : "포장",
            order.table ?? "",
            order.status,
            order.buzzerNo ?? "",
            order.requestNote ?? "",
            item.name,
            item.qty ? String(item.qty) : "",
            item.price ? String(item.price) : "",
            item.price && item.qty ? String(item.price * item.qty) : "",
            String(order.totalPrice),
            order.id,
            String(order.storeId || order.store_id || storeId),
          ]
            .map((value) => csvEscape(String(value)))
            .join(","),
        );
      }
    }

    downloadTextFile(
      `qr-cafe-sales-detail_${storeId}_${effectiveStart}_to_${effectiveEnd}.csv`,
      rows.join("\n"),
      "text/csv;charset=utf-8",
    );
  };

  const previewCount = 3;
  const hasMoreRange = rangeSummaryRows.length > previewCount;
  const visibleRangeRows = useMemo(() => {
    if (isPaidSubscriber && rangeExpanded) return rangeSummaryRows;
    return rangeSummaryRows.slice(Math.max(0, rangeSummaryRows.length - previewCount));
  }, [rangeSummaryRows, rangeExpanded, isPaidSubscriber]);

  const displayStoreName = storeName || storeId || "—";
  const modeLabel = loading ? "새로고침 중" : dataMode === "db" ? "최신 집계" : "데이터 없음";
  const maxBucketOrders = Math.max(1, ...timeBuckets.map((bucket) => bucket.orders));

  const renderMetricCard = (title: string, period: string, summary: Summary, locked = false) => (
    <div className={`card metricCard ${locked ? "locked" : ""}`}>
      <div className="cardHead">
        <div>
          <h2 className="cardTitle">{title}</h2>
          <div className="cardPeriod">{period}</div>
        </div>
        {locked ? (
          <span className="lockBadge">유료 전용</span>
        ) : (
          <span className="miniBadge">포장 {takeoutRate(summary)}%</span>
        )}
      </div>

      {locked ? (
        <div className="lockBox">
          <strong>구독 후 확인</strong>
          <button className="linkBtn" type="button" onClick={goBilling}>
            구독 관리
          </button>
        </div>
      ) : (
        <>
          <div className="salesLine">{formatWonCompact(summary.sales)}</div>
          <div className="metricLine">
            주문 {summary.orders}건 · 수량 {summary.qty}개
          </div>
          <div className="metricSub">
            객단가 {formatWon(avgOrder(summary))} · 매장 {summary.dineIn} / 포장 {summary.takeout}
          </div>
        </>
      )}
    </div>
  );

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
          --ok: #047857;
          --danger: #b91c1c;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .topbar {
          display: grid;
          gap: 8px;
        }
        .titleRow,
        .sectionHead,
        .notice,
        .modalHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .titleRow,
        .sectionHead {
          flex-wrap: wrap;
        }
        .h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .metaRow,
        .btnRow,
        .quickRow {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .pill,
        .miniBadge,
        .lockBadge {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 6px 9px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }
        .lockBadge {
          background: #fff7ed;
          border-color: #fed7aa;
          color: #9a3412;
        }
        .btn,
        .quickBtn,
        .linkBtn,
        .iconBtn {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 900;
        }
        .btn {
          padding: 10px 13px;
        }
        .quickBtn {
          padding: 8px 10px;
          font-size: 13px;
        }
        .btnPrimary {
          background: var(--brand);
          border-color: var(--brand);
          color: #fff;
        }
        .linkBtn {
          padding: 7px 9px;
          font-size: 12px;
        }
        .iconBtn {
          width: 34px;
          height: 34px;
        }
        .btn:disabled,
        .quickBtn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 12px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .notice {
          align-items: center;
          background: #fffbeb;
          border-color: #fde68a;
        }
        .noticeText {
          margin: 0;
          color: #92400e;
          font-size: 13px;
          font-weight: 850;
          line-height: 1.35;
        }
        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .cardHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .cardTitle,
        .modalTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
          line-height: 1.15;
        }
        .cardPeriod {
          margin-top: 5px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.15;
        }
        .salesLine {
          margin-top: 9px;
          font-size: 27px;
          font-weight: 950;
          letter-spacing: -0.02em;
          line-height: 1.05;
          white-space: nowrap;
        }
        .metricLine {
          margin-top: 8px;
          font-size: 13px;
          font-weight: 950;
        }
        .metricSub,
        .topSub,
        .daySub,
        .modalSub,
        .compareSub {
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.25;
        }
        .metricSub,
        .topSub,
        .daySub {
          margin-top: 3px;
        }
        .locked {
          background: linear-gradient(180deg, #fff, #fafafa);
        }
        .lockBox {
          margin-top: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          color: var(--muted);
        }
        .twoCol {
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 10px;
        }
        .topList,
        .mobileRows,
        .advancedGrid,
        .barList {
          margin-top: 8px;
          display: grid;
          gap: 6px;
        }
        .topItem,
        .dayCard,
        .compareCard,
        .salesRankItem {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 8px 10px;
          background: #fff;
        }
        .topItem,
        .dayCard,
        .salesRankItem {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .rank {
          min-width: 26px;
          height: 26px;
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
          gap: 8px;
          align-items: center;
          min-width: 0;
        }
        .topName {
          font-weight: 950;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .topMeta,
        .daySales {
          color: var(--muted);
          font-size: 13px;
          font-weight: 900;
          text-align: right;
          white-space: nowrap;
        }
        .rangeRow {
          margin-top: 8px;
          display: grid;
          grid-template-columns: 1fr 1fr auto;
          gap: 8px;
          align-items: end;
        }
        .field {
          display: grid;
          gap: 5px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          width: 100%;
          padding: 10px 11px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 850;
        }
        .totals {
          margin-top: 10px;
          border-top: 1px solid var(--line);
          padding-top: 10px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .totalBox {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 9px;
          background: #fff;
        }
        .totalLabel {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .totalValue {
          margin-top: 3px;
          font-size: 14px;
          font-weight: 950;
        }
        .tableWrap {
          margin-top: 8px;
          overflow: auto;
          border-radius: 14px;
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
          padding: 11px;
          border-bottom: 1px solid var(--line);
          text-align: left;
          font-size: 14px;
        }
        th {
          color: var(--muted);
          font-size: 13px;
          font-weight: 950;
          background: #fafafa;
        }
        .tfoot {
          background: #f9fafb;
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
        }
        .err {
          color: var(--danger);
          font-weight: 900;
          font-size: 13px;
        }
        .mobileRows {
          display: none;
        }
        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          background: rgba(17, 24, 39, 0.42);
          padding: 18px;
          display: grid;
          place-items: center;
        }
        .modalPanel {
          width: min(760px, 100%);
          max-height: min(720px, calc(100vh - 36px));
          overflow: auto;
          background: #fff;
          border-radius: 22px;
          border: 1px solid var(--line);
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26);
          padding: 14px;
        }
        .advancedGrid {
          grid-template-columns: 1fr 1fr;
        }
        .compareGrid {
          margin-top: 8px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .compareLabel {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .compareValue {
          margin-top: 3px;
          font-size: 18px;
          font-weight: 950;
        }
        .delta {
          margin-top: 8px;
          font-size: 13px;
          font-weight: 950;
        }
        .delta.up {
          color: var(--ok);
        }
        .delta.down {
          color: var(--danger);
        }
        .delta.flat {
          color: var(--muted);
        }
        .barRow {
          display: grid;
          grid-template-columns: 42px 1fr auto;
          gap: 8px;
          align-items: center;
          font-size: 13px;
          font-weight: 900;
        }
        .barTrack {
          height: 8px;
          border-radius: 999px;
          background: #f3f4f6;
          overflow: hidden;
        }
        .barFill {
          height: 100%;
          border-radius: 999px;
          background: #111827;
        }
        .upgradeBox {
          margin-top: 12px;
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 12px;
          background: #fffbeb;
        }
        @media (max-width: 900px) {
          .summaryGrid,
          .twoCol,
          .advancedGrid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .wrap {
            padding: 10px;
            gap: 8px;
          }
          .h1 {
            font-size: 23px;
          }
          .card {
            padding: 10px;
          }
          .summaryGrid {
            gap: 8px;
          }
          .salesLine {
            font-size: 24px;
          }
          .btn {
            padding: 9px 11px;
          }
          .notice {
            align-items: flex-start;
          }
          .rangeRow {
            grid-template-columns: 1fr 1fr;
          }
          .rangeRow .btnPrimary {
            grid-column: 1 / -1;
          }
          .totals,
          .compareGrid {
            grid-template-columns: 1fr 1fr;
            gap: 6px;
          }
          .tableWrap {
            display: none;
          }
          .mobileRows {
            display: grid;
          }
          .modalBackdrop {
            align-items: end;
            padding: 10px;
          }
          .modalPanel {
            width: 100%;
            max-height: 86vh;
            border-radius: 20px 20px 14px 14px;
          }
        }
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
            <a className="btn" href="/admin">
              관리자 홈
            </a>
            <button className="btn" type="button" onClick={fetchFromDb} disabled={loading}>
              {loading ? "새로고침 중" : "새로고침"}
            </button>
            <button className="btn btnPrimary" type="button" onClick={() => setAdvancedOpen(true)}>
              고급 통계
            </button>
          </div>
        </div>
        {errMsg ? <div className="err">오류: {errMsg}</div> : null}
      </header>

      {!isPaidSubscriber ? (
        <section className="card notice">
          <p className="noticeText">일부 통계는 구독 후 확인할 수 있습니다.</p>
          <button className="btn btnPrimary" type="button" onClick={goBilling}>
            구독 관리
          </button>
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
            {isPaidSubscriber ? (
              <span className="miniBadge">포장 {takeoutRate(monthly)}%</span>
            ) : (
              <span className="lockBadge">상세 유료</span>
            )}
          </div>
          <div className="salesLine">{formatWonCompact(monthly.sales)}</div>
          {isPaidSubscriber ? (
            <>
              <div className="metricLine">
                주문 {monthly.orders}건 · 수량 {monthly.qty}개
              </div>
              <div className="metricSub">
                객단가 {formatWon(avgOrder(monthly))} · 매장 {monthly.dineIn} / 포장 {monthly.takeout}
              </div>
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
            <p className="muted" style={{ marginTop: 10 }}>
              당월 판매 데이터가 없습니다.
            </p>
          ) : (
            <div className="topList">
              {(isPaidSubscriber ? top5 : top5.slice(0, 1)).map((menu, idx) => (
                <div key={menu.id} className="topItem">
                  <div className="topMain">
                    <span className="rank">{idx + 1}</span>
                    <div>
                      <div className="topName">{menu.name}</div>
                      <div className="topSub">판매 {menu.qty}개</div>
                    </div>
                  </div>
                  <div className="topMeta">{isPaidSubscriber ? formatWon(menu.sales) : "구독 후"}</div>
                </div>
              ))}
              {!isPaidSubscriber ? (
                <div className="lockBox">
                  <strong>나머지는 구독 후 확인</strong>
                  <button className="linkBtn" type="button" onClick={goBilling}>
                    구독 관리
                  </button>
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
            <button className="quickBtn" type="button" onClick={() => setPreset("today")} disabled={!isPaidSubscriber}>
              오늘
            </button>
            <button className="quickBtn" type="button" onClick={() => setPreset("7days")} disabled={!isPaidSubscriber}>
              7일
            </button>
            <button className="quickBtn" type="button" onClick={() => setPreset("month")} disabled={!isPaidSubscriber}>
              이번 달
            </button>
            <button className="quickBtn" type="button" onClick={() => setPreset("lastMonth")} disabled={!isPaidSubscriber}>
              지난 달
            </button>
          </div>
          <div className="rangeRow">
            <label className="field">
              <span className="label">시작일</span>
              <input
                className="input"
                type="date"
                value={rangeStart}
                disabled={!isPaidSubscriber}
                onChange={(e) => {
                  setRangeStart(e.target.value);
                  setRangeExpanded(false);
                }}
              />
            </label>
            <label className="field">
              <span className="label">종료일</span>
              <input
                className="input"
                type="date"
                value={rangeEnd}
                disabled={!isPaidSubscriber}
                onChange={(e) => {
                  setRangeEnd(e.target.value);
                  setRangeExpanded(false);
                }}
              />
            </label>
            <button className="btn btnPrimary" type="button" onClick={downloadRangeCsv} disabled={loading}>
              상세 내역 받기
            </button>
          </div>
          {isPaidSubscriber ? (
            <div className="totals">
              <div className="totalBox">
                <div className="totalLabel">매출</div>
                <div className="totalValue">{formatWon(rangeTotals.sales)}</div>
              </div>
              <div className="totalBox">
                <div className="totalLabel">주문</div>
                <div className="totalValue">{rangeTotals.orders}건</div>
              </div>
              <div className="totalBox">
                <div className="totalLabel">수량</div>
                <div className="totalValue">{rangeTotals.qty}개</div>
              </div>
              <div className="totalBox">
                <div className="totalLabel">포장</div>
                <div className="totalValue">{takeoutRate(rangeTotals)}%</div>
              </div>
            </div>
          ) : (
            <div className="lockBox">
              <strong>기간별 상세는 구독 후 확인</strong>
              <button className="linkBtn" type="button" onClick={goBilling}>
                구독 관리
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="sectionHead">
          <h2 className="cardTitle">일자별 요약</h2>
          {isPaidSubscriber && effectiveStart && effectiveEnd && effectiveStart <= effectiveEnd && hasMoreRange ? (
            <button className="btn" type="button" onClick={() => setRangeExpanded((value) => !value)}>
              {rangeExpanded ? "접기" : "전체 보기"}
            </button>
          ) : null}
        </div>

        {!effectiveStart || !effectiveEnd ? (
          <p className="muted" style={{ marginTop: 10 }}>
            기간을 선택해 주세요.
          </p>
        ) : effectiveStart > effectiveEnd ? (
          <p className="muted" style={{ marginTop: 10 }}>
            시작일이 종료일보다 늦습니다.
          </p>
        ) : rangeSummaryRows.length === 0 ? (
          <p className="muted" style={{ marginTop: 10 }}>
            선택한 기간에 주문이 없습니다.
          </p>
        ) : (
          <>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>매출</th>
                    <th>주문</th>
                    <th>수량</th>
                    <th>매장</th>
                    <th>포장</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRangeRows.map((row) => (
                    <tr key={row.date}>
                      <td style={{ fontWeight: 900 }}>{row.date}</td>
                      <td>{formatWon(row.sales)}</td>
                      <td>{row.orders}건</td>
                      <td>{row.qty}개</td>
                      <td>{row.dineIn}</td>
                      <td>{row.takeout}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tfoot">
                    <td>합계</td>
                    <td>{formatWon(rangeTotals.sales)}</td>
                    <td>{rangeTotals.orders}건</td>
                    <td>{rangeTotals.qty}개</td>
                    <td>{rangeTotals.dineIn}</td>
                    <td>{rangeTotals.takeout}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mobileRows">
              {visibleRangeRows.map((row) => (
                <div key={row.date} className="dayCard">
                  <div>
                    <strong>{row.date}</strong>
                    <div className="daySub">
                      주문 {row.orders} · 수량 {row.qty} · 매장 {row.dineIn} / 포장 {row.takeout}
                    </div>
                  </div>
                  <div className="daySales">{formatWon(row.sales)}</div>
                </div>
              ))}
            </div>

            {!isPaidSubscriber && hasMoreRange ? (
              <div className="lockBox">
                <strong>최근 3일만 표시</strong>
                <button className="linkBtn" type="button" onClick={goBilling}>
                  구독 관리
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {advancedOpen ? (
        <div className="modalBackdrop" role="presentation" onClick={() => setAdvancedOpen(false)}>
          <section className="modalPanel" role="dialog" aria-modal="true" aria-labelledby="advanced-stats-title" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <div>
                <h2 id="advanced-stats-title" className="modalTitle">고급 통계</h2>
                <div className="modalSub">{isPaidSubscriber ? "오늘 기준" : "구독 후 확인"}</div>
              </div>
              <button className="iconBtn" type="button" onClick={() => setAdvancedOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>

            {isPaidSubscriber ? (
              <div className="advancedGrid">
                <div className="compareCard">
                  <h3 className="cardTitle">오늘 비교</h3>
                  <div className="compareGrid">
                    <div>
                      <div className="compareLabel">오늘</div>
                      <div className="compareValue">{formatWonCompact(daily.sales)}</div>
                    </div>
                    <div>
                      <div className="compareLabel">어제</div>
                      <div className="compareValue">{formatWonCompact(yesterday.sales)}</div>
                    </div>
                  </div>
                  <div className={`delta ${deltaTone(daily.sales, yesterday.sales)}`}>
                    {deltaText(daily.sales, yesterday.sales)}
                  </div>
                </div>

                <div className="compareCard">
                  <h3 className="cardTitle">주간 비교</h3>
                  <div className="compareGrid">
                    <div>
                      <div className="compareLabel">이번 주</div>
                      <div className="compareValue">{formatWonCompact(weekly.sales)}</div>
                    </div>
                    <div>
                      <div className="compareLabel">지난주</div>
                      <div className="compareValue">{formatWonCompact(lastWeek.sales)}</div>
                    </div>
                  </div>
                  <div className={`delta ${deltaTone(weekly.sales, lastWeek.sales)}`}>
                    {deltaText(weekly.sales, lastWeek.sales)}
                  </div>
                </div>

                <div className="compareCard">
                  <h3 className="cardTitle">시간대별 주문</h3>
                  <div className="barList">
                    {timeBuckets.map((bucket) => (
                      <div key={bucket.key} className="barRow">
                        <span>{bucket.label}</span>
                        <span className="barTrack">
                          <span className="barFill" style={{ width: `${Math.max(4, (bucket.orders / maxBucketOrders) * 100)}%` }} />
                        </span>
                        <span>{bucket.orders}건</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="compareCard">
                  <h3 className="cardTitle">매출 TOP 5</h3>
                  {top5BySales.length === 0 ? (
                    <p className="muted" style={{ marginTop: 10 }}>
                      당월 판매 데이터가 없습니다.
                    </p>
                  ) : (
                    <div className="topList">
                      {top5BySales.map((menu, idx) => (
                        <div key={menu.id} className="salesRankItem">
                          <div className="topMain">
                            <span className="rank">{idx + 1}</span>
                            <div>
                              <div className="topName">{menu.name}</div>
                              <div className="topSub">판매 {menu.qty}개</div>
                            </div>
                          </div>
                          <div className="topMeta">{formatWon(menu.sales)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="upgradeBox">
                <strong>구독 후 확인할 수 있습니다.</strong>
                <div className="modalSub" style={{ marginTop: 6 }}>
                  전일 비교, 시간대별 주문, 매출 TOP 5를 제공합니다.
                </div>
                <button className="btn btnPrimary" type="button" onClick={goBilling} style={{ marginTop: 12 }}>
                  구독 관리
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
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
