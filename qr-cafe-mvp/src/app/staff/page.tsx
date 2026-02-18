"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done" | "canceled";
type PaymentStatus = "not_required" | "pending" | "paid";

type SelectedOptionItem = {
  id: string;
  name: string;
  priceDelta: number;
  qty: number;
};

type SelectedGroup = {
  groupId: string;
  groupName: string;
  required: boolean;
  min: number;
  max: number;
  items: SelectedOptionItem[];
};

type OrderItem = {
  id: string;
  name: string;
  price: number; // base
  qty: number;
  options?: SelectedGroup[];
  optionTotal?: number; // 1개 기준 옵션 추가금
  lineTotal?: number; // (base+optionTotal)*qty
};

type OrderRecord = {
  id: string;
  createdAt: number; // ms
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
  paymentStatus: PaymentStatus;
};

type DbOrderRow = {
  id: string;
  created_at: string;
  order_date: string | null;
  display_no: string | null;
  mode: string | null;
  table_no: string | null;
  buzzer_no: string | null;
  request_note: string | null;
  total_count: number | null;
  total_price: number | null;
  status: string | null;
  payment_status?: string | null;
  store_id: string | null;
};

type DbOrderItemRow = {
  id: string;
  order_id: string;
  menu_id: string | null;
  name: string | null;
  price: number | null;
  qty: number | null;
  store_id: string | null;
};

type DbOrderItemOptionRow = {
  id: string;
  order_item_id: string | null;

  option_id?: string | null;
  option_name?: string | null;
  price_delta?: number | null;
  qty?: number | null;

  group_id?: string | null;
  group_name?: string | null;

  option_item_id?: string | null;
  name?: string | null;
  option_group_id?: string | null;
  option_group_name?: string | null;

  store_id?: string | null;
};

const LAST_SPOKEN_KEY = "qrCafeStaffLastSpokenOrderId";

/**
 * ✅ 선택 매장 결정 우선순위
 * 1) URL ?store=
 * 2) localStorage(currentStoreId)
 * 3) env NEXT_PUBLIC_STORE_ID
 * 4) fallback "ximen"
 */
function resolveStoreIdFromClient(storeFromQuery?: string | null) {
  const q = String(storeFromQuery || "").trim();
  if (q) return q;

  const saved = String(getCurrentStoreId() || "").trim();
  if (saved) return saved;

  const env = String(process.env.NEXT_PUBLIC_STORE_ID || "").trim();
  if (env) return env;

  return "ximen";
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "신규",
  making: "제조중",
  ready: "준비완료",
  done: "완료",
  canceled: "취소",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  not_required: "후불(결제 불필요)",
  pending: "결제대기",
  paid: "결제완료",
};

function isActive(status: OrderStatus) {
  return status === "new" || status === "making" || status === "ready";
}
function isCompleted(status: OrderStatus) {
  return status === "done" || status === "canceled";
}

function normalizeMode(v: any): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}
function normalizeStatus(v: any): OrderStatus {
  const s = String(v || "").trim();
  if (s === "making" || s === "ready" || s === "done" || s === "canceled") return s;
  return "new";
}

function normalizePaymentStatus(v: any): PaymentStatus {
  const s = String(v || "").trim();
  if (s === "pending" || s === "paid") return s;
  return "not_required";
}

function speakKoreanOnce(text: string) {
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 1.0;
    u.pitch = 1.0;

    try {
      synth.cancel();
    } catch {}

    synth.speak(u);
  } catch {
    // ignore
  }
}

function nextStatus(s: OrderStatus): OrderStatus {
  if (s === "new") return "making";
  if (s === "making") return "ready";
  if (s === "ready") return "done";
  return s;
}

function statusButtonLabel(s: OrderStatus) {
  if (s === "new") return "제조 시작";
  if (s === "making") return "준비 완료";
  if (s === "ready") return "완료 처리";
  if (s === "done") return "완료됨";
  return "취소됨";
}

function buildOptionsByOrderItem(
  rows: DbOrderItemOptionRow[],
  orderItemId: string
): { groups: SelectedGroup[]; optionTotal: number } {
  const forItem = rows.filter((r) => String(r.order_item_id || "") === orderItemId);

  const getGid = (r: DbOrderItemOptionRow) => String(r.group_id ?? r.option_group_id ?? "default");
  const getGname = (r: DbOrderItemOptionRow) => String(r.group_name ?? r.option_group_name ?? "옵션");

  const getOptId = (r: DbOrderItemOptionRow) => String(r.option_id ?? r.option_item_id ?? r.id);
  const getOptName = (r: DbOrderItemOptionRow) => String(r.option_name ?? r.name ?? "옵션");
  const getPriceDelta = (r: DbOrderItemOptionRow) => Number(r.price_delta ?? 0);

  const map = new Map<string, SelectedGroup>();

  for (const r of forItem) {
    const gid = getGid(r);
    const gname = getGname(r);

    if (!map.has(gid)) {
      map.set(gid, {
        groupId: gid,
        groupName: gname,
        required: false,
        min: 0,
        max: 99,
        items: [],
      });
    }

    const g = map.get(gid)!;
    const oid = getOptId(r);
    const oqty = Math.max(1, Math.round(Number(r.qty ?? 1)));
    const existing = g.items.find((it) => it.id === oid);
    if (existing) {
      existing.qty += oqty;
      continue;
    }

    g.items.push({
      id: oid,
      name: getOptName(r),
      priceDelta: Math.round(getPriceDelta(r)),
      qty: oqty,
    });
  }

  const groups = Array.from(map.values());
  const optionTotal = groups.reduce(
    (sum, g) =>
      sum +
      g.items.reduce(
        (s, it) => s + Number(it.priceDelta || 0) * Math.max(1, Number(it.qty || 1)),
        0
      ),
    0
  );

  return { groups, optionTotal };
}

function isTodayLocal(ts: number) {
  const d = new Date(ts);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export default function StaffPage() {
  const searchParams = useSearchParams();

  // ✅ 현재 선택 매장
  const storeFromQuery = searchParams.get("store");
  const [storeId, setStoreId] = useState<string>("");

  // ✅ storeId 변경 감지(폴링/조회 시 사용)
  const storeIdRef = useRef<string>("");

  useEffect(() => {
    const resolved = resolveStoreIdFromClient(storeFromQuery);
    setStoreId(resolved);
    storeIdRef.current = resolved;

    // admin에서 선택한 매장을 staff에서 열었을 때도 저장(UX)
    try {
      if (resolved) setCurrentStoreId(resolved);
    } catch {}
  }, [storeFromQuery]);

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [prepayAddonActive, setPrepayAddonActive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [listTab, setListTab] = useState<"active" | "completed" | "all">("active");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // ✅ 로딩 UX 개선:
  // - 첫 로딩만 화면에 표시
  // - 폴링 갱신은 조용히(loading 표기 X)
  const [initialLoading, setInitialLoading] = useState(true);

  const [errMsg, setErrMsg] = useState("");

  // ✅ 새 주문 NEW 뱃지 표시용
  const [newOrderIds, setNewOrderIds] = useState<Record<string, number>>({}); // id -> expireAt(ms)

  // ✅ “새 주문 들어옴” 감지용
  const lastTopOrderIdRef = useRef<string>("");
  const mountedRef = useRef(false);

  const fetchOrdersFromDb = async (silent = false) => {
    const sid = storeIdRef.current || storeId;

    if (!sid) {
      if (!silent) setErrMsg("매장(store_id)이 선택되지 않았습니다. 관리자에서 매장 선택 후 다시 들어와 주세요.");
      setOrders([]);
      setInitialLoading(false);
      return;
    }

    if (!silent) setErrMsg("");

    const addonRes = await supabase
      .from("store_addons")
      .select("prepay_addon_status")
      .eq("store_id", sid)
      .maybeSingle();
    setPrepayAddonActive(String(addonRes.data?.prepay_addon_status || "inactive") === "active");

    let oRes = await supabase
      .from("orders")
      .select(
        "id, created_at, order_date, display_no, mode, table_no, buzzer_no, request_note, total_count, total_price, status, payment_status, store_id"
      )
      .eq("store_id", sid)
      .order("created_at", { ascending: false })
      .limit(200);

    if (oRes.error) {
      const msg = String(oRes.error.message || "").toLowerCase();
      const missingPaymentColumn = msg.includes("payment_status") && (msg.includes("column") || msg.includes("schema cache"));
      if (missingPaymentColumn) {
        oRes = await supabase
          .from("orders")
          .select(
            "id, created_at, order_date, display_no, mode, table_no, buzzer_no, request_note, total_count, total_price, status, store_id"
          )
          .eq("store_id", sid)
          .order("created_at", { ascending: false })
          .limit(200);
      }
    }

    const { data: oData, error: oErr } = oRes;

    if (oErr) {
      console.error("[staff] fetch orders error:", oErr.message);
      if (!silent) setErrMsg(oErr.message);
      setOrders([]);
      setInitialLoading(false);
      return;
    }

    const ordersRows = (Array.isArray(oData) ? oData : []) as DbOrderRow[];
    const orderIds = ordersRows.map((x) => x.id);

    if (!orderIds.length) {
      setOrders([]);
      setInitialLoading(false);
      return;
    }

    const { data: oiData, error: oiErr } = await supabase
      .from("order_items")
      .select("id, order_id, menu_id, name, price, qty, store_id")
      .in("order_id", orderIds);

    if (oiErr) {
      console.error("[staff] fetch order_items error:", oiErr.message);
      if (!silent) setErrMsg(oiErr.message);
      setOrders([]);
      setInitialLoading(false);
      return;
    }

    const itemRows = (Array.isArray(oiData) ? oiData : []) as DbOrderItemRow[];
    const orderItemIds = itemRows.map((x) => x.id);

    let optRows: DbOrderItemOptionRow[] = [];
    if (orderItemIds.length) {
      const { data: optData, error: optErr } = await supabase
        .from("order_item_options")
        .select("*")
        .in("order_item_id", orderItemIds);

      if (optErr) {
        console.error("[staff] fetch order_item_options error:", optErr.message);
        // 옵션 실패해도 주문/아이템은 보여주자
        optRows = [];
      } else {
        optRows = (Array.isArray(optData) ? optData : []) as DbOrderItemOptionRow[];
      }
    }

    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const it of itemRows) {
      const orderId = String(it.order_id);
      const itemId = String(it.id);

      const { groups, optionTotal } = buildOptionsByOrderItem(optRows, itemId);

      const base = Math.round(Number(it.price ?? 0));
      const qty = Math.max(0, Number(it.qty ?? 0));
      const unit = base + optionTotal;
      const lineTotal = unit * qty;

      const built: OrderItem = {
        id: String(it.menu_id ?? itemId),
        name: String(it.name ?? ""),
        price: base,
        qty,
        options: groups.length ? groups : [],
        optionTotal,
        lineTotal,
      };

      if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
      itemsByOrder.get(orderId)!.push(built);
    }

    const assembled: OrderRecord[] = ordersRows.map((o) => {
      const createdAtMs = o.created_at ? new Date(o.created_at).getTime() : Date.now();
      const items = itemsByOrder.get(o.id) || [];

      const totalCount =
        Number.isFinite(Number(o.total_count)) && o.total_count !== null
          ? Number(o.total_count)
          : items.reduce((s, x) => s + (x.qty || 0), 0);

      const totalPrice =
        Number.isFinite(Number(o.total_price)) && o.total_price !== null
          ? Number(o.total_price)
          : items.reduce((s, x) => s + Number(x.lineTotal || 0), 0);

      return {
        id: String(o.id),
        createdAt: createdAtMs || Date.now(),
        orderDate: String(o.order_date ?? ""),
        displayNo: String(o.display_no ?? ""),
        mode: normalizeMode(o.mode),
        table: o.table_no ? String(o.table_no) : undefined,
        buzzerNo: o.buzzer_no ? String(o.buzzer_no) : undefined,
        requestNote: String(o.request_note ?? ""),
        items,
        totalCount,
        totalPrice,
        status: normalizeStatus(o.status),
        paymentStatus: normalizePaymentStatus(o.payment_status),
      };
    });

    setOrders(assembled);
    setInitialLoading(false);
  };

  // ✅ 최초 로드 + 폴링(조용히 갱신)
  useEffect(() => {
    if (!storeId) return;

    // 매장 바뀌면: 선택 주문/NEW 뱃지/감지값 리셋
    setSelectedId(null);
    setMobileView("list");
    setNewOrderIds({});
    lastTopOrderIdRef.current = "";
    setInitialLoading(true);

    fetchOrdersFromDb(false);

    mountedRef.current = true;

    const t = window.setInterval(() => {
      fetchOrdersFromDb(true); // silent
      // NEW 뱃지 만료 정리
      setNewOrderIds((prev) => {
        const now = Date.now();
        const next: Record<string, number> = {};
        for (const [id, exp] of Object.entries(prev)) {
          if (exp > now) next[id] = exp;
        }
        return next;
      });
    }, 1200);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  // ✅ 새 주문 감지: 음성 + NEW 뱃지(10초)
  useEffect(() => {
    if (!mountedRef.current) return;
    const top = [...orders].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!top) return;

    const prevTopId = lastTopOrderIdRef.current;

    // 최초 세팅(첫 로드에서는 NEW/음성 안 함)
    if (!prevTopId) {
      lastTopOrderIdRef.current = top.id;
      return;
    }

    if (top.id && top.id !== prevTopId) {
      lastTopOrderIdRef.current = top.id;

      // NEW 뱃지 10초
      const expireAt = Date.now() + 10_000;
      setNewOrderIds((prev) => ({ ...prev, [top.id]: expireAt }));

      // 음성 안내(중복 방지)
      const lastSpoken = localStorage.getItem(LAST_SPOKEN_KEY) || "";
      if (lastSpoken !== top.id) {
        localStorage.setItem(LAST_SPOKEN_KEY, top.id);
        speakKoreanOnce("주문이 접수 되었습니다.");
      }
    }
  }, [orders]);

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) || null, [orders, selectedId]);

  // ✅ 탭 필터 규칙
  // - 진행중: 날짜 상관없이 모두
  // - 완료/취소: 오늘 주문만
  // - 전체: 오늘 주문만
  const filteredOrders = useMemo(() => {
    const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

    if (listTab === "active") return sorted.filter((o) => isActive(o.status));

    if (listTab === "completed") {
      return sorted.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt));
    }

    // all
    return sorted.filter((o) => isTodayLocal(o.createdAt));
  }, [orders, listTab]);

  // ✅ 카운트도 규칙에 맞춰 표시
  const counts = useMemo(() => {
    const active = orders.filter((o) => isActive(o.status)).length;
    const completed = orders.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt)).length;
    const all = orders.filter((o) => isTodayLocal(o.createdAt)).length;
    return { active, completed, all };
  }, [orders]);

  const onSelect = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  };

  const updateOrderInDb = async (id: string, patch: Partial<OrderRecord>) => {
    const sid = storeIdRef.current || storeId;

    const payload: any = {};
    if (typeof patch.buzzerNo !== "undefined") payload.buzzer_no = patch.buzzerNo || null;
    if (typeof patch.status !== "undefined") payload.status = patch.status;
    if (typeof patch.paymentStatus !== "undefined") payload.payment_status = patch.paymentStatus;

    if (!Object.keys(payload).length) return;

    const { error } = await supabase.from("orders").update(payload).eq("id", id).eq("store_id", sid);

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const missingPaymentColumn =
        typeof patch.paymentStatus !== "undefined" &&
        msg.includes("payment_status") &&
        (msg.includes("column") || msg.includes("schema cache"));

      if (missingPaymentColumn) {
        delete payload.payment_status;
        const fallback = await supabase.from("orders").update(payload).eq("id", id).eq("store_id", sid);
        if (!fallback.error) {
          setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
          return;
        }
      }
    }

    if (error) {
      console.error("[staff] update order error:", error.message);
      alert(`저장 실패: ${error.message}`);
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const badgeClassByStatus = (s: OrderStatus) =>
    s === "new"
      ? "badgeNew"
      : s === "making"
      ? "badgeMaking"
      : s === "ready"
      ? "badgeReady"
      : s === "canceled"
      ? "badgeCanceled"
      : "badgeDone";

  const isNewBadge = (orderId: string) => {
    const exp = newOrderIds[orderId];
    return !!exp && exp > Date.now();
  };

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
          --danger: #dc2626;
          --radius: 16px;
        }

        body {
          background: var(--bg);
          color: var(--text);
        }

        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 16px;
        }

        .topbar {
          display: grid;
          gap: 12px;
        }

        .titleBlock {
          display: grid;
          gap: 8px;
        }

        .h1 {
          font-size: 28px;
          font-weight: 900;
          margin: 0;
          letter-spacing: -0.02em;
        }

        .desc {
          margin: 0;
          color: var(--muted);
          line-height: 1.45;
          font-size: 14px;
          max-width: 520px;
          word-break: keep-all;
        }

        .btnRow {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-start;
        }

        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 800;
        }

        .btnPrimary {
          background: var(--brand);
          color: white;
          border-color: var(--brand);
        }

        .tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .chip {
          border: 1px solid var(--line);
          background: #fff;
          padding: 10px 12px;
          border-radius: 999px;
          font-weight: 800;
          cursor: pointer;
        }
        .chipOn {
          border-color: var(--brand);
          box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08);
        }

        /* ✅ 탭 아래 안내 문구 */
        .tabHint {
          margin: 8px 0 0 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.4;
          font-weight: 800;
          word-break: keep-all;
        }

        .panel {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          min-height: 520px;
        }

        .cardTitle {
          margin: 0 0 10px 0;
          font-size: 18px;
          font-weight: 900;
        }

        .list {
          display: grid;
          gap: 10px;
        }

        .itemBtn {
          text-align: left;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #fff;
          cursor: pointer;
        }
        .itemBtnOn {
          border: 2px solid var(--brand);
        }

        .rowBetween {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }

        .bigNo {
          font-size: 18px;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .muted {
          color: var(--muted);
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #fff;
        }

        .badgeNew {
          border-color: #dbeafe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .badgeMaking {
          border-color: #fef3c7;
          background: #fffbeb;
          color: #92400e;
        }
        .badgeReady {
          border-color: #dcfce7;
          background: #f0fdf4;
          color: #166534;
        }
        .badgeDone {
          border-color: #e5e7eb;
          background: #f9fafb;
          color: #374151;
        }
        .badgeCanceled {
          border-color: #fee2e2;
          background: #fef2f2;
          color: #991b1b;
        }

        /* ✅ NEW 뱃지 */
        .badgeHot {
          border-color: #fecaca;
          background: #fff1f2;
          color: #be123c;
        }

        .detailBox {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
        }

        .detailNo {
          font-size: 24px;
          font-weight: 950;
          margin: 0;
        }

        .section {
          margin-top: 14px;
        }

        .input {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          width: 160px;
          font-weight: 700;
        }

        .menuRow {
          display: grid;
          gap: 10px;
          margin-top: 10px;
        }

        .menuItem {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 8px;
        }

        .menuTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }

        /* ✅ 금액(원) 줄바꿈 방지 */
        .price {
          font-weight: 900;
          white-space: nowrap;
          line-height: 1.1;
          text-align: right;
          flex-shrink: 0;
        }

        .optWrap {
          border-top: 1px solid var(--line);
          padding-top: 8px;
          display: grid;
          gap: 6px;
        }

        .optLine {
          font-size: 12px;
          font-weight: 850;
          color: #111827;
          line-height: 1.35;
          word-break: keep-all;
        }

        .optMuted {
          color: var(--muted);
          font-weight: 800;
          font-size: 12px;
        }

        .sum {
          border-top: 1px solid var(--line);
          margin-top: 10px;
          padding-top: 10px;
          display: grid;
          gap: 6px;
        }

        .actionRow {
          margin-top: 14px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .actionBtn {
          flex: 1;
          min-width: 140px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 900;
          cursor: pointer;
        }

        .actionPrimary {
          background: var(--brand);
          border-color: var(--brand);
          color: #fff;
        }

        .actionCancel {
          background: #fff;
          border-color: #fecaca;
          color: var(--danger);
        }

        .hint {
          margin-top: 10px;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.4;
          word-break: keep-all;
        }

        .err {
          margin-top: 8px;
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
          word-break: break-all;
        }

        @media (max-width: 900px) {
          .panel {
            grid-template-columns: 1fr;
          }
          .card {
            min-height: auto;
          }
        }

        @media (max-width: 640px) {
          .wrap {
            padding: 14px;
          }

          .h1 {
            font-size: 24px;
          }

          .desc {
            font-size: 13px;
            max-width: 100%;
          }

          .btnRow {
            width: 100%;
            justify-content: flex-start;
          }

          .btn {
            padding: 10px 12px;
          }

          .mobileHide {
            display: none !important;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleBlock">
          <h1 className="h1">직원 화면</h1>
          <p className="desc">주문 리스트 확인 → 벨번호 입력(선택) → 상태 변경 / 취소</p>

          {/* ✅ 현재 매장 표시 */}
          <p className="muted" style={{ margin: 0, fontWeight: 900 }}>
            현재 매장: <b>{storeId || "미선택"}</b>
          </p>

          {/* ✅ 최초 로드에서만 표시 */}
          {initialLoading ? <p className="muted" style={{ margin: 0 }}>불러오는 중...</p> : null}

          {errMsg ? <p className="err">오류: {errMsg}</p> : null}
        </div>

        <div className="btnRow">
          <button
            className="btn btnPrimary"
            onClick={() =>
              (window.location.href = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")
            }
          >
            관리자 메뉴
          </button>

          <button
            className="btn"
            onClick={() => {
              speakKoreanOnce("직원 화면이 준비되었습니다.");
              fetchOrdersFromDb(false);
            }}
            disabled={!storeId}
            style={{ opacity: !storeId ? 0.5 : 1 }}
          >
            새로고침
          </button>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`chip ${listTab === "active" ? "chipOn" : ""}`}
          onClick={() => {
            setListTab("active");
            setMobileView("list");
          }}
        >
          진행중 ({counts.active})
        </button>
        <button
          className={`chip ${listTab === "completed" ? "chipOn" : ""}`}
          onClick={() => {
            setListTab("completed");
            setMobileView("list");
          }}
        >
          완료/취소 ({counts.completed})
        </button>
        <button
          className={`chip ${listTab === "all" ? "chipOn" : ""}`}
          onClick={() => {
            setListTab("all");
            setMobileView("list");
          }}
        >
          전체 ({counts.all})
        </button>
      </div>

      {/* ✅ A문구 확정 */}
      <p className="tabHint">완료/취소 및 전체 목록은 오늘 접수된 주문만 표시됩니다.</p>

      <div className="tabs" style={{ marginTop: 8 }}>
        <button
          className="btn"
          onClick={() => setMobileView("list")}
          style={{ display: mobileView === "detail" ? "inline-flex" : "none" }}
        >
          ← 목록으로
        </button>
      </div>

      <div className="panel">
        <section className={`card ${mobileView === "detail" ? "mobileHide" : ""}`}>
          <h2 className="cardTitle">주문 목록 ({filteredOrders.length})</h2>

          {!storeId ? (
            <p className="muted">매장이 선택되지 않았습니다. 관리자에서 매장을 선택하고 다시 들어와 주세요.</p>
          ) : filteredOrders.length === 0 ? (
            <p className="muted">해당 조건의 주문이 없습니다.</p>
          ) : (
            <div className="list">
              {filteredOrders.map((o) => {
                const isSelected = o.id === selectedId;
                const badgeClass = badgeClassByStatus(o.status);
                const showNew = isNewBadge(o.id);

                return (
                  <button
                    key={o.id}
                    onClick={() => onSelect(o.id)}
                    className={`itemBtn ${isSelected ? "itemBtnOn" : ""}`}
                  >
                    <div className="rowBetween">
                      <div className="bigNo">
                        {o.displayNo}
                        {o.buzzerNo ? ` · 벨 ${o.buzzerNo}` : ""}
                        {showNew ? <span className="badge badgeHot">NEW</span> : null}
                      </div>
                      <div className="muted">{formatTime(o.createdAt)}</div>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className={`badge ${badgeClass}`}>{STATUS_LABEL[o.status]}</span>
                      <span className="badge">
                        {o.mode === "dine-in" ? `매장 · 테이블 ${o.table ?? "-"}` : "포장"}
                      </span>
                    </div>

                    <div className="muted" style={{ marginTop: 8 }}>
                      {o.items
                        .map((it) => `${it.name}×${it.qty}`)
                        .slice(0, 2)
                        .join(", ")}
                      {o.items.length > 2 ? "…" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className={`card ${mobileView === "list" ? "mobileHide" : ""}`}>
          <h2 className="cardTitle">주문 상세</h2>

          {!selected ? (
            <p className="muted">주문을 선택하세요.</p>
          ) : (
            <>
              <div className="detailBox">
                <p className="detailNo">주문번호 {selected.displayNo}</p>
                <p className="muted" style={{ margin: "8px 0 0 0" }}>
                  {selected.mode === "dine-in" ? `매장 · 테이블 ${selected.table ?? "-"}` : "포장 주문"} · 상태:{" "}
                  <b>{STATUS_LABEL[selected.status]}</b>
                </p>
                <p className="muted" style={{ margin: "6px 0 0 0" }}>
                  결제상태: <b>{PAYMENT_LABEL[selected.paymentStatus]}</b>
                </p>
                <p className="muted" style={{ margin: "6px 0 0 0" }}>
                  주문시각: {formatTime(selected.createdAt)}
                </p>
              </div>

              {prepayAddonActive && selected.paymentStatus === "pending" ? (
                <div className="detailBox" style={{ borderColor: "#f59e0b", background: "#fffbeb" }}>
                  <b style={{ color: "#92400e" }}>선결재 옵션 매장: 결제완료 전에는 제조 시작이 불가합니다.</b>
                </div>
              ) : null}

              <div className="section">
                <h3 style={{ margin: "0 0 8px 0" }}>진동벨 번호 (선택)</h3>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="input"
                    value={selected.buzzerNo ?? ""}
                    onChange={(e) => updateOrderInDb(selected.id, { buzzerNo: e.target.value.trim() })}
                    placeholder="예: 12"
                  />
                  <span className="muted" style={{ fontSize: 13 }}>
                    * 벨을 지급한 경우에만 입력
                  </span>
                </div>
              </div>

              <div className="section">
                <h3 style={{ margin: 0 }}>주문 내역</h3>
                <div className="menuRow">
                  {selected.items.map((it, idx) => {
                    const optionTotal = Number(it.optionTotal || 0);
                    const unit = Number(it.price || 0) + optionTotal;
                    const lineTotal =
                      Number.isFinite(Number(it.lineTotal)) && it.lineTotal !== undefined
                        ? Number(it.lineTotal)
                        : unit * Number(it.qty || 0);

                    const optText =
                      it.options
                        ?.map((g) => {
                          if (!g.items?.length) return null;
                          const cleanGroupName = String(g.groupName || "")
                            .replace(/^\s*옵션\s*/g, "")
                            .trim();
                          const itemText = g.items
                            .map((x) => `${x.name}×${Math.max(1, Number(x.qty || 1))}`)
                            .join(", ");
                          return cleanGroupName ? `${cleanGroupName}: ${itemText}` : itemText;
                        })
                        .filter(Boolean)
                        .join(" / ") || "";

                    return (
                      <div key={`${it.id}_${idx}`} className="menuItem">
                        <div className="menuTop">
                          <div>
                            <div style={{ fontWeight: 900 }}>{it.name}</div>
                            <div className="optMuted" style={{ marginTop: 4 }}>
                              기본 {fmt(it.price)}원
                              {optionTotal ? ` + 옵션 ${fmt(optionTotal)}원` : ""}
                              {" · "}
                              {it.qty}개
                              {" · "}
                              1개당 {fmt(unit)}원
                            </div>
                          </div>

                          <div className="price">{fmt(lineTotal)}원</div>
                        </div>

                        {optText ? (
                          <div className="optWrap">
                            <div className="optLine">옵션: {optText}</div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="sum">
                  <div>
                    총 수량: <b>{selected.totalCount}</b>
                  </div>
                  <div>
                    총 금액: <b>{fmt(selected.totalPrice)}원</b>
                  </div>
                </div>
              </div>

              <div className="section">
                <h3 style={{ margin: "0 0 8px 0" }}>요청사항</h3>
                <div className="detailBox" style={{ color: selected.requestNote ? "#111" : "#6b7280" }}>
                  {selected.requestNote || "요청사항 없음"}
                </div>
              </div>

              <div className="actionRow">
                <button
                  className="actionBtn actionPrimary"
                  onClick={() => updateOrderInDb(selected.id, { status: nextStatus(selected.status) })}
                  disabled={
                    selected.status === "done" ||
                    selected.status === "canceled" ||
                    (prepayAddonActive && selected.paymentStatus === "pending" && selected.status === "new")
                  }
                  style={{
                    opacity:
                      selected.status === "done" ||
                      selected.status === "canceled" ||
                      (prepayAddonActive && selected.paymentStatus === "pending" && selected.status === "new")
                        ? 0.5
                        : 1,
                  }}
                >
                  {statusButtonLabel(selected.status)}
                </button>

                {prepayAddonActive && selected.paymentStatus === "pending" ? (
                  <button
                    className="actionBtn"
                    style={{ borderColor: "#2563eb", color: "#2563eb" }}
                    onClick={() => updateOrderInDb(selected.id, { paymentStatus: "paid" })}
                  >
                    결제완료 처리(테스트)
                  </button>
                ) : null}

                <button
                  className="actionBtn actionCancel"
                  onClick={() => {
                    if (!confirm("이 주문을 '취소' 처리할까요? (삭제 아님, 데이터 유지)")) return;
                    updateOrderInDb(selected.id, { status: "canceled" });
                  }}
                  disabled={selected.status === "done" || selected.status === "canceled"}
                  style={{
                    opacity: selected.status === "done" || selected.status === "canceled" ? 0.5 : 1,
                  }}
                >
                  주문 취소
                </button>
              </div>

              <p className="hint">
                * “주문 취소”는 삭제가 아니라 상태 변경입니다. 데이터는 남아 통계/CSV에 활용할 수 있어요.
                <br />
                * 새 주문 음성 안내는 브라우저 정책상 “새로고침 버튼”을 한 번 누른 뒤부터 더 안정적으로 들릴 수 있어요.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
