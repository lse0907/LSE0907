// src/app/admin/stats/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done" | "canceled";

type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string; // YYYY-MM-DD
  displayNo: string; // 4자리
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  items: Array<{ id: string; name: string; price: number; qty: number }>;
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;

  // ✅ (있으면) 매장 구분용
  storeId?: string;
  store_id?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function clampYmd(s: string) {
  if (!s) return "";
  return s.slice(0, 10);
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

type Summary = {
  sales: number;
  orders: number;
  qty: number;
  dineIn: number;
  takeout: number;
};

function summarize(orders: OrderRecord[]): Summary {
  let sales = 0;
  let ordersCount = 0;
  let qty = 0;
  let dineIn = 0;
  let takeout = 0;

  for (const o of orders) {
    sales += Number(o.totalPrice || 0);
    ordersCount += 1;
    qty += Number(o.totalCount || 0);
    if (o.mode === "dine-in") dineIn += 1;
    else takeout += 1;
  }

  return { sales, orders: ordersCount, qty, dineIn, takeout };
}

function isCanceled(o: OrderRecord) {
  return o.status === "canceled";
}

function inRange(orderDate: string, startYmd: string, endYmd: string) {
  if (!orderDate) return false;
  return orderDate >= startYmd && orderDate <= endYmd;
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
  const s = v ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeStatus(v: any): OrderStatus {
  const s = String(v || "").trim();
  if (s === "making" || s === "ready" || s === "done" || s === "canceled") return s;
  return "new";
}

function normalizeMode(v: any): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}

function toInt(v: any, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function formatWonCompact(n: number) {
  const v = Number(n || 0);
  if (v < 10000) return `₩${v.toLocaleString()}`;
  if (v < 1000000) return `₩${(v / 10000).toFixed(1)}만`;
  if (v < 100000000) return `₩${Math.floor(v / 10000).toLocaleString()}만`;
  return `₩${(v / 100000000).toFixed(1)}억`;
}

// ✅ DB → OrderRecord 변환(아이템은 이후 결합)
function dbOrderToRecord(row: any, storeId: string): OrderRecord {
  const createdAtMs = row?.created_at ? Date.parse(row.created_at) : Date.now();
  const createdAt = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();

  const orderDate =
    typeof row?.order_date === "string" && row.order_date.length >= 10
      ? row.order_date.slice(0, 10)
      : ymd(new Date(createdAt));

  const displayNo =
    typeof row?.display_no === "string"
      ? row.display_no
      : String(row?.display_no ?? "0000").padStart(4, "0");

  return {
    id: String(row?.id || ""),
    createdAt,
    orderDate,
    displayNo,
    mode: normalizeMode(row?.mode),
    table: row?.table_no ? String(row.table_no) : undefined,
    buzzerNo: row?.buzzer_no ? String(row.buzzer_no) : undefined,
    requestNote: String(row?.request_note || ""),
    items: [],
    totalCount: Math.max(0, toInt(row?.total_count, 0)),
    totalPrice: Math.max(0, Math.round(Number(row?.total_price ?? 0) || 0)),
    status: normalizeStatus(row?.status),
    storeId,
    store_id: storeId,
  };
}

function AdminStatsPageContent() {
  const router = useRouter();
  const sp = useSearchParams();

  const [storeId, setStoreId] = useState<string>("");
  const [dataMode, setDataMode] = useState<"db" | "empty">("empty");

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");

  const [rangeExpanded, setRangeExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");

  // ✅ store 결정 + 기본 기간(이번달 1일~오늘)
  useEffect(() => {
    const q = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = q || saved;

    if (!sid) {
      router.replace("/admin");
      return;
    }
    setStoreId(sid);

    const t = new Date();
    const start = new Date(t.getFullYear(), t.getMonth(), 1);
    setRangeStart(ymd(start));
    setRangeEnd(ymd(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = new Date();
  const todayKey = ymd(today);
  const weekStart = ymd(startOfWeekMon(today));
  const weekEnd = ymd(endOfWeekMon(today));
  const month = monthKey(today);

  // ✅ 통계에 필요한 “최소 로딩 범위”를 계산해서 DB에서 한 번에 가져옴
  const computedFetchRange = useMemo(() => {
    const rs = clampYmd(rangeStart);
    const re = clampYmd(rangeEnd);

    // 유효하지 않으면 일단 오늘 기준
    const safeStart = rs || ymd(new Date(today.getFullYear(), today.getMonth(), 1));
    const safeEnd = re || todayKey;

    // daily/weekly/monthly가 최소한 포함되도록 확장
    const monthStart = `${month}-01`;

    const start = [safeStart, weekStart, monthStart].sort()[0];
    const end = [safeEnd, weekEnd, todayKey].sort().slice(-1)[0];

    return { start, end };
  }, [rangeStart, rangeEnd, weekStart, weekEnd, month, todayKey, today]);

  const fetchFromDb = async () => {
    if (!storeId) return;

    const { start, end } = computedFetchRange;
    if (start > end) return;

    setLoading(true);
    setErrMsg("");

    try {
      // ✅ orders: store_id + 기간 + canceled 제외
      const { data: oData, error: oErr } = await supabase
        .from("orders")
        .select(
          "id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,total_price,status,store_id"
        )
        .eq("store_id", storeId)
        .gte("order_date", start)
        .lte("order_date", end)
        .neq("status", "canceled")
        .order("created_at", { ascending: true });

      if (oErr) throw new Error(`[orders] ${oErr.message}`);

      const orderRows = Array.isArray(oData) ? oData : [];
      if (orderRows.length === 0) {
        setOrders([]);
        setDataMode("empty");
        setLoading(false);
        return;
      }

      const base = orderRows.map((r: any) => dbOrderToRecord(r, storeId)).filter((x) => x.id);

      const orderIds = base.map((o) => o.id);
      // ✅ order_items: store_id + order_id in (...)
      const { data: iData, error: iErr } = await supabase
        .from("order_items")
        .select("id,order_id,menu_id,name,price,qty,store_id")
        .eq("store_id", storeId)
        .in("order_id", orderIds);

      if (iErr) throw new Error(`[order_items] ${iErr.message}`);

      const items = Array.isArray(iData) ? iData : [];

      const itemsByOrder = new Map<string, Array<{ id: string; name: string; price: number; qty: number }>>();
      for (const it of items) {
        const oid = String((it as any)?.order_id || "");
        if (!oid) continue;
        const arr = itemsByOrder.get(oid) || [];
        arr.push({
          id: String((it as any)?.menu_id || (it as any)?.id || ""),
          name: String((it as any)?.name || ""),
          price: Math.max(0, Math.round(Number((it as any)?.price ?? 0) || 0)),
          qty: Math.max(0, Math.round(Number((it as any)?.qty ?? 0) || 0)),
        });
        itemsByOrder.set(oid, arr);
      }

      const merged = base.map((o) => {
        const its = itemsByOrder.get(o.id) || [];
        // DB totals이 신뢰 가능하면 그대로 쓰고, 혹시 누락이면 items로 보정
        const computedCount = its.reduce((s, x) => s + (x.qty || 0), 0);
        const computedPrice = its.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0);
        return {
          ...o,
          items: its,
          totalCount: o.totalCount || computedCount,
          totalPrice: o.totalPrice || computedPrice,
        };
      });

      setOrders(merged);
      setDataMode("db");
      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setErrMsg(String(e?.message || e));
      setOrders([]);
      setDataMode("empty");
      setLoading(false);
    }
  };

  // 최초 로드 + storeId/기간 변경 시 자동 갱신
  useEffect(() => {
    if (!storeId) return;
    fetchFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, computedFetchRange.start, computedFetchRange.end]);

  const refresh = () => fetchFromDb();

  const nonCanceled = useMemo(() => orders.filter((o) => !isCanceled(o)), [orders]);

  const dailyOrders = useMemo(
    () => nonCanceled.filter((o) => o.orderDate === todayKey),
    [nonCanceled, todayKey]
  );
  const weeklyOrders = useMemo(
    () => nonCanceled.filter((o) => inRange(o.orderDate, weekStart, weekEnd)),
    [nonCanceled, weekStart, weekEnd]
  );
  const monthlyOrders = useMemo(
    () => nonCanceled.filter((o) => (o.orderDate || "").startsWith(month)),
    [nonCanceled, month]
  );

  const daily = useMemo(() => summarize(dailyOrders), [dailyOrders]);
  const weekly = useMemo(() => summarize(weeklyOrders), [weeklyOrders]);
  const monthly = useMemo(() => summarize(monthlyOrders), [monthlyOrders]);

  const top5 = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; sales: number }>();

    for (const o of monthlyOrders) {
      for (const it of o.items || []) {
        const key = it.id || it.name; // menu_id 우선
        const prev = map.get(key);
        const lineSales = (it.price || 0) * (it.qty || 0);
        if (!prev) map.set(key, { name: it.name, qty: it.qty, sales: lineSales });
        else {
          prev.qty += it.qty;
          prev.sales += lineSales;
        }
      }
    }

    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
      .slice(0, 5);
  }, [monthlyOrders]);

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
      const prev =
        bucket.get(o.orderDate) || { sales: 0, orders: 0, qty: 0, dineIn: 0, takeout: 0 };
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
      const v = bucket.get(key) || { sales: 0, orders: 0, qty: 0, dineIn: 0, takeout: 0 };
      rows.push({ date: key, ...v });
      cur = addDays(cur, 1);
    }
    return rows;
  }, [nonCanceled, effectiveStart, effectiveEnd]);

  const rangeTotals = useMemo(() => {
    const t = { sales: 0, orders: 0, qty: 0, dineIn: 0, takeout: 0 };
    for (const r of rangeSummaryRows) {
      t.sales += r.sales;
      t.orders += r.orders;
      t.qty += r.qty;
      t.dineIn += r.dineIn;
      t.takeout += r.takeout;
    }
    return t;
  }, [rangeSummaryRows]);

  const downloadRangeCsv = () => {
    if (!effectiveStart || !effectiveEnd) {
      alert("기간을 먼저 선택해 주세요.");
      return;
    }
    if (effectiveStart > effectiveEnd) {
      alert("시작일이 종료일보다 늦습니다.");
      return;
    }

    const rows: string[] = [];
    rows.push(
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
      ].join(",")
    );

    const list = nonCanceled
      .filter((o) => inRange(o.orderDate, effectiveStart, effectiveEnd))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const o of list) {
      // items가 비어있으면 “주문 1줄”이라도 남기고 싶으면 여기서 처리 가능
      if (!o.items?.length) {
        const cols = [
          o.orderDate,
          formatTime(o.createdAt),
          o.displayNo,
          o.mode === "dine-in" ? "매장" : "포장",
          o.table ?? "",
          o.status,
          o.buzzerNo ?? "",
          o.requestNote ?? "",
          "",
          "",
          "",
          "",
          String(o.totalPrice),
          o.id,
          String(o.storeId || o.store_id || storeId),
        ].map((x) => csvEscape(String(x)));
        rows.push(cols.join(","));
        continue;
      }

      for (const it of o.items) {
        const cols = [
          o.orderDate,
          formatTime(o.createdAt),
          o.displayNo,
          o.mode === "dine-in" ? "매장" : "포장",
          o.table ?? "",
          o.status,
          o.buzzerNo ?? "",
          o.requestNote ?? "",
          it.name,
          String(it.qty),
          String(it.price),
          String(it.price * it.qty),
          String(o.totalPrice),
          o.id,
          String(o.storeId || o.store_id || storeId),
        ].map((x) => csvEscape(String(x)));

        rows.push(cols.join(","));
      }
    }

    const filename = `qr-cafe-sales-detail_${storeId}_${effectiveStart}_to_${effectiveEnd}.csv`;
    downloadTextFile(filename, rows.join("\n"), "text/csv;charset=utf-8");
  };

  const previewCount = 3;
  const hasMoreRange = rangeSummaryRows.length > previewCount;
  const rangePreviewRows = useMemo(() => {
    if (rangeExpanded) return rangeSummaryRows;
    return rangeSummaryRows.slice(Math.max(0, rangeSummaryRows.length - previewCount));
  }, [rangeSummaryRows, rangeExpanded]);

  const modeLabel = dataMode === "db" ? (loading ? "DB 로딩중..." : "DB 집계") : "데이터 없음";

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
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
        }
        .topbar {
          display: grid;
          gap: 10px;
          margin-bottom: 10px;
        }
        .titleRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .h1 {
          font-size: 28px;
          font-weight: 950;
          margin: 0;
          letter-spacing: -0.02em;
        }
        .pill {
          font-size: 12px;
          font-weight: 900;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #fff;
          color: #6b7280;
          white-space: nowrap;
        }
        .desc {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.4;
          max-width: 560px;
          word-break: keep-all;
        }
        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-start;
          align-items: center;
        }
        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 900;
        }
        .btnPrimary {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 12px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .summaryCol {
          display: grid;
          gap: 10px;
          margin-top: 6px;
        }
        .cardHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
          line-height: 1.15;
        }
        .cardPeriod {
          margin-top: 6px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.15;
        }
        .subRight {
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          text-align: right;
          white-space: nowrap;
        }
        .salesLine {
          margin-top: 10px;
          font-size: 28px;
          font-weight: 950;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
        }
        .statsRow {
          margin-top: 10px;
          display: flex;
          gap: 8px 10px;
          flex-wrap: wrap;
          align-items: baseline;
        }
        .pill2 {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 8px 10px;
          display: flex;
          gap: 6px;
          align-items: baseline;
          min-width: 0;
        }
        .pillLabel {
          font-size: 12px;
          font-weight: 900;
          color: var(--muted);
          white-space: nowrap;
        }
        .pillValue {
          font-size: 14px;
          font-weight: 950;
          white-space: nowrap;
        }
        .twoCol {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 1.1fr 0.9fr;
          gap: 10px;
        }
        .topList {
          margin-top: 8px;
          display: grid;
          gap: 6px;
        }
        .topItem {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 8px 10px;
          background: #fff;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .topName {
          font-weight: 950;
          line-height: 1.2;
        }
        .topSub {
          margin-top: 2px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.15;
        }
        .topMeta {
          color: var(--muted);
          font-size: 13px;
          font-weight: 900;
          text-align: right;
          white-space: nowrap;
        }
        .rangeRow {
          margin-top: 8px;
          display: flex;
          gap: 10px;
          align-items: end;
          flex-wrap: wrap;
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
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 800;
        }
        .rangeTotalHead {
          font-weight: 950;
          display: grid;
          gap: 2px;
        }
        .rangeTotalPeriod {
          color: var(--muted);
          font-weight: 850;
          font-size: 12px;
          line-height: 1.2;
        }
        .tableWrap {
          margin-top: 10px;
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
          padding: 12px;
          border-bottom: 1px solid var(--line);
          text-align: left;
          font-size: 14px;
        }
        th {
          font-size: 13px;
          color: var(--muted);
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
          margin-top: 6px;
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
        }
        @media (max-width: 980px) {
          .twoCol {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .wrap {
            padding: 12px;
          }
          .h1 {
            font-size: 24px;
          }
          .salesLine {
            font-size: 26px;
          }
          th,
          td {
            padding: 10px;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <h1 className="h1">통계</h1>
          <span className="pill">
            store: {storeId || "—"} · {modeLabel}
          </span>
        </div>
        <p className="desc">* 취소 주문(canceled)은 통계/CSV/리스트에서 제외됩니다.</p>

        <div className="btnRow">
          <a className="btn" href="/admin">
            관리자 홈
          </a>
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "로딩중..." : "새로고침"}
          </button>
          {errMsg ? <div className="err">오류: {errMsg}</div> : null}
        </div>
      </header>

      <section className="summaryCol">
        <div className="card">
          <div className="cardHead">
            <div>
              <h2 className="cardTitle">일간매출</h2>
              <div className="cardPeriod">{todayKey}</div>
            </div>
            <div className="subRight">
              매장 {daily.dineIn} · 포장 {daily.takeout}
            </div>
          </div>

          <div className="salesLine">{formatWonCompact(daily.sales)}</div>

          <div className="statsRow">
            <div className="pill2">
              <div className="pillLabel">주문수</div>
              <div className="pillValue">{daily.orders}건</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">판매수량</div>
              <div className="pillValue">{daily.qty}개</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">매장/포장</div>
              <div className="pillValue">
                {daily.dineIn} / {daily.takeout}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <div>
              <h2 className="cardTitle">주간매출</h2>
              <div className="cardPeriod">
                {weekStart} ~ {weekEnd}
              </div>
            </div>
            <div className="subRight">
              매장 {weekly.dineIn} · 포장 {weekly.takeout}
            </div>
          </div>

          <div className="salesLine">{formatWonCompact(weekly.sales)}</div>

          <div className="statsRow">
            <div className="pill2">
              <div className="pillLabel">주문수</div>
              <div className="pillValue">{weekly.orders}건</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">판매수량</div>
              <div className="pillValue">{weekly.qty}개</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">매장/포장</div>
              <div className="pillValue">
                {weekly.dineIn} / {weekly.takeout}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <div>
              <h2 className="cardTitle">월간매출</h2>
              <div className="cardPeriod">{month}</div>
            </div>
            <div className="subRight">
              매장 {monthly.dineIn} · 포장 {monthly.takeout}
            </div>
          </div>

          <div className="salesLine">{formatWonCompact(monthly.sales)}</div>

          <div className="statsRow">
            <div className="pill2">
              <div className="pillLabel">주문수</div>
              <div className="pillValue">{monthly.orders}건</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">판매수량</div>
              <div className="pillValue">{monthly.qty}개</div>
            </div>
            <div className="pill2">
              <div className="pillLabel">매장/포장</div>
              <div className="pillValue">
                {monthly.dineIn} / {monthly.takeout}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="twoCol">
        <div className="card">
          <h2 className="cardTitle">인기 메뉴 TOP 5 (당월 기준)</h2>
          <p className="desc" style={{ marginTop: 6, maxWidth: "none" }}>
            수량 기준 TOP5 (동률이면 매출 기준)
          </p>

          {top5.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>
              당월 판매 데이터가 없습니다.
            </p>
          ) : (
            <div className="topList">
              {top5.map((m, idx) => (
                <div key={m.id} className="topItem">
                  <div>
                    <div className="topName">
                      {idx + 1}. {m.name}
                    </div>
                    <div className="topSub">판매수량 {m.qty}개</div>
                  </div>
                  <div className="topMeta">{formatWon(m.sales)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="cardTitle">기간 조회</h2>
          <p className="desc" style={{ marginTop: 6, maxWidth: "none" }}>
            기간을 선택하면 아래 요약 리스트/합계가 해당 기간 기준으로 갱신됩니다.
          </p>

          <div className="rangeRow">
            <div className="field">
              <div className="label">시작일</div>
              <input
                className="input"
                type="date"
                value={rangeStart}
                onChange={(e) => {
                  setRangeStart(e.target.value);
                  setRangeExpanded(false);
                }}
              />
            </div>

            <div className="field">
              <div className="label">종료일</div>
              <input
                className="input"
                type="date"
                value={rangeEnd}
                onChange={(e) => {
                  setRangeEnd(e.target.value);
                  setRangeExpanded(false);
                }}
              />
            </div>

            <button className="btn btnPrimary" onClick={downloadRangeCsv} disabled={loading}>
              상세 CSV 다운로드
            </button>
          </div>

          <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div className="rangeTotalHead">
              <div>선택 기간 합계</div>
              <div className="rangeTotalPeriod">
                {effectiveStart || "—"} ~ {effectiveEnd || "—"}
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="pill2" style={{ borderRadius: 14, padding: 10 }}>
                <div className="pillLabel">매출</div>
                <div className="pillValue">{formatWon(rangeTotals.sales)}</div>
              </div>
              <div className="pill2" style={{ borderRadius: 14, padding: 10 }}>
                <div className="pillLabel">주문수</div>
                <div className="pillValue">{rangeTotals.orders}건</div>
              </div>
              <div className="pill2" style={{ borderRadius: 14, padding: 10 }}>
                <div className="pillLabel">판매수량</div>
                <div className="pillValue">{rangeTotals.qty}개</div>
              </div>
              <div className="pill2" style={{ borderRadius: 14, padding: 10 }}>
                <div className="pillLabel">매장/포장</div>
                <div className="pillValue">
                  {rangeTotals.dineIn} / {rangeTotals.takeout}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 className="cardTitle">일자별 요약 리스트 (선택 기간)</h2>
            <p className="desc" style={{ marginTop: 6, maxWidth: "none" }}>
              표는 요약만 보여주고, 상세는 CSV에서 확인합니다.
            </p>
          </div>

          {effectiveStart && effectiveEnd && effectiveStart <= effectiveEnd && hasMoreRange ? (
            <button className="btn" onClick={() => setRangeExpanded((v) => !v)} style={{ height: 42 }}>
              {rangeExpanded ? "접기" : "더보기(전체)"}
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
        ) : (
          <>
            {!rangeExpanded && hasMoreRange ? (
              <p className="muted" style={{ marginTop: 10, fontSize: 12, fontWeight: 800 }}>
                * 기본은 최근 {previewCount}일만 표시됩니다. “더보기(전체)”를 누르면 전체가 나옵니다.
              </p>
            ) : null}

            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>매출</th>
                    <th>주문수</th>
                    <th>판매수량</th>
                    <th>매장</th>
                    <th>포장</th>
                  </tr>
                </thead>
                <tbody>
                  {rangePreviewRows.map((r) => (
                    <tr key={r.date}>
                      <td style={{ fontWeight: 900 }}>{r.date}</td>
                      <td>{formatWon(r.sales)}</td>
                      <td>{r.orders}건</td>
                      <td>{r.qty}개</td>
                      <td>{r.dineIn}</td>
                      <td>{r.takeout}</td>
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
          </>
        )}
      </section>
    </main>
  );
}


export default function AdminStatsPage() {
  return (
    <Suspense
      fallback={
        <main style={{ maxWidth: 980, margin: "0 auto", padding: 14 }}>
          <p style={{ margin: 0, fontWeight: 900, color: "#6b7280" }}>통계 페이지 로딩 중...</p>
        </main>
      }
    >
      <AdminStatsPageContent />
    </Suspense>
  );
}

