"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { maskToken } from "@/app/lib/billingSettings";

type OpsTab = "overview" | "stores" | "subscriptions" | "payments" | "tickets" | "settings";
type StoreStatus = "active" | "inactive" | "deleted" | "setup";
type StoreSort =
  | "risk"
  | "recentOrder"
  | "monthlyOrders"
  | "monthlyRevenue"
  | "expiring"
  | "openTickets";
type TicketStatusFilter =
  | "all"
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";
type TicketPriorityFilter = "all" | "urgent" | "high" | "normal" | "low";
type TicketCategoryFilter =
  | "all"
  | "billing"
  | "bug"
  | "improvement"
  | "inquiry"
  | "etc";

type StoreOpsRow = {
  store_id: string;
  store_name: string | null;
  status: StoreStatus;
  setup_completed: boolean;
  created_at: string | null;
  base_plan_status: string;
  paid_until: string | null;
  addon_status: string;
  addon_paid_until: string | null;
  monthly_revenue: number;
  paid_count: number;
  today_order_count: number;
  monthly_order_count: number;
  last_order_at: string | null;
  open_ticket_count: number;
  urgent_ticket_count: number;
  owner_user_id: string | null;
};

type StoreBaseRow = {
  store_id: string;
  store_name: string | null;
  status?: string | null;
  setup_completed?: boolean | null;
  created_at?: string | null;
};
type BillingBaseRow = {
  store_id: string;
  base_plan_status: string | null;
  paid_until: string | null;
};
type AddonBaseRow = {
  store_id: string;
  prepay_addon_status: string | null;
  addon_paid_until: string | null;
};
type PaymentBaseRow = {
  store_id: string;
  amount_krw: number | null;
  paid_at?: string | null;
  status?: string | null;
};
type RefundHistoryRow = {
  id: number | string;
  billing_payment_id: number;
  store_id: string;
  store_name: string | null;
  amount_krw: number;
  reason: string;
  status: string;
  public_error_code: string | null;
  internal_error: string | null;
  pg_status: string | null;
  requested_at: string;
  completed_at: string | null;
  source: "automatic" | "manual";
};
type RefundCaseRow = {
  id: number; billing_payment_id: number; store_id: string; store_name: string | null;
  support_ticket_id: number | null; reason: string; status: string; toss_status: string | null;
  toss_checked_at: string | null; local_payment_status: string | null; requested_at: string; completed_at: string | null;
};
type OrderBaseRow = {
  store_id: string | null;
  order_date: string | null;
  created_at: string | null;
  status: string | null;
};
type StoreMemberRow = {
  store_id: string | null;
  user_id: string | null;
  role: string | null;
};

type SupportTicketRow = {
  id: number;
  store_id: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  body: string | null;
  ops_note: string | null;
  created_at: string;
  updated_at: string;
};
type SavedPlatformPg = {
  mid: string;
  clientKey: string;
  hasSecret: boolean;
  updatedAt: string | null;
};
type StoreBenefit = {
  billingAccountId: number | null;
  ownerUserId: string | null;
  founderMember: boolean;
  founderBase: boolean;
  founderAddon: boolean;
  founderReason: string;
  founderDesignatedAt: string | null;
  storeSequence: number;
  baseStatus: string;
  trialEndAt: string | null;
  paidUntil: string | null;
};

type KpiSummary = {
  totalStores: number;
  activeStores: number;
  setupStores: number;
  paidStores: number;
  monthlyRevenue: number;
  monthlyPaidCount: number;
  monthlyOrders: number;
  orderActiveStores: number;
  expiringSoonStores: number;
  openTickets: number;
  inProgressTickets: number;
  urgentTickets: number;
  todayNewTickets: number;
  ownerAccounts: number;
};

const TABS: Array<{ id: OpsTab; label: string }> = [
  { id: "overview", label: "대시보드" },
  { id: "stores", label: "점주·매장" },
  { id: "subscriptions", label: "구독" },
  { id: "payments", label: "결제·환불" },
  { id: "tickets", label: "문의/장애" },
  { id: "settings", label: "시스템 설정" },
];

const ACTIVE_TICKET_STATUSES = new Set(["open", "in_progress"]);

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStartKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function fmtMoney(n: number) {
  return `${Math.round(n).toLocaleString()}원`;
}

function fmtDate(raw: string | null) {
  if (!raw) return "-";
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return raw;
  return new Date(t).toLocaleDateString("ko-KR");
}

function fmtDateTime(raw: string | null) {
  if (!raw) return "-";
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return raw;
  return new Date(t).toLocaleString("ko-KR", { hour12: false });
}

function shortId(raw: string | null) {
  if (!raw) return "미연결";
  return raw.length > 12 ? `${raw.slice(0, 8)}…${raw.slice(-4)}` : raw;
}

function remainingDays(raw: string | null) {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

function isExpiringSoon(raw: string | null) {
  const d = remainingDays(raw);
  return d != null && d >= 0 && d <= 7;
}

function isActiveTicket(status: string) {
  return ACTIVE_TICKET_STATUSES.has(status);
}

function ticketStatusLabel(status: string) {
  if (status === "open") return "접수";
  if (status === "in_progress") return "처리 중";
  if (status === "resolved") return "답변 완료";
  if (status === "closed") return "종료";
  return status || "-";
}

function ticketPriorityLabel(priority: string) {
  if (priority === "urgent") return "긴급";
  if (priority === "high") return "높음";
  if (priority === "normal") return "보통";
  if (priority === "low") return "낮음";
  return priority || "-";
}

function ticketCategoryLabel(category: string) {
  if (category === "billing") return "결제/구독";
  if (category === "bug") return "오류";
  if (category === "improvement") return "개선요청";
  if (category === "inquiry") return "문의";
  if (category === "etc") return "기타";
  return category || "-";
}

function refundStatusLabel(status: string) {
  if (status === "requested") return "요청됨";
  if (status === "processing") return "처리 중";
  if (status === "completed") return "취소 완료";
  if (status === "failed") return "취소 실패";
  if (status === "reconcile_required") return "확인 필요";
  return status || "-";
}

function refundCaseStatusLabel(status: string) {
  if (status === "requested") return "접수됨";
  if (status === "reviewing") return "검토 중";
  if (status === "approved") return "환불 승인";
  if (status === "rejected") return "환불 반려";
  if (status === "processing") return "처리 중";
  if (status === "completed") return "처리 완료";
  if (status === "reconcile_required") return "확인 필요";
  return "확인 필요";
}

function tossStatusLabel(status: string | null) {
  if (!status) return "조회 전";
  if (status === "DONE") return "결제 완료";
  if (status === "CANCELED") return "취소 완료";
  if (status === "PARTIAL_CANCELED") return "부분 취소";
  if (status === "IN_PROGRESS") return "결제 처리 중";
  if (status === "WAITING_FOR_DEPOSIT") return "입금 대기";
  if (status === "ABORTED") return "결제 중단";
  if (status === "EXPIRED") return "결제 만료";
  return "확인 필요";
}

function localPaymentStatusLabel(status: string | null) {
  if (status === "paid") return "결제 완료";
  if (status === "canceling") return "취소 처리 중";
  if (status === "refunded") return "환불 완료";
  if (status === "canceled" || status === "cancelled") return "결제 취소";
  if (status === "failed") return "결제 실패";
  return "확인 전";
}

function storeStatusLabel(row: StoreOpsRow) {
  if (row.status === "deleted") return "삭제";
  if (row.status === "inactive") return "비활성";
  if (!row.setup_completed) return "설정중";
  return "운영중";
}

function storeRiskLabel(row: StoreOpsRow) {
  if (row.urgent_ticket_count > 0) return "긴급문의";
  if (isExpiringSoon(row.paid_until)) return "만료임박";
  if (row.base_plan_status !== "active") return "구독확인";
  if (!row.setup_completed) return "설정필요";
  if (row.monthly_order_count === 0) return "주문없음";
  return "정상";
}

function storeRiskRank(row: StoreOpsRow) {
  if (row.urgent_ticket_count > 0) return 10;
  if (isExpiringSoon(row.paid_until)) return 9;
  if (row.base_plan_status === "active" && row.monthly_order_count === 0)
    return 8;
  if (!row.setup_completed) return 7;
  if (row.open_ticket_count > 0) return 6;
  if (row.base_plan_status !== "active" && row.monthly_order_count > 0)
    return 5;
  return 1;
}

function storeInsight(row: StoreOpsRow) {
  if (row.urgent_ticket_count > 0)
    return "긴급 문의가 있어 가장 먼저 확인해야 합니다.";
  if (isExpiringSoon(row.paid_until))
    return "구독 만료가 가까워 갱신 안내가 필요합니다.";
  if (row.base_plan_status === "active" && row.monthly_order_count === 0)
    return "유료 구독 중이지만 이번 달 주문이 없어 이탈 위험이 있습니다.";
  if (!row.setup_completed)
    return "초기 설정이 완료되지 않아 온보딩 지원이 필요합니다.";
  if (row.base_plan_status !== "active" && row.monthly_order_count > 0)
    return "비유료 상태에서도 주문이 발생해 유료 전환 후보입니다.";
  if (row.monthly_order_count > 0)
    return "이번 달 주문이 발생하고 있어 사용 중인 매장입니다.";
  return "현재 큰 위험 신호는 없습니다.";
}

export default function OpsPage() {
  const router = useRouter();
  const [isOps, setIsOps] = useState<boolean | null>(null);
  const [rows, setRows] = useState<StoreOpsRow[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [activeTab, setActiveTab] = useState<OpsTab>("overview");
  const [query, setQuery] = useState("");
  const [subFilter, setSubFilter] = useState("all");
  const [ticketFilter, setTicketFilter] = useState("all");
  const [sortBy, setSortBy] = useState<StoreSort>("risk");
  const [ticketStatusFilter, setTicketStatusFilter] =
    useState<TicketStatusFilter>("all");
  const [ticketPriorityFilter, setTicketPriorityFilter] =
    useState<TicketPriorityFilter>("all");
  const [ticketCategoryFilter, setTicketCategoryFilter] =
    useState<TicketCategoryFilter>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ticketMsg, setTicketMsg] = useState("");
  const [ticketDrafts, setTicketDrafts] = useState<Record<number, string>>({});
  const [pgForm, setPgForm] = useState({
    mid: "",
    clientKey: "",
    secretKey: "",
  });
  const [savedPg, setSavedPg] = useState<SavedPlatformPg | null>(null);
  const [pgReason, setPgReason] = useState("");
  const [benefit, setBenefit] = useState<StoreBenefit | null>(null);
  const [benefitForm, setBenefitForm] = useState({ founderMember: false, founderBase: false, founderAddon: false, founderReason: "", trialEndAt: "", trialReason: "" });
  const [benefitSaving, setBenefitSaving] = useState(false);
  const [opsIdentity, setOpsIdentity] = useState({ email: "", role: "viewer" });
  const [benefitEditorOpen, setBenefitEditorOpen] = useState(false);
  const [refundRows, setRefundRows] = useState<RefundHistoryRow[]>([]);
  const [refundCases, setRefundCases] = useState<RefundCaseRow[]>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundStatusFilter, setRefundStatusFilter] = useState("all");
  const [refundActionNotice, setRefundActionNotice] = useState<{ paymentId: number; tossStatus: string; localStatus: string; kind: "info" | "success" } | null>(null);
  const [refundSyncTarget, setRefundSyncTarget] = useState<RefundCaseRow | null>(null);
  const [refundSyncReason, setRefundSyncReason] = useState("");
  const [refundActionId, setRefundActionId] = useState<number | null>(null);
  const isOpsMaster = opsIdentity.role === "master";
  const canManageBilling = isOpsMaster || opsIdentity.role === "billing";

  const loadOps = useCallback(async () => {
    setLoading(true);
    setMsg("");
    setTicketMsg("");

    const todayKey = ymd(new Date());
    const monthStart = monthStartKey();

    const storesQuery = supabase
      .from("stores")
      .select("store_id, store_name, status, setup_completed, created_at")
      .order("store_name", { ascending: true });

    const [
      storesRes,
      billRes,
      addonRes,
      payRes,
      orderRes,
      ticketRes,
      memberRes,
    ] = await Promise.all([
      storesQuery,
      supabase
        .from("store_billing")
        .select("store_id, base_plan_status, paid_until"),
      supabase
        .from("store_addons")
        .select("store_id, prepay_addon_status, addon_paid_until"),
      supabase
        .from("billing_payments")
        .select("store_id, amount_krw, paid_at, status")
        .gte("paid_at", monthStart)
        .eq("status", "paid"),
      supabase
        .from("orders")
        .select("store_id, order_date, created_at, status")
        .gte("order_date", monthStart)
        .neq("status", "cancelled"),
      supabase
        .from("support_tickets")
        .select(
          "id, store_id, category, priority, status, title, body, ops_note, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("store_members").select("store_id, user_id, role"),
    ]);

    if (
      storesRes.error ||
      billRes.error ||
      addonRes.error ||
      payRes.error ||
      orderRes.error ||
      ticketRes.error
    ) {
      setMsg(
        [
          storesRes.error,
          billRes.error,
          addonRes.error,
          payRes.error,
          orderRes.error,
          ticketRes.error || memberRes.error,
        ]
          .filter(Boolean)
          .map((e) => e?.message)
          .join(" / ") || "OPS 데이터 로딩 실패",
      );
      setLoading(false);
      return;
    }

    const storeRows = (storesRes.data || []) as StoreBaseRow[];
    const billRows = (billRes.data || []) as BillingBaseRow[];
    const addonRows = (addonRes.data || []) as AddonBaseRow[];
    const paymentRows = (payRes.data || []) as PaymentBaseRow[];
    const orderRows = (orderRes.data || []) as OrderBaseRow[];
    const ticketRows = (ticketRes.data || []) as SupportTicketRow[];
    const memberRows = (memberRes.data || []) as StoreMemberRow[];
    if (memberRes.error)
      setMsg(`점주 계정 연결 로딩 실패: ${memberRes.error.message}`);

    const billMap = new Map(billRows.map((x) => [x.store_id, x]));
    const addonMap = new Map(addonRows.map((x) => [x.store_id, x]));
    const revenueMap = new Map<string, number>();
    const paidCountMap = new Map<string, number>();
    const monthlyOrderMap = new Map<string, number>();
    const todayOrderMap = new Map<string, number>();
    const lastOrderMap = new Map<string, string>();
    const openTicketMap = new Map<string, number>();
    const urgentTicketMap = new Map<string, number>();
    const ownerMap = new Map<string, string>();

    for (const m of memberRows) {
      const sid = String(m.store_id || "");
      const uid = String(m.user_id || "");
      if (!sid || !uid) continue;
      if (m.role === "owner" || !ownerMap.has(sid)) ownerMap.set(sid, uid);
    }

    for (const p of paymentRows) {
      const sid = String(p.store_id || "");
      if (!sid) continue;
      revenueMap.set(
        sid,
        (revenueMap.get(sid) || 0) + Math.max(0, Number(p.amount_krw || 0)),
      );
      paidCountMap.set(sid, (paidCountMap.get(sid) || 0) + 1);
    }

    for (const o of orderRows) {
      const sid = String(o.store_id || "");
      if (!sid) continue;
      monthlyOrderMap.set(sid, (monthlyOrderMap.get(sid) || 0) + 1);
      if (String(o.order_date || "") === todayKey)
        todayOrderMap.set(sid, (todayOrderMap.get(sid) || 0) + 1);
      const createdAt = String(o.created_at || "");
      if (
        createdAt &&
        (!lastOrderMap.get(sid) || createdAt > String(lastOrderMap.get(sid)))
      )
        lastOrderMap.set(sid, createdAt);
    }

    for (const t of ticketRows) {
      const sid = String(t.store_id || "");
      if (!sid) continue;
      if (ACTIVE_TICKET_STATUSES.has(t.status))
        openTicketMap.set(sid, (openTicketMap.get(sid) || 0) + 1);
      if (t.priority === "urgent" && ACTIVE_TICKET_STATUSES.has(t.status))
        urgentTicketMap.set(sid, (urgentTicketMap.get(sid) || 0) + 1);
    }

    const nextRows: StoreOpsRow[] = storeRows.map((s) => {
      const rawStatus = String(s.status || "active");
      const status: StoreStatus =
        rawStatus === "inactive" || rawStatus === "deleted"
          ? rawStatus
          : s.setup_completed === false
            ? "setup"
            : "active";
      return {
        store_id: String(s.store_id),
        store_name: s.store_name || null,
        status,
        setup_completed: s.setup_completed === true,
        created_at: s.created_at || null,
        base_plan_status:
          billMap.get(s.store_id)?.base_plan_status || "inactive",
        paid_until: billMap.get(s.store_id)?.paid_until || null,
        addon_status:
          addonMap.get(s.store_id)?.prepay_addon_status || "inactive",
        addon_paid_until: addonMap.get(s.store_id)?.addon_paid_until || null,
        monthly_revenue: revenueMap.get(String(s.store_id)) || 0,
        paid_count: paidCountMap.get(String(s.store_id)) || 0,
        today_order_count: todayOrderMap.get(String(s.store_id)) || 0,
        monthly_order_count: monthlyOrderMap.get(String(s.store_id)) || 0,
        last_order_at: lastOrderMap.get(String(s.store_id)) || null,
        open_ticket_count: openTicketMap.get(String(s.store_id)) || 0,
        urgent_ticket_count: urgentTicketMap.get(String(s.store_id)) || 0,
        owner_user_id: ownerMap.get(String(s.store_id)) || null,
      };
    });

    setRows(nextRows);
    setTickets(ticketRows);
    setTicketDrafts(
      Object.fromEntries(ticketRows.map((t) => [t.id, t.ops_note || ""])),
    );
    setSelectedStoreId((prev) => prev || nextRows[0]?.store_id || "");
    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const roleFromApp = String(data?.user?.app_metadata?.role || "");
      const allowed = roleFromApp === "ops";
      setOpsIdentity({ email: String(data?.user?.email || ""), role: String(data?.user?.app_metadata?.ops_role || "viewer") });
      setIsOps(allowed);
      if (!allowed) {
        setLoading(false);
        setMsg("OPS 권한(role=ops)이 필요합니다.");
      }
    })();
  }, []);

  useEffect(() => {
    if (isOps !== true) return;
    const timer = setTimeout(() => {
      void loadOps();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOps, loadOps]);

  useEffect(() => {
    if (isOps !== true) return;
    (async () => {
      const response = await fetch("/api/ops/platform-pg", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) return;
      const data = result.config;
      setPgForm({ mid: String(data?.mid || ""), clientKey: String(data?.clientKey || ""), secretKey: "" });
      setSavedPg({
        mid: String(data?.mid || ""),
        clientKey: String(data?.clientKey || ""),
        hasSecret: data?.hasSecret === true,
        updatedAt: String(data?.updatedAt || "").trim() || null,
      });
    })();
  }, [isOps]);

  const loadRefundHistory = useCallback(async () => {
    if (isOps !== true || !canManageBilling) return;
    setRefundLoading(true);
    const response = await fetch("/api/ops/refund-history?limit=100", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) { setRefundRows((result.rows || []) as RefundHistoryRow[]); setRefundCases((result.cases || []) as RefundCaseRow[]); }
    else setMsg(String(result?.message || "환불 이력을 불러오지 못했습니다."));
    setRefundLoading(false);
  }, [canManageBilling, isOps]);

  const reconcileRefund = async (paymentId: number, action: "inspect" | "sync", reason = "") => {
    if (action === "sync" && reason.trim().length < 2) return;
    setRefundActionId(paymentId);
    const response = await fetch("/api/ops/refund-reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId, action, reason }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) {
      setRefundActionNotice({ paymentId, tossStatus: String(result.tossStatus || ""), localStatus: String(result.localStatus || ""), kind: action === "sync" ? "success" : "info" });
      setMsg("");
      await loadRefundHistory();
      if (action === "sync") {
        setRefundSyncTarget(null);
        setRefundSyncReason("");
      }
    } else {
      setRefundActionNotice(null);
      setMsg(String(result?.message || "결제 상태 확인에 실패했습니다."));
    }
    setRefundActionId(null);
  };

  useEffect(() => {
    if (activeTab !== "payments") return;
    const timer = window.setTimeout(() => void loadRefundHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadRefundHistory]);

  const selectedStore = useMemo(
    () => rows.find((r) => r.store_id === selectedStoreId) || rows[0] || null,
    [rows, selectedStoreId],
  );

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = rows.filter((r) => {
      const matchesQuery =
        !q ||
        String(r.store_name || "")
          .toLowerCase()
          .includes(q) ||
        r.store_id.toLowerCase().includes(q) ||
        String(r.owner_user_id || "")
          .toLowerCase()
          .includes(q);
      const matchesSub =
        subFilter === "all" ||
        (subFilter === "active" && r.base_plan_status === "active") ||
        (subFilter === "inactive" && r.base_plan_status !== "active") ||
        (subFilter === "expiring" && isExpiringSoon(r.paid_until));
      const matchesTicket =
        ticketFilter === "all" ||
        (ticketFilter === "open" && r.open_ticket_count > 0) ||
        (ticketFilter === "urgent" && r.urgent_ticket_count > 0);
      return matchesQuery && matchesSub && matchesTicket;
    });

    next.sort((a, b) => {
      if (sortBy === "recentOrder")
        return String(b.last_order_at || "").localeCompare(
          String(a.last_order_at || ""),
        );
      if (sortBy === "monthlyOrders")
        return b.monthly_order_count - a.monthly_order_count;
      if (sortBy === "monthlyRevenue")
        return b.monthly_revenue - a.monthly_revenue;
      if (sortBy === "openTickets")
        return b.open_ticket_count - a.open_ticket_count;
      if (sortBy === "expiring")
        return (
          (remainingDays(a.paid_until) ?? 99999) -
          (remainingDays(b.paid_until) ?? 99999)
        );
      return storeRiskRank(b) - storeRiskRank(a);
    });

    return next;
  }, [query, rows, sortBy, subFilter, ticketFilter]);

  const kpi = useMemo<KpiSummary>(() => {
    const activeTicketRows = tickets.filter((t) =>
      ACTIVE_TICKET_STATUSES.has(t.status),
    );
    return {
      totalStores: rows.length,
      activeStores: rows.filter(
        (r) => r.status === "active" && r.setup_completed,
      ).length,
      setupStores: rows.filter((r) => !r.setup_completed).length,
      paidStores: rows.filter((r) => r.base_plan_status === "active").length,
      monthlyRevenue: rows.reduce((a, c) => a + c.monthly_revenue, 0),
      monthlyPaidCount: rows.reduce((a, c) => a + c.paid_count, 0),
      monthlyOrders: rows.reduce((a, c) => a + c.monthly_order_count, 0),
      orderActiveStores: rows.filter((r) => r.monthly_order_count > 0).length,
      expiringSoonStores: rows.filter((r) => isExpiringSoon(r.paid_until))
        .length,
      openTickets: activeTicketRows.length,
      inProgressTickets: tickets.filter((t) => t.status === "in_progress")
        .length,
      urgentTickets: activeTicketRows.filter((t) => t.priority === "urgent")
        .length,
      todayNewTickets: tickets.filter((t) =>
        String(t.created_at || "").startsWith(ymd(new Date())),
      ).length,
      ownerAccounts: new Set(rows.map((r) => r.owner_user_id).filter(Boolean))
        .size,
    };
  }, [rows, tickets]);

  const riskStores = useMemo(
    () =>
      rows
        .filter((r) => storeRiskRank(r) >= 6)
        .sort((a, b) => storeRiskRank(b) - storeRiskRank(a))
        .slice(0, 6),
    [rows],
  );
  const paidNoOrderStores = useMemo(
    () =>
      rows
        .filter(
          (r) => r.base_plan_status === "active" && r.monthly_order_count === 0,
        )
        .sort((a, b) => storeRiskRank(b) - storeRiskRank(a)),
    [rows],
  );
  const nonPaidActiveStores = useMemo(
    () =>
      rows
        .filter(
          (r) => r.base_plan_status !== "active" && r.monthly_order_count > 0,
        )
        .sort((a, b) => b.monthly_order_count - a.monthly_order_count),
    [rows],
  );
  const arpu =
    kpi.paidStores > 0 ? Math.round(kpi.monthlyRevenue / kpi.paidStores) : 0;
  const freeOrInactiveStores = Math.max(0, kpi.totalStores - kpi.paidStores);
  const todayOrders = rows.reduce((a, c) => a + c.today_order_count, 0);
  const noPaymentPaidStores = rows.filter(
    (r) => r.base_plan_status === "active" && r.paid_count === 0,
  );
  const filteredTickets = useMemo(() => {
    return tickets
      .filter(
        (t) => ticketStatusFilter === "all" || t.status === ticketStatusFilter,
      )
      .filter(
        (t) =>
          ticketPriorityFilter === "all" || t.priority === ticketPriorityFilter,
      )
      .filter(
        (t) =>
          ticketCategoryFilter === "all" || t.category === ticketCategoryFilter,
      )
      .sort((a, b) => {
        const priorityRank = (t: SupportTicketRow) => {
          const activeBoost = isActiveTicket(t.status) ? 100 : 0;
          const p =
            t.priority === "urgent"
              ? 40
              : t.priority === "high"
                ? 30
                : t.priority === "normal"
                  ? 20
                  : 10;
          const s =
            t.status === "open"
              ? 4
              : t.status === "in_progress"
                ? 3
                : t.status === "resolved"
                  ? 2
                  : 1;
          return activeBoost + p + s;
        };
        const rankDiff = priorityRank(b) - priorityRank(a);
        if (rankDiff !== 0) return rankDiff;
        return String(b.created_at || "").localeCompare(
          String(a.created_at || ""),
        );
      });
  }, [ticketCategoryFilter, ticketPriorityFilter, ticketStatusFilter, tickets]);

  const recentTickets = filteredTickets.slice(0, 5);

  const selectedTicket = useMemo(() => {
    if (selectedTicketId == null) return filteredTickets[0] || null;
    return (
      filteredTickets.find((t) => t.id === selectedTicketId) ||
      filteredTickets[0] ||
      null
    );
  }, [filteredTickets, selectedTicketId]);

  const savePg = async () => {
    const ok = window.confirm(
      "플랫폼 PG 정보를 변경하시겠습니까? 이 설정은 전체 점주 구독 결제에 영향을 줄 수 있습니다.",
    );
    if (!ok) return;
    if (!pgReason.trim()) { setMsg("PG 변경 사유를 입력해 주세요."); return; }
    const response = await fetch("/api/ops/platform-pg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mid: pgForm.mid, clientKey: pgForm.clientKey, secretKey: pgForm.secretKey, reason: pgReason }) });
    const result = await response.json().catch(() => ({}));
    setMsg(response.ok && result?.ok ? "PG 저장 완료" : String(result?.message || "PG 저장 실패"));
    if (response.ok && result?.ok) {
      setSavedPg(result.config);
      setPgForm((prev) => ({ ...prev, secretKey: "" }));
      setPgReason("");
    }
  };

  const loadBenefit = useCallback(async (storeId: string) => {
    if (!storeId || isOps !== true) return;
    const response = await fetch(`/api/ops/store-benefits?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) { setMsg(String(result?.message || "구독 혜택을 불러오지 못했습니다.")); return; }
    const next = result.benefit as StoreBenefit;
    setBenefit(next);
    setBenefitForm({
      founderMember: next.founderMember,
      founderBase: next.founderBase,
      founderAddon: next.founderAddon,
      founderReason: next.founderReason || "",
      trialEndAt: next.trialEndAt ? new Date(next.trialEndAt).toISOString().slice(0, 10) : "",
      trialReason: "",
    });
  }, [isOps]);

  useEffect(() => {
    if (!selectedStoreId) return;
    const timer = window.setTimeout(() => void loadBenefit(selectedStoreId), 0);
    return () => window.clearTimeout(timer);
  }, [loadBenefit, selectedStoreId]);

  const saveFounderBenefit = async () => {
    if (!selectedStoreId || !benefitForm.founderReason.trim()) { setMsg("창립 멤버 설정 사유를 입력해 주세요."); return; }
    if (benefitForm.founderAddon && !window.confirm("선결제 베타 테스트 참여를 확인했습니까? 옵션 구독 40% 할인이 적용됩니다.")) return;
    setBenefitSaving(true);
    const response = await fetch("/api/ops/store-benefits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: selectedStoreId, founderMember: benefitForm.founderMember, founderBase: benefitForm.founderBase, founderAddon: benefitForm.founderAddon, founderReason: benefitForm.founderReason }) });
    const result = await response.json().catch(() => ({}));
    setMsg(response.ok && result?.ok ? "창립 멤버 혜택을 저장했습니다." : String(result?.message || "혜택 저장에 실패했습니다."));
    if (response.ok && result?.ok) { setBenefit(result.benefit); setBenefitEditorOpen(false); }
    setBenefitSaving(false);
  };

  const saveTrial = async () => {
    if (!selectedStoreId || !benefitForm.trialReason.trim()) { setMsg("무료 체험 조정 사유를 입력해 주세요."); return; }
    setBenefitSaving(true);
    const trialEndAt = benefitForm.trialEndAt ? new Date(`${benefitForm.trialEndAt}T23:59:59+09:00`).toISOString() : null;
    const response = await fetch("/api/ops/store-benefits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: selectedStoreId, trialEndAt, trialReason: benefitForm.trialReason }) });
    const result = await response.json().catch(() => ({}));
    setMsg(response.ok && result?.ok ? "무료 체험 기간을 조정했습니다." : String(result?.message || "무료 체험 조정에 실패했습니다."));
    if (response.ok && result?.ok) { setBenefit(result.benefit); setBenefitForm((prev) => ({ ...prev, trialReason: "" })); }
    setBenefitSaving(false);
  };

  const updateTicket = async (
    ticketId: number,
    patch: Partial<Pick<SupportTicketRow, "status" | "ops_note">>,
  ) => {
    setTicketMsg("");
    const payload: {
      status?: string;
      ops_note?: string | null;
      resolved_at?: string | null;
    } = {
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.ops_note !== undefined ? { ops_note: patch.ops_note } : {}),
    };
    if (patch.status === "resolved" || patch.status === "closed")
      payload.resolved_at = new Date().toISOString();
    const { error } = await supabase
      .from("support_tickets")
      .update(payload)
      .eq("id", ticketId);
    if (error) {
      setTicketMsg(`티켓 업데이트 실패: ${error.message}`);
      return;
    }
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              ...(patch.status != null ? { status: patch.status } : {}),
              ...(patch.ops_note !== undefined
                ? { ops_note: patch.ops_note }
                : {}),
              updated_at: new Date().toISOString(),
            }
          : t,
      ),
    );
    setTicketMsg("티켓 업데이트 완료");
  };

  if (isOps === false) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>OPS 관리자 콘솔</h1>
        <p style={{ color: "#6b7280" }}>
          접근 권한이 없습니다. 관리자에게 OPS role 부여를 요청해 주세요.
        </p>
        <button
          onClick={() => router.push("/admin")}
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 8,
            background: "#fff",
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          admin으로 돌아가기
        </button>
      </main>
    );
  }

  const renderStoreTable = (mode: "stores" | "billing" = "stores") => (
    <div className="tableWrap">
      <table className="opsTable">
        <thead>
          {mode === "billing" ? (
            <tr>
              <th>점주 계정</th>
              <th>매장</th>
              <th>구독 상태</th>
              <th>만료/남은 기간</th>
              <th>이번 달 구독 매출</th>
              <th>결제 건수</th>
              <th>점검</th>
            </tr>
          ) : (
            <tr>
              <th>점주 계정</th>
              <th>매장</th>
              <th>운영 상태</th>
              <th>구독</th>
              <th>사용</th>
              <th>문의</th>
              <th>최근 활동</th>
            </tr>
          )}
        </thead>
        <tbody>
          {filteredRows.map((r) => {
            const days = remainingDays(r.paid_until);
            const dday = days != null ? `D-${Math.max(0, days)}` : "-";
            return (
              <tr
                key={r.store_id}
                className={r.store_id === selectedStore?.store_id ? "sel" : ""}
                onClick={() => setSelectedStoreId(r.store_id)}
              >
                {mode === "billing" ? (
                  <>
                    <td>
                      <div className="cellMain">
                        <strong>{shortId(r.owner_user_id)}</strong>
                        <small>owner</small>
                      </div>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>{r.store_name || r.store_id}</strong>
                        <small>{r.store_id}</small>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`pill ${r.base_plan_status === "active" ? "ok" : "warn"}`}
                      >
                        {r.base_plan_status === "active"
                          ? "유료"
                          : "무료/비활성"}
                      </span>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>{fmtDate(r.paid_until)}</strong>
                        <small>{dday}</small>
                      </div>
                    </td>
                    <td className="num">{fmtMoney(r.monthly_revenue)}</td>
                    <td className="num">{r.paid_count.toLocaleString()}건</td>
                    <td>
                      <span
                        className={`pill ${storeRiskLabel(r) === "정상" ? "ok" : "warn"}`}
                      >
                        {storeRiskLabel(r)}
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      <div className="cellMain">
                        <strong>{shortId(r.owner_user_id)}</strong>
                        <small>owner</small>
                      </div>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>{r.store_name || r.store_id}</strong>
                        <small>{r.store_id}</small>
                      </div>
                    </td>
                    <td>
                      <div className="pillStack">
                        <span
                          className={`pill ${storeStatusLabel(r) === "운영중" ? "ok" : "warn"}`}
                        >
                          {storeStatusLabel(r)}
                        </span>
                        <span
                          className={`pill ${storeRiskLabel(r) === "정상" ? "ok" : "warn"}`}
                        >
                          {storeRiskLabel(r)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>
                          {r.base_plan_status === "active"
                            ? "유료"
                            : "무료/비활성"}
                        </strong>
                        <small>
                          {fmtMoney(r.monthly_revenue)} · {dday}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>
                          이번 달 {r.monthly_order_count.toLocaleString()}건
                        </strong>
                        <small>
                          오늘 {r.today_order_count.toLocaleString()}건
                        </small>
                      </div>
                    </td>
                    <td>
                      {r.open_ticket_count ? (
                        <span className="pill warn">
                          미처리 {r.open_ticket_count}건
                        </span>
                      ) : (
                        <span className="muted">문의 없음</span>
                      )}
                    </td>
                    <td>
                      {r.last_order_at ? (
                        fmtDateTime(r.last_order_at)
                      ) : (
                        <span className="muted">최근 주문 없음</span>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderSelectedStore = () => (
    <aside className="card detailCard">
      <div className="sectionTitle">선택 매장 상세</div>
      {selectedStore ? (
        <>
          <div className="storeDetailHeader">
            <div>
              <h3>{selectedStore.store_name || selectedStore.store_id}</h3>
              <p className="muted">
                owner: {shortId(selectedStore.owner_user_id)}
              </p>
              <p className="muted">store_id: {selectedStore.store_id}</p>
            </div>
            <div className="pillStack right">
              <span
                className={`pill ${storeStatusLabel(selectedStore) === "운영중" ? "ok" : "warn"}`}
              >
                {storeStatusLabel(selectedStore)}
              </span>
              <span
                className={`pill ${storeRiskLabel(selectedStore) === "정상" ? "ok" : "warn"}`}
              >
                {storeRiskLabel(selectedStore)}
              </span>
            </div>
          </div>

          <div
            className={`insight ${storeRiskLabel(selectedStore) === "정상" ? "ok" : "warn"}`}
          >
            <strong>운영 판단</strong>
            <span>{storeInsight(selectedStore)}</span>
          </div>

          <div className="metricGrid">
            <div className="metric">
              <span>점주 계정</span>
              <strong>{shortId(selectedStore.owner_user_id)}</strong>
            </div>
            <div className="metric">
              <span>구독 상태</span>
              <strong>{selectedStore.base_plan_status}</strong>
            </div>
            <div className="metric">
              <span>구독 만료</span>
              <strong>{fmtDate(selectedStore.paid_until)}</strong>
            </div>
            <div className="metric">
              <span>남은 기간</span>
              <strong>
                {remainingDays(selectedStore.paid_until) != null
                  ? `D-${Math.max(0, Number(remainingDays(selectedStore.paid_until)))}`
                  : "-"}
              </strong>
            </div>
            <div className="metric">
              <span>이번 달 구독 매출</span>
              <strong>{fmtMoney(selectedStore.monthly_revenue)}</strong>
            </div>
            <div className="metric">
              <span>오늘 주문</span>
              <strong>
                {selectedStore.today_order_count.toLocaleString()}건
              </strong>
            </div>
            <div className="metric">
              <span>이번 달 주문</span>
              <strong>
                {selectedStore.monthly_order_count.toLocaleString()}건
              </strong>
            </div>
            <div className="metric">
              <span>미처리 문의</span>
              <strong>
                {selectedStore.open_ticket_count.toLocaleString()}건
              </strong>
            </div>
            <div className="metric">
              <span>최근 주문</span>
              <strong>{fmtDateTime(selectedStore.last_order_at)}</strong>
            </div>
          </div>

          <div className="benefitBox">
            <div className="sectionTitle">창립 멤버·무료 체험</div>
            <p className="muted">{benefit ? `${benefit.storeSequence}번째 매장 · ${benefit.founderMember ? "창립 멤버" : "일반 점주"}` : "혜택 정보 확인 중..."}</p>
            <div className="benefitSummary"><span>기본 구독 40%</span><strong>{benefit?.founderBase ? "적용" : "미적용"}</strong><span>선결제 옵션 40%</span><strong>{benefit?.founderAddon ? "적용" : "미적용"}</strong></div>
            <button className="btn primary" disabled={!canManageBilling} onClick={() => setBenefitEditorOpen(true)}>{canManageBilling ? "창립 멤버 혜택 변경" : "조회 전용"}</button>
            <div className="trialControls">
              <label><span>무료 체험 종료일</span><input className="input" type="date" value={benefitForm.trialEndAt} disabled={benefit?.baseStatus === "active" || Boolean(benefit?.paidUntil)} onChange={(e) => setBenefitForm((prev) => ({ ...prev, trialEndAt: e.target.value }))}/></label>
              <textarea className="input" rows={2} maxLength={240} placeholder="무료 체험 조정 사유(필수)" value={benefitForm.trialReason} disabled={benefit?.baseStatus === "active" || Boolean(benefit?.paidUntil)} onChange={(e) => setBenefitForm((prev) => ({ ...prev, trialReason: e.target.value }))}/>
              <button className="btn" disabled={!canManageBilling || benefitSaving || benefit?.baseStatus === "active" || Boolean(benefit?.paidUntil)} onClick={() => void saveTrial()}>무료 체험 기간 저장</button>
              {benefit?.baseStatus === "active" || benefit?.paidUntil ? <small className="muted">유료 매장은 무료 체험을 변경할 수 없습니다. 별도의 구독 보상 절차를 사용해야 합니다.</small> : null}
            </div>
          </div>

          <div className="quickLinks">
            <button
              className="btn"
              onClick={() =>
                router.push(
                  `/admin?store=${encodeURIComponent(selectedStore.store_id)}`,
                )
              }
            >
              점주 관리자
            </button>
            <button
              className="btn"
              onClick={() =>
                router.push(
                  `/admin/menu?store=${encodeURIComponent(selectedStore.store_id)}`,
                )
              }
            >
              메뉴 관리
            </button>
            <button
              className="btn"
              onClick={() =>
                router.push(
                  `/admin/qr?store=${encodeURIComponent(selectedStore.store_id)}`,
                )
              }
            >
              QR 보기
            </button>
            <button className="btn" onClick={() => setActiveTab("tickets")}>
              문의 보기
            </button>
          </div>
        </>
      ) : (
        <p className="muted">선택된 매장이 없습니다.</p>
      )}
    </aside>
  );

  return (
    <main className="wrap">
      <style jsx global>{`
        .wrap {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          padding: 24px;
          display: grid;
          gap: 16px;
          color: #111827;
        }
        .hero {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .benefitBox { display:grid; gap:9px; padding:14px; border:1px solid #dbeafe; background:#f8fbff; border-radius:14px; }
        .benefitSummary { display:grid; grid-template-columns:1fr auto; gap:7px 12px; font-size:12px; }
        .benefitSummary strong { color:#1d4ed8; }
        .checkRow { display:flex; align-items:center; gap:9px; font-weight:800; font-size:13px; }
        .checkRow input { width:18px; height:18px; }
        .trialControls { display:grid; gap:8px; padding-top:10px; border-top:1px solid #dbeafe; }
        .trialControls label { display:grid; gap:6px; font-size:12px; font-weight:800; }
        .opsAccount > div { display:grid; gap:2px; text-align:right; }
        .opsAccount small { color:#6b7280; font-size:10px; font-weight:900; }
        .modalBackdrop { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:18px; background:rgba(15,23,42,.62); }
        .opsModal { width:min(460px,100%); display:grid; gap:14px; border-radius:18px; background:#fff; padding:22px; box-shadow:0 28px 80px rgba(15,23,42,.28); }
        .h1 {
          margin: 0;
          font-size: clamp(24px, 2vw, 30px);
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 6px 0 0;
          color: #6b7280;
          font-size: clamp(13px, 0.9vw, 14px);
        }
        .row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }
        .card {
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          background: #fff;
          padding: 18px;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
        }
        .kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .kpi {
          min-height: 112px;
          display: grid;
          gap: 6px;
          align-content: space-between;
        }
        .kpiLabel {
          color: #6b7280;
          font-size: clamp(12px, 0.85vw, 13px);
          font-weight: 800;
        }
        .kpiValue {
          font-size: clamp(22px, 2.2vw, 28px);
          font-weight: 950;
          letter-spacing: -0.03em;
        }
        .kpiHint {
          color: #6b7280;
          font-size: clamp(12px, 0.8vw, 13px);
        }
        .tabs {
          display: flex;
          gap: 8px;
          overflow: auto;
          padding: 4px;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          background: #f8fafc;
        }
        .tab {
          border: 0;
          border-radius: 12px;
          padding: 10px 14px;
          background: transparent;
          color: #4b5563;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }
        .tab.active {
          background: #111827;
          color: #fff;
        }
        .btn {
          border: 1px solid #d1d5db;
          padding: 10px 12px;
          border-radius: 12px;
          background: #fff;
          color: #111827;
          font-weight: 900;
          cursor: pointer;
          min-height: 38px;
        }
        .btn.primary {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
        }
        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
        }
        .btn.danger {
          border-color: #fecaca;
          color: #b91c1c;
        }
        .grid2 {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(340px, 0.85fr);
          gap: 16px;
          align-items: start;
        }
        .grid3 {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .sectionTitle {
          font-size: clamp(15px, 1.1vw, 17px);
          font-weight: 950;
          margin-bottom: 10px;
        }
        .muted {
          color: #6b7280;
          font-size: clamp(12px, 0.85vw, 13px);
          margin: 0;
        }
        .noticeList {
          display: grid;
          gap: 8px;
        }
        .notice {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #f9fafb;
        }
        .filters {
          display: grid;
          grid-template-columns: 1fr 170px 170px 170px;
          gap: 10px;
          margin-bottom: 12px;
        }
        .input,
        .select,
        .textarea {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          background: #fff;
          color: #111827;
        }
        .textarea {
          min-height: 72px;
          resize: vertical;
        }
        .tableWrap {
          overflow: auto;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          background: #fff;
        }
        table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 14px;
          min-width: 760px;
        }
        th,
        td {
          border-bottom: 1px solid #eef2f7;
          padding: 13px 12px;
          text-align: left;
          vertical-align: middle;
        }
        th {
          background: #f9fafb;
          color: #4b5563;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }
        td small {
          display: block;
          color: #6b7280;
          font-size: 12px;
          margin-top: 3px;
        }
        td.num {
          text-align: right;
          font-weight: 900;
          white-space: nowrap;
        }
        .cellMain {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .cellMain strong {
          font-size: 14px;
          line-height: 1.25;
          word-break: keep-all;
        }
        .cellMain small {
          color: #6b7280;
          font-size: 12px;
          line-height: 1.25;
        }
        .pillStack {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .pillStack.right {
          justify-content: flex-end;
        }
        tr {
          cursor: pointer;
        }
        tr.sel {
          background: #eef6ff;
          box-shadow: inset 4px 0 0 #2563eb;
        }
        tr:hover {
          background: #f8fafc;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
        }
        .pill.ok {
          color: #047857;
          background: #ecfdf5;
          border-color: #a7f3d0;
        }
        .pill.warn {
          color: #b45309;
          background: #fffbeb;
          border-color: #fde68a;
        }
        .pill.danger {
          color: #b91c1c;
          background: #fef2f2;
          border-color: #fecaca;
        }
        .detailCard {
          position: sticky;
          top: 16px;
          align-self: start;
        }
        .detailCard h3 {
          margin: 4px 0;
          font-size: 22px;
          line-height: 1.2;
          letter-spacing: -0.02em;
        }
        .storeDetailHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          border-bottom: 1px solid #eef2f7;
          padding-bottom: 12px;
        }
        .infoGrid {
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 9px 12px;
          margin: 14px 0;
          font-size: 14px;
        }
        .infoGrid span {
          color: #6b7280;
        }
        .insight {
          display: grid;
          gap: 4px;
          border-radius: 14px;
          padding: 12px;
          margin: 12px 0;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
        }
        .insight span {
          color: #4b5563;
          font-size: 13px;
        }
        .insight.ok {
          background: #ecfdf5;
          border-color: #a7f3d0;
        }
        .insight.warn {
          background: #fffbeb;
          border-color: #fde68a;
        }
        .storeMiniList {
          display: grid;
          gap: 8px;
        }
        .storeMini {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 10px;
          display: grid;
          gap: 5px;
          cursor: pointer;
          background: #fff;
        }
        .storeMini:hover {
          background: #f8fafc;
        }
        .metricGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin: 12px 0;
        }
        .metric {
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f9fafb;
          padding: 12px;
          display: grid;
          gap: 5px;
          min-width: 0;
        }
        .metric span {
          color: #6b7280;
          font-size: 12px;
          font-weight: 800;
        }
        .metric strong {
          font-size: 14px;
          line-height: 1.25;
          word-break: break-word;
        }
        .quickLinks {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          border-top: 1px solid #eef2f7;
          padding-top: 12px;
        }
        .barRow {
          display: grid;
          grid-template-columns: 92px 1fr 42px;
          gap: 8px;
          align-items: center;
          font-size: 13px;
        }
        .barTrack {
          height: 9px;
          border-radius: 999px;
          background: #eef2f7;
          overflow: hidden;
        }
        .barFill {
          height: 100%;
          border-radius: 999px;
          background: #2563eb;
        }
        .ticketList {
          display: grid;
          gap: 10px;
        }
        .ticket {
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 8px;
          background: #fff;
          cursor: pointer;
          text-align: left;
        }
        .ticket.selectedTicket {
          border-color: #2563eb;
          background: #eff6ff;
        }
        .ticketDetail {
          border: 1px solid #dbeafe;
          background: #f8fbff;
          border-radius: 14px;
          padding: 12px;
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .ticketTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .ticketTitle {
          font-weight: 950;
        }
        .settingsGrid {
          display: grid;
          grid-template-columns: 0.8fr 1.2fr;
          gap: 16px;
          align-items: start;
        }
        .dashboardGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
          gap: 16px;
          align-items: start;
        }
        .todoList {
          display: grid;
          gap: 10px;
        }
        .todoCard {
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 14px;
          background: #fff;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px;
          align-items: center;
        }
        .todoCard.danger {
          border-color: #fecaca;
          background: #fff7f7;
        }
        .todoCard.warn {
          border-color: #fde68a;
          background: #fffbeb;
        }
        .todoCard.ok {
          border-color: #bfdbfe;
          background: #eff6ff;
        }
        .todoCard h3 {
          margin: 0;
          font-size: clamp(15px, 1.1vw, 17px);
          font-weight: 950;
        }
        .todoCard p {
          margin: 5px 0 0;
          color: #6b7280;
          font-size: clamp(12px, 0.85vw, 13px);
          line-height: 1.45;
        }
        .todoCount {
          font-size: clamp(21px, 2vw, 26px);
          font-weight: 950;
          white-space: nowrap;
        }
        .panelHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }
        .panelHeader p {
          margin: 4px 0 0;
          color: #6b7280;
          font-size: 13px;
        }
        .businessGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .businessMetric {
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 12px;
          background: #f9fafb;
          display: grid;
          gap: 5px;
        }
        .businessMetric span {
          color: #6b7280;
          font-size: 12px;
          font-weight: 800;
        }
        .businessMetric strong {
          font-size: 18px;
        }
        .ticketShell {
          display: grid;
          grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
          gap: 16px;
          align-items: start;
        }
        .ticketStats {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .refundActionNotice {
          position: sticky; top: 10px; z-index: 20; display:flex; align-items:center; justify-content:space-between; gap:16px;
          border:2px solid #93c5fd; border-radius:16px; padding:16px 18px; background:#eff6ff; color:#1e3a8a;
          box-shadow:0 16px 40px rgba(37,99,235,.18);
        }
        .refundActionNotice.success { border-color:#6ee7b7; background:#ecfdf5; color:#065f46; }
        .refundActionNotice p { margin:5px 0; font-size:15px; }
        .checkedRow { background:#eff6ff; }
        .refundActions { display:grid; gap:6px; min-width:170px; }
        .refundActions .btn { width:100%; }
        .refundActions small { color:#6b7280; line-height:1.35; }
        .refundSummary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
        .refundSummary .notice { min-height:68px; }
        .refundSummary strong { font-size:20px; }
        .actionComplete { display:grid; gap:5px; justify-items:start; min-width:130px; }
        .historySource { white-space:nowrap; }
        .refundConfirmSummary { display:grid; gap:8px; padding:12px; border:1px solid #dbeafe; border-radius:14px; background:#f8fbff; }
        .refundConfirmSummary div { display:flex; justify-content:space-between; gap:16px; }
        .refundConfirmSummary span { color:#64748b; }
        .modalActions { display:flex; justify-content:flex-end; gap:8px; }
        @media (max-width: 1100px) {
          .kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .grid2,
          .settingsGrid,
          .dashboardGrid,
          .ticketShell {
            grid-template-columns: 1fr;
          }
          .businessGrid,
          .ticketStats,
          .refundSummary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .detailCard {
            position: static;
          }
        }
        @media (max-width: 720px) {
          .wrap {
            padding: 14px;
          }
          .hero {
            display: grid;
          }
          .kpis {
            grid-template-columns: 1fr;
          }
          .kpiValue {
            font-size: clamp(21px, 6vw, 24px);
          }
          .filters {
            grid-template-columns: 1fr;
          }
          .grid3,
          .businessGrid,
          .ticketStats {
            grid-template-columns: 1fr;
          }
          .todoCard {
            grid-template-columns: 1fr;
          }
          .quickLinks {
            grid-template-columns: 1fr;
          }
          .refundSummary { grid-template-columns:1fr; }
          .refundActionNotice { position:static; align-items:flex-start; }
          .refundActions { min-width:150px; }
          .modalActions { display:grid; grid-template-columns:1fr; }
          .modalActions .btn { width:100%; }
          .opsAccount { width:100%; }
          .opsAccount > div { text-align:left; width:100%; }
          .modalBackdrop { align-items:end; padding:10px; }
          .opsModal { border-radius:18px 18px 12px 12px; padding:18px; }
        }
      `}</style>

      <header className="hero">
        <div>
          <h1 className="h1">OPS 관리자 콘솔</h1>
          <p className="sub">
            전체 매장, 구독, 주문, 문의 상태를 한눈에 확인하고 관리합니다.
          </p>
          <p className="sub">
            마지막 업데이트: {lastLoadedAt ? fmtDateTime(lastLoadedAt) : "-"}
          </p>
        </div>
        <div className="row opsAccount">
          <div><strong>{opsIdentity.email || "OPS 사용자"}</strong><small>{opsIdentity.role.toUpperCase()}</small></div>
          <button className="btn" onClick={loadOps}>
            새로고침
          </button>
          <button className="btn" onClick={() => void supabase.auth.signOut().then(() => router.replace("/ops/login"))}>로그아웃</button>
        </div>
      </header>

      {msg ? (
        <section className="card">
          <p className="muted">{msg}</p>
        </section>
      ) : null}

      <section className="kpis">
        <article className="card kpi">
          <div className="kpiLabel">점주 계정 / 매장</div>
          <div className="kpiValue">
            {kpi.ownerAccounts.toLocaleString()} /{" "}
            {kpi.totalStores.toLocaleString()}개
          </div>
          <div className="kpiHint">
            활성 {kpi.activeStores.toLocaleString()}개 · 설정중{" "}
            {kpi.setupStores.toLocaleString()}개
          </div>
        </article>
        <article className="card kpi">
          <div className="kpiLabel">유료 구독</div>
          <div className="kpiValue">{kpi.paidStores.toLocaleString()}개</div>
          <div className="kpiHint">
            무료/비활성 {freeOrInactiveStores.toLocaleString()}개
          </div>
        </article>
        <article className="card kpi">
          <div className="kpiLabel">이번 달 구독 매출</div>
          <div className="kpiValue">{fmtMoney(kpi.monthlyRevenue)}</div>
          <div className="kpiHint">
            결제 완료 {kpi.monthlyPaidCount.toLocaleString()}건 · ARPU{" "}
            {fmtMoney(arpu)}
          </div>
        </article>
        <article className="card kpi">
          <div className="kpiLabel">처리 필요 문의</div>
          <div className="kpiValue">{kpi.openTickets.toLocaleString()}건</div>
          <div className="kpiHint">
            긴급 {kpi.urgentTickets.toLocaleString()}건 · 오늘 신규{" "}
            {kpi.todayNewTickets.toLocaleString()}건
          </div>
        </article>
      </section>

      <nav className="tabs" aria-label="OPS 탭">
        {TABS.filter((tab) => tab.id !== "settings" || isOpsMaster).map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <section className="card">
          <p className="muted">OPS 데이터를 로딩 중입니다...</p>
        </section>
      ) : null}

      {!loading && activeTab === "overview" ? (
        <section className="dashboardGrid">
          <article className="card">
            <div className="panelHeader">
              <div>
                <div className="sectionTitle">오늘 확인할 일</div>
                <p>
                  사업 운영에 바로 영향을 줄 수 있는 항목만 우선순위로
                  정리했습니다.
                </p>
              </div>
              <span className="pill warn">운영 체크</span>
            </div>
            <div className="todoList">
              <div
                className={`todoCard ${kpi.urgentTickets > 0 ? "danger" : kpi.openTickets > 0 ? "warn" : "ok"}`}
              >
                <div>
                  <h3>문의/장애 대응</h3>
                  <p>
                    미처리 문의와 긴급 문의를 먼저 확인해 고객 불편을 줄입니다.
                  </p>
                </div>
                <div className="row">
                  <strong className="todoCount">
                    {kpi.openTickets.toLocaleString()}건
                  </strong>
                  <button
                    className="btn primary"
                    onClick={() => setActiveTab("tickets")}
                  >
                    문의 확인
                  </button>
                </div>
              </div>
              <div
                className={`todoCard ${paidNoOrderStores.length > 0 ? "warn" : "ok"}`}
              >
                <div>
                  <h3>유료인데 주문 없는 매장</h3>
                  <p>
                    구독료를 내고 있지만 사용이 적은 매장입니다. 해지 위험을
                    먼저 점검합니다.
                  </p>
                </div>
                <div className="row">
                  <strong className="todoCount">
                    {paidNoOrderStores.length.toLocaleString()}개
                  </strong>
                  <button
                    className="btn"
                    onClick={() => setActiveTab("stores")}
                  >
                    매장 보기
                  </button>
                </div>
              </div>
              <div
                className={`todoCard ${nonPaidActiveStores.length > 0 ? "ok" : ""}`}
              >
                <div>
                  <h3>무료 사용 중 주문 발생</h3>
                  <p>
                    실제 주문이 있어 유료 전환 안내를 검토할 수 있는 후보입니다.
                  </p>
                </div>
                <div className="row">
                  <strong className="todoCount">
                    {nonPaidActiveStores.length.toLocaleString()}개
                  </strong>
                  <button
                    className="btn"
                    onClick={() => setActiveTab("stores")}
                  >
                    전환 후보
                  </button>
                </div>
              </div>
              <div
                className={`todoCard ${noPaymentPaidStores.length > 0 || kpi.expiringSoonStores > 0 ? "warn" : "ok"}`}
              >
                <div>
                  <h3>구독/결제 점검</h3>
                  <p>
                    결제 없는 유료 매장과 만료 임박 매장을 확인해 매출 누락을
                    방지합니다.
                  </p>
                </div>
                <div className="row">
                  <strong className="todoCount">
                    {(
                      noPaymentPaidStores.length + kpi.expiringSoonStores
                    ).toLocaleString()}
                    개
                  </strong>
                  <button
                    className="btn"
                    onClick={() => setActiveTab("stores")}
                  >
                    결제 확인
                  </button>
                </div>
              </div>
            </div>
          </article>

          <article className="card">
            <div className="panelHeader">
              <div>
                <div className="sectionTitle">구독 사업 현황</div>
                <p>
                  매장 주문액이 아니라, 플랫폼 구독 사업을 판단하는 핵심
                  지표입니다.
                </p>
              </div>
            </div>
            <div className="businessGrid">
              <div className="businessMetric">
                <span>가입 매장</span>
                <strong>{kpi.totalStores.toLocaleString()}개</strong>
              </div>
              <div className="businessMetric">
                <span>무료/비활성</span>
                <strong>{freeOrInactiveStores.toLocaleString()}개</strong>
              </div>
              <div className="businessMetric">
                <span>이번 달 주문</span>
                <strong>{kpi.monthlyOrders.toLocaleString()}건</strong>
              </div>
              <div className="businessMetric">
                <span>주문 발생 매장</span>
                <strong>{kpi.orderActiveStores.toLocaleString()}개</strong>
              </div>
            </div>
            <div className="noticeList" style={{ marginTop: 12 }}>
              <div className="notice">
                <span>오늘 주문</span>
                <strong>{todayOrders.toLocaleString()}건</strong>
              </div>
              <div className="notice">
                <span>이번 달 구독 매출</span>
                <strong>{fmtMoney(kpi.monthlyRevenue)}</strong>
              </div>
              <div className="notice">
                <span>매장당 평균 구독 매출</span>
                <strong>{fmtMoney(arpu)}</strong>
              </div>
            </div>
          </article>

          <article className="card">
            <div className="sectionTitle">이탈 위험 매장</div>
            <div className="storeMiniList">
              {paidNoOrderStores.slice(0, 5).map((r) => (
                <div
                  key={r.store_id}
                  className="storeMini"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedStoreId(r.store_id);
                    setActiveTab("stores");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelectedStoreId(r.store_id);
                      setActiveTab("stores");
                    }
                  }}
                >
                  <div className="row">
                    <span className="pill warn">주문없음</span>
                    <strong>{r.store_name || r.store_id}</strong>
                  </div>
                  <p className="muted">
                    유료 구독 중이지만 이번 달 주문이 없어 사용 현황 확인이
                    필요합니다.
                  </p>
                </div>
              ))}
              {paidNoOrderStores.length === 0 ? (
                <p className="muted">
                  현재 유료 구독 중 주문 없는 매장이 없습니다.
                </p>
              ) : null}
            </div>
          </article>

          <article className="card">
            <div className="sectionTitle">유료 전환 후보</div>
            <div className="storeMiniList">
              {nonPaidActiveStores.slice(0, 5).map((r) => (
                <div
                  key={r.store_id}
                  className="storeMini"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedStoreId(r.store_id);
                    setActiveTab("stores");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelectedStoreId(r.store_id);
                      setActiveTab("stores");
                    }
                  }}
                >
                  <div className="row">
                    <span className="pill ok">전환 후보</span>
                    <strong>{r.store_name || r.store_id}</strong>
                  </div>
                  <p className="muted">
                    무료/비활성 상태에서 이번 달 주문{" "}
                    {r.monthly_order_count.toLocaleString()}건이 발생했습니다.
                  </p>
                </div>
              ))}
              {nonPaidActiveStores.length === 0 ? (
                <p className="muted">
                  현재 주문이 발생한 무료/비활성 매장이 없습니다.
                </p>
              ) : null}
            </div>
          </article>

          <article className="card">
            <div className="sectionTitle">우선 점검 신호</div>
            <div className="storeMiniList">
              {riskStores.length === 0 ? (
                <p className="muted">현재 우선 점검할 위험 신호가 없습니다.</p>
              ) : null}
              {riskStores.map((r) => (
                <div
                  key={r.store_id}
                  className="storeMini"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedStoreId(r.store_id);
                    setActiveTab("stores");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelectedStoreId(r.store_id);
                      setActiveTab("stores");
                    }
                  }}
                >
                  <div className="row">
                    <span className="pill warn">{storeRiskLabel(r)}</span>
                    <strong>{r.store_name || r.store_id}</strong>
                  </div>
                  <p className="muted">{storeInsight(r)}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="sectionTitle">최근 문의</div>
            <div className="storeMiniList">
              {recentTickets.map((t) => (
                <div
                  key={t.id}
                  className="storeMini"
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedTicketId(t.id);
                    setActiveTab("tickets");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setSelectedTicketId(t.id);
                      setActiveTab("tickets");
                    }
                  }}
                >
                  <div className="row">
                    <span
                      className={`pill ${t.priority === "urgent" ? "danger" : ACTIVE_TICKET_STATUSES.has(t.status) ? "warn" : "ok"}`}
                    >
                      {ticketStatusLabel(t.status)}
                    </span>
                    <strong>{t.title}</strong>
                  </div>
                  <p className="muted">
                    {t.store_id} · {ticketCategoryLabel(t.category)} ·{" "}
                    {fmtDateTime(t.created_at)}
                  </p>
                </div>
              ))}
              {recentTickets.length === 0 ? (
                <p className="muted">최근 문의가 없습니다.</p>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      {!loading && activeTab === "stores" ? (
        <section className="grid2">
          <article className="card">
            <div className="panelHeader">
              <div>
                <div className="sectionTitle">고객·구독 관리</div>
                <p>
                  점주 계정, 매장, 구독/결제, 주문 사용량, 문의 상태를 한
                  화면에서 함께 확인합니다.
                </p>
              </div>
              <span className="pill ok">계정 → 매장</span>
            </div>
            <div className="grid3">
              <div className="notice">
                <span>점주 계정</span>
                <strong>{kpi.ownerAccounts.toLocaleString()}개</strong>
              </div>
              <div className="notice">
                <span>전체 매장</span>
                <strong>{kpi.totalStores.toLocaleString()}개</strong>
              </div>
              <div className="notice">
                <span>유료 구독</span>
                <strong>{kpi.paidStores.toLocaleString()}개</strong>
              </div>
              <div className="notice">
                <span>무료/비활성</span>
                <strong>{freeOrInactiveStores.toLocaleString()}개</strong>
              </div>
              <div className="notice">
                <span>이번 달 구독 매출</span>
                <strong>{fmtMoney(kpi.monthlyRevenue)}</strong>
              </div>
              <div className="notice">
                <span>결제/만료 점검</span>
                <strong>
                  {(
                    noPaymentPaidStores.length + kpi.expiringSoonStores
                  ).toLocaleString()}
                  개
                </strong>
              </div>
            </div>
            <div className="filters" style={{ marginTop: 12 }}>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="점주 계정 / 매장명 / store_id 검색"
              />
              <select
                className="select"
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value)}
              >
                <option value="all">구독 전체</option>
                <option value="active">활성 구독</option>
                <option value="inactive">비활성/미구독</option>
                <option value="expiring">만료 임박</option>
              </select>
              <select
                className="select"
                value={ticketFilter}
                onChange={(e) => setTicketFilter(e.target.value)}
              >
                <option value="all">문의 전체</option>
                <option value="open">미처리 있음</option>
                <option value="urgent">긴급 있음</option>
              </select>
              <select
                className="select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as StoreSort)}
              >
                <option value="risk">위험 우선</option>
                <option value="recentOrder">최근 주문순</option>
                <option value="monthlyOrders">주문 많은순</option>
                <option value="monthlyRevenue">구독매출 높은순</option>
                <option value="expiring">만료 임박순</option>
                <option value="openTickets">문의 많은순</option>
              </select>
            </div>
            {renderStoreTable("stores")}
          </article>
          {renderSelectedStore()}
        </section>
      ) : null}

      {!loading && activeTab === "subscriptions" ? (
        <section className="grid2">
          <article className="card">
            <div className="panelHeader">
              <div><div className="sectionTitle">구독 현황</div><p>플랜 상태, 만료일과 구독 매출을 중심으로 확인합니다.</p></div>
              <span className="pill ok">구독 운영</span>
            </div>
            <div className="filters" style={{ marginTop: 12 }}>
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="매장명 / store_id 검색" />
              <select className="select" value={subFilter} onChange={(event) => setSubFilter(event.target.value)}><option value="all">구독 전체</option><option value="active">활성 구독</option><option value="inactive">비활성/미구독</option><option value="expiring">만료 임박</option></select>
              <select className="select" value={sortBy} onChange={(event) => setSortBy(event.target.value as StoreSort)}><option value="expiring">만료 임박순</option><option value="monthlyRevenue">구독매출 높은순</option><option value="risk">점검 우선순</option></select>
            </div>
            {renderStoreTable("billing")}
          </article>
          {renderSelectedStore()}
        </section>
      ) : null}

      {!loading && activeTab === "payments" && canManageBilling ? (
        <section className="noticeList">
          <div className="refundSummary" aria-label="환불 처리 현황">
            <div className="notice"><span>처리 필요</span><strong>{refundCases.filter((item) => ["requested", "reviewing", "approved", "processing"].includes(item.status)).length}건</strong></div>
            <div className="notice"><span>확인 필요</span><strong>{refundCases.filter((item) => item.status === "reconcile_required").length}건</strong></div>
            <div className="notice"><span>완료된 수동 환불</span><strong>{refundCases.filter((item) => item.status === "completed").length}건</strong></div>
          </div>
          {refundActionNotice ? (
            <div className={`refundActionNotice ${refundActionNotice.kind}`} role="status" aria-live="polite">
              <div>
                <strong>결제 #{refundActionNotice.paymentId} 상태 확인 완료</strong>
                <p>Toss <b>{tossStatusLabel(refundActionNotice.tossStatus)}</b> · 내부 <b>{localPaymentStatusLabel(refundActionNotice.localStatus)}</b></p>
                <small>{refundActionNotice.tossStatus === "CANCELED" && refundActionNotice.localStatus !== "refunded" ? "해당 행에서 2단계 내부 환불 처리를 진행해 주세요." : refundActionNotice.localStatus === "refunded" ? "Toss와 내부 환불 상태가 동기화되었습니다." : "Toss에서 전체 취소를 완료한 뒤 상태를 다시 확인해 주세요."}</small>
              </div>
              <button className="btn" onClick={() => setRefundActionNotice(null)}>닫기</button>
            </div>
          ) : null}
          <article className="card">
            <div className="panelHeader">
              <div><div className="sectionTitle">수동 환불 요청</div><p>Toss 취소 확인 후 내부 결제 상태와 구독 기간을 안전하게 동기화합니다.</p></div>
              <span className="pill warn">처리 필요 {refundCases.filter((item) => ["requested", "reviewing", "approved", "processing", "reconcile_required"].includes(item.status)).length}건</span>
            </div>
            <div className="tableWrap">
              <table className="opsTable">
                <thead><tr><th>요청일시</th><th>매장·결제</th><th>요청 상태</th><th>Toss 상태</th><th>내부 상태</th><th>사유·문의</th><th>처리</th></tr></thead>
                <tbody>
                  {refundCases.map((item) => {
                    const canSync = item.toss_status === "CANCELED" && item.local_payment_status !== "refunded" && item.status !== "completed";
                    const isWorking = refundActionId === item.billing_payment_id;
                    return (
                      <tr key={item.id} className={refundActionNotice?.paymentId === item.billing_payment_id ? "checkedRow" : ""}>
                        <td>{fmtDateTime(item.requested_at)}</td>
                        <td><div className="cellMain"><strong>{item.store_name || item.store_id}</strong><small>결제 #{item.billing_payment_id} · {item.store_id}</small></div></td>
                        <td><span className={`pill ${item.status === "completed" ? "ok" : item.status === "rejected" || item.status === "reconcile_required" ? "danger" : "warn"}`}>{refundCaseStatusLabel(item.status)}</span></td>
                        <td><div className="cellMain"><span className={`pill ${item.toss_status === "CANCELED" ? "ok" : item.toss_status === "DONE" ? "warn" : ""}`}>{tossStatusLabel(item.toss_status)}</span><small>{item.toss_checked_at ? `${fmtDateTime(item.toss_checked_at)} 확인` : "상태 확인 필요"}</small></div></td>
                        <td><span className={`pill ${item.local_payment_status === "refunded" ? "ok" : "warn"}`}>{localPaymentStatusLabel(item.local_payment_status)}</span></td>
                        <td><div className="cellMain"><strong>{item.reason}</strong><small>{item.support_ticket_id ? `문의 #${item.support_ticket_id}` : "연결 문의 없음"}</small></div></td>
                        <td>
                          {item.status === "completed" ? (
                            <div className="actionComplete"><span className="pill ok">처리 완료</span><small>{fmtDateTime(item.completed_at)}</small></div>
                          ) : (
                            <div className="refundActions">
                              <button className="btn" disabled={isWorking} onClick={() => void reconcileRefund(item.billing_payment_id, "inspect")}>{isWorking ? "확인 중..." : "1. Toss 상태 확인"}</button>
                              <button className="btn primary" disabled={!canSync || isWorking} title={canSync ? "내부 결제를 환불 완료로 변경하고 구독 기간을 조정합니다." : "Toss 상태가 취소 완료일 때만 사용할 수 있습니다."} onClick={() => { setRefundSyncTarget(item); setRefundSyncReason(""); }}>2. 내부 환불 처리</button>
                              {!canSync ? <small>{item.toss_status === "DONE" ? "Toss에서 먼저 전체 취소해 주세요." : item.toss_status ? "현재 상태에서는 내부 처리할 수 없습니다." : "먼저 Toss 상태를 확인해 주세요."}</small> : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!refundLoading && refundCases.length === 0 ? <p className="muted">접수된 기간 경과 환불 요청이 없습니다.</p> : null}
          </article>
          <article className="card">
            <div className="panelHeader">
              <div><div className="sectionTitle">통합 환불 이력</div><p>자동 취소와 OPS 수동 처리 결과를 한곳에서 확인합니다.</p></div>
              <div className="row">
                <select className="select" aria-label="환불 상태 필터" value={refundStatusFilter} onChange={(event) => setRefundStatusFilter(event.target.value)}>
                  <option value="all">상태 전체</option><option value="processing">처리 중</option><option value="completed">취소 완료</option><option value="failed">취소 실패</option><option value="reconcile_required">확인 필요</option>
                </select>
                <button className="btn" disabled={refundLoading} onClick={() => void loadRefundHistory()}>{refundLoading ? "불러오는 중" : "이력 새로고침"}</button>
              </div>
            </div>
            <div className="tableWrap">
              <table className="opsTable">
                <thead><tr><th>요청일시</th><th>처리 방식</th><th>매장</th><th>환불금액</th><th>상태</th><th>PG 상태</th><th>취소 사유·오류</th><th>완료일시</th></tr></thead>
                <tbody>
                  {refundRows.filter((row) => refundStatusFilter === "all" || row.status === refundStatusFilter).map((row) => (
                    <tr key={row.id}>
                      <td>{fmtDateTime(row.requested_at)}</td>
                      <td className="historySource"><span className={`pill ${row.source === "manual" ? "ok" : ""}`}>{row.source === "manual" ? "OPS 수동" : "자동 취소"}</span></td>
                      <td><div className="cellMain"><strong>{row.store_name || row.store_id}</strong><small>{row.store_id}</small></div></td>
                      <td className="num">{fmtMoney(row.amount_krw)}</td>
                      <td><span className={`pill ${row.status === "completed" ? "ok" : row.status === "failed" || row.status === "reconcile_required" ? "danger" : "warn"}`}>{refundStatusLabel(row.status)}</span></td>
                      <td><span className={`pill ${row.pg_status === "CANCELED" ? "ok" : row.pg_status ? "warn" : ""}`}>{tossStatusLabel(row.pg_status)}</span></td>
                      <td><div className="cellMain"><strong>{row.reason}</strong><small>{row.public_error_code || "오류 없음"}</small>{row.internal_error ? <small title={row.internal_error}>{row.internal_error}</small> : null}</div></td>
                      <td>{fmtDateTime(row.completed_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!refundLoading && refundRows.filter((row) => refundStatusFilter === "all" || row.status === refundStatusFilter).length === 0 ? <p className="muted">조건에 맞는 환불 이력이 없습니다.</p> : null}
          </article>
        </section>
      ) : null}

      {refundSyncTarget ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && refundActionId == null) setRefundSyncTarget(null); }}>
          <section className="opsModal" role="dialog" aria-modal="true" aria-labelledby="refund-sync-title">
            <div><div className="sectionTitle" id="refund-sync-title">내부 환불 처리 확인</div><p className="muted">이 작업은 내부 결제를 환불 완료로 변경하고 해당 구독 기간을 조정합니다.</p></div>
            <div className="refundConfirmSummary">
              <div><span>매장</span><strong>{refundSyncTarget.store_name || refundSyncTarget.store_id}</strong></div>
              <div><span>결제 번호</span><strong>#{refundSyncTarget.billing_payment_id}</strong></div>
              <div><span>Toss 상태</span><strong>{tossStatusLabel(refundSyncTarget.toss_status)}</strong></div>
              <div><span>현재 내부 상태</span><strong>{localPaymentStatusLabel(refundSyncTarget.local_payment_status)}</strong></div>
              <div><span>변경 후 상태</span><strong>환불 완료</strong></div>
            </div>
            <label><span className="muted">처리 사유 (필수)</span><textarea className="textarea" maxLength={240} value={refundSyncReason} onChange={(event) => setRefundSyncReason(event.target.value)} placeholder="Toss 수동 취소 확인 등 처리 근거를 입력해 주세요." /></label>
            <div className="modalActions">
              <button className="btn" disabled={refundActionId != null} onClick={() => setRefundSyncTarget(null)}>취소</button>
              <button className="btn primary" disabled={refundSyncReason.trim().length < 2 || refundActionId != null} onClick={() => void reconcileRefund(refundSyncTarget.billing_payment_id, "sync", refundSyncReason)}>{refundActionId != null ? "처리 중..." : "확인 후 내부 환불 처리"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {!loading && activeTab === "tickets" ? (
        <section className="card">
          <div className="panelHeader">
            <div>
              <div className="sectionTitle">문의/장애</div>
              <p>고객 문의와 장애를 빠르게 확인하고 처리 상태를 변경합니다.</p>
            </div>
          </div>
          <div className="ticketStats">
            <div className="notice">
              <span>미처리</span>
              <strong>{kpi.openTickets.toLocaleString()}건</strong>
            </div>
            <div className="notice">
              <span>긴급</span>
              <strong>{kpi.urgentTickets.toLocaleString()}건</strong>
            </div>
            <div className="notice">
              <span>오늘 신규</span>
              <strong>{kpi.todayNewTickets.toLocaleString()}건</strong>
            </div>
            <div className="notice">
              <span>처리 중</span>
              <strong>{kpi.inProgressTickets.toLocaleString()}건</strong>
            </div>
          </div>
          {ticketMsg ? (
            <p className="muted" style={{ marginTop: 10 }}>
              {ticketMsg}
            </p>
          ) : null}
          <div className="ticketShell" style={{ marginTop: 16 }}>
            <article>
              <div className="sectionTitle">문의 목록</div>
              <div className="filters">
                <select
                  className="select"
                  value={ticketStatusFilter}
                  onChange={(e) =>
                    setTicketStatusFilter(e.target.value as TicketStatusFilter)
                  }
                >
                  <option value="all">상태 전체</option>
                  <option value="open">접수</option>
                  <option value="in_progress">처리 중</option>
                  <option value="resolved">답변 완료</option>
                  <option value="closed">종료</option>
                </select>
                <select
                  className="select"
                  value={ticketPriorityFilter}
                  onChange={(e) =>
                    setTicketPriorityFilter(
                      e.target.value as TicketPriorityFilter,
                    )
                  }
                >
                  <option value="all">우선순위 전체</option>
                  <option value="urgent">긴급</option>
                  <option value="high">높음</option>
                  <option value="normal">보통</option>
                  <option value="low">낮음</option>
                </select>
                <select
                  className="select"
                  value={ticketCategoryFilter}
                  onChange={(e) =>
                    setTicketCategoryFilter(
                      e.target.value as TicketCategoryFilter,
                    )
                  }
                >
                  <option value="all">카테고리 전체</option>
                  <option value="billing">결제/구독</option>
                  <option value="bug">오류</option>
                  <option value="improvement">개선요청</option>
                  <option value="inquiry">문의</option>
                  <option value="etc">기타</option>
                </select>
              </div>
              <div className="ticketList">
                {filteredTickets.length === 0 ? (
                  <p className="muted">조건에 맞는 티켓이 없습니다.</p>
                ) : null}
                {filteredTickets.slice(0, 12).map((t) => (
                  <div
                    key={t.id}
                    className={`ticket ${selectedTicket?.id === t.id ? "selectedTicket" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTicketId(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSelectedTicketId(t.id);
                    }}
                  >
                    <div className="ticketTop">
                      <div>
                        <div className="ticketTitle">
                          #{t.id} [{t.store_id}] {t.title}
                        </div>
                        <p className="muted">
                          {ticketCategoryLabel(t.category)} ·{" "}
                          {ticketPriorityLabel(t.priority)} · 등록{" "}
                          {fmtDateTime(t.created_at)}
                        </p>
                      </div>
                      <span
                        className={`pill ${t.priority === "urgent" ? "danger" : ACTIVE_TICKET_STATUSES.has(t.status) ? "warn" : "ok"}`}
                      >
                        {ticketStatusLabel(t.status)}
                      </span>
                    </div>
                    {t.body ? (
                      <p style={{ margin: 0, fontSize: 13 }}>{t.body}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
            <article className="ticketDetail" style={{ marginTop: 0 }}>
              {selectedTicket ? (
                <>
                  <div className="sectionTitle">선택 문의 상세</div>
                  <p className="muted">
                    #{selectedTicket.id} · {selectedTicket.store_id} ·{" "}
                    {ticketCategoryLabel(selectedTicket.category)} ·{" "}
                    {ticketPriorityLabel(selectedTicket.priority)}
                  </p>
                  <strong>{selectedTicket.title}</strong>
                  {selectedTicket.body ? (
                    <p style={{ margin: 0 }}>{selectedTicket.body}</p>
                  ) : null}
                  <textarea
                    className="textarea"
                    placeholder="OPS 답변/처리 메모"
                    value={ticketDrafts[selectedTicket.id] ?? ""}
                    onChange={(e) =>
                      setTicketDrafts((prev) => ({
                        ...prev,
                        [selectedTicket.id]: e.target.value,
                      }))
                    }
                  />
                  <div className="row">
                    <button
                      className="btn primary"
                      onClick={() =>
                        void updateTicket(selectedTicket.id, {
                          ops_note:
                            (ticketDrafts[selectedTicket.id] || "").trim() ||
                            null,
                        })
                      }
                    >
                      메모 저장
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void updateTicket(selectedTicket.id, { status: "open" })
                      }
                    >
                      접수
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void updateTicket(selectedTicket.id, {
                          status: "in_progress",
                        })
                      }
                    >
                      처리 중
                    </button>
                    <button
                      className="btn"
                      onClick={() =>
                        void updateTicket(selectedTicket.id, {
                          status: "resolved",
                        })
                      }
                    >
                      답변 완료
                    </button>
                    <button
                      className="btn danger"
                      onClick={() =>
                        void updateTicket(selectedTicket.id, {
                          status: "closed",
                        })
                      }
                    >
                      종료
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">선택된 문의가 없습니다.</p>
              )}
            </article>
          </div>
        </section>
      ) : null}

      {!loading && activeTab === "settings" && isOpsMaster ? (
        <section className="settingsGrid">
          <article className="card">
            <div className="sectionTitle">등록된 플랫폼 PG</div>
            <div className="infoGrid">
              <span>MID</span>
              <strong>{savedPg?.mid || "-"}</strong>
              <span>Client Key</span>
              <strong>
                {savedPg?.clientKey ? maskToken(savedPg.clientKey) : "-"}
              </strong>
              <span>Secret Key</span>
              <strong>{savedPg?.hasSecret ? "********(등록됨)" : "-"}</strong>
              <span>최근 수정</span>
              <strong>{fmtDateTime(savedPg?.updatedAt || null)}</strong>
            </div>
            <p className="muted">
              Secret Key는 저장 후 다시 표시되지 않습니다. 비워두면 기존 Secret
              Key가 유지되고, 변경할 때만 새 값을 입력합니다.
            </p>
          </article>
          <article className="card">
            <div className="sectionTitle">플랫폼 PG 연결 변경</div>
            <p className="muted">
              점주 구독 결제는 플랫폼 사업자 PG 공통 MID 기준으로 처리합니다.
            </p>
            <div className="noticeList" style={{ marginTop: 12 }}>
              <input
                className="input"
                placeholder="MID"
                value={pgForm.mid}
                onChange={(e) =>
                  setPgForm((p) => ({ ...p, mid: e.target.value }))
                }
              />
              <input
                className="input"
                placeholder="Client Key"
                value={pgForm.clientKey}
                onChange={(e) =>
                  setPgForm((p) => ({ ...p, clientKey: e.target.value }))
                }
              />
              <input
                className="input"
                type="password"
                placeholder="Secret Key (변경 시에만 입력)"
                value={pgForm.secretKey}
                onChange={(e) =>
                  setPgForm((p) => ({ ...p, secretKey: e.target.value }))
                }
              />
              <textarea
                className="input"
                rows={2}
                maxLength={240}
                placeholder="PG 변경 사유(필수)"
                value={pgReason}
                onChange={(e) => setPgReason(e.target.value)}
              />
              <button className="btn primary" onClick={savePg}>
                PG 저장
              </button>
            </div>
          </article>
        </section>
      ) : null}

      {benefitEditorOpen && selectedStore ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => !benefitSaving && setBenefitEditorOpen(false)}>
          <section className="opsModal" role="dialog" aria-modal="true" aria-labelledby="founder-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><div className="sectionTitle" id="founder-editor-title">창립 멤버 혜택 변경</div><p className="muted">{selectedStore.store_name || selectedStore.store_id}</p></div>
            <label className="checkRow"><input type="checkbox" checked={benefitForm.founderMember} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderMember: e.target.checked, founderBase: e.target.checked ? prev.founderBase : false, founderAddon: e.target.checked ? prev.founderAddon : false }))}/><span>창립 멤버로 지정</span></label>
            <label className="checkRow"><input type="checkbox" disabled={!benefitForm.founderMember} checked={benefitForm.founderBase} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderBase: e.target.checked }))}/><span>기본 구독 40% 할인</span></label>
            <label className="checkRow"><input type="checkbox" disabled={!benefitForm.founderMember} checked={benefitForm.founderAddon} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderAddon: e.target.checked }))}/><span>선결제 옵션 40% 할인</span></label>
            <textarea className="input" rows={3} maxLength={240} placeholder="창립 멤버 지정·변경 사유(필수)" value={benefitForm.founderReason} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderReason: e.target.value }))}/>
            <div className="row"><button className="btn" disabled={benefitSaving} onClick={() => setBenefitEditorOpen(false)}>취소</button><button className="btn primary" disabled={benefitSaving} onClick={() => void saveFounderBenefit()}>{benefitSaving ? "저장 중..." : "변경 저장"}</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
