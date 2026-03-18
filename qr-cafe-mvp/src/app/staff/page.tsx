"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type PaymentStatus = "not_required" | "pending" | "paid";
type StaffViewMode = "simple" | "station";
type ItemStatus = "waiting" | "making" | "done";

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
  menuId: string;
  name: string;
  price: number; // base
  qty: number;
  status: ItemStatus;
  batch: number;
  options?: SelectedGroup[];
  optionTotal?: number; // 1개 기준 옵션 추가금
  lineTotal?: number; // (base+optionTotal)*qty
  orderId?: string;
  displayNo?: string;
  packingChecked?: boolean;
  categoryId?: string;
  categoryName?: string;
  categoryOrder?: number;
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
  status: string | null;
  batch: number | null;
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

type DbPackingCheckRow = {
  order_item_id: string | null;
  checked: boolean | null;
};

const LAST_SPOKEN_KEY = "qrCafeStaffLastSpokenOrderId";
const STAFF_POLL_INTERVAL_MS = 5000;
const STAFF_VIEW_MODE_OVERRIDE_KEY = "qrCafeStaffViewModeOverride";

function normalizeStaffViewMode(v: any): StaffViewMode {
  return String(v || "").trim() === "station" ? "station" : "simple";
}

/**
 * ✅ 선택 매장 결정 우선순위
 * 1) URL ?store=
 * 2) localStorage(currentStoreId)
 * 3) env NEXT_PUBLIC_STORE_ID
 * 4) fallback "ximen"
 */
function getStaffViewModeOverride(storeId: string): StaffViewMode | null {
  try {
    if (typeof window === "undefined") return null;
    const key = `${STAFF_VIEW_MODE_OVERRIDE_KEY}:${storeId}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeStaffViewMode(raw);
  } catch {
    return null;
  }
}

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

function formatElapsedMin(ts: number) {
  const diffMs = Date.now() - Number(ts || 0);
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  return `${minutes}분 경과`;
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "신규",
  checked: "주문확인",
  making: "제조중",
  ready_for_packing: "준비완료",
  completed: "완료",
  cancelled: "취소",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  not_required: "후불(결제 불필요)",
  pending: "결제대기",
  paid: "결제완료",
};

function isActive(status: OrderStatus) {
  return status === "new" || status === "checked" || status === "making" || status === "ready_for_packing";
}
function isCompleted(status: OrderStatus) {
  return status === "completed" || status === "cancelled";
}

function normalizeMode(v: any): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}
function normalizeStatus(v: any): OrderStatus {
  const s = String(v || "").trim();
  if (s === "checked" || s === "making" || s === "ready_for_packing" || s === "completed" || s === "cancelled") return s;
  if (s === "ready") return "ready_for_packing";
  if (s === "done") return "completed";
  if (s === "canceled") return "cancelled";
  return "new";
}

function normalizeItemStatus(v: any): ItemStatus {
  const s = String(v || "").trim();
  if (s === "making" || s === "done") return s;
  return "waiting";
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
  if (s === "new") return "checked";
  if (s === "checked") return "making";
  if (s === "making") return "ready_for_packing";
  if (s === "ready_for_packing") return "completed";
  return s;
}

function statusButtonLabel(s: OrderStatus) {
  if (s === "new") return "주문 확인";
  if (s === "checked") return "▶ 제조 시작";
  if (s === "making") return "준비 완료";
  if (s === "ready_for_packing") return "✓ 전달 완료";
  if (s === "completed") return "완료됨";
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

function StaffPageInner() {
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
  const [stationTab, setStationTab] = useState<"order" | "make" | "ready" | "history">("order");
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [staffViewMode, setStaffViewMode] = useState<StaffViewMode>("simple");
  const [modeToast, setModeToast] = useState("");
  const modeToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    (async () => {
      const { data } = await supabase
        .from("stores")
        .select("staff_view_mode")
        .eq("store_id", sid)
        .maybeSingle();
      const baseMode = normalizeStaffViewMode(data?.staff_view_mode);
      const overrideMode = getStaffViewModeOverride(sid);
      setStaffViewMode(overrideMode || baseMode);
    })();
  }, [storeId]);

  const showModeToast = (text: string) => {
    setModeToast(text);
    if (typeof window === "undefined") return;
    if (modeToastTimerRef.current) window.clearTimeout(modeToastTimerRef.current);
    modeToastTimerRef.current = window.setTimeout(() => {
      setModeToast("");
      modeToastTimerRef.current = null;
    }, 1500);
  };

  const updateStaffViewMode = (next: StaffViewMode) => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    try {
      if (typeof window !== "undefined") {
        const key = `${STAFF_VIEW_MODE_OVERRIDE_KEY}:${sid}`;
        window.localStorage.setItem(key, next);
      }
    } catch {
      // ignore local override write failure
    }
    setStaffViewMode(next);
    setMobileView("list");
    showModeToast("현재 기기에서만 화면 모드를 임시 전환했어요.");
  };

  useEffect(() => {
    if (staffViewMode === "station") {
      setStationTab("order");
      setMobileView("list");
      return;
    }
    setListTab("active");
    setMobileView("list");
  }, [staffViewMode]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (modeToastTimerRef.current) window.clearTimeout(modeToastTimerRef.current);
    };
  }, []);

  // ✅ 로딩 UX 개선:
  // - 첫 로딩만 화면에 표시
  // - 폴링 갱신은 조용히(loading 표기 X)
  const [initialLoading, setInitialLoading] = useState(true);

  const [errMsg, setErrMsg] = useState("");

  // ✅ 새 주문 NEW 뱃지 표시용
  const [newOrderIds, setNewOrderIds] = useState<Record<string, number>>({}); // id -> expireAt(ms)
  const [newOrderPopup, setNewOrderPopup] = useState<{ id: string; displayNo: string } | null>(null);

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
            "id, created_at, order_date, display_no, mode, table_no, buzzer_no, request_note, total_count, total_price, status, payment_status, store_id"
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
      .select("id, order_id, menu_id, name, price, qty, status, batch, store_id")
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

    const menuIds = Array.from(new Set(itemRows.map((x) => String(x.menu_id || "")).filter(Boolean)));
    const menuCategoryMap = new Map<string, { categoryId: string; categoryName: string; categoryOrder: number }>();
    if (menuIds.length) {
      const { data: menuData, error: menuErr } = await supabase
        .from("menu_items")
        .select("id,category_id")
        .eq("store_id", sid)
        .in("id", menuIds);
      if (menuErr) {
        console.error("[staff] fetch menu_items(category) error:", menuErr.message);
      } else {
        const categoryIds = Array.from(new Set((Array.isArray(menuData) ? menuData : []).map((m: any) => String(m.category_id || "")).filter(Boolean)));
        const categoryMap = new Map<string, { name: string; order: number }>();
        if (categoryIds.length) {
          const { data: catData, error: catErr } = await supabase
            .from("menu_categories")
            .select("id,name,sort_order")
            .eq("store_id", sid)
            .in("id", categoryIds);
          if (catErr) {
            console.error("[staff] fetch menu_categories error:", catErr.message);
          } else {
            for (const c of Array.isArray(catData) ? catData : []) {
              categoryMap.set(String((c as any).id || ""), {
                name: String((c as any).name || "").trim() || "미분류",
                order: Number.isFinite(Number((c as any).sort_order)) ? Number((c as any).sort_order) : 9999,
              });
            }
          }
        }
        for (const m of Array.isArray(menuData) ? menuData : []) {
          const catId = String((m as any).category_id || "").trim();
          const meta = categoryMap.get(catId) || { name: "미분류", order: 9999 };
          menuCategoryMap.set(String((m as any).id || "").trim(), {
            categoryId: catId,
            categoryName: meta.name,
            categoryOrder: meta.order,
          });
        }
      }
    }

    let optRows: DbOrderItemOptionRow[] = [];
    let packingMap = new Map<string, boolean>();
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

      const { data: checkData, error: checkErr } = await supabase
        .from("order_item_packing_checks")
        .select("order_item_id, checked")
        .in("order_item_id", orderItemIds);

      if (checkErr) {
        console.error("[staff] fetch order_item_packing_checks error:", checkErr.message);
      } else {
        const rows = (Array.isArray(checkData) ? checkData : []) as DbPackingCheckRow[];
        packingMap = new Map(rows.map((r) => [String(r.order_item_id || ""), !!r.checked]));
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

      const menuId = String(it.menu_id ?? itemId);
      const categoryMeta = menuCategoryMap.get(menuId) || { categoryId: "", categoryName: "미분류", categoryOrder: 9999 };
      const built: OrderItem = {
        id: itemId,
        orderId,
        displayNo: "",
        menuId,
        name: String(it.name ?? ""),
        price: base,
        qty,
        status: normalizeItemStatus(it.status),
        batch: Number(it.batch ?? 0),
        options: groups.length ? groups : [],
        optionTotal,
        lineTotal,
        packingChecked: packingMap.get(itemId) || false,
        categoryId: categoryMeta.categoryId,
        categoryName: categoryMeta.categoryName,
        categoryOrder: categoryMeta.categoryOrder,
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

    for (const order of assembled) {
      for (const item of order.items) {
        item.displayNo = order.displayNo;
      }
    }

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
    setNewOrderPopup(null);
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
    }, STAFF_POLL_INTERVAL_MS);

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
      setNewOrderPopup({ id: top.id, displayNo: top.displayNo });

      // 음성 안내(중복 방지)
      const lastSpoken = localStorage.getItem(LAST_SPOKEN_KEY) || "";
      if (lastSpoken !== top.id) {
        localStorage.setItem(LAST_SPOKEN_KEY, top.id);
        speakKoreanOnce("주문이 접수 되었습니다.");
      }
    }
  }, [orders]);

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) || null, [orders, selectedId]);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; displayNo: string } | null>(null);

  const moveToOrderCheckTab = () => {
    if (staffViewMode === "station") setStationTab("order");
    else setListTab("active");
    setMobileView("list");
    setNewOrderPopup(null);
  };

  // ✅ 탭 필터 규칙
  // - 진행중: 날짜 상관없이 모두
  // - 완료/취소: 오늘 주문만
  // - 전체: 오늘 주문만
  const filteredOrders = useMemo(() => {
    const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);

    if (staffViewMode === "station") {
      if (stationTab === "order") return sorted.filter((o) => o.status === "new");
      if (stationTab === "make") return sorted.filter((o) => o.status === "checked" || o.status === "making");
      if (stationTab === "ready") return sorted.filter((o) => !isCompleted(o.status) && hasReadyItems(o));
      return sorted.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt));
    }

    if (listTab === "active") return sorted.filter((o) => isActive(o.status));

    if (listTab === "completed") {
      return sorted.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt));
    }

    // all
    return sorted.filter((o) => isTodayLocal(o.createdAt));
  }, [orders, listTab, staffViewMode, stationTab]);

  // ✅ 카운트도 규칙에 맞춰 표시
  const counts = useMemo(() => {
    const active = orders.filter((o) => isActive(o.status)).length;
    const completed = orders.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt)).length;
    const all = orders.filter((o) => isTodayLocal(o.createdAt)).length;
    return { active, completed, all };
  }, [orders]);

  const stationCounts = useMemo(() => {
    const order = orders.filter((o) => o.status === "new").length;
    const make = orders.filter((o) => o.status === "checked" || o.status === "making").length;
    const ready = orders.filter((o) => !isCompleted(o.status) && hasReadyItems(o)).length;
    const history = orders.filter((o) => isCompleted(o.status) && isTodayLocal(o.createdAt)).length;
    return { order, make, ready, history };
  }, [orders]);

  const listTitle = useMemo(() => {
    if (staffViewMode !== "station") return "주문 목록";
    if (stationTab === "order") return "주문확인";
    if (stationTab === "make") return "제조";
    if (stationTab === "ready") return "준비";
    return "완료/취소";
  }, [staffViewMode, stationTab]);

  const waitingItemIdsForBatch = useMemo(
    () => makeGroups.filter((g) => g.status === "waiting").flatMap((g) => g.itemIds),
    [makeGroups]
  );

  const statusButtonLabelForView = (s: OrderStatus) => {
    if (staffViewMode === "simple") {
      if (s === "checked" || s === "making") return "✓ 제조 완료";
      if (s === "ready_for_packing") return "✓ 주문 완료";
    }
    return statusButtonLabel(s);
  };

  const nextStatusForView = (s: OrderStatus): OrderStatus => {
    if (staffViewMode !== "simple") return nextStatus(s);
    if (s === "new") return "checked";
    if (s === "checked" || s === "making") return "ready_for_packing";
    if (s === "ready_for_packing") return "completed";
    return s;
  };

  const advanceOrder = async (order: OrderRecord) => {
    await updateOrderInDb(order.id, { status: nextStatusForView(order.status) });
    if (staffViewMode === "simple" && order.status === "ready_for_packing") {
      setListTab("active");
      setSelectedId(null);
      setMobileView("list");
    }
  };

  const onSelect = (id: string) => {
    setSelectedId(id);
    setMobileView("detail");
  };

  const openCancelModal = (order: OrderRecord) => {
    setCancelTarget({ id: order.id, displayNo: order.displayNo });
  };

  const closeCancelModal = () => {
    setCancelTarget(null);
  };

  const confirmCancelOrder = async () => {
    if (!cancelTarget) return;
    const id = cancelTarget.id;
    closeCancelModal();
    await updateOrderInDb(id, { status: "cancelled" });
  };

  const nextBatch = useMemo(() => {
    const maxBatch = orders
      .flatMap((o) => o.items)
      .reduce((max, it) => Math.max(max, Number(it.batch || 0)), 0);
    return maxBatch + 1;
  }, [orders]);

  const optionSignature = (it: OrderItem) => {
    const groups = [...(it.options || [])]
      .map((g) => ({
        groupId: String(g.groupId || ""),
        items: [...(g.items || [])]
          .map((x) => `${x.id}:${Math.max(1, Number(x.qty || 1))}`)
          .sort(),
      }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId));
    return JSON.stringify(groups);
  };

  const makeGroups = useMemo(() => {
    const source = orders
      .filter((o) => o.status === "checked" || o.status === "making")
      .flatMap((o) => o.items.map((it) => ({ ...it, orderId: o.id, displayNo: o.displayNo })));

    type Grouped = {
      key: string;
      menuId: string;
      name: string;
      status: ItemStatus;
      batch: number;
      optionSig: string;
      qty: number;
      itemIds: string[];
      orderNos: string[];
      optionLabel: string;
      categoryName: string;
      categoryOrder: number;
    };

    const grouped = new Map<string, Grouped>();

    for (const it of source) {
      if (!(it.status === "waiting" || it.status === "making")) continue;
      const statusKey = it.status;
      const batchKey = Number(it.batch || 0);
      const optSig = optionSignature(it);
      const key = [it.menuId, statusKey, String(batchKey), optSig].join("::");

      if (!grouped.has(key)) {
        const optionLabel =
          it.options
            ?.map((g) => {
              if (!g.items?.length) return null;
              const cleaned = String(g.groupName || "").replace(/^\s*옵션\s*/g, "").trim();
              const names = g.items.map((x) => `${x.name}×${Math.max(1, Number(x.qty || 1))}`).join(", ");
              return cleaned ? `${cleaned}: ${names}` : names;
            })
            .filter(Boolean)
            .join(" / ") || "";

        grouped.set(key, {
          key,
          menuId: it.menuId,
          name: it.name,
          status: it.status,
          batch: batchKey,
          optionSig: optSig,
          qty: 0,
          itemIds: [],
          orderNos: [],
          optionLabel,
          categoryName: it.categoryName || "미분류",
          categoryOrder: Number.isFinite(Number(it.categoryOrder)) ? Number(it.categoryOrder) : 9999,
        });
      }

      const g = grouped.get(key)!;
      g.qty += Number(it.qty || 0);
      g.itemIds.push(it.id);
      if (it.displayNo && !g.orderNos.includes(it.displayNo)) g.orderNos.push(it.displayNo);
    }

    return [...grouped.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === "making" ? 1 : -1;
      if (a.categoryOrder !== b.categoryOrder) return a.categoryOrder - b.categoryOrder;
      if (a.categoryName !== b.categoryName) return a.categoryName.localeCompare(b.categoryName);
      if (a.batch !== b.batch) return a.batch - b.batch;
      return a.name.localeCompare(b.name);
    });
  }, [orders]);

  const buildOptionText = (it: OrderItem) =>
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

  function hasReadyItems(o: OrderRecord) {
    return o.items.some((it) => it.status === "done");
  }

  const readyOrders = useMemo(
    () =>
      [...orders]
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter((o) => !isCompleted(o.status) && hasReadyItems(o)),
    [orders]
  );

  const togglePackingChecks = async (order: OrderRecord, nextChecked: boolean, targetItemId?: string) => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;

    const doneItems = order.items.filter((it) => it.status === "done");
    const targets = targetItemId ? doneItems.filter((it) => it.id === targetItemId) : doneItems;
    if (!targets.length) return;

    const nowIso = new Date().toISOString();
    const rows = targets.map((it) => ({
      store_id: sid,
      order_id: order.id,
      order_item_id: it.id,
      checked: nextChecked,
      checked_at: nextChecked ? nowIso : null,
    }));

    const { error } = await supabase.from("order_item_packing_checks").upsert(rows, { onConflict: "order_item_id" });
    if (error) {
      alert(`준비 확인 저장 실패: ${error.message}`);
      return;
    }

    fetchOrdersFromDb(true);
  };

  const canAdvanceSelected =
    !!selected &&
    !(selected.status === "completed" || selected.status === "cancelled" || (prepayAddonActive && selected.paymentStatus === "pending" && selected.status === "new"));
  const canCancelSelected = !!selected && !(selected.status === "completed" || selected.status === "cancelled");

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

  const updateOrderItemsInDb = async (itemIds: string[], patch: { status?: ItemStatus; batch?: number }) => {
    const sid = storeIdRef.current || storeId;
    if (!sid || !itemIds.length) return;
    if (typeof patch.status === "undefined") return;

    const rpcPayload = {
      p_store_id: sid,
      p_item_ids: itemIds,
      p_status: patch.status,
      p_batch: typeof patch.batch === "undefined" ? null : patch.batch,
    };

    const rpcRes = await supabase.rpc("staff_update_order_items_status", rpcPayload);

    // 마이그레이션 미반영 환경 대비 fallback
    if (rpcRes.error) {
      const payload: any = { status: patch.status };
      if (typeof patch.batch !== "undefined") payload.batch = patch.batch;

      const fallback = await supabase.from("order_items").update(payload).in("id", itemIds);
      if (fallback.error) {
        alert(`아이템 상태 저장 실패: ${fallback.error.message}`);
        return;
      }
    }

    fetchOrdersFromDb(true);
  };

  const badgeClassByStatus = (s: OrderStatus) =>
    s === "new"
      ? "badgeNew"
      : s === "checked"
      ? "badgeChecked"
      : s === "making"
      ? "badgeMaking"
      : s === "ready_for_packing"
      ? "badgeReady"
      : s === "cancelled"
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
          color-scheme: light;
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
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          width: 100%;
        }

        .titleTop {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          width: 100%;
        }

        .topActions {
          display: flex;
          gap: 8px;
          flex-wrap: nowrap;
          justify-content: flex-end;
          margin-left: auto;
        }

        .storeInfo {
          margin: 0;
          font-weight: 800;
          font-size: 16px;
          line-height: 1.25;
        }

        .storeInfo b {
          font-weight: 900;
        }

        .btn.topActionBtn {
          padding: 10px 14px;
          font-size: 14px;
          border-radius: 12px;
          white-space: nowrap;
        }

        .sectionTitle {
          margin: 0;
          font-size: 24px;
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: -0.01em;
        }

        .sectionTitleSm {
          margin: 0;
          font-size: 18px;
          line-height: 1.25;
          font-weight: 850;
          letter-spacing: -0.01em;
        }

        .buzzerRow {
          margin-top: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: nowrap;
        }

        .buzzerInput {
          width: 120px;
          min-width: 0;
          height: 38px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid var(--line);
          font-weight: 700;
        }

        .buzzerHint {
          margin: 8px 0 0 0;
          color: var(--muted);
          font-size: 13px;
        }

        .titleBlock {
          display: grid;
          gap: 8px;
          width: 100%;
        }

        .h1 {
          font-size: 30px;
          font-weight: 900;
          margin: 0;
          letter-spacing: -0.02em;
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
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 6px;
        }

        .tabsRow {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .modeRow {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .modeSwitch {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #f8fafc;
        }

        .modeSwitchBtn {
          border: none;
          background: transparent;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          padding: 6px 11px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition: all 0.16s ease;
        }

        .modeSwitchBtnOn {
          background: #111827;
          color: #fff;
          box-shadow: 0 2px 8px rgba(17, 24, 39, 0.22);
        }

        .modeSwitchBtn:focus-visible {
          outline: 2px solid #4f46e5;
          outline-offset: 1px;
        }

        .modeToast {
          margin: 6px 0 0 0;
          font-size: 12px;
          font-weight: 800;
          color: #1d4ed8;
        }

        .newOrderPopup {
          margin-top: 8px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          border-radius: 12px;
          padding: 10px 12px;
        }
        .newOrderPopupTitle {
          font-size: 12px;
          font-weight: 900;
          color: #1d4ed8;
        }
        .newOrderPopupText {
          margin-top: 2px;
          font-size: 13px;
          font-weight: 850;
          color: #111827;
        }

        .modeLabel {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
          font-weight: 800;
        }

        .chip {
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          padding: 12px 12px;
          border-radius: 12px;
          font-weight: 900;
          cursor: pointer;
          font-size: 15px;
        }
        .chipOn {
          border-color: var(--brand);
          color: var(--text);
          box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08);
        }

        /* ✅ 탭 아래 안내 문구 */
        .tabHint {
          margin: 8px 0 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.4;
          font-weight: 700;
          word-break: keep-all;
        }

        .panel {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 16px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          min-height: 520px;
        }

        .cardTitle {
          margin: 0;
          font-size: 20px;
          font-weight: 900;
        }

        .cardTitleRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }

        .backBtn {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
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
          transition: border-color 0.16s ease, box-shadow 0.16s ease;
        }

        .itemBtn:hover {
          border-color: #cbd5e1;
        }

        .itemBtn:focus-visible {
          outline: 2px solid #4f46e5;
          outline-offset: 2px;
        }

        .itemBtnOn {
          border: 2px solid var(--brand);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
        }

        .rowBetween {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }

        .orderMetaRight {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .elapsedBadge {
          border: 1px solid #fde68a;
          background: #fffbeb;
          color: #92400e;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
        }

        .orderQuickMeta {
          margin-top: 8px;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .itemQuickActions {
          margin-top: 8px;
          display: flex;
          justify-content: flex-end;
        }

        .quickActionBtn {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          transition: background-color 0.14s ease, transform 0.06s ease, box-shadow 0.14s ease;
        }

        .quickActionBtnPrimary {
          border-color: #1d4ed8;
          background: #2563eb;
          color: #fff;
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
        }

        .quickActionBtnPrimary:hover {
          background: #1d4ed8;
        }

        .quickActionBtnPrimary:active {
          transform: translateY(1px);
          background: #1e40af;
          box-shadow: 0 1px 4px rgba(37, 99, 235, 0.25);
        }

        .quickActionBtnPrimary:focus-visible {
          outline: 2px solid #60a5fa;
          outline-offset: 1px;
        }

        .readyItemSubRow {
          margin-top: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .readyItemOption {
          margin: 0;
          flex: 1 1 220px;
          min-width: 0;
        }

        .readyItemActions {
          margin-top: 0;
          margin-left: auto;
          flex: 0 0 auto;
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
        .badgeChecked {
          border-color: #e0e7ff;
          background: #eef2ff;
          color: #4338ca;
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
          padding: 10px 12px;
          background: #fff;
          display: grid;
          gap: 6px;
        }

        .detailNo {
          font-size: 22px;
          font-weight: 900;
          margin: 0;
          line-height: 1.2;
        }

        .metaRow {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.4;
          font-weight: 750;
        }

        .metaTop {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }

        .metaTime {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
        }

        .metaBottom {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.4;
          font-weight: 750;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .metaSummary {
          margin: 0;
          padding-top: 6px;
          border-top: 1px solid var(--line);
          color: #111827;
          font-size: 14px;
          font-weight: 850;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
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

        .orderItemsBox {
          margin-top: 10px;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          overflow: hidden;
        }

        .orderItemLine {
          padding: 12px;
          display: grid;
          gap: 6px;
        }

        .orderItemLine + .orderItemLine {
          border-top: 1px solid var(--line);
        }

        .orderItemLineTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .orderItemName {
          font-size: 22px;
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: -0.01em;
        }

        .orderItemPrice {
          font-weight: 900;
          white-space: nowrap;
          line-height: 1.1;
          text-align: right;
          flex-shrink: 0;
        }

        .itemsScroll {
          margin-top: 10px;
          max-height: none;
          overflow: visible;
          padding-right: 0;
        }

        .orderItemsTitle {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
          font-weight: 900;
          letter-spacing: -0.01em;
        }

        .menuItem {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 8px;
        }

        .menuName {
          font-size: 24px;
          line-height: 1.2;
          font-weight: 950;
          letter-spacing: -0.01em;
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
          margin-top: 4px;
          border-radius: 10px;
          padding: 8px 10px;
          background: #f8fafc;
          display: grid;
          gap: 6px;
        }

        .optLine {
          font-size: 16px;
          font-weight: 850;
          color: #111827;
          line-height: 1.4;
          word-break: keep-all;
        }

        .optMuted {
          color: var(--muted);
          font-weight: 800;
          font-size: 13px;
          line-height: 1.45;
        }

        .actionRow {
          margin-top: 14px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .actionDock {
          display: none;
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

        .modalBackdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: grid;
          place-items: center;
          z-index: 60;
          padding: 16px;
        }

        .modalCard {
          width: min(420px, 100%);
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 16px;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.25);
          display: grid;
          gap: 12px;
        }

        .modalTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
        }

        .modalDesc {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.5;
        }

        .modalActions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
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
            font-size: 25px;
          }

          .desc {
            font-size: 13px;
            max-width: 100%;
          }

          .cardTitle {
            font-size: 18px;
          }

          .detailNo {
            font-size: 20px;
          }

          .orderItemsTitle {
            font-size: 18px;
          }

          .sectionTitle {
            font-size: 19px;
          }

          .sectionTitleSm {
            font-size: 17px;
          }

          .menuName {
            font-size: 20px;
          }

          .optLine {
            font-size: 14px;
          }

          .titleTop {
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
          }

          .topActions {
            justify-content: flex-end;
            gap: 6px;
            flex-shrink: 0;
            margin-left: auto;
          }

          .btn.topActionBtn {
            padding: 6px 8px;
            font-size: 12px;
          }

          .storeInfo {
            font-size: 15px;
          }

          .orderMetaRight {
            gap: 4px;
          }

          .elapsedBadge {
            padding: 3px 7px;
            font-size: 10px;
          }

          .itemQuickActions {
            margin-top: 6px;
          }

          .quickActionBtn {
            padding: 5px 9px;
            font-size: 11px;
          }

          .orderItemName {
            font-size: 19px;
          }

          .modeRow {
            margin-top: 8px;
            gap: 6px;
          }

          .buzzerRow {
            gap: 8px;
          }

          .buzzerInput {
            width: 92px;
            height: 34px;
            font-size: 14px;
          }

          .btn {
            padding: 10px 12px;
          }

          .tabs {
            gap: 5px;
            flex-wrap: nowrap;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }

          .tabs::-webkit-scrollbar {
            display: none;
          }

          .chip {
            flex: 0 0 auto;
            white-space: nowrap;
            font-size: 13px;
            padding: 8px 11px;
            border-radius: 11px;
          }

          .mobileHide {
            display: none !important;
          }

          .actionRow {
            display: none;
          }

          .actionDock {
            position: fixed;
            left: 12px;
            right: 12px;
            bottom: max(12px, env(safe-area-inset-bottom));
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            padding: 10px;
            border: 1px solid var(--line);
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
            z-index: 30;
            backdrop-filter: blur(4px);
          }

          .actionDockTriple {
            grid-template-columns: 1fr;
          }

          .dockSpacer {
            height: 96px;
          }
          .modeSwitchBtn {
            font-size: 11px;
            padding: 6px 10px;
          }
        }

        @media (max-width: 390px) {
          .tabs {
            gap: 3px;
          }

          .btn.topActionBtn {
            padding: 8px 10px;
            font-size: 12px;
          }

          .chip {
            padding: 10px 10px;
            font-size: 14px;
          }
        }

      `}</style>

      <header className="topbar">
        <div className="titleBlock">
          <div className="titleTop">
            <h1 className="h1">직원 화면</h1>

            <div className="topActions">
              <button
                className="btn btnPrimary topActionBtn"
                onClick={() =>
                  (window.location.href = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")
                }
              >
                관리자
              </button>
              <a className="btn topActionBtn" href="/logout">로그아웃</a>
            </div>
          </div>

          {/* ✅ 현재 매장 표시 */}
          <p className="muted storeInfo">
            현재 매장: <b>{storeId || "미선택"}</b>
          </p>

          {/* ✅ 최초 로드에서만 표시 */}
          {initialLoading ? <p className="muted" style={{ margin: 0 }}>불러오는 중...</p> : null}

          {errMsg ? <p className="err">오류: {errMsg}</p> : null}
        </div>
      </header>

      <div className="modeRow">
        <p className="modeLabel">모드전환</p>
        <div className="modeSwitch" role="group" aria-label="모드전환">
          <button
            type="button"
            className={`modeSwitchBtn ${staffViewMode === "simple" ? "modeSwitchBtnOn" : ""}`}
            aria-pressed={staffViewMode === "simple"}
            onClick={() => updateStaffViewMode("simple")}
          >
            Simple
          </button>
          <button
            type="button"
            className={`modeSwitchBtn ${staffViewMode === "station" ? "modeSwitchBtnOn" : ""}`}
            aria-pressed={staffViewMode === "station"}
            onClick={() => updateStaffViewMode("station")}
          >
            Station
          </button>
        </div>
      </div>

      {staffViewMode === "simple" ? (
        <div className="tabsRow">
          <div className="tabs">
            <button
              className={`chip ${listTab === "active" ? "chipOn" : ""}`}
              onClick={() => {
                setListTab("active");
                setMobileView("list");
              }}
            >
              주문확인 ({counts.active})
            </button>
            <button
              className={`chip ${listTab === "completed" ? "chipOn" : ""}`}
              onClick={() => {
                setListTab("completed");
                setMobileView("list");
              }}
            >
              완료 ({counts.completed})
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
        </div>
      ) : (
        <div className="tabsRow">
          <div className="tabs">
            <button
              className={`chip ${stationTab === "order" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("order");
                setMobileView("list");
              }}
            >
              주문확인 ({stationCounts.order})
            </button>
            <button
              className={`chip ${stationTab === "make" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("make");
                setMobileView("list");
              }}
            >
              제조 ({stationCounts.make})
            </button>
            <button
              className={`chip ${stationTab === "ready" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("ready");
                setMobileView("list");
              }}
            >
              준비 ({stationCounts.ready})
            </button>
            <button
              className={`chip ${stationTab === "history" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("history");
                setMobileView("list");
              }}
            >
              완료 ({stationCounts.history})
            </button>
          </div>
        </div>
      )}
      {modeToast ? <p className="modeToast">{modeToast}</p> : null}
      {newOrderPopup ? (
        <div className="newOrderPopup" role="alert" aria-live="assertive">
          <div className="newOrderPopupTitle">신규 주문 접수</div>
          <div className="newOrderPopupText">주문번호 {newOrderPopup.displayNo}</div>
          <div className="itemQuickActions" style={{ marginTop: 8 }}>
            <button type="button" className="quickActionBtn quickActionBtnPrimary" onClick={moveToOrderCheckTab}>
              주문확인으로 이동
            </button>
            <button type="button" className="quickActionBtn" onClick={() => setNewOrderPopup(null)}>
              닫기
            </button>
          </div>
        </div>
      ) : null}
      <p className="tabHint" style={{ marginTop: 4 }}>주문 확인 → 제조 → 준비 확인 순서로 진행해 주세요.</p>

      <div className="panel">
        <section className={`card ${mobileView === "detail" ? "mobileHide" : ""}`}>
          <div className="cardTitleRow">
            <h2 className="cardTitle">{listTitle}</h2>
            <span className="badge">{filteredOrders.length}건</span>
          </div>

          {!storeId ? (
            <p className="muted">매장이 선택되지 않았습니다. 관리자에서 매장을 선택하고 다시 들어와 주세요.</p>
          ) : staffViewMode === "station" && stationTab === "make" ? (
            makeGroups.length === 0 ? <p className="muted">제조 대기/진행 아이템이 없습니다.</p> : (
              <div className="list">
                <div className="itemQuickActions" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="quickActionBtn quickActionBtnPrimary"
                    onClick={() => updateOrderItemsInDb(waitingItemIdsForBatch, { status: "making", batch: nextBatch })}
                    disabled={waitingItemIdsForBatch.length === 0}
                    style={{ opacity: waitingItemIdsForBatch.length ? 1 : 0.45 }}
                  >
                    배치 생성 (전체 1회)
                  </button>
                </div>
                {makeGroups.map((g) => (
                  <div key={g.key} className="itemBtn" style={{ cursor: "default" }}>
                    <div className="rowBetween">
                      <div className="bigNo">{g.name} × {g.qty}</div>
                      <span className={`badge statusPill ${g.status === "waiting" ? "badgeChecked" : "badgeMaking"}`}>
                        {g.status === "waiting" ? "제조대기" : "제조중"}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 8 }}>
                      {g.batch > 0 ? `제조 순번 #${g.batch} · ` : ""}주문번호 {g.orderNos.join(", ")}
                    </div>
                    {g.optionLabel ? <div className="muted" style={{ marginTop: 4 }}>옵션: {g.optionLabel}</div> : null}
                    <div className="itemQuickActions" style={{ marginTop: 10 }}>
                      {g.status === "waiting" ? (
                        <button
                          type="button"
                          className="quickActionBtn quickActionBtnPrimary"
                          onClick={() => updateOrderItemsInDb(g.itemIds, { status: "making", batch: nextBatch })}
                        >
                          ▶ 제조 시작
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="quickActionBtn quickActionBtnPrimary"
                          onClick={() => updateOrderItemsInDb(g.itemIds, { status: "done" })}
                        >
                          ✓ 제조 완료
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : staffViewMode === "station" && stationTab === "ready" ? (
            readyOrders.length === 0 ? <p className="muted">준비 확인 대기 주문이 없습니다.</p> : (
              <div className="list">
                {readyOrders.map((o) => {
                  const doneItems = o.items.filter((it) => it.status === "done");
                  const checkedCount = doneItems.filter((it) => !!it.packingChecked).length;
                  const allItemsDone = o.items.length > 0 && o.items.every((it) => it.status === "done");
                  const allDoneChecked = doneItems.length > 0 && checkedCount === doneItems.length;
                  const canCompleteOrder = allItemsDone && allDoneChecked;

                  return (
                    <div key={`ready_${o.id}`} className="itemBtn" style={{ cursor: "default" }}>
                      <div className="rowBetween">
                        <div className="bigNo">주문번호 {o.displayNo}</div>
                        <span className="badge">준비 확인 {checkedCount}/{doneItems.length}</span>
                      </div>

                      <div className="muted" style={{ marginTop: 8 }}>
                        {o.mode === "dine-in" ? `매장 · 테이블 ${o.table ?? "-"}` : "포장"}
                      </div>
                      {o.requestNote ? <div className="muted" style={{ marginTop: 4 }}>요청사항: {o.requestNote}</div> : null}

                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        {o.items.map((it) => {
                          const optText = buildOptionText(it);
                          const checked = !!it.packingChecked;
                          const isDone = it.status === "done";
                          const statusText = !isDone
                            ? it.status === "making"
                              ? "제조중"
                              : "제조대기"
                            : checked
                            ? "준비확인"
                            : "준비대기";
                          const statusClass = !isDone ? "badgeMaking" : checked ? "badgeDone" : "badgeChecked";

                          return (
                            <div key={`ready_item_${it.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                              <div className="rowBetween">
                                <div style={{ fontWeight: 800 }}>{it.name} × {it.qty}</div>
                                <span className={`badge statusPill ${statusClass}`}>{statusText}</span>
                              </div>
                              {optText || isDone ? (
                                <div className="readyItemSubRow">
                                  {optText ? <div className="muted readyItemOption">{optText}</div> : null}
                                  {isDone ? (
                                    <div className="itemQuickActions readyItemActions">
                                      <button
                                        type="button"
                                        className={`quickActionBtn ${checked ? "" : "quickActionBtnPrimary"}`}
                                        onClick={() => togglePackingChecks(o, !checked, it.id)}
                                      >
                                        {checked ? "↺ 확인취소" : "✓ 준비확인"}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="itemQuickActions" style={{ marginTop: 12, gap: 8 }}>
                        <button
                          type="button"
                          className="quickActionBtn"
                          onClick={() => togglePackingChecks(o, true)}
                          disabled={!doneItems.length}
                          style={{ opacity: doneItems.length ? 1 : 0.45 }}
                        >
                          ✓ 전체 준비확인
                        </button>
                        <button
                          type="button"
                          className="quickActionBtn quickActionBtnPrimary"
                          onClick={() => updateOrderInDb(o.id, { status: "completed" })}
                          disabled={!canCompleteOrder}
                          style={{ opacity: canCompleteOrder ? 1 : 0.45 }}
                        >
                          ✓ 전달 완료
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : filteredOrders.length === 0 ? (
            <p className="muted">해당 조건의 주문이 없습니다.</p>
          ) : (
            <div className="list">
              {filteredOrders.map((o) => {
                const isSelected = o.id === selectedId;
                const badgeClass = badgeClassByStatus(o.status);
                const showNew = isNewBadge(o.id);
                const totalQty = o.items.reduce((acc, it) => acc + Number(it.qty || 0), 0);

                return (
                  <div
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`주문번호 ${o.displayNo} 상세 보기`}
                    onClick={() => onSelect(o.id)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onSelect(o.id);
                    }}
                    className={`itemBtn ${isSelected ? "itemBtnOn" : ""}`}
                  >
                    <div className="rowBetween">
                      <div className="bigNo">
                        {o.displayNo}
                        {o.buzzerNo ? ` · 벨 ${o.buzzerNo}` : ""}
                        {showNew ? <span className="badge badgeHot">NEW</span> : null}
                      </div>
                      <div className="orderMetaRight">
                        <span className="elapsedBadge">{formatElapsedMin(o.createdAt)}</span>
                        <div className="muted">{formatTime(o.createdAt)}</div>
                      </div>
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

                    <div className="orderQuickMeta">
                      <span className="badge">메뉴 {o.items.length}개</span>
                      <span className="badge">총 수량 {totalQty}</span>
                    </div>

                    {staffViewMode === "station" && isActive(o.status) ? (
                      <div className="itemQuickActions">
                        <button
                          type="button"
                          className="quickActionBtn quickActionBtnPrimary"
                          aria-label={`주문번호 ${o.displayNo} ${statusButtonLabelForView(o.status)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            advanceOrder(o);
                          }}
                        >
                          {statusButtonLabelForView(o.status)}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={`card ${mobileView === "list" ? "mobileHide" : ""}`}>
          <div className="cardTitleRow">
            <h2 className="cardTitle">주문 상세</h2>
            <button
              className="backBtn"
              onClick={() => setMobileView("list")}
              style={{ display: mobileView === "detail" ? "inline-flex" : "none" }}
            >
              주문 목록
            </button>
          </div>

          {!selected ? (
            <div className="detailBox" style={{ display: "grid", gap: 10 }}>
              <p className="muted">주문을 선택하세요.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">주문확인 {counts.active}건</span>
                <span className="badge">완료 {counts.completed}건</span>
                <span className="badge">전체 {counts.all}건</span>
              </div>
              <div className="itemQuickActions">
                <button type="button" className="quickActionBtn quickActionBtnPrimary" onClick={moveToOrderCheckTab}>
                  주문확인 탭 보기
                </button>
                {staffViewMode === "station" ? (
                  <button type="button" className="quickActionBtn" onClick={() => setStationTab("make")}>
                    제조 탭 보기
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="detailBox">
                <div className="metaTop">
                  <p className="detailNo">주문번호 {selected.displayNo}</p>
                  <p className="metaTime">주문시각: {formatTime(selected.createdAt)}</p>
                </div>
                <p className="metaBottom">
                  <span>{selected.mode === "dine-in" ? `매장 · 테이블 ${selected.table ?? "-"}` : "포장 주문"}</span>
                  <span>결제상태: <b>{PAYMENT_LABEL[selected.paymentStatus]}</b></span>
                </p>
                <p className="metaSummary">
                  <span>총 수량: <b>{selected.totalCount}</b></span>
                  <span>총 금액: <b>{fmt(selected.totalPrice)}원</b></span>
                </p>
              </div>

              {prepayAddonActive && selected.paymentStatus === "pending" ? (
                <div className="detailBox" style={{ borderColor: "#f59e0b", background: "#fffbeb" }}>
                  <b style={{ color: "#92400e" }}>선결재 옵션 매장: 결제완료 전에는 제조 시작이 불가합니다.</b>
                </div>
              ) : null}

              <div className="section">
                <div className="buzzerRow">
                  <h3 className="sectionTitleSm">진동벨 번호 (선택)</h3>
                  <input
                    className="buzzerInput"
                    value={selected.buzzerNo ?? ""}
                    onChange={(e) => updateOrderInDb(selected.id, { buzzerNo: e.target.value.trim() })}
                    placeholder="예: 12"
                  />
                </div>
                <p className="buzzerHint">* 벨을 지급한 경우에만 입력</p>
              </div>

              <div className="section">
                <h3 className="sectionTitleSm">요청사항</h3>
                <div className="detailBox" style={{ color: selected.requestNote ? "#111" : "#6b7280" }}>
                  {selected.requestNote || "요청사항 없음"}
                </div>
              </div>

              <div className="section">
                <h3 className="sectionTitle">주문 내역</h3>
                <div className="itemsScroll">
                  <div className="orderItemsBox">
                    {Object.entries(
                      selected.items.reduce<Record<string, OrderItem[]>>((acc, it) => {
                        const key = it.categoryName || "미분류";
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(it);
                        return acc;
                      }, {})
                    )
                      .sort((a, b) => {
                        const ao = Math.min(...a[1].map((it) => Number(it.categoryOrder ?? 9999)));
                        const bo = Math.min(...b[1].map((it) => Number(it.categoryOrder ?? 9999)));
                        if (ao !== bo) return ao - bo;
                        return a[0].localeCompare(b[0]);
                      })
                      .map(([categoryName, rows]) => (
                        <div key={categoryName} style={{ display: "grid", gap: 8 }}>
                          <div className="muted" style={{ fontWeight: 900, paddingLeft: 8 }}>{categoryName}</div>
                          {rows.map((it, idx) => {
                            const optionTotal = Number(it.optionTotal || 0);
                            const unit = Number(it.price || 0) + optionTotal;
                            const lineTotal =
                              Number.isFinite(Number(it.lineTotal)) && it.lineTotal !== undefined
                                ? Number(it.lineTotal)
                                : unit * Number(it.qty || 0);

                            const optText = buildOptionText(it);

                            return (
                              <div key={`${it.id}_${idx}`} className="orderItemLine">
                                <div className="orderItemLineTop">
                                  <div>
                                    <div className="orderItemName">{it.name} x{it.qty}</div>
                                    {optText ? (
                                      <div className="optWrap">
                                        <div className="optLine">옵션: {optText}</div>
                                      </div>
                                    ) : null}
                                    <div className="optMuted" style={{ marginTop: 4 }}>
                                      기본 {fmt(it.price)}원
                                      {optionTotal ? ` + 옵션 ${fmt(optionTotal)}원` : ""}
                                      {" · "}
                                      1개당 {fmt(unit)}원
                                    </div>
                                  </div>

                                  <div className="orderItemPrice">{fmt(lineTotal)}원</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="actionRow">
                <button
                  className="actionBtn actionPrimary"
                  onClick={() => advanceOrder(selected)}
                  disabled={!canAdvanceSelected}
                  style={{
                    opacity: canAdvanceSelected ? 1 : 0.5,
                  }}
                >
                  {statusButtonLabelForView(selected.status)}
                </button>

                {prepayAddonActive && selected.paymentStatus === "pending" ? (
                  <button
                    className="actionBtn"
                    style={{ borderColor: "#2563eb", color: "#2563eb" }}
                    onClick={() => updateOrderInDb(selected.id, { paymentStatus: "paid" })}
                  >
                    결제완료 처리
                  </button>
                ) : null}

                <button
                  className="actionBtn actionCancel"
                  onClick={() => openCancelModal(selected)}
                  disabled={!canCancelSelected}
                  style={{
                    opacity: canCancelSelected ? 1 : 0.5,
                  }}
                >
                  주문 취소
                </button>
              </div>

              <div className="dockSpacer" />

              <p className="hint">
                * 주문 취소는 삭제가 아닌 상태 변경입니다.
              </p>
            </>
          )}
        </section>
      </div>

      {selected && mobileView === "detail" ? (
        <div className={`actionDock ${prepayAddonActive && selected.paymentStatus === "pending" ? "actionDockTriple" : ""}`}>
          <button
            className="actionBtn actionPrimary"
            onClick={() => advanceOrder(selected)}
            disabled={!canAdvanceSelected}
            style={{ opacity: canAdvanceSelected ? 1 : 0.5 }}
          >
            {statusButtonLabelForView(selected.status)}
          </button>

          {prepayAddonActive && selected.paymentStatus === "pending" ? (
            <button
              className="actionBtn"
              style={{ borderColor: "#2563eb", color: "#2563eb" }}
              onClick={() => updateOrderInDb(selected.id, { paymentStatus: "paid" })}
            >
              결제완료 처리
            </button>
          ) : null}

          <button
            className="actionBtn actionCancel"
            onClick={() => openCancelModal(selected)}
            disabled={!canCancelSelected}
            style={{ opacity: canCancelSelected ? 1 : 0.5 }}
          >
            주문 취소
          </button>
        </div>
      ) : null}

      {cancelTarget ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="cancel-modal-title">
          <div className="modalCard">
            <h3 id="cancel-modal-title" className="modalTitle">주문 취소 확인</h3>
            <p className="modalDesc">
              주문번호 {cancelTarget.displayNo}를 취소 처리할까요?
              <br />
              취소는 삭제가 아닌 상태 변경입니다.
            </p>
            <div className="modalActions">
              <button type="button" className="btn" onClick={closeCancelModal}>닫기</button>
              <button type="button" className="btn actionCancel" onClick={confirmCancelOrder}>주문 취소</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function StaffPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <StaffPageInner />
    </Suspense>
  );
}
