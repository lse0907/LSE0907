/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
"use client";

import { Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import RionBrand from "@/app/components/RionBrand";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type PaymentStatus = "not_required" | "pending" | "paid";
type StaffViewMode = "simple" | "station";
type ItemStatus = "waiting" | "making" | "done";
type StaffIconName = "home" | "logout" | "arrow-left" | "check" | "play" | "package-check" | "bell" | "order";

function StaffIcon({ name, className = "staffIcon" }: { name: StaffIconName; className?: string }) {
  const paths: Record<StaffIconName, ReactNode> = {
    home: <><path d="M3 9.2 10 3l7 6.2v7.3a.5.5 0 0 1-.5.5h-4.2v-5H7.7v5H3.5a.5.5 0 0 1-.5-.5V9.2Z" /></>,
    logout: <><path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" /><path d="M12.5 6.5 16 10l-3.5 3.5M7 10h9" /></>,
    "arrow-left": <><path d="m9 5-5 5 5 5M4 10h12" /></>,
    check: <><circle cx="10" cy="10" r="7" /><path d="m6.8 10.1 2.1 2.2 4.5-4.7" /></>,
    play: <><circle cx="10" cy="10" r="7" /><path d="m8.4 7 4.6 3-4.6 3V7Z" /></>,
    "package-check": <><path d="m4 6 6-3 6 3v8l-6 3-6-3V6Z" /><path d="m4 6 6 3 6-3M10 9v4" /><path d="m12.2 14.1 1.1 1.1 2.2-2.4" /></>,
    bell: <><path d="M5.5 14h9l-1.2-1.8V8a3.3 3.3 0 0 0-6.6 0v4.2L5.5 14Z" /><path d="M8.5 16.2h3" /></>,
    order: <><path d="M5 3.5h10v13H5z" /><path d="M7.5 7h5M7.5 10h5M7.5 13h3" /></>,
  };

  return <svg className={className} viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

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
const STAFF_WORKER_AUTO_LOCK_MS = 30 * 60 * 1000;
const STAFF_SESSION_AUTO_LOGOUT_MS = 120 * 60 * 1000;

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
  if (s === "checked") return "제조 시작";
  if (s === "making") return "준비 완료";
  if (s === "ready_for_packing") return "전달 완료";
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

  const [listTab, setListTab] = useState<"active" | "completed">("active");
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
        .select("staff_view_mode,store_name")
        .eq("store_id", sid)
        .maybeSingle();
      setStoreName(String(data?.store_name || "").trim());
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
  const [deviceStatus, setDeviceStatus] = useState<"checking" | "approved" | "pending" | "rejected" | "disabled" | "setup_required" | "owner_bypass">("checking");
  const [storeName, setStoreName] = useState("");
  const [loginRole, setLoginRole] = useState<"owner" | "manager" | "staff" | "viewer">("viewer");
  const [currentWorker, setCurrentWorker] = useState<{ id: string; displayName: string; pinRole: "staff" | "manager"; isOwnerBypass?: boolean } | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [workerPinModalOpen, setWorkerPinModalOpen] = useState(false);
  const [pinRequestOpen, setPinRequestOpen] = useState(false);
  const [pinRequestForm, setPinRequestForm] = useState({ displayName: "", contactHint: "", pin: "", pinConfirm: "", requestedRole: "staff" as "staff" | "manager" });
  const [pinRequestMsg, setPinRequestMsg] = useState("");
  const [cancelReason, setCancelReason] = useState("고객 요청");
  const [managerPinForCancel, setManagerPinForCancel] = useState("");
  const [cancelNeedsManagerPin, setCancelNeedsManagerPin] = useState(false);
  const [cancelMsg, setCancelMsg] = useState("");
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const lastActivityAtRef = useRef(Date.now());


  useEffect(() => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    (async () => {
      try {
        let fingerprint = window.localStorage.getItem("qrCafeStaffDeviceFingerprint");
        if (!fingerprint) {
          fingerprint = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          window.localStorage.setItem("qrCafeStaffDeviceFingerprint", fingerprint);
        }
        const res = await fetch("/api/staff/devices/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: sid,
            fingerprint,
            deviceName: navigator.userAgent.includes("Mobile") ? "모바일 기기" : "직원 기기",
            deviceType: navigator.userAgent.includes("Mobile") ? "mobile" : "web",
            browser: navigator.userAgent,
          }),
        });
        const json = await res.json();
        setDeviceStatus(json.status === "owner_bypass" || json.status === "approved" || json.status === "setup_required" ? json.status : json.status || "pending");
      } catch {
        setDeviceStatus("setup_required");
      }
    })();
  }, [storeId]);

  const verifyWorkerPin = async (requiredRole: "staff" | "manager" = "staff") => {
    const sid = storeIdRef.current || storeId;
    if (!sid || !pinInput.trim()) return;
    setPinMsg("");
    try {
      const res = await fetch("/api/staff/pins/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: sid, pin: pinInput.trim(), requiredRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "PIN 확인 실패");
      setCurrentWorker({ id: json.pin.id, displayName: json.pin.displayName, pinRole: json.pin.pinRole });
      setPinInput("");
      setPinMsg("");
      setWorkerPinModalOpen(false);
      lastActivityAtRef.current = Date.now();
    } catch (e: unknown) {
      setPinMsg(e instanceof Error ? e.message : String(e));
    }
  };


  useEffect(() => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) return;
      const { data } = await supabase.from("store_members").select("role").eq("store_id", sid).eq("user_id", uid).limit(1).maybeSingle();
      const role = String(data?.role || "viewer").trim().toLowerCase();
      const normalizedRole = role === "owner" || role === "manager" || role === "staff" ? role : "viewer";
      setLoginRole(normalizedRole);
      if (normalizedRole === "owner") {
        setCurrentWorker({ id: "", displayName: "대표자 계정", pinRole: "manager", isOwnerBypass: true });
        setWorkerPinModalOpen(false);
      } else if (!currentWorker) {
        setWorkerPinModalOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    const markActive = () => {
      lastActivityAtRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "touchstart", "scroll"];
    events.forEach((eventName) => window.addEventListener(eventName, markActive, { passive: true }));
    const timer = window.setInterval(async () => {
      const idleMs = Date.now() - lastActivityAtRef.current;
      if (idleMs >= STAFF_SESSION_AUTO_LOGOUT_MS) {
        await supabase.auth.signOut();
        const next = storeId ? `/staff?store=${encodeURIComponent(storeId)}` : "/staff";
        window.location.href = `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("120분 미사용으로 로그아웃되었습니다.")}`;
        return;
      }
      if (idleMs >= STAFF_WORKER_AUTO_LOCK_MS && loginRole !== "owner" && currentWorker) {
        setCurrentWorker(null);
        setWorkerPinModalOpen(true);
        setPinMsg("30분 미사용으로 잠겼습니다.");
      }
    }, 30 * 1000);
    return () => {
      events.forEach((eventName) => window.removeEventListener(eventName, markActive));
      window.clearInterval(timer);
    };
  }, [currentWorker, loginRole, storeId]);

  const requireWorkerPin = () => {
    if (loginRole === "owner" || currentWorker) return true;
    setWorkerPinModalOpen(true);
    setPinMsg("담당 직원 확인이 필요합니다.");
    return false;
  };

  const actorPinIdForEvent = currentWorker?.isOwnerBypass ? null : currentWorker?.id || null;

  const workerRoleText = currentWorker?.isOwnerBypass
    ? "대표자 계정"
    : currentWorker
      ? `${currentWorker.displayName} · ${currentWorker.pinRole === "manager" ? "매니저" : "직원"}`
      : "PIN 필요";
  const workerLabelText = currentWorker?.isOwnerBypass ? "작업 권한" : "담당 직원";
  const workerBadgeClass = currentWorker?.isOwnerBypass
    ? "workerBadge workerBadgeOwner"
    : currentWorker?.pinRole === "manager"
      ? "workerBadge workerBadgeManager"
      : currentWorker
        ? "workerBadge workerBadgeStaff"
        : "workerBadge workerBadgePending";
  const workerChangeLabel = currentWorker ? "담당 변경" : "PIN 입력";
  const storeDisplayName = storeName || storeId || "미선택";
  const deviceNoticeText = deviceStatus === "checking"
    ? "기기 확인 중..."
    : deviceStatus === "pending"
      ? "기기 승인 대기 중입니다."
      : deviceStatus === "rejected"
        ? "기기 승인이 거절되었습니다."
        : deviceStatus === "disabled"
          ? "이 기기는 비활성화되었습니다."
          : "기기 상태를 확인해 주세요.";

  const requestStaffPin = async () => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    const displayName = pinRequestForm.displayName.trim();
    const pin = pinRequestForm.pin.trim();
    if (!displayName || !/^\d{4,8}$/.test(pin)) {
      setPinRequestMsg("이름과 4~8자리 숫자 PIN을 입력해주세요.");
      return;
    }
    if (pin !== pinRequestForm.pinConfirm.trim()) {
      setPinRequestMsg("PIN 확인이 일치하지 않습니다.");
      return;
    }
    setPinRequestMsg("");
    try {
      const res = await fetch("/api/staff/pins/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: sid,
          displayName,
          contactHint: pinRequestForm.contactHint,
          pin,
          requestedRole: pinRequestForm.requestedRole,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "PIN 등록 요청 실패");
      setPinRequestMsg("요청 완료. 관리자 승인 후 사용 가능합니다.");
      setPinRequestForm({ displayName: "", contactHint: "", pin: "", pinConfirm: "", requestedRole: "staff" });
    } catch (e: unknown) {
      setPinRequestMsg(e instanceof Error ? e.message : String(e));
    }
  };

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
  const [cancelTarget, setCancelTarget] = useState<{ id: string; displayNo: string; status: OrderStatus } | null>(null);

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

  const emptyListCopy = useMemo(() => {
    if (staffViewMode === "simple") {
      return listTab === "completed"
        ? { title: "오늘 완료된 주문이 없습니다", description: "완료 및 취소된 주문을 이곳에서 확인할 수 있습니다." }
        : { title: "현재 진행 중인 주문이 없습니다", description: "새 주문이 들어오면 이곳에 바로 표시됩니다." };
    }
    if (stationTab === "order") return { title: "현재 접수할 주문이 없습니다", description: "새 주문이 들어오면 이곳에 바로 표시됩니다." };
    if (stationTab === "make") return { title: "제조 대기 중인 메뉴가 없습니다", description: "접수된 주문의 제조를 시작하면 이곳에 표시됩니다." };
    if (stationTab === "ready") return { title: "준비 확인할 주문이 없습니다", description: "제조가 완료된 메뉴가 이곳에 표시됩니다." };
    return { title: "오늘 완료된 주문이 없습니다", description: "완료 및 취소된 주문을 이곳에서 확인할 수 있습니다." };
  }, [listTab, staffViewMode, stationTab]);

  const statusButtonLabelForView = (s: OrderStatus) => {
    if (staffViewMode === "simple") {
      if (s === "new") return "주문 확인";
      if (s === "checked" || s === "making") return "제조 완료";
      if (s === "ready_for_packing") return "전달 완료";
    }
    return statusButtonLabel(s);
  };

  const statusActionIcon = (s: OrderStatus): StaffIconName => {
    if (staffViewMode !== "simple" && s === "checked") return "play";
    if (s === "ready_for_packing") return "package-check";
    return "check";
  };

  const nextStatusForView = (s: OrderStatus): OrderStatus => {
    if (staffViewMode !== "simple") return nextStatus(s);
    if (s === "new") return "checked";
    if (s === "checked" || s === "making") return "ready_for_packing";
    if (s === "ready_for_packing") return "completed";
    return s;
  };

  const advanceOrder = async (order: OrderRecord) => {
    if (!requireWorkerPin()) return;
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

  const cancelRequiresManagerPin = (order: OrderRecord) =>
    loginRole === "staff" && !(order.status === "new" || order.status === "checked");

  const openCancelModal = (order: OrderRecord) => {
    const needsManagerPin = cancelRequiresManagerPin(order);
    setCancelTarget({ id: order.id, displayNo: order.displayNo, status: order.status });
    setCancelNeedsManagerPin(needsManagerPin);
    setCancelMsg("");
  };

  const closeCancelModal = () => {
    setCancelTarget(null);
    setCancelReason("고객 요청");
    setManagerPinForCancel("");
    setCancelNeedsManagerPin(false);
    setCancelMsg("");
    setCancelSubmitting(false);
  };

  const confirmCancelOrder = async () => {
    if (!cancelTarget || cancelSubmitting) return;
    const id = cancelTarget.id;
    const sid = storeIdRef.current || storeId;
    if (!sid) return;
    if (cancelNeedsManagerPin && !managerPinForCancel.trim()) {
      setCancelMsg("매니저 PIN을 입력하세요.");
      return;
    }
    try {
      setCancelSubmitting(true);
      setCancelMsg("");
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: "staff",
          storeId: sid,
          orderId: id,
          reason: cancelReason || "매장 주문 취소",
          actorPinId: actorPinIdForEvent,
          managerPin: managerPinForCancel || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        if (json?.code === "MANAGER_PIN_REQUIRED" || json?.code === "MANAGER_PIN_INVALID") {
          setCancelTarget({ id, displayNo: cancelTarget.displayNo, status: cancelTarget.status });
          setCancelNeedsManagerPin(true);
          setCancelMsg(String(json?.code === "MANAGER_PIN_REQUIRED" ? "제조 이후 취소는 매니저 PIN이 필요합니다." : json?.message || "매니저 PIN을 확인하세요."));
          return;
        }
        const friendlyCancelMessage: Record<string, string> = {
          PG_CANCEL_FAILED: "결제 취소에 실패했습니다. 관리자 확인이 필요합니다.",
          PAYMENT_IDENTIFIER_MISSING: "결제 정보를 찾지 못했습니다. 관리자 확인이 필요합니다.",
          PG_SECRET_MISSING: "결제 취소 설정이 필요합니다.",
        };
        throw new Error(String(friendlyCancelMessage[String(json?.code || "")] || json?.message || "주문 취소 처리 실패"));
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: "cancelled" } : o))
      );
      closeCancelModal();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCancelMsg(`취소 실패: ${msg}`);
    } finally {
      setCancelSubmitting(false);
    }
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

  const waitingItemIdsForBatch = useMemo(
    () => makeGroups.filter((g) => g.status === "waiting").flatMap((g) => g.itemIds),
    [makeGroups]
  );
  const makingItemIdsForBatch = useMemo(
    () => makeGroups.filter((g) => g.status === "making").flatMap((g) => g.itemIds),
    [makeGroups]
  );

  const makeGroupsByCategory = useMemo(() => {
    const grouped = new Map<string, typeof makeGroups>();
    for (const g of makeGroups) {
      const key = g.categoryName || "미분류";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(g);
    }
    return [...grouped.entries()];
  }, [makeGroups]);

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

    try {
      const res = await fetch("/api/orders/items/packing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: sid,
          orderId: order.id,
          itemIds: targets.map((it) => it.id),
          checked: nextChecked,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "준비 확인 저장 실패"));
      }
      fetchOrdersFromDb(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(`준비 확인 실패: ${msg}`);
    }
  };

  const canAdvanceSelected =
    !!selected &&
    !(selected.status === "completed" || selected.status === "cancelled" || (prepayAddonActive && selected.paymentStatus === "pending" && selected.status === "new"));
  const canCancelSelected = !!selected && !(selected.status === "completed" || selected.status === "cancelled");

  const updateOrderInDb = async (id: string, patch: Partial<OrderRecord>) => {
    const sid = storeIdRef.current || storeId;
    if (!sid) return;

    if (!requireWorkerPin()) return;
    const payload: Record<string, unknown> = { storeId: sid, orderId: id };
    if (actorPinIdForEvent) payload.actorPinId = actorPinIdForEvent;
    if (typeof patch.buzzerNo !== "undefined") payload.buzzerNo = patch.buzzerNo || null;
    if (typeof patch.status !== "undefined") payload.status = patch.status;
    if (typeof patch.paymentStatus !== "undefined") payload.paymentStatus = patch.paymentStatus;

    if (Object.keys(payload).length <= 2) return;

    try {
      const res = await fetch("/api/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "주문 상태 저장 실패"));
      }
      setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[staff] update order error:", msg);
      setErrMsg(`저장 실패: ${msg}`);
    }
  };

  const updateOrderItemsInDb = async (itemIds: string[], patch: { status?: ItemStatus; batch?: number }) => {
    const sid = storeIdRef.current || storeId;
    if (!sid || !itemIds.length) return;
    if (!requireWorkerPin()) return;
    if (typeof patch.status === "undefined") return;

    try {
      const res = await fetch("/api/orders/items/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: sid,
          itemIds,
          status: patch.status,
          batch: typeof patch.batch === "undefined" ? null : patch.batch,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "아이템 상태 저장 실패"));
      }
      fetchOrdersFromDb(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(`아이템 저장 실패: ${msg}`);
    }
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

        .staffToolbar {
          margin-top: 10px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px 14px;
          width: 100%;
          padding: 12px;
          border: 1px solid var(--line);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.78);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .contextLine {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .contextLabel {
          color: #64748b;
          font-size: 12px;
          font-weight: 950;
        }

        .storeBadge {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 5px 10px;
          font-size: 13px;
          font-weight: 950;
          line-height: 1;
        }

        .deviceNotice {
          margin-top: 10px;
          display: inline-flex;
          align-items: center;
          border: 1px solid #fde68a;
          border-radius: 999px;
          background: #fffbeb;
          color: #92400e;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 900;
        }

        .workerInfo {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .workerLabel {
          color: #64748b;
          font-weight: 950;
          font-size: 12px;
          letter-spacing: -0.01em;
        }

        .workerBadge {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          border-radius: 999px;
          padding: 5px 10px;
          border: 1px solid transparent;
          font-weight: 950;
          font-size: 13px;
          line-height: 1;
          letter-spacing: -0.01em;
        }

        .workerBadgeOwner {
          background: #111827;
          border-color: #111827;
          color: #fff;
        }

        .workerBadgeManager {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
        }

        .workerBadgeStaff {
          background: #f1f5f9;
          border-color: #cbd5e1;
          color: #334155;
        }

        .workerBadgePending {
          background: #fffbeb;
          border-color: #fde68a;
          color: #92400e;
        }

        .workerActions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-left: auto;
        }

        .workerActionBtn {
          min-height: 32px;
          padding: 7px 10px;
          border-radius: 11px;
          font-size: 12px;
        }

        .modalBackdrop {
          position: fixed;
          inset: 0;
          z-index: 80;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(17, 24, 39, 0.48);
        }

        .pinModal {
          width: min(420px, 100%);
          border-radius: 20px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.25);
          padding: 18px;
        }

        .pinModalTextInput,
        .modalInput,
        .modalSelect,
        .pinModalInput {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fff;
          color: var(--text);
          padding: 14px;
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.12em;
        }

        .pinModalTextInput,
        .modalInput,
        .modalSelect {
          margin-top: 8px;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0;
        }

        .modalFieldLabel {
          font-size: 13px;
          font-weight: 900;
          color: var(--text);
        }

        .successMsg {
          margin: 8px 0 0;
          color: #047857;
          font-weight: 900;
        }

        .pinModalActions {
          margin-top: 12px;
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
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
          display: flex;
          align-items: center;
          justify-content: flex-end;
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
          margin: 6px 0 0 0;
          color: var(--muted);
          font-size: 11px;
          line-height: 1.4;
          font-weight: 400;
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

        .statusPillMini {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 999px;
          line-height: 1.2;
        }

        .readyItemNameWrap {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          flex-wrap: wrap;
        }

        .readyItemOptionDesktop {
          display: none;
          min-width: 0;
          color: var(--muted);
        }

        .readyItemOptionMobile {
          margin: 0;
          flex: 1 1 220px;
          min-width: 0;
        }

        @media (min-width: 900px) {
          .readyItemSubRow {
            align-items: flex-start;
          }
          .readyItemOption {
            flex: 0 1 52%;
            margin-left: auto;
            text-align: right;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .readyItemOptionDesktop {
            display: inline;
            white-space: normal;
            overflow-wrap: anywhere;
            line-height: 1.35;
          }
          .readyItemOptionMobile {
            display: none;
          }
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

          .staffToolbar {
            margin-top: 8px;
            grid-template-columns: 1fr;
            padding: 10px;
            gap: 8px;
            border-radius: 16px;
          }

          .contextLine {
            gap: 6px;
          }

          .deviceNotice {
            margin-top: 8px;
            border-radius: 12px;
          }

          .workerLabel {
            font-size: 11px;
          }

          .workerBadge {
            min-height: 26px;
            padding: 5px 9px;
            font-size: 12px;
          }

          .workerActions {
            gap: 5px;
          }

          .workerActionBtn {
            min-height: 30px;
            padding: 6px 9px;
            font-size: 11px;
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
            justify-content: flex-start;
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

        /* RION Order Staff visual system */
        :root {
          --bg: #f3f6fb;
          --card: #ffffff;
          --text: #14213d;
          --muted: #667085;
          --line: #e4e9f2;
          --brand: #0f1f3d;
          --brand-blue: #2563eb;
          --brand-soft: #eef4ff;
          --danger: #dc2626;
          --radius: 22px;
        }

        body {
          background:
            radial-gradient(circle at 6% 0%, rgba(37, 99, 235, 0.07), transparent 28rem),
            var(--bg);
        }

        .wrap {
          max-width: 1240px;
          padding: 24px 24px 40px;
        }

        .topbar {
          padding: 18px 20px 20px;
          border: 1px solid rgba(228, 233, 242, 0.92);
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 18px 50px rgba(30, 55, 90, 0.08);
          backdrop-filter: blur(12px);
        }

        .titleBlock { gap: 16px; }

        .titleTop {
          padding-bottom: 15px;
          border-bottom: 1px solid var(--line);
        }

        .brandArea {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .workspaceBadge {
          display: inline-flex;
          align-items: center;
          min-height: 25px;
          padding: 5px 9px;
          border: 1px solid #cbd8ea;
          border-radius: 999px;
          background: #f6f8fc;
          color: #36506f;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.08em;
          white-space: nowrap;
        }

        .pageIntro { display: grid; gap: 5px; }

        .pageEyebrow {
          color: var(--brand-blue);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.1em;
        }

        .h1 {
          color: var(--brand);
          font-size: 32px;
          letter-spacing: -0.045em;
        }

        .pageDesc {
          margin: 0;
          color: var(--muted);
          font-size: 14px;
          font-weight: 650;
          line-height: 1.55;
          word-break: keep-all;
        }

        .topActions { gap: 7px; }

        .btn {
          min-height: 42px;
          border-color: #d9e1ed;
          color: var(--text);
          font-family: inherit;
          box-shadow: 0 1px 2px rgba(15, 31, 61, 0.03);
          transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease, transform 0.08s ease;
        }

        .btn:hover { border-color: #aebdd2; background: #f8faff; }
        .btn:active { transform: translateY(1px); }
        .btn:focus-visible, .actionBtn:focus-visible, .chip:focus-visible, .backBtn:focus-visible {
          outline: 3px solid rgba(37, 99, 235, 0.28);
          outline-offset: 2px;
        }

        .btnPrimary { background: var(--brand); border-color: var(--brand); color: #fff; }
        .btnPrimary:hover { background: #17345e; border-color: #17345e; }

        .staffToolbar {
          margin-top: 0;
          grid-template-columns: minmax(0, 1fr) minmax(320px, auto);
          align-items: stretch;
          padding: 0;
          overflow: hidden;
          border-color: #dfe6f0;
          border-radius: 18px;
          background: #f8faff;
          box-shadow: none;
        }

        .contextLine {
          padding: 13px 14px;
          gap: 11px;
        }

        .contextItem { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
        .contextItem strong { overflow: hidden; color: var(--brand); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
        .contextKey { color: #75849a; font-size: 11px; font-weight: 900; white-space: nowrap; }
        .contextDivider { width: 1px; height: 26px; background: #dfe6f0; }

        .workerBadge { min-height: 27px; padding: 5px 9px; }
        .workerActionBtn { min-height: 34px; margin-left: auto; border-radius: 10px; }

        .modeRow {
          display: grid;
          grid-template-columns: auto auto;
          justify-content: end;
          align-content: center;
          padding: 10px 12px;
          border-left: 1px solid #dfe6f0;
          background: #fff;
        }

        .modeLabel { color: #75849a; font-size: 11px; font-weight: 900; }

        .modeSwitch { border-color: #dbe3ef; background: #f3f6fb; }

        .modeSwitchBtn {
          min-height: 34px;
          color: #52637a;
          font-size: 12px;
        }

        .modeSwitchBtnOn {
          background: var(--brand);
          color: #fff;
          box-shadow: 0 4px 12px rgba(15, 31, 61, 0.22);
        }

        .modeDescription {
          grid-column: 1 / -1;
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 10px;
          font-weight: 700;
          text-align: right;
          white-space: nowrap;
        }

        .deviceNotice {
          width: 100%;
          margin-top: 12px;
          border-radius: 14px;
          padding: 10px 12px;
        }

        .tabsRow {
          margin-top: 18px;
          padding: 5px;
          border: 1px solid #dfe6f0;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 0 8px 24px rgba(30, 55, 90, 0.05);
        }

        .tabs { width: 100%; margin-top: 0; gap: 5px; }

        .chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 44px;
          border-color: transparent;
          background: transparent;
          color: #52637a;
          font-family: inherit;
          font-size: 14px;
          transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
        }

        .chip:hover { background: #f3f6fb; }
        .chipOn { border-color: #dbe6f8; background: var(--brand-soft); color: #1d4ed8; box-shadow: none; }

        .tabCount {
          display: inline-grid;
          min-width: 23px;
          height: 23px;
          place-items: center;
          border-radius: 999px;
          background: #e7edf6;
          color: #52637a;
          padding: 0 6px;
          font-size: 11px;
          font-weight: 950;
        }

        .chipOn .tabCount { background: #2563eb; color: #fff; }
        .tabHint { margin: 8px 5px 0; color: #75849a; font-size: 12px; font-weight: 650; }

        .newOrderPopup {
          margin-top: 12px;
          border-color: #b9d3ff;
          border-radius: 18px;
          padding: 13px 14px;
          background: linear-gradient(135deg, #edf5ff, #f8fbff);
          box-shadow: 0 10px 28px rgba(37, 99, 235, 0.1);
        }

        .newOrderPopupContent { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; }
        .newOrderDot { width: 10px; height: 10px; border-radius: 999px; background: #2563eb; box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.12); }
        .newOrderPopupTitle { color: #1d4ed8; font-size: 12px; }
        .newOrderPopupText { margin-top: 2px; color: var(--brand); font-size: 17px; font-weight: 950; }

        .panel { gap: 18px; }

        .card {
          border-color: #dfe6f0;
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 12px 34px rgba(30, 55, 90, 0.07);
        }

        .cardEmpty { min-height: 280px; }

        .cardTitle { color: var(--brand); font-size: 21px; letter-spacing: -0.025em; }

        .itemBtn {
          padding: 14px;
          border-color: #e1e7f0;
          border-radius: 16px;
          box-shadow: 0 3px 10px rgba(30, 55, 90, 0.035);
        }

        .itemBtn:hover { border-color: #aebed4; box-shadow: 0 8px 22px rgba(30, 55, 90, 0.08); }
        .itemBtnOn { border: 2px solid #4c82d8; background: #f8fbff; box-shadow: 0 10px 26px rgba(37, 99, 235, 0.12); }
        .bigNo { color: var(--brand); font-size: 21px; letter-spacing: -0.025em; }

        .elapsedBadge { border-color: #f5d98e; background: #fff8e6; }
        .badge { border-color: #dfe6f0; }
        .badgeHot { border-color: #bfdbfe; background: #eff6ff; color: #1d4ed8; }

        .quickActionBtn {
          min-height: 38px;
          border-color: #d9e1ed;
          padding: 8px 13px;
          color: var(--text);
          font-family: inherit;
        }

        .quickActionBtnPrimary { border-color: var(--brand-blue); background: var(--brand-blue); color: #fff; }

        .detailBox, .orderItemsBox {
          border-color: #dfe6f0;
          border-radius: 16px;
        }

        .actionBtn {
          min-height: 48px;
          border-color: #d9e1ed;
          color: var(--text);
          font-family: inherit;
        }

        .actionPrimary { background: var(--brand-blue); border-color: var(--brand-blue); }
        .actionCancel { background: #fff8f8; border-color: #fecaca; color: var(--danger); }
        .actionBtn:disabled, .btn:disabled, .quickActionBtn:disabled { cursor: not-allowed; box-shadow: none; }

        .pinModal, .modalCard {
          border-color: #dfe6f0;
          border-radius: 22px;
          box-shadow: 0 28px 80px rgba(15, 31, 61, 0.24);
        }

        .pinModal { padding: 22px; }
        .modalCard { padding: 20px; }

        .pinModalTextInput, .modalInput, .modalSelect, .pinModalInput, .buzzerInput {
          border-color: #ced8e6;
          outline: none;
        }

        .pinModalTextInput:focus, .modalInput:focus, .modalSelect:focus, .pinModalInput:focus, .buzzerInput:focus {
          border-color: #4c82d8;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.13);
        }

        @media (min-width: 901px) {
          .tabs .chip { flex: 1 1 0; }
          .panel { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); }
        }

        @media (max-width: 900px) {
          .wrap { padding: 12px 12px 28px; }
          .topbar { padding: 11px 12px 12px; border-radius: 18px; }
          .titleBlock { gap: 9px; }
          .titleTop { min-height: 38px; padding-bottom: 8px; gap: 8px; }
          .brandArea { gap: 7px; }
          .workspaceBadge, .pageIntro { display: none; }
          .topActions { gap: 6px; }
          .btn.topActionBtn { min-height: 36px; padding: 7px 10px; font-size: 11px; }
          .staffToolbar { grid-template-columns: 1fr; border-radius: 13px; }
          .contextLine { flex-wrap: nowrap; padding: 8px 9px; gap: 7px; }
          .contextKey, .contextDivider { display: none; }
          .contextItem { min-width: 0; }
          .contextItem:first-child { flex: 1 1 auto; overflow: hidden; }
          .contextItem:first-child::after { content: "·"; margin-left: 7px; color: #a0aec0; }
          .contextItem strong { font-size: 13px; }
          .workerBadge { min-height: 25px; padding: 4px 8px; font-size: 11px; white-space: nowrap; }
          .workerActionBtn { min-height: 34px; margin-left: auto; padding: 6px 9px; font-size: 11px; white-space: nowrap; }
          .modeRow { display: block; padding: 7px; border-top: 1px solid #dfe6f0; border-left: 0; }
          .modeLabel, .modeDescription { display: none; }
          .modeSwitch { display: flex; width: 100%; padding: 3px; }
          .modeSwitchBtn { flex: 1; min-height: 34px; }
          .tabsRow { margin-top: 8px; }
          .tabHint { min-height: 0; margin-top: 5px; }
          .tabHint:empty { display: none; }
          .panel { margin-top: 9px; }
          .card { min-height: auto; }
          .cardEmpty { min-height: 190px; }
          .mobileHide { display: none !important; }
          .actionRow { display: none; }
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
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.98);
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
            z-index: 30;
            backdrop-filter: blur(4px);
          }
          .actionDockTriple { grid-template-columns: 1fr; }
          .dockSpacer { height: 96px; }
        }

        @media (max-width: 640px) {
          .wrap { padding: 10px 10px 28px; }
          .topbar { padding: 10px; border-radius: 17px; }
          .titleBlock { gap: 8px; }
          .titleTop { gap: 6px; padding-bottom: 7px; }
          .brandArea { gap: 6px; }
          .h1 { font-size: 27px; }
          .pageDesc { font-size: 13px; }
          .btn.topActionBtn { min-height: 36px; padding: 7px 8px; font-size: 11px; }
          .contextLine { padding: 7px 8px; gap: 5px; }
          .contextItem:first-child::after { margin-left: 5px; }
          .workerActionBtn { min-height: 34px; }
          .modeRow { padding: 6px; }
          .tabsRow { margin-top: 7px; padding: 4px; }
          .tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: visible; }
          .tabs .chip { min-width: 0; min-height: 44px; gap: 4px; padding: 7px 4px; font-size: 12px; }
          .tabs .chip:first-child:nth-last-child(2), .tabs .chip:first-child:nth-last-child(2) ~ .chip { grid-column: span 2; }
          .tabCount { min-width: 20px; height: 20px; padding: 0 5px; font-size: 10px; }
          .newOrderPopupContent { grid-template-columns: auto minmax(0, 1fr); }
          .newOrderPopupContent .itemQuickActions { grid-column: 1 / -1; width: 100%; gap: 8px; }
          .newOrderPopupContent .quickActionBtn { flex: 1; min-height: 44px; }
          .panel { margin-top: 12px; }
          .card { padding: 14px; border-radius: 18px; }
          .itemBtn { padding: 13px; }
          .bigNo { font-size: 20px; }
          .quickActionBtn { min-height: 42px; padding: 9px 12px; font-size: 13px; }
          .actionDock { border-radius: 18px; padding: 10px; }
          .actionBtn { min-height: 50px; }
          .pinModal, .modalCard { border-radius: 20px; }
        }

        @media (max-width: 390px) {
          .workspaceBadge { display: none; }
          .btn.topActionBtn { padding: 7px 6px; font-size: 10px; }
          .tabs .chip { font-size: 11px; }
        }

        /* Compact operational header and restrained RION signatures */
        .topbar { padding: 15px 17px 16px; }
        .titleBlock { gap: 10px; }
        .titleTop { min-height: 42px; padding-bottom: 10px; }
        .workspaceBadge { display: inline-flex; }
        .operationsLine {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 14px;
          min-width: 0;
        }
        .pageIntro { display: grid; gap: 2px; min-width: 105px; }
        .pageEyebrow { font-size: 9px; letter-spacing: .12em; }
        .h1 { font-size: 23px; line-height: 1.1; letter-spacing: -.04em; }
        .pageDesc { display: none; }
        .staffToolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          justify-items: end;
          gap: 7px;
          min-width: 0;
          padding: 0;
          overflow: visible;
          border: 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }
        .contextLine {
          min-width: 0;
          padding: 0;
          flex-wrap: nowrap;
          justify-content: flex-end;
          gap: 9px;
        }
        .contextKey { display: inline; color: #8290a3; font-size: 10px; }
        .contextDivider { display: block; height: 22px; }
        .contextItem:first-child { flex: 0 1 auto; overflow: hidden; }
        .contextItem:first-child::after { content: none; }
        .contextItem strong { max-width: 180px; font-size: 13px; }
        .workerActionBtn { min-height: 36px; margin-left: 0; padding: 7px 10px; }
        .modeRow {
          display: block;
          padding: 0;
          border: 0;
          background: transparent;
        }
        .modeLabel, .modeDescription { display: none; }
        .modeSwitch { display: flex; width: 190px; padding: 3px; }
        .modeSwitchBtn { flex: 1; min-height: 34px; padding: 6px 9px; }
        .staffIcon { width: 16px; height: 16px; flex: 0 0 auto; }
        .topActions { gap: 7px; }
        .btn.topActionBtn {
          min-height: 40px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 12px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.2;
          appearance: none;
        }
        .quickActionBtn, .actionBtn, .backBtn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .newOrderIcon {
          width: 34px;
          height: 34px;
          display: inline-grid;
          place-items: center;
          border-radius: 11px;
          background: #dceaff;
          color: var(--brand-blue);
        }
        .newOrderIcon .staffIcon { width: 19px; height: 19px; }
        .emptyStateIcon { width: 32px; height: 32px; margin-bottom: 4px; color: #4877ba; opacity: .82; }
        .tabsRow { margin-top: 10px; border-radius: 14px; }
        .chip { position: relative; border-radius: 10px; }
        .chip::after {
          content: "";
          position: absolute;
          right: 12px;
          bottom: 2px;
          left: 12px;
          height: 2px;
          border-radius: 999px;
          background: transparent;
        }
        .chipOn::after { background: var(--brand-blue); }
        .cardTitle { display: inline-flex; align-items: center; gap: 8px; }
        .cardTitle::before {
          content: "";
          width: 3px;
          height: 18px;
          flex: 0 0 auto;
          border-radius: 999px;
          background: linear-gradient(180deg, var(--brand), var(--brand-blue));
        }
        .emptyState {
          min-height: 150px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 6px;
          padding: 24px 12px;
          color: var(--muted);
          text-align: center;
        }
        .emptyStateMark {
          width: 28px;
          height: 3px;
          margin-bottom: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--brand), var(--brand-blue));
          opacity: .85;
        }
        .emptyState strong { color: var(--text); font-size: 15px; }
        .emptyState span { font-size: 12px; line-height: 1.5; word-break: keep-all; }
        .panel { margin-top: 10px; }

        @media (max-width: 1023px) {
          .topbar { padding: 13px 14px 14px; }
          .operationsLine { grid-template-columns: auto minmax(0, 1fr); gap: 12px; }
          .contextLine { gap: 7px; }
          .contextDivider { display: none; }
          .contextItem strong { max-width: 125px; }
          .workerBadge { max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
          .workerActionBtn { min-height: 34px; padding: 6px 8px; font-size: 10px; }
          .modeSwitch { width: 190px; }
          .modeSwitchBtn { font-size: 11px; }
        }

        @media (max-width: 767px) {
          .topbar { padding: 10px 11px 11px; }
          .titleBlock { gap: 8px; }
          .titleTop { min-height: 38px; padding-bottom: 7px; }
          .workspaceBadge { display: none; }
          .operationsLine { grid-template-columns: 1fr; gap: 7px; }
          .pageIntro { display: grid; min-width: 0; }
          .pageEyebrow { display: block; font-size: 8px; }
          .h1 { font-size: 20px; }
          .staffToolbar { width: 100%; justify-items: stretch; gap: 7px; }
          .contextLine {
            justify-content: flex-start;
            padding: 7px 0 0;
            border-top: 1px solid var(--line);
            gap: 6px;
          }
          .contextItem:first-child { flex: 1 1 auto; }
          .contextItem strong { max-width: 120px; }
          .workerActionBtn { margin-left: auto; white-space: nowrap; }
          .modeRow { padding-top: 0; }
          .modeSwitch { width: 100%; }
          .modeSwitchBtn { min-height: 36px; }
          .tabsRow { margin-top: 7px; }
          .emptyState { min-height: 120px; padding: 18px 10px; }
          .panel { margin-top: 8px; }
        }

        @media (max-width: 430px) {
          .btn.topActionBtn { min-height: 38px; padding: 8px 8px; font-size: 11px; }
          .btn.topActionBtn .staffIcon { width: 14px; height: 14px; }
          .contextLine { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
          .contextItem:first-child { grid-column: 1; }
          .contextItem:last-of-type { grid-column: 1; }
          .workerActionBtn { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
          .contextItem strong, .workerBadge { max-width: 160px; }
        }

      `}</style>

      <header className="topbar">
        <div className="titleBlock">
          <div className="titleTop">
            <div className="brandArea">
              <RionBrand product staff />
              <span className="workspaceBadge">STORE STAFF</span>
            </div>

            <div className="topActions">
              <button
                type="button"
                className="btn topActionBtn"
                aria-label="관리자 홈으로 이동"
                onClick={() =>
                  (window.location.href = storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")
                }
              >
                <StaffIcon name="home" />
                <span>관리자 홈</span>
              </button>
              <a className="btn topActionBtn" href="/logout" aria-label="로그아웃">
                <StaffIcon name="logout" />
                <span>로그아웃</span>
              </a>
            </div>
          </div>

          <div className="operationsLine">
            <div className="pageIntro">
              <span className="pageEyebrow">ORDER OPERATIONS</span>
              <h1 className="h1">주문 운영</h1>
            </div>

            <div className="staffToolbar" aria-label="직원 화면 운영 정보">
              <div className="contextLine" aria-label="매장과 담당 직원">
                <span className="contextItem">
                  <span className="contextKey">매장</span>
                  <strong>{storeDisplayName}</strong>
                </span>
                <span className="contextDivider" aria-hidden="true" />
                <span className="contextItem">
                  <span className="contextKey">담당</span>
                  <span className={workerBadgeClass}>{workerRoleText}</span>
                </span>
                <button type="button" className="btn workerActionBtn" onClick={() => setWorkerPinModalOpen(true)}>{workerChangeLabel}</button>
              </div>

              <div className="modeRow">
                <div className="modeSwitch" role="group" aria-label="운영 방식 전환">
                  <button
                    type="button"
                    className={`modeSwitchBtn ${staffViewMode === "simple" ? "modeSwitchBtnOn" : ""}`}
                    aria-pressed={staffViewMode === "simple"}
                    onClick={() => updateStaffViewMode("simple")}
                  >
                    기본 운영
                  </button>
                  <button
                    type="button"
                    className={`modeSwitchBtn ${staffViewMode === "station" ? "modeSwitchBtnOn" : ""}`}
                    aria-pressed={staffViewMode === "station"}
                    onClick={() => updateStaffViewMode("station")}
                  >
                    분업 운영
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ✅ 최초 로드에서만 표시 */}
          {initialLoading ? <p className="muted" style={{ margin: "8px 0 0" }}>불러오는 중...</p> : null}

          {errMsg ? <p className="err">오류: {errMsg}</p> : null}
        </div>
      </header>

      {deviceStatus !== "approved" && deviceStatus !== "owner_bypass" && deviceStatus !== "setup_required" ? (
        <div className="deviceNotice" role="status">{deviceNoticeText}</div>
      ) : null}

      {workerPinModalOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="직원 PIN">
          <div className="pinModal">
            <h2 className="h2" style={{ marginTop: 0 }}>직원 PIN</h2>
            <p className="muted">담당 직원 확인이 필요합니다.</p>
            <input
              className="pinModalInput"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN"
              inputMode="numeric"
              autoFocus
            />
            {pinMsg ? <p className="err">{pinMsg}</p> : null}
            <div className="pinModalActions">
              {currentWorker && !currentWorker.isOwnerBypass ? <button className="btn" onClick={() => { setCurrentWorker(null); setPinMsg("담당이 해제되었습니다."); }}>담당 해제</button> : null}
              {loginRole === "owner" ? <button className="btn" onClick={() => setWorkerPinModalOpen(false)}>관리자로 계속</button> : null}
              <button className="btn btnPrimary" onClick={() => verifyWorkerPin("staff")}>확인</button>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>처음 사용하시나요?</p>
            <button type="button" className="btn" onClick={() => { setPinRequestOpen(true); setPinRequestMsg(""); }}>신규 PIN 등록</button>
          </div>
        </div>
      ) : null}

      {pinRequestOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="신규 PIN 등록">
          <div className="pinModal">
            <h2 className="h2" style={{ marginTop: 0 }}>신규 PIN 등록</h2>
            <p className="muted">사용할 PIN을 요청합니다. 관리자 승인 후 사용 가능합니다.</p>
            <input className="pinModalTextInput" value={pinRequestForm.displayName} onChange={(e) => setPinRequestForm((prev) => ({ ...prev, displayName: e.target.value }))} placeholder="이름" />
            <input className="pinModalTextInput" value={pinRequestForm.contactHint} onChange={(e) => setPinRequestForm((prev) => ({ ...prev, contactHint: e.target.value }))} placeholder="연락처 뒷번호/메모" />
            <select className="pinModalTextInput" value={pinRequestForm.requestedRole} onChange={(e) => setPinRequestForm((prev) => ({ ...prev, requestedRole: e.target.value === "manager" ? "manager" : "staff" }))}>
              <option value="staff">직원</option>
              <option value="manager">매니저</option>
            </select>
            <input className="pinModalInput" value={pinRequestForm.pin} onChange={(e) => setPinRequestForm((prev) => ({ ...prev, pin: e.target.value }))} placeholder="4~8자리 PIN" inputMode="numeric" />
            <input className="pinModalInput" value={pinRequestForm.pinConfirm} onChange={(e) => setPinRequestForm((prev) => ({ ...prev, pinConfirm: e.target.value }))} placeholder="PIN 확인" inputMode="numeric" />
            {pinRequestMsg ? <p className={pinRequestMsg.includes("완료") ? "successMsg" : "err"}>{pinRequestMsg}</p> : null}
            <div className="pinModalActions">
              <button type="button" className="btn" onClick={() => setPinRequestOpen(false)}>닫기</button>
              <button type="button" className="btn btnPrimary" onClick={requestStaffPin}>등록 요청</button>
            </div>
          </div>
        </div>
      ) : null}

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
              <span>진행 중</span><span className="tabCount">{counts.active}</span>
            </button>
            <button
              className={`chip ${listTab === "completed" ? "chipOn" : ""}`}
              onClick={() => {
                setListTab("completed");
                setMobileView("list");
              }}
            >
              <span>완료</span><span className="tabCount">{counts.completed}</span>
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
              <span>접수</span><span className="tabCount">{stationCounts.order}</span>
            </button>
            <button
              className={`chip ${stationTab === "make" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("make");
                setMobileView("list");
              }}
            >
              <span>제조</span><span className="tabCount">{stationCounts.make}</span>
            </button>
            <button
              className={`chip ${stationTab === "ready" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("ready");
                setMobileView("list");
              }}
            >
              <span>준비</span><span className="tabCount">{stationCounts.ready}</span>
            </button>
            <button
              className={`chip ${stationTab === "history" ? "chipOn" : ""}`}
              onClick={() => {
                setStationTab("history");
                setMobileView("list");
              }}
            >
              <span>완료</span><span className="tabCount">{stationCounts.history}</span>
            </button>
          </div>
        </div>
      )}
      {modeToast ? <p className="modeToast">{modeToast}</p> : null}
      {newOrderPopup ? (
        <div className="newOrderPopup" role="alert" aria-live="assertive">
          <div className="newOrderPopupContent">
            <span className="newOrderIcon" aria-hidden="true"><StaffIcon name="bell" /></span>
            <div>
              <div className="newOrderPopupTitle">새 주문이 도착했어요</div>
              <div className="newOrderPopupText">주문번호 {newOrderPopup.displayNo}</div>
            </div>
            <div className="itemQuickActions" style={{ marginTop: 0 }}>
              <button type="button" className="quickActionBtn quickActionBtnPrimary" onClick={moveToOrderCheckTab}>주문 확인</button>
              <button type="button" className="quickActionBtn" onClick={() => setNewOrderPopup(null)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="panel">
        <section className={`card ${filteredOrders.length === 0 ? "cardEmpty" : ""} ${mobileView === "detail" ? "mobileHide" : ""}`}>
          <div className="cardTitleRow">
            <h2 className="cardTitle">{listTitle}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="badge">{filteredOrders.length}건</span>
              {staffViewMode === "station" && stationTab === "make" ? (
                <button
                  type="button"
                  className="quickActionBtn quickActionBtnPrimary"
                  onClick={() => updateOrderItemsInDb(waitingItemIdsForBatch, { status: "making", batch: nextBatch })}
                  disabled={waitingItemIdsForBatch.length === 0}
                  style={{ opacity: waitingItemIdsForBatch.length ? 1 : 0.45 }}
                >
                  <StaffIcon name="play" /> 제조 시작
                </button>
              ) : null}
            </div>
          </div>

          {!storeId ? (
            <p className="muted">매장이 선택되지 않았습니다. 관리자에서 매장을 선택하고 다시 들어와 주세요.</p>
          ) : staffViewMode === "station" && stationTab === "make" ? (
            makeGroups.length === 0 ? (
              <div className="emptyState">
                <StaffIcon name="order" className="emptyStateIcon" />
                <strong>제조 대기 중인 메뉴가 없습니다</strong>
                <span>접수된 주문의 제조를 시작하면 이곳에 표시됩니다.</span>
              </div>
            ) : (
              <div className="list">
                {makeGroupsByCategory.map(([categoryName, rows]) => (
                  <div key={`make_cat_${categoryName}`} style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        padding: "6px 10px",
                        borderLeft: "4px solid #3b82f6",
                        background: "#eff6ff",
                        color: "#1e3a8a",
                        borderRadius: 8,
                      }}
                    >
                      {categoryName}
                    </div>
                    <div className="detailBox" style={{ display: "grid", gap: 0, padding: 0 }}>
                      {rows.map((g, idx) => (
                        <div
                          key={g.key}
                          style={{
                            padding: "10px 12px",
                            borderTop: idx === 0 ? "none" : "1px solid #e5e7eb",
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div className="rowBetween">
                            <div className="bigNo">{g.name} × {g.qty}</div>
                            {g.status === "making" ? (
                              <button
                                type="button"
                                className="quickActionBtn quickActionBtnPrimary"
                                onClick={() => updateOrderItemsInDb(g.itemIds, { status: "done" })}
                              >
                                <StaffIcon name="check" /> 제조 완료
                              </button>
                            ) : (
                              <span className="muted" style={{ fontWeight: 800 }}>대기</span>
                            )}
                          </div>
                          <div className="muted">
                            {g.batch > 0 ? `제조 순번 #${g.batch} · ` : ""}주문번호 {g.orderNos.join(", ")}
                          </div>
                          {g.optionLabel ? <div className="muted">옵션: {g.optionLabel}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="itemQuickActions" style={{ marginTop: 12, gap: 8 }}>
                  <button
                    type="button"
                    className="quickActionBtn quickActionBtnPrimary"
                    onClick={() => updateOrderItemsInDb(makingItemIdsForBatch, { status: "done" })}
                    disabled={makingItemIdsForBatch.length === 0}
                    style={{ opacity: makingItemIdsForBatch.length ? 1 : 0.45 }}
                  >
                    <StaffIcon name="check" /> 전체 제조 완료
                  </button>
                </div>
              </div>
            )
          ) : staffViewMode === "station" && stationTab === "ready" ? (
            readyOrders.length === 0 ? (
              <div className="emptyState">
                <StaffIcon name="order" className="emptyStateIcon" />
                <strong>준비 확인할 주문이 없습니다</strong>
                <span>제조가 완료된 메뉴가 이곳에 표시됩니다.</span>
              </div>
            ) : (
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

                      <div className="detailBox" style={{ marginTop: 10, display: "grid", gap: 0, padding: 0 }}>
                        {o.items.map((it) => {
                          const optText = buildOptionText(it);
                          const checked = !!it.packingChecked;
                          const isDone = it.status === "done";
                          const statusText = !isDone
                            ? it.status === "making"
                              ? "제조중"
                              : "제조대기"
                            : checked
                            ? "확인"
                            : "준비대기";
                          const statusClass = !isDone ? "badgeMaking" : checked ? "badgeDone" : "badgeChecked";
                          const showReadyAction = isDone && !checked;

                          return (
                            <div
                              key={`ready_item_${it.id}`}
                              style={{
                                padding: "10px 12px",
                                borderTop: o.items.findIndex((x) => x.id === it.id) === 0 ? "none" : "1px solid #e5e7eb",
                              }}
                            >
                              <div className="rowBetween">
                                <div className="readyItemNameWrap">
                                  {isDone && checked ? (
                                    <span className={`badge statusPill ${statusClass} statusPillMini`}>{statusText}</span>
                                  ) : null}
                                  <div style={{ fontWeight: 800 }}>{it.name} × {it.qty}</div>
                                  {optText ? <div className="readyItemOptionDesktop">{optText}</div> : null}
                                </div>
                                {isDone ? (
                                  <button
                                    type="button"
                                    className={checked ? "quickActionBtn" : "quickActionBtn quickActionBtnPrimary"}
                                    style={checked ? { minWidth: 60, borderColor: "#ef4444", color: "#b91c1c" } : { minWidth: 60 }}
                                    onClick={() => togglePackingChecks(o, !checked, it.id)}
                                  >
                                    {checked ? "취소" : "확인"}
                                  </button>
                                ) : (
                                  <span className={`badge statusPill ${statusClass}`}>{statusText}</span>
                                )}
                              </div>
                              {optText ? (
                                <div className="readyItemSubRow">
                                  {optText ? <div className="muted readyItemOption readyItemOptionMobile">{optText}</div> : null}
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
                          <StaffIcon name="check" /> 전체 확인
                        </button>
                        <button
                          type="button"
                          className="quickActionBtn quickActionBtnPrimary"
                          onClick={() => updateOrderInDb(o.id, { status: "completed" })}
                          disabled={!canCompleteOrder}
                          style={{ opacity: canCompleteOrder ? 1 : 0.45 }}
                        >
                          <StaffIcon name="package-check" /> 전달 완료
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : filteredOrders.length === 0 ? (
            <div className="emptyState">
              <StaffIcon name="order" className="emptyStateIcon" />
              <strong>{emptyListCopy.title}</strong>
              <span>{emptyListCopy.description}</span>
            </div>
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
                        {showNew ? <span className="badge badgeHot">신규</span> : null}
                      </div>
                      <div className="orderMetaRight">
                        <span className="elapsedBadge">{formatElapsedMin(o.createdAt)}</span>
                        <div className="muted">{formatTime(o.createdAt)}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <span className={`badge ${badgeClass}`}>{STATUS_LABEL[o.status]}</span>
                      <span className="badge">
                        {o.mode === "dine-in" ? `매장 · 테이블 ${o.table ?? "-"}` : "포장"}
                      </span>
                      <span className="badge">메뉴 {o.items.length}개</span>
                      <span className="badge">총 수량 {totalQty}</span>
                    </div>

                    <div className="rowBetween" style={{ marginTop: 8, gap: 10 }}>
                      <div className="muted" style={{ flex: 1, minWidth: 0 }}>
                        {o.items
                          .map((it) => `${it.name}×${it.qty}`)
                          .slice(0, 2)
                          .join(", ")}
                        {o.items.length > 2 ? "…" : ""}
                      </div>
                      {(staffViewMode === "simple" ? o.status === "new" : isActive(o.status)) ? (
                        <div className="itemQuickActions" style={{ marginTop: 0 }}>
                          <button
                            type="button"
                            className="quickActionBtn quickActionBtnPrimary"
                            aria-label={`주문번호 ${o.displayNo} ${statusButtonLabelForView(o.status)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              advanceOrder(o);
                            }}
                          >
                            <StaffIcon name={statusActionIcon(o.status)} />
                            {statusButtonLabelForView(o.status)}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className={`card ${!selected ? "cardEmpty" : ""} ${mobileView === "list" ? "mobileHide" : ""}`}>
          <div className="cardTitleRow">
            <h2 className="cardTitle">주문 상세</h2>
            <button
              className="backBtn"
              onClick={() => setMobileView("list")}
              style={{ display: mobileView === "detail" ? "inline-flex" : "none" }}
            >
              <StaffIcon name="arrow-left" />
              <span>주문 목록</span>
            </button>
          </div>

          {staffViewMode === "station" && (stationTab === "make" || stationTab === "ready") ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="detailBox">
                <div className="rowBetween">
                  <b>{stationTab === "make" ? "제조 진행 현황" : "준비 진행 현황"}</b>
                  <span className="badge">{stationTab === "make" ? makeGroups.length : readyOrders.length}건</span>
                </div>
              </div>

              {stationTab === "make" ? (
                <div className="detailBox" style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge">제조대기 {makeGroups.filter((g) => g.status === "waiting").length}건</span>
                    <span className="badge">제조중 {makeGroups.filter((g) => g.status === "making").length}건</span>
                  </div>
                  {makeGroups.map((g) => (
                    <div key={`panel_make_${g.key}`} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                      <div className="rowBetween">
                        <div style={{ fontWeight: 800 }}>{g.name} × {g.qty}</div>
                        <span className={`badge statusPill ${g.status === "waiting" ? "badgeChecked" : "badgeMaking"}`}>
                          {g.status === "waiting" ? "제조대기" : "제조중"}
                        </span>
                      </div>
                      <div className="muted" style={{ marginTop: 6 }}>
                        {g.batch > 0 ? `제조 순번 #${g.batch} · ` : ""}주문번호 {g.orderNos.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detailBox" style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge">준비 대상 {readyOrders.length}건</span>
                    <span className="badge">
                      준비확인 완료 {readyOrders.filter((o) => o.items.filter((it) => it.status === "done").every((it) => !!it.packingChecked)).length}건
                    </span>
                  </div>
                  {readyOrders.map((o) => {
                    const doneItems = o.items.filter((it) => it.status === "done");
                    const checkedCount = doneItems.filter((it) => !!it.packingChecked).length;
                    return (
                      <div key={`panel_ready_${o.id}`} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                        <div className="rowBetween">
                          <div style={{ fontWeight: 800 }}>주문번호 {o.displayNo}</div>
                          <span className="badge">준비 확인 {checkedCount}/{doneItems.length}</span>
                        </div>
                        <div className="muted" style={{ marginTop: 6 }}>
                          {o.items.map((it) => `${it.name}×${it.qty}`).slice(0, 2).join(", ")}
                          {o.items.length > 2 ? "…" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : !selected ? (
            <div className="detailBox" style={{ display: "grid", gap: 10 }}>
              <p className="muted">주문을 선택하세요.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">주문확인 {counts.active}건</span>
                <span className="badge">완료 {counts.completed}건</span>
                <span className="badge">전체 {counts.all}건</span>
              </div>
              {((staffViewMode === "simple" ? listTab !== "active" : stationTab !== "order") || (staffViewMode === "station" && stationTab !== "make")) ? (
                <div className="itemQuickActions">
                  {(staffViewMode === "simple" ? listTab !== "active" : stationTab !== "order") ? (
                    <button type="button" className="quickActionBtn quickActionBtnPrimary" onClick={moveToOrderCheckTab}>
                      접수 탭으로 이동
                    </button>
                  ) : null}
                  {staffViewMode === "station" && stationTab !== "make" ? (
                  <button type="button" className="quickActionBtn" onClick={() => setStationTab("make")}>
                    제조 탭 보기
                  </button>
                  ) : null}
                </div>
              ) : null}
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

              {(staffViewMode !== "station" || stationTab === "order" || stationTab === "history") ? (
                <>
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
                          <div
                            style={{
                              fontWeight: 900,
                              padding: "6px 10px",
                              borderLeft: "4px solid #3b82f6",
                              background: "#eff6ff",
                              color: "#1e3a8a",
                              borderRadius: 8,
                            }}
                          >
                            {categoryName}
                          </div>
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
                </>
              ) : null}

              {staffViewMode === "station" && (stationTab === "make" || stationTab === "ready") && !isCompleted(selected.status) ? (
                <div className="section">
                  <h3 className="sectionTitle">진행 현황</h3>
                  <div className="detailBox" style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className="badge">제조대기 {selected.items.filter((it) => it.status === "waiting").length}개</span>
                      <span className="badge">제조중 {selected.items.filter((it) => it.status === "making").length}개</span>
                      <span className="badge">제조완료 {selected.items.filter((it) => it.status === "done").length}개</span>
                      <span className="badge">
                        준비확인 {selected.items.filter((it) => it.status === "done" && !!it.packingChecked).length}개
                      </span>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      {selected.items.map((it, idx) => {
                        const optText = buildOptionText(it);
                        const statusText =
                          it.status === "waiting"
                            ? "제조대기"
                            : it.status === "making"
                            ? "제조중"
                            : it.packingChecked
                                    ? "확인"
                                    : "제조완료";
                        const statusClass =
                          it.status === "waiting"
                            ? "badgeChecked"
                            : it.status === "making"
                            ? "badgeMaking"
                            : it.packingChecked
                            ? "badgeDone"
                            : "badgeDone";

                        return (
                          <div key={`station_progress_${it.id}_${idx}`} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                            <div className="rowBetween">
                              <div style={{ fontWeight: 800 }}>{it.name} × {it.qty}</div>
                              <span className={`badge statusPill ${statusClass}`}>{statusText}</span>
                            </div>
                            {optText ? <div className="muted" style={{ marginTop: 6 }}>{optText}</div> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="actionRow">
                {staffViewMode !== "station" ? (
                  <>
                    <button
                      className="actionBtn actionPrimary"
                      onClick={() => advanceOrder(selected)}
                      disabled={!canAdvanceSelected}
                      style={{
                        opacity: canAdvanceSelected ? 1 : 0.5,
                      }}
                    >
                      <StaffIcon name={statusActionIcon(selected.status)} />
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
                  </>
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
                * 준비 완료: 고객 알림 · 전달 완료: 수령 완료
              </p>
            </>
          )}
        </section>
      </div>

      {selected && mobileView === "detail" ? (
        <div className={`actionDock ${prepayAddonActive && selected.paymentStatus === "pending" ? "actionDockTriple" : ""}`}>
          {staffViewMode !== "station" ? (
            <>
              <button
                className="actionBtn actionPrimary"
                onClick={() => advanceOrder(selected)}
                disabled={!canAdvanceSelected}
                style={{ opacity: canAdvanceSelected ? 1 : 0.5 }}
              >
                <StaffIcon name={statusActionIcon(selected.status)} />
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
            </>
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
            <h3 id="cancel-modal-title" className="modalTitle">주문 취소</h3>
            <p className="modalDesc">
              주문 {cancelTarget.displayNo}를 취소할까요?
              <br />
              취소 이력이 저장됩니다.
            </p>
            <label className="modalFieldLabel">취소 사유</label>
            <select className="modalSelect" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}>
              <option value="고객 요청">고객 요청</option>
              <option value="품절">품절</option>
              <option value="주문 오입력">주문 오입력</option>
              <option value="매장 사정">매장 사정</option>
              <option value="기타">기타</option>
            </select>
            {cancelMsg ? <p className="err">{cancelMsg}</p> : null}
            {cancelNeedsManagerPin ? (
              <>
                <p className="hint" style={{ marginTop: 8 }}>제조 이후 취소는 매니저 PIN이 필요합니다.</p>
                <label className="modalFieldLabel">매니저 PIN</label>
                <input className="modalInput" value={managerPinForCancel} onChange={(e) => setManagerPinForCancel(e.target.value.replace(/[^\d]/g, ""))} placeholder="매니저 PIN" inputMode="numeric" />
              </>
            ) : null}
            <div className="modalActions">
              <button type="button" className="btn" onClick={closeCancelModal} disabled={cancelSubmitting}>닫기</button>
              <button type="button" className="btn actionCancel" onClick={confirmCancelOrder} disabled={cancelSubmitting}>{cancelSubmitting ? "처리 중..." : "취소 처리"}</button>
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
