"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { maskToken } from "@/app/lib/billingSettings";

type OpsTab = "overview" | "stores" | "billing" | "orders" | "tickets" | "settings";
type StoreStatus = "active" | "inactive" | "deleted" | "setup";
type StoreSort = "risk" | "recentOrder" | "monthlyOrders" | "monthlyRevenue" | "expiring" | "openTickets";
type TicketStatusFilter = "all" | "open" | "in_progress" | "resolved" | "closed";
type TicketPriorityFilter = "all" | "urgent" | "high" | "normal" | "low";
type TicketCategoryFilter = "all" | "billing" | "bug" | "improvement" | "inquiry" | "etc";

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
};

type StoreBaseRow = {
  store_id: string;
  store_name: string | null;
  status?: string | null;
  setup_completed?: boolean | null;
  created_at?: string | null;
};
type BillingBaseRow = { store_id: string; base_plan_status: string | null; paid_until: string | null };
type AddonBaseRow = { store_id: string; prepay_addon_status: string | null; addon_paid_until: string | null };
type PaymentBaseRow = { store_id: string; amount_krw: number | null; paid_at?: string | null; status?: string | null };
type OrderBaseRow = { store_id: string | null; order_date: string | null; created_at: string | null; status: string | null };
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
};

const TABS: Array<{ id: OpsTab; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "stores", label: "매장" },
  { id: "billing", label: "구독/매출" },
  { id: "orders", label: "주문/활성도" },
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
  if (row.base_plan_status === "active" && row.monthly_order_count === 0) return 8;
  if (!row.setup_completed) return 7;
  if (row.open_ticket_count > 0) return 6;
  if (row.base_plan_status !== "active" && row.monthly_order_count > 0) return 5;
  return 1;
}

function storeInsight(row: StoreOpsRow) {
  if (row.urgent_ticket_count > 0) return "긴급 문의가 있어 가장 먼저 확인해야 합니다.";
  if (isExpiringSoon(row.paid_until)) return "구독 만료가 가까워 갱신 안내가 필요합니다.";
  if (row.base_plan_status === "active" && row.monthly_order_count === 0) return "유료 구독 중이지만 이번 달 주문이 없어 이탈 위험이 있습니다.";
  if (!row.setup_completed) return "초기 설정이 완료되지 않아 온보딩 지원이 필요합니다.";
  if (row.base_plan_status !== "active" && row.monthly_order_count > 0) return "비유료 상태에서도 주문이 발생해 유료 전환 후보입니다.";
  if (row.monthly_order_count > 0) return "이번 달 주문이 발생하고 있어 사용 중인 매장입니다.";
  return "현재 큰 위험 신호는 없습니다.";
}

function countBy<T extends string>(values: T[]) {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  return out;
}

function maxBar(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(6, Math.round((value / max) * 100));
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
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatusFilter>("all");
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState<TicketPriorityFilter>("all");
  const [ticketCategoryFilter, setTicketCategoryFilter] = useState<TicketCategoryFilter>("all");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ticketMsg, setTicketMsg] = useState("");
  const [ticketDrafts, setTicketDrafts] = useState<Record<number, string>>({});
  const [pgForm, setPgForm] = useState({ mid: "", clientKey: "", secretKey: "" });
  const [savedPg, setSavedPg] = useState<SavedPlatformPg | null>(null);

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

    const [storesRes, billRes, addonRes, payRes, orderRes, ticketRes] = await Promise.all([
      storesQuery,
      supabase.from("store_billing").select("store_id, base_plan_status, paid_until"),
      supabase.from("store_addons").select("store_id, prepay_addon_status, addon_paid_until"),
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
        .select("id, store_id, category, priority, status, title, body, ops_note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (storesRes.error || billRes.error || addonRes.error || payRes.error || orderRes.error || ticketRes.error) {
      setMsg(
        [storesRes.error, billRes.error, addonRes.error, payRes.error, orderRes.error, ticketRes.error]
          .filter(Boolean)
          .map((e) => e?.message)
          .join(" / ") || "OPS 데이터 로딩 실패"
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

    const billMap = new Map(billRows.map((x) => [x.store_id, x]));
    const addonMap = new Map(addonRows.map((x) => [x.store_id, x]));
    const revenueMap = new Map<string, number>();
    const paidCountMap = new Map<string, number>();
    const monthlyOrderMap = new Map<string, number>();
    const todayOrderMap = new Map<string, number>();
    const lastOrderMap = new Map<string, string>();
    const openTicketMap = new Map<string, number>();
    const urgentTicketMap = new Map<string, number>();

    for (const p of paymentRows) {
      const sid = String(p.store_id || "");
      if (!sid) continue;
      revenueMap.set(sid, (revenueMap.get(sid) || 0) + Math.max(0, Number(p.amount_krw || 0)));
      paidCountMap.set(sid, (paidCountMap.get(sid) || 0) + 1);
    }

    for (const o of orderRows) {
      const sid = String(o.store_id || "");
      if (!sid) continue;
      monthlyOrderMap.set(sid, (monthlyOrderMap.get(sid) || 0) + 1);
      if (String(o.order_date || "") === todayKey) todayOrderMap.set(sid, (todayOrderMap.get(sid) || 0) + 1);
      const createdAt = String(o.created_at || "");
      if (createdAt && (!lastOrderMap.get(sid) || createdAt > String(lastOrderMap.get(sid)))) lastOrderMap.set(sid, createdAt);
    }

    for (const t of ticketRows) {
      const sid = String(t.store_id || "");
      if (!sid) continue;
      if (ACTIVE_TICKET_STATUSES.has(t.status)) openTicketMap.set(sid, (openTicketMap.get(sid) || 0) + 1);
      if (t.priority === "urgent" && ACTIVE_TICKET_STATUSES.has(t.status)) urgentTicketMap.set(sid, (urgentTicketMap.get(sid) || 0) + 1);
    }

    const nextRows: StoreOpsRow[] = storeRows.map((s) => {
      const rawStatus = String(s.status || "active");
      const status: StoreStatus = rawStatus === "inactive" || rawStatus === "deleted" ? rawStatus : s.setup_completed === false ? "setup" : "active";
      return {
        store_id: String(s.store_id),
        store_name: s.store_name || null,
        status,
        setup_completed: s.setup_completed === true,
        created_at: s.created_at || null,
        base_plan_status: billMap.get(s.store_id)?.base_plan_status || "inactive",
        paid_until: billMap.get(s.store_id)?.paid_until || null,
        addon_status: addonMap.get(s.store_id)?.prepay_addon_status || "inactive",
        addon_paid_until: addonMap.get(s.store_id)?.addon_paid_until || null,
        monthly_revenue: revenueMap.get(String(s.store_id)) || 0,
        paid_count: paidCountMap.get(String(s.store_id)) || 0,
        today_order_count: todayOrderMap.get(String(s.store_id)) || 0,
        monthly_order_count: monthlyOrderMap.get(String(s.store_id)) || 0,
        last_order_at: lastOrderMap.get(String(s.store_id)) || null,
        open_ticket_count: openTicketMap.get(String(s.store_id)) || 0,
        urgent_ticket_count: urgentTicketMap.get(String(s.store_id)) || 0,
      };
    });

    setRows(nextRows);
    setTickets(ticketRows);
    setTicketDrafts(Object.fromEntries(ticketRows.map((t) => [t.id, t.ops_note || ""])));
    setSelectedStoreId((prev) => prev || nextRows[0]?.store_id || "");
    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const roleFromApp = String(data?.user?.app_metadata?.role || "");
      const roleFromUser = String(data?.user?.user_metadata?.role || "");
      const allowed = roleFromApp === "ops" || roleFromUser === "ops";
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
      const { data, error } = await supabase
        .from("platform_pg_config")
        .select("mid, client_key, secret_key, updated_at")
        .eq("id", 1)
        .maybeSingle();
      if (error) return;
      setPgForm({ mid: String(data?.mid || ""), clientKey: String(data?.client_key || ""), secretKey: "" });
      setSavedPg({
        mid: String(data?.mid || ""),
        clientKey: String(data?.client_key || ""),
        hasSecret: !!String(data?.secret_key || "").trim(),
        updatedAt: String(data?.updated_at || "").trim() || null,
      });
    })();
  }, [isOps]);

  const selectedStore = useMemo(() => rows.find((r) => r.store_id === selectedStoreId) || rows[0] || null, [rows, selectedStoreId]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const next = rows.filter((r) => {
      const matchesQuery = !q || String(r.store_name || "").toLowerCase().includes(q) || r.store_id.toLowerCase().includes(q);
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
      if (sortBy === "recentOrder") return String(b.last_order_at || "").localeCompare(String(a.last_order_at || ""));
      if (sortBy === "monthlyOrders") return b.monthly_order_count - a.monthly_order_count;
      if (sortBy === "monthlyRevenue") return b.monthly_revenue - a.monthly_revenue;
      if (sortBy === "openTickets") return b.open_ticket_count - a.open_ticket_count;
      if (sortBy === "expiring") return (remainingDays(a.paid_until) ?? 99999) - (remainingDays(b.paid_until) ?? 99999);
      return storeRiskRank(b) - storeRiskRank(a);
    });

    return next;
  }, [query, rows, sortBy, subFilter, ticketFilter]);

  const kpi = useMemo<KpiSummary>(() => {
    const activeTicketRows = tickets.filter((t) => ACTIVE_TICKET_STATUSES.has(t.status));
    return {
      totalStores: rows.length,
      activeStores: rows.filter((r) => r.status === "active" && r.setup_completed).length,
      setupStores: rows.filter((r) => !r.setup_completed).length,
      paidStores: rows.filter((r) => r.base_plan_status === "active").length,
      monthlyRevenue: rows.reduce((a, c) => a + c.monthly_revenue, 0),
      monthlyPaidCount: rows.reduce((a, c) => a + c.paid_count, 0),
      monthlyOrders: rows.reduce((a, c) => a + c.monthly_order_count, 0),
      orderActiveStores: rows.filter((r) => r.monthly_order_count > 0).length,
      expiringSoonStores: rows.filter((r) => isExpiringSoon(r.paid_until)).length,
      openTickets: activeTicketRows.length,
      inProgressTickets: tickets.filter((t) => t.status === "in_progress").length,
      urgentTickets: activeTicketRows.filter((t) => t.priority === "urgent").length,
      todayNewTickets: tickets.filter((t) => String(t.created_at || "").startsWith(ymd(new Date()))).length,
    };
  }, [rows, tickets]);

  const ticketStatusCounts = useMemo(() => countBy(tickets.map((t) => ticketStatusLabel(t.status))), [tickets]);
  const ticketPriorityCounts = useMemo(() => countBy(tickets.map((t) => ticketPriorityLabel(t.priority))), [tickets]);
  const ticketCategoryCounts = useMemo(() => countBy(tickets.map((t) => ticketCategoryLabel(t.category))), [tickets]);
  const maxTicketStatus = Math.max(1, ...Object.values(ticketStatusCounts));
  const maxTicketCategory = Math.max(1, ...Object.values(ticketCategoryCounts));

  const riskStores = useMemo(() => rows.filter((r) => storeRiskRank(r) >= 6).sort((a, b) => storeRiskRank(b) - storeRiskRank(a)).slice(0, 6), [rows]);
  const opportunityStores = useMemo(
    () => rows.filter((r) => r.base_plan_status !== "active" && r.monthly_order_count > 0).sort((a, b) => b.monthly_order_count - a.monthly_order_count).slice(0, 6),
    [rows]
  );
  const paidNoOrderStores = useMemo(() => rows.filter((r) => r.base_plan_status === "active" && r.monthly_order_count === 0).sort((a, b) => storeRiskRank(b) - storeRiskRank(a)), [rows]);
  const nonPaidActiveStores = useMemo(() => rows.filter((r) => r.base_plan_status !== "active" && r.monthly_order_count > 0).sort((a, b) => b.monthly_order_count - a.monthly_order_count), [rows]);
  const topOrderStores = useMemo(() => rows.filter((r) => r.monthly_order_count > 0).sort((a, b) => b.monthly_order_count - a.monthly_order_count).slice(0, 5), [rows]);
  const arpu = kpi.paidStores > 0 ? Math.round(kpi.monthlyRevenue / kpi.paidStores) : 0;

  const filteredTickets = useMemo(() => {
    return tickets
      .filter((t) => ticketStatusFilter === "all" || t.status === ticketStatusFilter)
      .filter((t) => ticketPriorityFilter === "all" || t.priority === ticketPriorityFilter)
      .filter((t) => ticketCategoryFilter === "all" || t.category === ticketCategoryFilter)
      .sort((a, b) => {
        const priorityRank = (t: SupportTicketRow) => {
          const activeBoost = isActiveTicket(t.status) ? 100 : 0;
          const p = t.priority === "urgent" ? 40 : t.priority === "high" ? 30 : t.priority === "normal" ? 20 : 10;
          const s = t.status === "open" ? 4 : t.status === "in_progress" ? 3 : t.status === "resolved" ? 2 : 1;
          return activeBoost + p + s;
        };
        const rankDiff = priorityRank(b) - priorityRank(a);
        if (rankDiff !== 0) return rankDiff;
        return String(b.created_at || "").localeCompare(String(a.created_at || ""));
      });
  }, [ticketCategoryFilter, ticketPriorityFilter, ticketStatusFilter, tickets]);

  const selectedTicket = useMemo(() => {
    if (selectedTicketId == null) return filteredTickets[0] || null;
    return filteredTickets.find((t) => t.id === selectedTicketId) || filteredTickets[0] || null;
  }, [filteredTickets, selectedTicketId]);

  const savePg = async () => {
    const ok = window.confirm("플랫폼 PG 정보를 변경하시겠습니까? 이 설정은 전체 점주 구독 결제에 영향을 줄 수 있습니다.");
    if (!ok) return;
    const payload: { id: number; mid: string; client_key: string; secret_key?: string; updated_at: string } = {
      id: 1,
      mid: pgForm.mid.trim(),
      client_key: pgForm.clientKey.trim(),
      updated_at: new Date().toISOString(),
    };
    if (pgForm.secretKey.trim()) payload.secret_key = pgForm.secretKey.trim();
    const { error } = await supabase.from("platform_pg_config").upsert(payload, { onConflict: "id" });
    setMsg(error ? `PG 저장 실패: ${error.message}` : "PG 저장 완료");
    if (!error) {
      setSavedPg({ mid: payload.mid, clientKey: payload.client_key, hasSecret: payload.secret_key ? true : savedPg?.hasSecret || false, updatedAt: payload.updated_at });
      setPgForm((prev) => ({ ...prev, secretKey: "" }));
    }
  };

  const updateTicket = async (ticketId: number, patch: Partial<Pick<SupportTicketRow, "status" | "ops_note">>) => {
    setTicketMsg("");
    const payload: { status?: string; ops_note?: string | null; resolved_at?: string | null } = {
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.ops_note !== undefined ? { ops_note: patch.ops_note } : {}),
    };
    if (patch.status === "resolved" || patch.status === "closed") payload.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("support_tickets").update(payload).eq("id", ticketId);
    if (error) {
      setTicketMsg(`티켓 업데이트 실패: ${error.message}`);
      return;
    }
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? { ...t, ...(patch.status != null ? { status: patch.status } : {}), ...(patch.ops_note !== undefined ? { ops_note: patch.ops_note } : {}), updated_at: new Date().toISOString() }
          : t
      )
    );
    setTicketMsg("티켓 업데이트 완료");
  };

  if (isOps === false) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>OPS 관리자 콘솔</h1>
        <p style={{ color: "#6b7280" }}>접근 권한이 없습니다. 관리자에게 OPS role 부여를 요청해 주세요.</p>
        <button onClick={() => router.push("/admin")} style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "8px 12px", cursor: "pointer" }}>
          admin으로 돌아가기
        </button>
      </main>
    );
  }

  const renderStoreTable = (mode: "stores" | "billing" | "orders" = "stores") => (
    <div className="tableWrap">
      <table className="opsTable">
        <thead>
          {mode === "billing" ? (
            <tr>
              <th>매장</th>
              <th>구독 상태</th>
              <th>만료/남은 기간</th>
              <th>이번 달 결제</th>
              <th>결제 건수</th>
              <th>점검</th>
            </tr>
          ) : mode === "orders" ? (
            <tr>
              <th>매장</th>
              <th>오늘 주문</th>
              <th>이번 달 주문</th>
              <th>최근 주문</th>
              <th>활성도 신호</th>
              <th>문의</th>
            </tr>
          ) : (
            <tr>
              <th>매장</th>
              <th>상태/점검</th>
              <th>구독/매출</th>
              <th>주문/활성도</th>
              <th>문의</th>
              <th>최근활동</th>
            </tr>
          )}
        </thead>
        <tbody>
          {filteredRows.map((r) => {
            const days = remainingDays(r.paid_until);
            const dday = days != null ? `D-${Math.max(0, days)}` : "-";
            return (
              <tr key={r.store_id} className={r.store_id === selectedStore?.store_id ? "sel" : ""} onClick={() => setSelectedStoreId(r.store_id)}>
                {mode === "billing" ? (
                  <>
                    <td><div className="cellMain"><strong>{r.store_name || r.store_id}</strong><small>{r.store_id}</small></div></td>
                    <td><span className={`pill ${r.base_plan_status === "active" ? "ok" : "warn"}`}>{r.base_plan_status}</span></td>
                    <td><div className="cellMain"><strong>{fmtDate(r.paid_until)}</strong><small>{dday}</small></div></td>
                    <td className="num">{fmtMoney(r.monthly_revenue)}</td>
                    <td className="num">{r.paid_count.toLocaleString()}건</td>
                    <td><span className={`pill ${storeRiskLabel(r) === "정상" ? "ok" : "warn"}`}>{storeRiskLabel(r)}</span></td>
                  </>
                ) : mode === "orders" ? (
                  <>
                    <td><div className="cellMain"><strong>{r.store_name || r.store_id}</strong><small>{r.store_id}</small></div></td>
                    <td className="num">{r.today_order_count.toLocaleString()}건</td>
                    <td className="num">{r.monthly_order_count.toLocaleString()}건</td>
                    <td>{r.last_order_at ? fmtDateTime(r.last_order_at) : <span className="muted">최근 주문 없음</span>}</td>
                    <td><span className={`pill ${r.monthly_order_count > 0 ? "ok" : "warn"}`}>{r.monthly_order_count > 0 ? "사용중" : "주문없음"}</span></td>
                    <td>{r.open_ticket_count ? <span className="pill warn">{r.open_ticket_count}건</span> : <span className="muted">문의 없음</span>}</td>
                  </>
                ) : (
                  <>
                    <td><div className="cellMain"><strong>{r.store_name || r.store_id}</strong><small>{r.store_id}</small></div></td>
                    <td><div className="pillStack"><span className={`pill ${storeStatusLabel(r) === "운영중" ? "ok" : "warn"}`}>{storeStatusLabel(r)}</span><span className={`pill ${storeRiskLabel(r) === "정상" ? "ok" : "warn"}`}>{storeRiskLabel(r)}</span></div></td>
                    <td><div className="cellMain"><strong>{r.base_plan_status}</strong><small>{fmtMoney(r.monthly_revenue)} · {dday}</small></div></td>
                    <td><div className="cellMain"><strong>{r.monthly_order_count.toLocaleString()}건</strong><small>오늘 {r.today_order_count.toLocaleString()}건</small></div></td>
                    <td>{r.open_ticket_count ? <span className="pill warn">미처리 {r.open_ticket_count}건</span> : <span className="muted">문의 없음</span>}</td>
                    <td>{r.last_order_at ? fmtDateTime(r.last_order_at) : <span className="muted">최근 주문 없음</span>}</td>
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
              <p className="muted">store_id: {selectedStore.store_id}</p>
            </div>
            <div className="pillStack right">
              <span className={`pill ${storeStatusLabel(selectedStore) === "운영중" ? "ok" : "warn"}`}>{storeStatusLabel(selectedStore)}</span>
              <span className={`pill ${storeRiskLabel(selectedStore) === "정상" ? "ok" : "warn"}`}>{storeRiskLabel(selectedStore)}</span>
            </div>
          </div>

          <div className={`insight ${storeRiskLabel(selectedStore) === "정상" ? "ok" : "warn"}`}>
            <strong>운영 판단</strong>
            <span>{storeInsight(selectedStore)}</span>
          </div>

          <div className="metricGrid">
            <div className="metric"><span>구독 상태</span><strong>{selectedStore.base_plan_status}</strong></div>
            <div className="metric"><span>구독 만료</span><strong>{fmtDate(selectedStore.paid_until)}</strong></div>
            <div className="metric"><span>남은 기간</span><strong>{remainingDays(selectedStore.paid_until) != null ? `D-${Math.max(0, Number(remainingDays(selectedStore.paid_until)))}` : "-"}</strong></div>
            <div className="metric"><span>이번 달 매출</span><strong>{fmtMoney(selectedStore.monthly_revenue)}</strong></div>
            <div className="metric"><span>오늘 주문</span><strong>{selectedStore.today_order_count.toLocaleString()}건</strong></div>
            <div className="metric"><span>이번 달 주문</span><strong>{selectedStore.monthly_order_count.toLocaleString()}건</strong></div>
            <div className="metric"><span>미처리 문의</span><strong>{selectedStore.open_ticket_count.toLocaleString()}건</strong></div>
            <div className="metric"><span>최근 주문</span><strong>{fmtDateTime(selectedStore.last_order_at)}</strong></div>
          </div>

          <div className="quickLinks">
            <button className="btn" onClick={() => router.push(`/admin?store=${encodeURIComponent(selectedStore.store_id)}`)}>점주 관리자</button>
            <button className="btn" onClick={() => router.push(`/admin/menu?store=${encodeURIComponent(selectedStore.store_id)}`)}>메뉴 관리</button>
            <button className="btn" onClick={() => router.push(`/admin/qr?store=${encodeURIComponent(selectedStore.store_id)}`)}>QR 보기</button>
            <button className="btn" onClick={() => setActiveTab("tickets")}>문의 보기</button>
          </div>
        </>
      ) : <p className="muted">선택된 매장이 없습니다.</p>}
    </aside>
  );

  return (
    <main className="wrap">
      <style jsx>{`
        .wrap { max-width: 1440px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; color:#111827; }
        .hero { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
        .h1 { margin:0; font-size: 30px; font-weight: 950; letter-spacing:-0.02em; }
        .sub { margin:6px 0 0; color:#6b7280; font-size:14px; }
        .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .card { border:1px solid #e5e7eb; border-radius:18px; background:#fff; padding:16px; box-shadow:0 8px 24px rgba(15,23,42,0.04); }
        .kpis { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px; }
        .kpi { min-height:112px; display:grid; gap:6px; align-content:space-between; }
        .kpiLabel { color:#6b7280; font-size:13px; font-weight:800; }
        .kpiValue { font-size:26px; font-weight:950; letter-spacing:-0.03em; }
        .kpiHint { color:#6b7280; font-size:12px; }
        .tabs { display:flex; gap:8px; overflow:auto; padding:4px; border:1px solid #e5e7eb; border-radius:16px; background:#f8fafc; }
        .tab { border:0; border-radius:12px; padding:10px 14px; background:transparent; color:#4b5563; font-weight:900; cursor:pointer; white-space:nowrap; }
        .tab.active { background:#111827; color:#fff; }
        .btn { border:1px solid #d1d5db; padding:9px 12px; border-radius:12px; background:#fff; color:#111827; font-weight:850; cursor:pointer; }
        .btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
        .btn.danger { border-color:#fecaca; color:#b91c1c; }
        .grid2 { display:grid; grid-template-columns: 1.45fr 0.85fr; gap:16px; align-items:start; }
        .grid3 { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:12px; }
        .sectionTitle { font-size:16px; font-weight:950; margin-bottom:10px; }
        .muted { color:#6b7280; font-size:13px; margin:0; }
        .noticeList { display:grid; gap:8px; }
        .notice { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb; }
        .filters { display:grid; grid-template-columns: 1fr 170px 170px 170px; gap:10px; margin-bottom:12px; }
        .input, .select, .textarea { width:100%; border:1px solid #d1d5db; border-radius:12px; padding:10px 12px; font-size:14px; background:#fff; color:#111827; }
        .textarea { min-height:72px; resize:vertical; }
        .tableWrap { overflow:auto; border:1px solid #eef2f7; border-radius:14px; }
        table { width:100%; border-collapse: collapse; font-size: 14px; min-width: 760px; }
        th, td { border-bottom:1px solid #eef2f7; padding:12px 10px; text-align:left; vertical-align:middle; }
        th { background:#f9fafb; color:#4b5563; font-size:12px; }
        td small { display:block; color:#6b7280; font-size:12px; margin-top:3px; }
        td.num { text-align:right; font-weight:900; white-space:nowrap; }
        .cellMain { display:grid; gap:3px; min-width:0; }
        .cellMain strong { font-size:14px; line-height:1.25; word-break:keep-all; }
        .cellMain small { color:#6b7280; font-size:12px; line-height:1.25; }
        .pillStack { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
        .pillStack.right { justify-content:flex-end; }
        tr { cursor:pointer; }
        tr.sel { background:#eef6ff; }
        tr:hover { background:#f8fafc; }
        .pill { display:inline-flex; align-items:center; border-radius:999px; padding:4px 8px; font-size:12px; font-weight:900; border:1px solid #e5e7eb; background:#f8fafc; }
        .pill.ok { color:#047857; background:#ecfdf5; border-color:#a7f3d0; }
        .pill.warn { color:#b45309; background:#fffbeb; border-color:#fde68a; }
        .pill.danger { color:#b91c1c; background:#fef2f2; border-color:#fecaca; }
        .detailCard { position:sticky; top:16px; }
        .detailCard h3 { margin:4px 0; font-size:22px; }
        .storeDetailHeader { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom:1px solid #eef2f7; padding-bottom:12px; }
        .infoGrid { display:grid; grid-template-columns: 110px 1fr; gap:9px 12px; margin:14px 0; font-size:14px; }
        .infoGrid span { color:#6b7280; }
        .insight { display:grid; gap:4px; border-radius:14px; padding:12px; margin:12px 0; border:1px solid #e5e7eb; background:#f9fafb; }
        .insight span { color:#4b5563; font-size:13px; }
        .insight.ok { background:#ecfdf5; border-color:#a7f3d0; }
        .insight.warn { background:#fffbeb; border-color:#fde68a; }
        .storeMiniList { display:grid; gap:8px; }
        .storeMini { border:1px solid #e5e7eb; border-radius:12px; padding:10px; display:grid; gap:5px; cursor:pointer; background:#fff; }
        .storeMini:hover { background:#f8fafc; }
        .metricGrid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; margin:12px 0; }
        .metric { border:1px solid #eef2f7; border-radius:12px; background:#f9fafb; padding:10px; display:grid; gap:4px; min-width:0; }
        .metric span { color:#6b7280; font-size:12px; font-weight:800; }
        .metric strong { font-size:14px; line-height:1.25; word-break:break-word; }
        .quickLinks { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:8px; }
        .barRow { display:grid; grid-template-columns: 92px 1fr 42px; gap:8px; align-items:center; font-size:13px; }
        .barTrack { height:9px; border-radius:999px; background:#eef2f7; overflow:hidden; }
        .barFill { height:100%; border-radius:999px; background:#2563eb; }
        .ticketList { display:grid; gap:10px; }
        .ticket { border:1px solid #e5e7eb; border-radius:14px; padding:12px; display:grid; gap:8px; background:#fff; cursor:pointer; text-align:left; }
        .ticket.selectedTicket { border-color:#2563eb; background:#eff6ff; }
        .ticketDetail { border:1px solid #dbeafe; background:#f8fbff; border-radius:14px; padding:12px; display:grid; gap:10px; margin-top:12px; }
        .ticketTop { display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
        .ticketTitle { font-weight:950; }
        .settingsGrid { display:grid; grid-template-columns: 0.8fr 1.2fr; gap:16px; align-items:start; }
        @media (max-width: 1100px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .grid2, .settingsGrid { grid-template-columns:1fr; } .detailCard { position:static; } }
        @media (max-width: 720px) { .wrap { padding:14px; } .hero { display:grid; } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpiValue { font-size:21px; } .filters { grid-template-columns:1fr; } .grid3 { grid-template-columns:1fr; } .quickLinks { grid-template-columns:1fr; } }
      `}</style>

      <header className="hero">
        <div>
          <h1 className="h1">OPS 관리자 콘솔</h1>
          <p className="sub">전체 매장, 구독, 주문, 문의 상태를 한눈에 확인하고 관리합니다.</p>
          <p className="sub">마지막 업데이트: {lastLoadedAt ? fmtDateTime(lastLoadedAt) : "-"}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={loadOps}>새로고침</button>
        </div>
      </header>

      {msg ? <section className="card"><p className="muted">{msg}</p></section> : null}

      <section className="kpis">
        <article className="card kpi"><div className="kpiLabel">총 매장</div><div className="kpiValue">{kpi.totalStores.toLocaleString()}개</div><div className="kpiHint">설정중 {kpi.setupStores.toLocaleString()}개</div></article>
        <article className="card kpi"><div className="kpiLabel">활성 매장</div><div className="kpiValue">{kpi.activeStores.toLocaleString()}개</div><div className="kpiHint">운영 가능 매장 기준</div></article>
        <article className="card kpi"><div className="kpiLabel">유료 구독</div><div className="kpiValue">{kpi.paidStores.toLocaleString()}개</div><div className="kpiHint">base plan active</div></article>
        <article className="card kpi"><div className="kpiLabel">이번 달 구독 매출</div><div className="kpiValue">{fmtMoney(kpi.monthlyRevenue)}</div><div className="kpiHint">결제 완료 {kpi.monthlyPaidCount.toLocaleString()}건</div></article>
        <article className="card kpi"><div className="kpiLabel">이번 달 주문</div><div className="kpiValue">{kpi.monthlyOrders.toLocaleString()}건</div><div className="kpiHint">주문 발생 매장 {kpi.orderActiveStores.toLocaleString()}개</div></article>
        <article className="card kpi"><div className="kpiLabel">만료 임박</div><div className="kpiValue">{kpi.expiringSoonStores.toLocaleString()}개</div><div className="kpiHint">7일 이내 만료</div></article>
        <article className="card kpi"><div className="kpiLabel">미처리 문의</div><div className="kpiValue">{kpi.openTickets.toLocaleString()}건</div><div className="kpiHint">처리 중 {kpi.inProgressTickets.toLocaleString()}건</div></article>
        <article className="card kpi"><div className="kpiLabel">긴급 문의</div><div className="kpiValue">{kpi.urgentTickets.toLocaleString()}건</div><div className="kpiHint">오늘 신규 {kpi.todayNewTickets.toLocaleString()}건</div></article>
      </section>

      <nav className="tabs" aria-label="OPS 탭">
        {TABS.map((tab) => (
          <button key={tab.id} type="button" className={`tab ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
        ))}
      </nav>

      {loading ? <section className="card"><p className="muted">OPS 데이터를 로딩 중입니다...</p></section> : null}

      {!loading && activeTab === "overview" ? (
        <section className="grid2">
          <article className="card">
            <div className="sectionTitle">위험 신호</div>
            <div className="storeMiniList">
              {riskStores.length === 0 ? <p className="muted">현재 우선 점검할 위험 신호가 없습니다.</p> : null}
              {riskStores.map((r) => (
                <div key={r.store_id} className="storeMini" role="button" tabIndex={0} onClick={() => { setSelectedStoreId(r.store_id); setActiveTab("stores"); }} onKeyDown={(e) => { if (e.key === "Enter") { setSelectedStoreId(r.store_id); setActiveTab("stores"); } }}>
                  <div className="row"><span className="pill warn">{storeRiskLabel(r)}</span><strong>{r.store_name || r.store_id}</strong></div>
                  <p className="muted">{storeInsight(r)}</p>
                </div>
              ))}
            </div>
          </article>
          <article className="card">
            <div className="sectionTitle">기회 신호</div>
            <div className="storeMiniList">
              {opportunityStores.length === 0 ? <p className="muted">주문이 발생한 비유료 매장이 아직 없습니다.</p> : null}
              {opportunityStores.map((r) => (
                <div key={r.store_id} className="storeMini" role="button" tabIndex={0} onClick={() => { setSelectedStoreId(r.store_id); setActiveTab("orders"); }} onKeyDown={(e) => { if (e.key === "Enter") { setSelectedStoreId(r.store_id); setActiveTab("orders"); } }}>
                  <div className="row"><span className="pill ok">전환 후보</span><strong>{r.store_name || r.store_id}</strong></div>
                  <p className="muted">비유료 상태에서 이번 달 주문 {r.monthly_order_count.toLocaleString()}건이 발생했습니다.</p>
                </div>
              ))}
            </div>
          </article>
          <article className="card">
            <div className="sectionTitle">상태 분포</div>
            <div className="noticeList">
              <div className="barRow"><span>운영중</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(kpi.activeStores, kpi.totalStores)}%` }} /></div><strong>{kpi.activeStores}</strong></div>
              <div className="barRow"><span>설정중</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(kpi.setupStores, kpi.totalStores)}%` }} /></div><strong>{kpi.setupStores}</strong></div>
              <div className="barRow"><span>유료구독</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(kpi.paidStores, kpi.totalStores)}%` }} /></div><strong>{kpi.paidStores}</strong></div>
              <div className="barRow"><span>주문매장</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(kpi.orderActiveStores, kpi.totalStores)}%` }} /></div><strong>{kpi.orderActiveStores}</strong></div>
            </div>
          </article>
          <article className="card">
            <div className="sectionTitle">운영 요약</div>
            <div className="noticeList">
              <div className="notice"><span>주문 없는 유료 매장</span><strong>{paidNoOrderStores.length.toLocaleString()}개</strong></div>
              <div className="notice"><span>주문 있는 비유료 매장</span><strong>{nonPaidActiveStores.length.toLocaleString()}개</strong></div>
              <div className="notice"><span>만료 임박 매장</span><strong>{kpi.expiringSoonStores.toLocaleString()}개</strong></div>
              <div className="notice"><span>긴급 문의</span><strong>{kpi.urgentTickets.toLocaleString()}건</strong></div>
            </div>
          </article>
        </section>
      ) : null}

      {!loading && activeTab === "stores" ? (
        <section className="grid2">
          <article className="card">
            <div className="sectionTitle">매장 관리</div>
            <div className="filters">
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="매장명 또는 store_id 검색" />
              <select className="select" value={subFilter} onChange={(e) => setSubFilter(e.target.value)}>
                <option value="all">구독 전체</option>
                <option value="active">활성 구독</option>
                <option value="inactive">비활성/미구독</option>
                <option value="expiring">만료 임박</option>
              </select>
              <select className="select" value={ticketFilter} onChange={(e) => setTicketFilter(e.target.value)}>
                <option value="all">문의 전체</option>
                <option value="open">미처리 있음</option>
                <option value="urgent">긴급 있음</option>
              </select>
              <select className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as StoreSort)}>
                <option value="risk">위험 우선</option>
                <option value="recentOrder">최근 주문순</option>
                <option value="monthlyOrders">주문 많은순</option>
                <option value="monthlyRevenue">월매출 높은순</option>
                <option value="expiring">만료 임박순</option>
                <option value="openTickets">문의 많은순</option>
              </select>
            </div>
            {renderStoreTable("stores")}
          </article>
          {renderSelectedStore()}
        </section>
      ) : null}

      {!loading && activeTab === "billing" ? (
        <section className="grid2">
          <article className="card">
            <div className="sectionTitle">구독/매출 요약</div>
            <div className="grid3">
              <div className="notice"><span>유료 구독</span><strong>{kpi.paidStores}개</strong></div>
              <div className="notice"><span>이번 달 매출</span><strong>{fmtMoney(kpi.monthlyRevenue)}</strong></div>
              <div className="notice"><span>결제 완료</span><strong>{kpi.monthlyPaidCount}건</strong></div>
              <div className="notice"><span>매장당 평균 매출</span><strong>{fmtMoney(arpu)}</strong></div>
              <div className="notice"><span>만료 임박</span><strong>{kpi.expiringSoonStores}개</strong></div>
              <div className="notice"><span>결제 없는 유료 매장</span><strong>{rows.filter((r) => r.base_plan_status === "active" && r.paid_count === 0).length}개</strong></div>
            </div>
            <div style={{ marginTop: 12 }}>{renderStoreTable("billing")}</div>
          </article>
          {renderSelectedStore()}
        </section>
      ) : null}

      {!loading && activeTab === "orders" ? (
        <section className="grid2">
          <article className="card">
            <div className="sectionTitle">주문/활성도</div>
            <div className="grid3">
              <div className="notice"><span>오늘 주문</span><strong>{rows.reduce((a, c) => a + c.today_order_count, 0).toLocaleString()}건</strong></div>
              <div className="notice"><span>이번 달 주문</span><strong>{kpi.monthlyOrders.toLocaleString()}건</strong></div>
              <div className="notice"><span>주문 발생 매장</span><strong>{kpi.orderActiveStores.toLocaleString()}개</strong></div>
            </div>
            <div className="grid3" style={{ marginTop: 12 }}>
              <div>
                <div className="sectionTitle">주문 없는 유료 매장</div>
                <div className="storeMiniList">
                  {paidNoOrderStores.slice(0, 5).map((r) => (
                    <div key={r.store_id} className="storeMini" role="button" tabIndex={0} onClick={() => setSelectedStoreId(r.store_id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedStoreId(r.store_id); }}>
                      <strong>{r.store_name || r.store_id}</strong>
                      <span className="muted">{storeInsight(r)}</span>
                    </div>
                  ))}
                  {paidNoOrderStores.length === 0 ? <p className="muted">주문 없는 유료 매장이 없습니다.</p> : null}
                </div>
              </div>
              <div>
                <div className="sectionTitle">유료 전환 후보</div>
                <div className="storeMiniList">
                  {nonPaidActiveStores.slice(0, 5).map((r) => (
                    <div key={r.store_id} className="storeMini" role="button" tabIndex={0} onClick={() => setSelectedStoreId(r.store_id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedStoreId(r.store_id); }}>
                      <strong>{r.store_name || r.store_id}</strong>
                      <span className="muted">이번 달 주문 {r.monthly_order_count.toLocaleString()}건</span>
                    </div>
                  ))}
                  {nonPaidActiveStores.length === 0 ? <p className="muted">유료 전환 후보가 없습니다.</p> : null}
                </div>
              </div>
              <div>
                <div className="sectionTitle">주문 TOP 5</div>
                <div className="storeMiniList">
                  {topOrderStores.map((r, idx) => (
                    <div key={r.store_id} className="storeMini" role="button" tabIndex={0} onClick={() => setSelectedStoreId(r.store_id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedStoreId(r.store_id); }}>
                      <strong>{idx + 1}. {r.store_name || r.store_id}</strong>
                      <span className="muted">이번 달 주문 {r.monthly_order_count.toLocaleString()}건</span>
                    </div>
                  ))}
                  {topOrderStores.length === 0 ? <p className="muted">이번 달 주문이 없습니다.</p> : null}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>{renderStoreTable("orders")}</div>
          </article>
          {renderSelectedStore()}
        </section>
      ) : null}

      {!loading && activeTab === "tickets" ? (
        <section className="grid2">
          <article className="card">
            <div className="sectionTitle">문의/장애 통계</div>
            <div className="grid3">
              <div className="notice"><span>미처리</span><strong>{kpi.openTickets}건</strong></div>
              <div className="notice"><span>긴급</span><strong>{kpi.urgentTickets}건</strong></div>
              <div className="notice"><span>오늘 신규</span><strong>{kpi.todayNewTickets}건</strong></div>
            </div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <div>
                <div className="sectionTitle">상태별</div>
                {Object.entries(ticketStatusCounts).map(([label, count]) => <div key={label} className="barRow"><span>{label}</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(count, maxTicketStatus)}%` }} /></div><strong>{count}</strong></div>)}
              </div>
              <div>
                <div className="sectionTitle">카테고리별</div>
                {Object.entries(ticketCategoryCounts).map(([label, count]) => <div key={label} className="barRow"><span>{label}</span><div className="barTrack"><div className="barFill" style={{ width: `${maxBar(count, maxTicketCategory)}%` }} /></div><strong>{count}</strong></div>)}
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="sectionTitle">우선순위별</div>
              <div className="row">{Object.entries(ticketPriorityCounts).map(([label, count]) => <span key={label} className={`pill ${label === "긴급" ? "danger" : ""}`}>{label} {count}</span>)}</div>
            </div>
          </article>
          <article className="card">
            <div className="sectionTitle">문의/장애 관리</div>
            {ticketMsg ? <p className="muted">{ticketMsg}</p> : null}
            <div className="filters">
              <select className="select" value={ticketStatusFilter} onChange={(e) => setTicketStatusFilter(e.target.value as TicketStatusFilter)}>
                <option value="all">상태 전체</option>
                <option value="open">접수</option>
                <option value="in_progress">처리 중</option>
                <option value="resolved">답변 완료</option>
                <option value="closed">종료</option>
              </select>
              <select className="select" value={ticketPriorityFilter} onChange={(e) => setTicketPriorityFilter(e.target.value as TicketPriorityFilter)}>
                <option value="all">우선순위 전체</option>
                <option value="urgent">긴급</option>
                <option value="high">높음</option>
                <option value="normal">보통</option>
                <option value="low">낮음</option>
              </select>
              <select className="select" value={ticketCategoryFilter} onChange={(e) => setTicketCategoryFilter(e.target.value as TicketCategoryFilter)}>
                <option value="all">카테고리 전체</option>
                <option value="billing">결제/구독</option>
                <option value="bug">오류</option>
                <option value="improvement">개선요청</option>
                <option value="inquiry">문의</option>
                <option value="etc">기타</option>
              </select>
            </div>
            <div className="ticketList">
              {filteredTickets.length === 0 ? <p className="muted">조건에 맞는 티켓이 없습니다.</p> : null}
              {filteredTickets.slice(0, 12).map((t) => (
                <div key={t.id} className={`ticket ${selectedTicket?.id === t.id ? "selectedTicket" : ""}`} role="button" tabIndex={0} onClick={() => setSelectedTicketId(t.id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedTicketId(t.id); }}>
                  <div className="ticketTop">
                    <div>
                      <div className="ticketTitle">#{t.id} [{t.store_id}] {t.title}</div>
                      <p className="muted">{ticketCategoryLabel(t.category)} · {ticketPriorityLabel(t.priority)} · 등록 {fmtDateTime(t.created_at)}</p>
                    </div>
                    <span className={`pill ${t.priority === "urgent" ? "danger" : ACTIVE_TICKET_STATUSES.has(t.status) ? "warn" : "ok"}`}>{ticketStatusLabel(t.status)}</span>
                  </div>
                  {t.body ? <p style={{ margin: 0, fontSize: 13 }}>{t.body}</p> : null}
                </div>
              ))}
            </div>
            {selectedTicket ? (
              <div className="ticketDetail">
                <div className="sectionTitle">선택 티켓 상세</div>
                <p className="muted">#{selectedTicket.id} · {selectedTicket.store_id} · {ticketCategoryLabel(selectedTicket.category)} · {ticketPriorityLabel(selectedTicket.priority)}</p>
                <strong>{selectedTicket.title}</strong>
                {selectedTicket.body ? <p style={{ margin: 0 }}>{selectedTicket.body}</p> : null}
                <textarea className="textarea" placeholder="OPS 답변/처리 메모" value={ticketDrafts[selectedTicket.id] ?? ""} onChange={(e) => setTicketDrafts((prev) => ({ ...prev, [selectedTicket.id]: e.target.value }))} />
                <div className="row">
                  <button className="btn primary" onClick={() => void updateTicket(selectedTicket.id, { ops_note: (ticketDrafts[selectedTicket.id] || "").trim() || null })}>메모 저장</button>
                  <button className="btn" onClick={() => void updateTicket(selectedTicket.id, { status: "open" })}>접수</button>
                  <button className="btn" onClick={() => void updateTicket(selectedTicket.id, { status: "in_progress" })}>처리 중</button>
                  <button className="btn" onClick={() => void updateTicket(selectedTicket.id, { status: "resolved" })}>답변 완료</button>
                  <button className="btn danger" onClick={() => void updateTicket(selectedTicket.id, { status: "closed" })}>종료</button>
                </div>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {!loading && activeTab === "settings" ? (
        <section className="settingsGrid">
          <article className="card">
            <div className="sectionTitle">등록된 플랫폼 PG</div>
            <div className="infoGrid">
              <span>MID</span><strong>{savedPg?.mid || "-"}</strong>
              <span>Client Key</span><strong>{savedPg?.clientKey ? maskToken(savedPg.clientKey) : "-"}</strong>
              <span>Secret Key</span><strong>{savedPg?.hasSecret ? "********(등록됨)" : "-"}</strong>
              <span>최근 수정</span><strong>{fmtDateTime(savedPg?.updatedAt || null)}</strong>
            </div>
            <p className="muted">Secret Key는 저장 후 다시 표시되지 않습니다. 비워두면 기존 Secret Key가 유지되고, 변경할 때만 새 값을 입력합니다.</p>
          </article>
          <article className="card">
            <div className="sectionTitle">플랫폼 PG 연결 변경</div>
            <p className="muted">점주 구독 결제는 플랫폼 사업자 PG 공통 MID 기준으로 처리합니다.</p>
            <div className="noticeList" style={{ marginTop: 12 }}>
              <input className="input" placeholder="MID" value={pgForm.mid} onChange={(e) => setPgForm((p) => ({ ...p, mid: e.target.value }))} />
              <input className="input" placeholder="Client Key" value={pgForm.clientKey} onChange={(e) => setPgForm((p) => ({ ...p, clientKey: e.target.value }))} />
              <input className="input" type="password" placeholder="Secret Key (변경 시에만 입력)" value={pgForm.secretKey} onChange={(e) => setPgForm((p) => ({ ...p, secretKey: e.target.value }))} />
              <button className="btn primary" onClick={savePg}>PG 저장</button>
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
