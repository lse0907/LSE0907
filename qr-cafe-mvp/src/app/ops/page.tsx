"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { maskToken } from "@/app/lib/billingSettings";
import RionBrand from "@/app/components/RionBrand";
import OpsIcon, { type OpsIconName } from "./_components/OpsIcon";
import OpsBusinessVerifications from "./business-verifications/page";
import OpsPrivacyRequests from "./privacy-requests/OpsPrivacyRequests";
import OpsAiUsage from "./ai-usage/page";
import OpsSupportDesk from "./support/OpsSupportDesk";

type OpsTab = "overview" | "stores" | "subscriptions" | "payments" | "businessVerification" | "privacyRequests" | "ai" | "tickets" | "settings";
type OpsPrimaryTab = "overview" | "merchant" | "billing" | "support" | "system";
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
  trial_end_at: string | null;
  founder_member: boolean;
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
  trial_end_at: string | null;
};
type FounderStoreRow = { storeId: string; founderMember: boolean };
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
type OrderCancelCaseRow = {
  id: string;
  order_id: string;
  store_id: string;
  status: string;
  attempt_count: number;
  pg_status: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  requested_at: string;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  completed_at: string | null;
  updated_at: string;
  kind?: "full" | "partial";
  refund_amount?: number | null;
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

type OpsWorkQueue = {
  businessVerificationCount: number;
  privacyRequestCount: number;
  oldestBusinessVerificationAt: string | null;
  oldestPrivacyRequestAt: string | null;
  loading: boolean;
  businessVerificationError: string;
  privacyRequestError: string;
};

type AiOpsSignal = { loading: boolean; error: string; blockedCount: number; failedCount: number; monthlyCostRate: number | null };

const NAV_GROUPS: Array<{ id: OpsPrimaryTab; label: string; icon: OpsIconName; tabs: Array<{ id: OpsTab; label: string; icon: OpsIconName }> }> = [
  { id: "overview", label: "대시보드", icon: "dashboard", tabs: [{ id: "overview", label: "대시보드", icon: "dashboard" }] },
  { id: "merchant", label: "점주·매장", icon: "store", tabs: [{ id: "stores", label: "매장·점주 관리", icon: "store" }, { id: "businessVerification", label: "사업자 인증", icon: "shield" }] },
  { id: "billing", label: "구독·결제", icon: "card", tabs: [{ id: "subscriptions", label: "구독 관리", icon: "card" }, { id: "payments", label: "결제·환불", icon: "card" }] },
  { id: "support", label: "지원·장애", icon: "support", tabs: [{ id: "tickets", label: "문의·장애", icon: "support" }] },
  { id: "system", label: "시스템·정책", icon: "settings", tabs: [{ id: "ai", label: "AI 운영", icon: "sparkles" }, { id: "privacyRequests", label: "개인정보 요청", icon: "privacy" }, { id: "settings", label: "시스템 설정", icon: "settings" }] },
];

function primaryForTab(tab: OpsTab): OpsPrimaryTab {
  if (tab === "stores" || tab === "businessVerification") return "merchant";
  if (tab === "subscriptions" || tab === "payments") return "billing";
  if (tab === "tickets") return "support";
  if (tab === "ai" || tab === "privacyRequests" || tab === "settings") return "system";
  return "overview";
}

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

function queueAgeLabel(raw: string | null, emptyLabel: string) {
  if (!raw) return emptyLabel;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "접수 시점을 확인해 주세요.";
  const days = Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)));
  return days === 0 ? "가장 오래된 요청이 오늘 접수되었습니다." : `가장 오래된 요청이 ${days}일 경과했습니다.`;
}

function subscriptionStatusLabel(status: string) {
  if (status === "active") return "유료 구독 중";
  if (status === "trialing") return "무료 체험 중";
  if (status === "past_due") return "결제 확인 필요";
  if (status === "canceled" || status === "cancelled") return "구독 해지";
  if (status === "inactive" || !status) return "미구독";
  return "상태 확인 필요";
}

function subscriptionTone(status: string) {
  if (status === "active") return "ok";
  if (status === "trialing") return "trial";
  if (status === "past_due") return "warn";
  if (status === "canceled" || status === "cancelled") return "danger";
  return "neutral";
}

function usageEndAt(row: StoreOpsRow) {
  return row.base_plan_status === "active" ? row.paid_until : row.base_plan_status === "trialing" ? row.trial_end_at : null;
}

function isExpiringSoon(raw: string | null) {
  const d = remainingDays(raw);
  return d != null && d >= 0 && d <= 7;
}

function isActiveTicket(status: string) {
  return ACTIVE_TICKET_STATUSES.has(status);
}

function addDaysToDateInput(raw: string, days: number) {
  const base = raw ? new Date(`${raw}T12:00:00`) : new Date();
  if (!Number.isFinite(base.getTime())) return ymd(new Date());
  base.setDate(base.getDate() + days);
  return ymd(base);
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
  if (status === "retryable") return "재시도 대기";
  if (status === "pg_cancelled") return "PG 취소 확인";
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
  if (isExpiringSoon(usageEndAt(row))) return "만료임박";
  if (row.base_plan_status !== "active" && row.base_plan_status !== "trialing") return "구독확인";
  if (!row.setup_completed) return "설정필요";
  if (row.monthly_order_count === 0) return "주문없음";
  return "정상";
}

function storeRiskRank(row: StoreOpsRow) {
  if (row.urgent_ticket_count > 0) return 10;
  if (isExpiringSoon(usageEndAt(row))) return 9;
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
  if (isExpiringSoon(usageEndAt(row)))
    return "이용 종료일이 가까워 갱신 또는 체험 기간 확인이 필요합니다.";
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
  const [trialEditorOpen, setTrialEditorOpen] = useState(false);
  const [trialMessage, setTrialMessage] = useState("");
  const [refundRows, setRefundRows] = useState<RefundHistoryRow[]>([]);
  const [refundCases, setRefundCases] = useState<RefundCaseRow[]>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundStatusFilter, setRefundStatusFilter] = useState("all");
  const [refundActionNotice, setRefundActionNotice] = useState<{ paymentId: number; tossStatus: string; localStatus: string; kind: "info" | "success" } | null>(null);
  const [refundSyncTarget, setRefundSyncTarget] = useState<RefundCaseRow | null>(null);
  const [refundSyncReason, setRefundSyncReason] = useState("");
  const [refundActionId, setRefundActionId] = useState<number | null>(null);
  const [orderCancelCases, setOrderCancelCases] = useState<OrderCancelCaseRow[]>([]);
  const [orderCancelLoading, setOrderCancelLoading] = useState(false);
  const [orderCancelActionId, setOrderCancelActionId] = useState<string | null>(null);
  const [orderCancelReasons, setOrderCancelReasons] = useState<Record<string, string>>({});
  const [subscriptionActivityOpen, setSubscriptionActivityOpen] = useState(false);
  const [opsWorkQueue, setOpsWorkQueue] = useState<OpsWorkQueue>({
    businessVerificationCount: 0,
    privacyRequestCount: 0,
    oldestBusinessVerificationAt: null,
    oldestPrivacyRequestAt: null,
    loading: true,
    businessVerificationError: "",
    privacyRequestError: "",
  });
  const [aiOpsSignal, setAiOpsSignal] = useState<AiOpsSignal>({ loading: true, error: "", blockedCount: 0, failedCount: 0, monthlyCostRate: null });
  const isOpsMaster = opsIdentity.role === "master";
  const canManageBilling = isOpsMaster || opsIdentity.role === "billing";

  const loadOpsWorkQueue = useCallback(async () => {
    setOpsWorkQueue((current) => ({ ...current, loading: true, businessVerificationError: "", privacyRequestError: "" }));
    const [businessResponse, privacyResponse] = await Promise.all([
      fetch("/api/ops/business-verifications?status=submitted&summary=1", { cache: "no-store" }),
      fetch("/api/ops/privacy-requests?status=open&summary=1", { cache: "no-store" }),
    ]);
    const [businessPayload, privacyPayload] = await Promise.all([
      businessResponse.json().catch(() => ({})),
      privacyResponse.json().catch(() => ({})),
    ]);

    setOpsWorkQueue({
      businessVerificationCount: businessResponse.ok && businessPayload?.ok ? Number(businessPayload.count || 0) : 0,
      privacyRequestCount: privacyResponse.ok && privacyPayload?.ok ? Number(privacyPayload.count || 0) : 0,
      oldestBusinessVerificationAt: businessResponse.ok && businessPayload?.ok ? String(businessPayload.oldestSubmittedAt || "") || null : null,
      oldestPrivacyRequestAt: privacyResponse.ok && privacyPayload?.ok ? String(privacyPayload.oldestRequestedAt || "") || null : null,
      loading: false,
      businessVerificationError: businessResponse.ok && businessPayload?.ok ? "" : "사업자 인증 데이터 준비 상태를 확인해야 합니다.",
      privacyRequestError: privacyResponse.ok && privacyPayload?.ok ? "" : "개인정보 요청 데이터를 불러오지 못했습니다.",
    });
  }, []);

  const loadAiOpsSignal = useCallback(async () => {
    setAiOpsSignal((current) => ({ ...current, loading: true, error: "" }));
    const response = await fetch("/api/ops/ai-usage?summary=1", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const limit = Number(payload?.summary?.monthlyLimitWon || 0);
    const used = Number(payload?.summary?.monthCost || 0);
    setAiOpsSignal({
      loading: false,
      error: response.ok && payload?.ok ? "" : "AI 운영 상태를 불러오지 못했습니다.",
      blockedCount: response.ok && payload?.ok ? Number(payload?.summary?.blockedCount || 0) : 0,
      failedCount: response.ok && payload?.ok ? Number(payload?.summary?.failedCount || 0) : 0,
      monthlyCostRate: response.ok && payload?.ok && limit > 0 ? Math.round((used / limit) * 100) : null,
    });
  }, []);

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
      founderRes,
    ] = await Promise.all([
      storesQuery,
      supabase
        .from("store_billing")
        .select("store_id, base_plan_status, paid_until, trial_end_at"),
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
      fetch("/api/ops/store-benefits?summary=1", { cache: "no-store" }),
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
    const founderPayload = await founderRes.json().catch(() => ({}));
    const founderRows = founderRes.ok && founderPayload?.ok ? (founderPayload.rows || []) as FounderStoreRow[] : [];
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
    const founderMap = new Map<string, boolean>();

    for (const item of founderRows) {
      if (item.storeId) founderMap.set(item.storeId, item.founderMember);
    }

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
        trial_end_at: billMap.get(s.store_id)?.trial_end_at || null,
        founder_member: founderMap.get(String(s.store_id)) === true,
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
      void loadOpsWorkQueue();
      void loadAiOpsSignal();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOps, loadOps, loadOpsWorkQueue, loadAiOpsSignal]);

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

  const loadOrderCancelCases = useCallback(async () => {
    if (isOps !== true || !canManageBilling) return;
    setOrderCancelLoading(true);
    const response = await fetch("/api/ops/order-cancel-reconcile", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) setOrderCancelCases((result.cases || []) as OrderCancelCaseRow[]);
    else setMsg(String(result?.message || "주문 결제취소 예외건을 불러오지 못했습니다."));
    setOrderCancelLoading(false);
  }, [canManageBilling, isOps]);

  const reconcileOrderCancel = async (attemptId: string, action: "inspect" | "retry", kind: "full" | "partial" = "full") => {
    const reason = String(orderCancelReasons[attemptId] || "").trim();
    if (reason.length < 2) {
      setMsg("주문 결제취소 확인·재시도 사유를 2자 이상 입력해 주세요.");
      return;
    }
    setOrderCancelActionId(attemptId);
    const response = await fetch("/api/ops/order-cancel-reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId, action, reason, kind }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result?.ok) {
      setMsg(result.state === "refunded" ? "주문 결제취소 상태를 환불 완료로 동기화했습니다." : "PG 상태를 확인했으며 아직 결제취소 처리 중입니다.");
      await loadOrderCancelCases();
    } else {
      setMsg(String(result?.message || "주문 결제취소 확인에 실패했습니다."));
    }
    setOrderCancelActionId(null);
  };

  useEffect(() => {
    if (activeTab !== "payments") return;
    const timer = window.setTimeout(() => void Promise.all([loadRefundHistory(), loadOrderCancelCases()]), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadOrderCancelCases, loadRefundHistory]);

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
        (subFilter === "trialing" && r.base_plan_status === "trialing") ||
        (subFilter === "inactive" && r.base_plan_status !== "active" && r.base_plan_status !== "trialing") ||
        (subFilter === "expiring" && isExpiringSoon(usageEndAt(r)));
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
          (remainingDays(usageEndAt(a)) ?? 99999) -
          (remainingDays(usageEndAt(b)) ?? 99999)
        );
      return storeRiskRank(b) - storeRiskRank(a);
    });

    return next;
  }, [query, rows, sortBy, subFilter, ticketFilter]);

  const subscriptionRows = useMemo(
    () => filteredRows.filter((row) => row.status !== "deleted"),
    [filteredRows],
  );

  const subscriptionBaseRows = useMemo(
    () => rows.filter((row) => row.status !== "deleted"),
    [rows],
  );

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
        .sort((a, b) => {
          const riskDiff = storeRiskRank(b) - storeRiskRank(a);
          if (riskDiff) return riskDiff;
          return (usageEndAt(a) || "9999-12-31").localeCompare(usageEndAt(b) || "9999-12-31");
        })
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
  const subscriptionPaidStores = subscriptionBaseRows.filter((r) => r.base_plan_status === "active").length;
  const subscriptionTrialStores = subscriptionBaseRows.filter((r) => r.base_plan_status === "trialing").length;
  const subscriptionExpiringStores = subscriptionBaseRows.filter((r) => isExpiringSoon(usageEndAt(r))).length;
  const todayOrders = rows.reduce((a, c) => a + c.today_order_count, 0);
  const noPaymentPaidStores = rows.filter(
    (r) => r.base_plan_status === "active" && r.paid_count === 0,
  );
  const subscriptionCheckCount =
    noPaymentPaidStores.length + kpi.expiringSoonStores;
  const opsQueueCount =
    opsWorkQueue.businessVerificationCount + opsWorkQueue.privacyRequestCount;
  const opsQueueHasError = Boolean(
    opsWorkQueue.businessVerificationError || opsWorkQueue.privacyRequestError,
  );
  const aiOpsNeedsAttention = Boolean(aiOpsSignal.error || aiOpsSignal.blockedCount > 0 || aiOpsSignal.failedCount > 0 || (aiOpsSignal.monthlyCostRate || 0) >= 80);
  const immediateActionCount =
    kpi.openTickets + opsQueueCount + subscriptionCheckCount;
  const activePrimary = primaryForTab(activeTab);
  const activeNavGroup = NAV_GROUPS.find((group) => group.id === activePrimary) || NAV_GROUPS[0];
  const availableNavTabs = activeNavGroup.tabs.filter(
    (tab) => tab.id !== "settings" || isOpsMaster,
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
    if (!selectedStoreId || !benefitForm.founderReason.trim()) { setMsg("베타 테스터 혜택 설정 사유를 입력해 주세요."); return; }
    if (benefitForm.founderAddon && !window.confirm("선결제 베타 테스트 참여를 확인했습니까? 옵션 구독 40% 할인이 적용됩니다.")) return;
    setBenefitSaving(true);
    const response = await fetch("/api/ops/store-benefits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: selectedStoreId, founderMember: benefitForm.founderMember, founderBase: benefitForm.founderBase, founderAddon: benefitForm.founderAddon, founderReason: benefitForm.founderReason }) });
    const result = await response.json().catch(() => ({}));
    setMsg(response.ok && result?.ok ? "베타 테스터 혜택을 저장했습니다." : String(result?.message || "혜택 저장에 실패했습니다."));
    if (response.ok && result?.ok) { setBenefit(result.benefit); setBenefitEditorOpen(false); }
    setBenefitSaving(false);
  };

  const saveTrial = async () => {
    setTrialMessage("");
    if (!isOpsMaster) { setTrialMessage("마스터 권한만 무료 체험 기간을 변경할 수 있습니다."); return; }
    if (!selectedStoreId) { setTrialMessage("매장을 다시 선택해 주세요."); return; }
    if (!benefitForm.trialEndAt) { setTrialMessage("무료 체험 종료일을 선택해 주세요."); return; }
    if (!benefitForm.trialReason.trim()) { setTrialMessage("무료 체험 시작 또는 연장 사유를 입력해 주세요."); return; }
    if (benefit?.trialEndAt && new Date(`${benefitForm.trialEndAt}T23:59:59+09:00`).getTime() <= new Date(benefit.trialEndAt).getTime()) { setTrialMessage("현재 종료일보다 이후 날짜를 선택해 주세요."); return; }
    setBenefitSaving(true);
    const trialEndAt = benefitForm.trialEndAt ? new Date(`${benefitForm.trialEndAt}T23:59:59+09:00`).toISOString() : null;
    const response = await fetch("/api/ops/store-benefits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: selectedStoreId, trialEndAt, trialReason: benefitForm.trialReason }) });
    const result = await response.json().catch(() => ({}));
    const resultMessage = response.ok && result?.ok ? `무료 체험을 ${fmtDate(result.benefit?.trialEndAt || trialEndAt)}까지 적용했습니다.` : String(result?.message || "무료 체험 조정에 실패했습니다.");
    setTrialMessage(resultMessage);
    setMsg(resultMessage);
    if (response.ok && result?.ok) {
      setBenefit(result.benefit);
      setBenefitForm((prev) => ({ ...prev, trialReason: "" }));
      await loadOps();
    }
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
            const periodEnd = usageEndAt(r);
            const days = remainingDays(periodEnd);
            const dday = days != null ? `D-${Math.max(0, days)}` : "-";
            return (
              <tr
                key={r.store_id}
                className={`${r.store_id === selectedStore?.store_id ? "sel" : ""} ${r.status === "deleted" ? "deletedRow" : ""}`}
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
                        <div className="nameWithBadge"><strong>{r.store_name || r.store_id}</strong>{r.founder_member ? <span className="pill founder" title="베타 테스터 혜택 적용 매장">베타</span> : null}</div>
                        <small>{r.store_id}</small>
                      </div>
                    </td>
                    <td>
                      <span className={`pill ${subscriptionTone(r.base_plan_status)}`}>{subscriptionStatusLabel(r.base_plan_status)}</span>
                    </td>
                    <td>
                      <div className="cellMain">
                        <strong>{fmtDate(periodEnd)}</strong>
                        <small>{periodEnd ? dday : "기간 없음"}</small>
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
                        <div className="nameWithBadge"><strong>{r.store_name || r.store_id}</strong>{r.founder_member ? <span className="pill founder" title="베타 테스터 혜택 적용 매장">베타</span> : null}</div>
                        <small>{r.store_id}</small>
                      </div>
                    </td>
                    <td>
                      <div className="pillStack">
                        <span
                          className={`pill ${r.status === "deleted" ? "danger" : storeStatusLabel(r) === "운영중" ? "ok" : "warn"}`}
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
                        <span className={`pill ${subscriptionTone(r.base_plan_status)}`}>{subscriptionStatusLabel(r.base_plan_status)}</span>
                        <small>{periodEnd ? `${fmtDate(periodEnd)} · ${days != null && days < 0 ? `만료 ${Math.abs(days)}일` : dday}` : "기간 없음"}</small>
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
              <strong>{subscriptionStatusLabel(selectedStore.base_plan_status)}</strong>
            </div>
            <div className="metric">
              <span>이용 종료일</span>
              <strong>{fmtDate(usageEndAt(selectedStore))}</strong>
            </div>
            <div className="metric">
              <span>남은 기간</span>
              <strong>
                {remainingDays(usageEndAt(selectedStore)) != null
                  ? `D-${Math.max(0, Number(remainingDays(usageEndAt(selectedStore))))}`
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
            <div className="sectionTitle">베타 테스터 혜택</div>
            <p className="muted">{benefit ? `${benefit.storeSequence}번째 매장 · ${benefit.founderMember ? "베타 테스터" : "일반 점주"}` : "혜택 정보 확인 중..."}</p>
            <div className="benefitSummary"><span>기본 구독 40%</span><strong>{benefit?.founderBase ? "적용" : "미적용"}</strong><span>선결제 옵션 40%</span><strong>{benefit?.founderAddon ? "적용" : "미적용"}</strong></div>
            <button className="btn primary" disabled={!canManageBilling} onClick={() => setBenefitEditorOpen(true)}>{canManageBilling ? "베타 테스터 혜택 변경" : "조회 전용"}</button>
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

  const renderSubscriptionTable = () => (
    <div className="tableWrap subscriptionTableWrap">
      <table className="opsTable subscriptionTable">
        <thead><tr><th>매장·점주</th><th>구독 상태</th><th>이용 기간</th><th>이번 달 결제</th><th>운영 확인</th></tr></thead>
        <tbody>
          {subscriptionRows.map((r) => {
            const periodEnd = usageEndAt(r);
            const days = remainingDays(periodEnd);
            return (
              <tr key={r.store_id} className={r.store_id === selectedStore?.store_id ? "sel" : ""} tabIndex={0} onClick={() => { setSelectedStoreId(r.store_id); setSubscriptionActivityOpen(false); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedStoreId(r.store_id); setSubscriptionActivityOpen(false); } }}>
                <td data-label="매장"><div className="cellMain"><strong>{r.store_name || r.store_id}</strong><small>매장 ID {r.store_id} · 점주 {shortId(r.owner_user_id)}</small></div></td>
                <td data-label="구독 상태"><span className={`pill ${subscriptionTone(r.base_plan_status)}`}>{subscriptionStatusLabel(r.base_plan_status)}</span></td>
                <td data-label="이용 기간"><div className="cellMain"><strong>{fmtDate(periodEnd)}</strong><small>{days != null ? days < 0 ? `만료 ${Math.abs(days)}일 경과` : `D-${days}` : "기간 없음"}</small></div></td>
                <td data-label="이번 달 결제"><div className="cellMain"><strong>{fmtMoney(r.monthly_revenue)}</strong><small>{r.paid_count.toLocaleString()}건</small></div></td>
                <td data-label="운영 확인"><span className={`pill ${storeRiskLabel(r) === "정상" ? "ok" : "warn"}`}>{storeRiskLabel(r)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {subscriptionRows.length === 0 ? <p className="emptyState">조건에 맞는 구독 매장이 없습니다. 필터를 초기화해 다시 확인해 주세요.</p> : null}
    </div>
  );

  const renderSubscriptionDetail = () => (
    <aside className="card detailCard subscriptionDetail">
      {selectedStore ? (
        <>
          <div className="storeDetailHeader">
            <div><div className="eyebrow">구독 상세</div><h3>{selectedStore.store_name || selectedStore.store_id}</h3><p className="muted">매장 ID {selectedStore.store_id} · 점주 {shortId(selectedStore.owner_user_id)}</p></div>
            <div className="pillStack right"><span className={`pill ${subscriptionTone(selectedStore.base_plan_status)}`}>{subscriptionStatusLabel(selectedStore.base_plan_status)}</span></div>
          </div>
          <div className={`insight ${selectedStore.base_plan_status === "active" || selectedStore.base_plan_status === "trialing" ? "ok" : "warn"}`}><strong>구독 운영 판단</strong><span>{selectedStore.base_plan_status === "active" ? `유료 구독 중이며 종료일까지 ${Math.max(0, remainingDays(selectedStore.paid_until) || 0)}일 남았습니다.` : selectedStore.base_plan_status === "trialing" ? `무료 체험 중이며 종료일까지 ${Math.max(0, remainingDays(selectedStore.trial_end_at) || 0)}일 남았습니다.` : "현재 이용 중인 구독이나 무료 체험이 없습니다."}</span></div>
          <dl className="subscriptionFacts">
            <div><dt>현재 상태</dt><dd>{subscriptionStatusLabel(selectedStore.base_plan_status)}</dd></div>
            <div><dt>이용 종료일</dt><dd>{fmtDate(usageEndAt(selectedStore))}</dd></div>
            <div><dt>남은 기간</dt><dd>{remainingDays(usageEndAt(selectedStore)) != null ? `D-${Math.max(0, Number(remainingDays(usageEndAt(selectedStore))))}` : "-"}</dd></div>
            <div><dt>이번 달 결제</dt><dd>{fmtMoney(selectedStore.monthly_revenue)} · {selectedStore.paid_count.toLocaleString()}건</dd></div>
          </dl>
          <section className="trialManagementRow">
            <div><div className="sectionTitle">무료 체험</div><p>{benefit?.baseStatus === "trialing" ? `${fmtDate(benefit.trialEndAt)}까지 · ${Math.max(0, Number(remainingDays(benefit.trialEndAt)))}일 남음` : benefit?.baseStatus === "active" || benefit?.paidUntil ? "유료 구독 중인 매장은 무료 체험을 변경할 수 없습니다." : "현재 적용된 무료 체험 기간이 없습니다."}</p></div>
            {benefit?.baseStatus === "active" || benefit?.paidUntil ? <span className="pill ok">유료 구독 중</span> : isOpsMaster ? <button className="btn primary" onClick={() => { setTrialMessage(""); setTrialEditorOpen(true); }}>{benefit?.trialEndAt ? "기간 연장" : "무료 체험 시작"}</button> : <span className="lockedHint">마스터 권한에서 관리</span>}
          </section>
          <button className="activityToggle" type="button" aria-expanded={subscriptionActivityOpen} onClick={() => setSubscriptionActivityOpen((open) => !open)}><span>매장 활동 참고 정보</span><strong>{subscriptionActivityOpen ? "접기" : "펼치기"}</strong></button>
          {subscriptionActivityOpen ? <div className="activityGrid"><div><span>오늘 주문</span><strong>{selectedStore.today_order_count.toLocaleString()}건</strong></div><div><span>이번 달 주문</span><strong>{selectedStore.monthly_order_count.toLocaleString()}건</strong></div><div><span>미처리 문의</span><strong>{selectedStore.open_ticket_count.toLocaleString()}건</strong></div><div><span>최근 주문</span><strong>{fmtDateTime(selectedStore.last_order_at)}</strong></div></div> : null}
          <div className="subscriptionLinks"><button className="btn" onClick={() => setActiveTab("payments")}>결제·환불 보기</button><button className="btn" onClick={() => setActiveTab("tickets")}>문의 보기</button></div>
        </>
      ) : <p className="muted">선택된 매장이 없습니다.</p>}
    </aside>
  );

  return (
    <main className="wrap opsConsole">
      <style jsx global>{`
        :root { --ops-navy:#0f1f3d; --ops-charcoal:#2b2f36; --ops-muted:#667085; --ops-line:#e1e5eb; --ops-canvas:#f3f5f8; }
        body { background:var(--ops-canvas); color:var(--ops-charcoal); }
        .wrap {
          width: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding: 28px clamp(24px, 2.4vw, 40px) 48px;
          display: grid;
          gap: 18px;
          color: var(--ops-charcoal);
        }
        .hero {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          padding:18px 20px;
          border-radius:18px;
          color:#fff;
          background:linear-gradient(120deg,#0b172f,#0f1f3d 62%,#182f59);
          box-shadow:0 18px 45px rgba(15,31,61,.14);
        }
        .heroBrand { display:flex; align-items:center; gap:22px; min-width:0; }
        .heroMeta { padding-left:18px; border-left:1px solid rgba(255,255,255,.18); }
        .heroMeta strong { display:block; font-size:14px; }
        .heroMeta .sub { color:#c6d0df; }
        .liveBadge { display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(255,255,255,.1);font-size:10px;font-weight:950;letter-spacing:.08em; }
        .liveBadge::before { content:"";width:6px;height:6px;border-radius:50%;background:#6ee7b7;box-shadow:0 0 0 3px rgba(110,231,183,.15); }
        .benefitBox { display:grid; gap:9px; padding:14px; border:1px solid #dbeafe; background:#f8fbff; border-radius:14px; }
        .benefitSummary { display:grid; grid-template-columns:1fr auto; gap:7px 12px; font-size:12px; }
        .benefitSummary strong { color:#1d4ed8; }
        .checkRow { display:flex; align-items:center; gap:9px; font-weight:800; font-size:13px; }
        .checkRow input { width:18px; height:18px; }
        .trialControls { display:grid; gap:8px; padding-top:10px; border-top:1px solid #dbeafe; }
        .trialControls label { display:grid; gap:6px; font-size:12px; font-weight:800; }
        .subscriptionShell { display:grid; grid-template-columns:minmax(0,2.15fr) minmax(400px,.85fr); gap:18px; align-items:start; }
        .subscriptionMain { display:grid; gap:14px; min-width:0; }
        .subscriptionKpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .subscriptionKpi { border:1px solid #e2e8f0; border-radius:14px; padding:13px 14px; background:linear-gradient(145deg,#fff,#f8fafc); display:grid; gap:5px; }
        .subscriptionKpi span { color:#64748b; font-size:12px; font-weight:800; }
        .subscriptionKpi strong { font-size:20px; }
        .subscriptionKpi small { color:#64748b; }
        .subscriptionToolbar { display:grid; grid-template-columns:minmax(220px,1fr) 170px 170px auto; gap:9px; }
        .subscriptionResult { display:flex; justify-content:space-between; gap:10px; align-items:center; color:#64748b; font-size:12px; font-weight:800; }
        .subscriptionDetail { display:grid; gap:14px; }
        .eyebrow { color:#2563eb; font-size:11px; font-weight:950; letter-spacing:.08em; text-transform:uppercase; }
        .subscriptionFacts { margin:0; display:grid; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; }
        .subscriptionFacts div { display:flex; justify-content:space-between; gap:16px; padding:11px 12px; border-bottom:1px solid #eef2f7; }
        .subscriptionFacts div:last-child { border-bottom:0; }
        .subscriptionFacts dt { color:#64748b; font-size:12px; font-weight:800; }
        .subscriptionFacts dd { margin:0; text-align:right; font-size:13px; font-weight:900; }
        .benefitSummaryCard { display:grid; gap:11px; padding:14px; border:1px solid #dbeafe; background:#f8fbff; border-radius:14px; }
        .trialManagementRow { display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 16px;border:1px solid #b8d5ff;background:linear-gradient(145deg,#f7fbff,#eef6ff);border-radius:14px; }
        .trialManagementRow .sectionTitle { margin-bottom:4px; }
        .trialManagementRow p { margin:0;color:#64748b;font-size:12px;line-height:1.5; }
        .trialManagementRow .btn { flex:0 0 auto; }
        .lockedHint { color:#64748b;font-size:11px;font-weight:800;white-space:nowrap; }
        .trialPresetGrid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px; }
        .trialPresetGrid .btn { width:100%; }
        .trialPreview { display:grid;gap:8px;padding:13px;border:1px solid #b8d5ff;border-radius:12px;background:#f3f8ff; }
        .trialPreview div { display:flex;justify-content:space-between;gap:16px;font-size:13px; }
        .trialPreview span { color:#64748b; }
        .trialPreview strong { text-align:right; }
        .trialMessage { margin:0;padding:11px 12px;border:1px solid #bfdbfe;border-radius:11px;background:#eff6ff;color:#1e3a8a;font-size:12px;font-weight:800;line-height:1.5; }
        .activityToggle { width:100%; display:flex; justify-content:space-between; padding:12px; border:1px solid #e2e8f0; border-radius:12px; background:#fff; cursor:pointer; }
        .activityGrid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
        .activityGrid div { display:grid; gap:4px; padding:10px; border-radius:11px; background:#f8fafc; }
        .activityGrid span { color:#64748b; font-size:11px; font-weight:800; }
        .activityGrid strong { font-size:12px; word-break:break-word; }
        .subscriptionLinks { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding-top:12px; border-top:1px solid #eef2f7; }
        .emptyState {
          margin:0;
          padding:28px 20px;
          border:1px dashed #cbd7e6;
          border-radius:14px;
          background:#f8fafc;
          color:#64748b;
          text-align:center;
          line-height:1.55;
        }
        .opsAccount > div { display:grid; gap:2px; text-align:right; }
        .opsAccount small { color:#c6d0df; font-size:10px; font-weight:900; }
        .hero .btn { border-color:rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff; }
        .hero .btn:hover { background:rgba(255,255,255,.18); }
        .opsControl { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
        .opsControl svg { width:15px; height:15px; flex:0 0 auto; }
        .tab { display:inline-flex; align-items:center; gap:7px; }
        .tab svg { width:15px; height:15px; flex:0 0 auto; opacity:.72; }
        .tab.active svg { opacity:1; }
        .modalBackdrop { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:18px; background:rgba(15,23,42,.62); }
        .opsModal { width:min(460px,100%); display:grid; gap:14px; border-radius:18px; background:#fff; padding:22px; box-shadow:0 28px 80px rgba(15,23,42,.28); }
        .opsModal .opsField { display:grid;gap:7px;font-size:13px;font-weight:800; }
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
          border: 1px solid var(--ops-line);
          border-radius: 16px;
          background: #fff;
          padding: 18px;
          box-shadow: 0 8px 24px rgba(15,31,61,.04);
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
        .opsPulse {
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:20px;
          align-items:center;
          border-color:#c9dcf6;
          background:linear-gradient(115deg,#f7fbff 0%,#fff 62%);
        }
        .opsPulseCopy { display:grid; gap:6px; }
        .opsPulseLabel { display:inline-flex; align-items:center; gap:7px; color:#245797; font-size:11px; font-weight:950; letter-spacing:.08em; }
        .opsPulseLabel svg { width:15px; height:15px; }
        .opsPulse h2 { margin:0; font-size:clamp(19px,1.7vw,24px); letter-spacing:-.025em; }
        .opsPulse p { margin:0; color:#64748b; font-size:13px; line-height:1.5; }
        .opsPulseCount { display:grid; justify-items:end; gap:3px; text-align:right; }
        .opsPulseCount strong { font-size:clamp(28px,3vw,38px); line-height:1; letter-spacing:-.05em; }
        .opsPulseCount span { color:#64748b; font-size:12px; font-weight:850; }
        .immediateActionGrid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
        .aiOpsAlert { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:12px; padding:16px 18px; border-color:#f4cf77; background:#fffaf0; }
        .aiOpsAlert.danger { border-color:#ffc3cd; background:#fff6f7; }
        .aiOpsAlert > div { display:grid; gap:5px; }
        .aiOpsAlert span { display:flex; align-items:center; gap:6px; color:#9a6300; font-size:11px; font-weight:950; }
        .aiOpsAlert.danger span { color:#b42345; }
        .aiOpsAlert span svg { width:15px; height:15px; }
        .aiOpsAlert strong { font-size:14px; }
        .aiOpsAlert p { margin:0; color:#6b7280; font-size:12px; }
        .aiOpsAlert button { min-height:38px; padding:0 12px; border:1px solid #c9a856; border-radius:10px; background:#fff; color:#805500; font-size:12px; font-weight:900; white-space:nowrap; }
        .immediateAction {
          min-width:0; display:grid; gap:8px; padding:14px; border:1px solid #dfe6ef; border-radius:14px;
          background:#fff; color:var(--ops-charcoal); text-align:left; cursor:pointer;
          transition:border-color .16s ease, background .16s ease, transform .16s ease;
        }
        .immediateAction:hover { border-color:#8eadd3; background:#f6faff; transform:translateY(-1px); }
        .immediateAction:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
        .immediateAction:disabled { cursor:default; opacity:.72; }
        .immediateAction:disabled:hover { border-color:#f4d06c; background:#fffaf0; transform:none; }
        .immediateAction.warn { border-color:#f4d06c; background:#fffaf0; }
        .immediateAction.danger { border-color:#fecaca; background:#fff8f8; }
        .immediateActionTitle { display:flex; align-items:center; gap:7px; font-size:14px; font-weight:950; }
        .immediateActionTitle svg { width:16px; height:16px; color:#245797; flex:0 0 auto; }
        .immediateActionMeta { display:flex; justify-content:space-between; gap:8px; align-items:end; }
        .immediateAction small { color:#667085; font-size:11px; line-height:1.35; }
        .immediateAction b { font-size:21px; white-space:nowrap; }
        .tabs {
          display: flex;
          gap: 8px;
          overflow: auto;
          padding: 4px;
          border: 1px solid var(--ops-line);
          border-radius: 14px;
          background: #fff;
          box-shadow:0 5px 18px rgba(15,31,61,.035);
        }
        .primaryTabs {
          display:grid;
          grid-template-columns:repeat(5, minmax(0, 1fr));
          min-width:0;
          max-width:100%;
          overflow:visible;
          gap:6px;
          padding:5px;
        }
        .tab {
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:7px;
          border: 0;
          border-radius: 12px;
          padding: 10px 14px;
          background: transparent;
          color: #4b5563;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }
        .primaryTabs .tab { min-width:0; }
        .primaryTabs .tab:hover:not(.active) { background:#f3f6fa; color:#233a5e; }
        .opsNavigation {
          display:grid;
          grid-template-columns:repeat(5, minmax(0, 1fr));
          gap:0;
          margin-bottom:-4px;
          min-width:0;
          padding:5px;
          border:1px solid var(--ops-line);
          border-radius:14px;
          background:#fff;
          box-shadow:0 5px 18px rgba(15,31,61,.035);
        }
        .opsNavigation .primaryTabs {
          grid-column:1 / -1;
          padding:0;
          border:0;
          border-radius:10px;
          background:transparent;
          box-shadow:none;
        }
        .subNavContext {
          display:flex;
          align-items:center;
          justify-content:flex-start;
          grid-column:1 / -1;
          min-width:0;
          padding:5px 4px 0;
          border-top:1px solid #edf1f6;
        }
        .subTabs {
          display:flex;
          gap:2px;
          margin:0;
          padding:0 2px;
          min-width:0;
        }
        .subTabs button {
          position:relative;
          display:inline-flex;
          align-items:center;
          gap:7px;
          min-height:40px;
          padding:9px 14px;
          border:0;
          border-radius:8px;
          background:transparent;
          color:#526174;
          font-size:14px;
          font-weight:800;
          cursor:pointer;
          white-space:nowrap;
          transition:background .18s, color .18s;
        }
        .subTabs button svg { width:15px; height:15px; }
        .subTabs button:hover:not(.active) { background:#f3f6fa; color:#233a5e; }
        .subTabs button.active { background:transparent; color:#142b50; font-weight:950; }
        .subTabs button.active::after {
          content:"";
          position:absolute;
          left:14px;
          right:14px;
          bottom:0;
          height:3px;
          border-radius:999px;
          background:var(--ops-navy);
        }
        @media (min-width: 921px) {
          .opsNavigation.primary-overview .subNavContext { grid-column:1; }
          .opsNavigation.primary-merchant .subNavContext { grid-column:2 / span 2; }
          .opsNavigation.primary-billing .subNavContext { grid-column:3 / span 2; }
          .opsNavigation.primary-support .subNavContext { grid-column:4; }
          .opsNavigation.primary-system .subNavContext { grid-column:4 / -1; justify-content:flex-end; }
        }
        .tab.active {
          background: var(--ops-navy);
          color: #fff;
        }
        .btn {
          border: 1px solid #d1d5db;
          padding: 10px 12px;
          border-radius: 12px;
          background: #fff;
          color: var(--ops-charcoal);
          font-weight: 900;
          cursor: pointer;
          min-height: 42px;
          transition:transform .18s,box-shadow .18s,background .18s;
        }
        .btn.primary {
          background: var(--ops-navy);
          border-color: var(--ops-navy);
          color: #fff;
        }
        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08);
        }
        .btn:focus-visible,.tab:focus-visible,.input:focus-visible,.select:focus-visible,.textarea:focus-visible { outline:3px solid rgba(67,102,156,.32); outline-offset:2px; }
        .btn.danger {
          border-color: #fecaca;
          color: #b91c1c;
        }
        .grid2 {
          display: grid;
          grid-template-columns: minmax(0, 2.2fr) minmax(390px, 0.9fr);
          gap: 18px;
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
        .paymentStack { gap:14px; }
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
          padding: 15px 14px;
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
        .nameWithBadge { display:flex;align-items:center;gap:6px;flex-wrap:wrap; }
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
          box-shadow: inset 4px 0 0 var(--ops-navy);
        }
        tr:hover {
          background: #f8fafc;
        }
        tr.deletedRow { color:#7f1d1d;background:#fffafa; }
        tr.deletedRow:hover { background:#fff5f5; }
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
        .pill.trial { color:#1e3a8a;background:#eff6ff;border-color:#bfdbfe; }
        .pill.neutral { color:#475569;background:#f8fafc;border-color:#cbd5e1; }
        .pill.founder { color:#0f1f3d;background:#eef4ff;border-color:#a9bddf;font-size:10px;padding:3px 7px; }
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
        .ticketExcerpt {
          display:-webkit-box;
          overflow:hidden;
          margin:0;
          color:#526071;
          font-size:13px;
          line-height:1.55;
          -webkit-box-orient:vertical;
          -webkit-line-clamp:2;
        }
        .ticketTitle {
          font-weight: 950;
        }
        .settingsGrid {
          display: grid;
          grid-template-columns: minmax(380px, 0.8fr) minmax(560px, 1.2fr);
          gap: 18px;
          align-items: start;
        }
        .dashboardGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
          gap: 16px;
          align-items: start;
        }
        .dashboardColumn {
          min-width: 0;
          display: grid;
          gap: 16px;
          align-content: start;
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
        .refundSummary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
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
          .subscriptionShell,
          .settingsGrid,
          .dashboardGrid,
          .ticketShell {
            grid-template-columns: 1fr;
          }
          .businessGrid,
          .ticketStats,
          .refundSummary,
          .subscriptionKpis,
          .immediateActionGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .aiOpsAlert { align-items:flex-start; flex-direction:column; }
          .subscriptionToolbar { grid-template-columns:1fr 1fr; }
          .detailCard {
            position: static;
          }
        }
        @media (max-width: 920px) {
          .primaryTabs { grid-template-columns:repeat(3, minmax(0, 1fr)); }
          .opsNavigation { grid-template-columns:repeat(3, minmax(0, 1fr)); }
          .opsNavigation.primary-overview .subNavContext,
          .opsNavigation.primary-support .subNavContext { grid-column:1; }
          .opsNavigation.primary-merchant .subNavContext { grid-column:2 / -1; }
          .opsNavigation.primary-billing .subNavContext { grid-column:2 / -1; justify-content:flex-end; }
          .opsNavigation.primary-system .subNavContext { grid-column:1 / -1; justify-content:center; }
          .hero { align-items:flex-start; }
          .opsAccount { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); width:min(100%,360px); }
          .opsAccount > div { grid-column:1 / -1; text-align:left; }
          .opsAccount .btn { width:100%; }
        }
        /* The three newer work areas share the same visual rhythm as the original OPS tabs. */
        .opsConsole .opsReview.embedded .filters,
        .opsConsole .aiOps.embedded .filters,
        .opsConsole .page.embedded .filters { margin:0 0 14px; }
        .opsConsole .opsReview.embedded .filters button,
        .opsConsole .page.embedded .filters button {
          min-height:36px;
          padding:8px 12px;
          border-radius:999px;
          font-size:12px;
          box-shadow:none;
        }
        .opsConsole .opsReview.embedded .content,
        .opsConsole .page.embedded .layout { gap:14px; }
        .opsConsole .opsReview.embedded .requestList,
        .opsConsole .opsReview.embedded .detail,
        .opsConsole .page.embedded .list,
        .opsConsole .page.embedded .detail,
        .opsConsole .aiOps.embedded .metrics article,
        .opsConsole .aiOps.embedded .notice,
        .opsConsole .aiOps.embedded .panel {
          border-color:var(--ops-line);
          border-radius:16px;
          box-shadow:0 7px 22px rgba(15,31,61,.045);
        }
        .opsConsole .opsReview.embedded .requestList,
        .opsConsole .opsReview.embedded .detail { min-height:520px; }
        .opsConsole .opsReview.embedded .request,
        .opsConsole .page.embedded .row { border-radius:12px; }
        .opsConsole .page.embedded .listHead { padding:5px 6px 14px; }
        .opsConsole .page.embedded .detail { padding:22px; }
        .opsConsole .page.embedded .empty {
          margin:0;
          padding:34px 20px;
          border:1px dashed #cbd7e6;
          border-radius:12px;
          background:#f8fafc;
        }
        .opsConsole .aiOps.embedded .metrics { gap:10px; }
        .opsConsole .aiOps.embedded .metrics article { min-height:104px; padding:16px; }
        .opsConsole .aiOps.embedded .notice { margin:12px 0; padding:15px 16px; }
        .opsConsole .aiOps.embedded .panelHead { padding:18px 18px 14px; }
        .opsConsole .aiOps.embedded .panelHead h2 { font-size:18px; }
        .opsConsole .aiOps.embedded th,
        .opsConsole .aiOps.embedded td { padding:13px 15px; }
        .ticketShell .filters { grid-template-columns:repeat(3, minmax(0, 1fr)); }
        .opsConsole .opsReview.embedded .request:hover,
        .opsConsole .page.embedded .row:hover,
        .opsConsole .aiOps.embedded tbody tr:hover { background:#f7fbff; }
        @media (max-width: 720px) {
          .primaryTabs { display:flex; width:100%; overflow:auto; grid-template-columns:none; }
          .primaryTabs .tab { flex:0 0 auto; }
          .subNavContext { grid-column:1 / -1 !important; padding-left:2px; padding-right:2px; }
          .subTabs { overflow:auto; padding-bottom:2px; }
          .ticketShell .filters { grid-template-columns:1fr; }
          .opsConsole .opsReview.embedded .requestList,
          .opsConsole .opsReview.embedded .detail { min-height:auto; }
          .wrap {
            padding: 14px;
          }
          .hero {
            display: grid;
            padding:16px;
          }
          .heroBrand { align-items:flex-start; }
          .heroMeta { display:none; }
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
          .ticketStats,
          .immediateActionGrid {
            grid-template-columns: 1fr;
          }
          .opsPulse { grid-template-columns:1fr; }
          .opsPulseCount { justify-items:start; text-align:left; }
          .todoCard {
            grid-template-columns: 1fr;
          }
          .quickLinks {
            grid-template-columns: 1fr;
          }
          .refundSummary { grid-template-columns:1fr; }
          .subscriptionKpis,
          .subscriptionToolbar,
          .subscriptionLinks { grid-template-columns:1fr; }
          .trialPresetGrid { grid-template-columns:1fr; }
          .subscriptionTable { min-width:0; }
          .subscriptionTable thead { display:none; }
          .subscriptionTable tbody { display:grid; gap:10px; padding:10px; }
          .subscriptionTable tr { display:grid; gap:9px; border:1px solid #e2e8f0; border-radius:14px; padding:13px; }
          .subscriptionTable tr.sel { box-shadow:inset 4px 0 0 #2563eb; }
          .subscriptionTable td { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:0; border:0; text-align:right; }
          .subscriptionTable td::before { content:attr(data-label); color:#64748b; font-size:11px; font-weight:900; text-align:left; }
          .subscriptionTable td:first-child { display:block; text-align:left; padding-bottom:9px; border-bottom:1px solid #eef2f7; }
          .subscriptionTable td:first-child::before { display:none; }
          .refundActionNotice { position:static; align-items:flex-start; }
          .refundActions { min-width:150px; }
          .modalActions { display:grid; grid-template-columns:1fr; }
          .modalActions .btn { width:100%; }
          .opsAccount { width:100%; display:flex; }
          .opsAccount > div { text-align:left; width:100%; }
          .opsAccount .btn { flex:1; min-height:44px; }
          .modalBackdrop { align-items:end; padding:10px; }
          .opsModal { border-radius:18px 18px 12px 12px; padding:18px; }
        }
      `}</style>

      <header className="hero">
        <div className="heroBrand">
          <RionBrand product inverse />
          <div className="heroMeta">
            <span className="liveBadge">LIVE</span>
            <p className="sub">마지막 업데이트 {lastLoadedAt ? fmtDateTime(lastLoadedAt) : "-"}</p>
          </div>
        </div>
        <div className="row opsAccount">
          <div><strong>{opsIdentity.email || "OPS 사용자"}</strong><small>{opsIdentity.role.toUpperCase()}</small></div>
          <button className="btn opsControl" onClick={() => { void loadOps(); void loadOpsWorkQueue(); void loadAiOpsSignal(); }} disabled={loading || opsWorkQueue.loading || aiOpsSignal.loading}>
            <OpsIcon name="refresh" />{loading ? "업데이트 중..." : "새로고침"}
          </button>
          <button className="btn opsControl" onClick={() => void supabase.auth.signOut().then(() => router.replace("/ops/login"))}><OpsIcon name="logout" />로그아웃</button>
        </div>
      </header>

      {msg ? (
        <section className="card">
          <p className="muted">{msg}</p>
        </section>
      ) : null}

      <div className={`opsNavigation primary-${activePrimary}`}>
        <nav className="tabs primaryTabs" aria-label="OPS 주요 메뉴">
          {NAV_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`tab ${activePrimary === group.id ? "active" : ""}`}
              onClick={() => {
                const target = group.tabs.find((tab) => tab.id !== "settings" || isOpsMaster) || group.tabs[0];
                if (target.id === "subscriptions" && selectedStore?.status === "deleted") setSelectedStoreId(subscriptionBaseRows[0]?.store_id || "");
                setActiveTab(target.id);
              }}
            >
              <OpsIcon name={group.icon} />{group.label}
            </button>
          ))}
        </nav>
        {availableNavTabs.length > 1 ? <div className="subNavContext">
          <nav className="subTabs" aria-label={`${activeNavGroup.label} 세부 메뉴`}>
            {availableNavTabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}><OpsIcon name={tab.icon} />{tab.label}</button>)}
          </nav>
        </div> : null}
      </div>

      {!loading && activeTab === "overview" ? (
        <>
          <section className="card opsPulse" aria-label="오늘의 운영 상태">
            <div className="opsPulseCopy">
              <span className="opsPulseLabel"><OpsIcon name="dashboard" />TODAY&apos;S OPS</span>
              <h2>{opsQueueHasError ? "운영 데이터 확인이 필요합니다" : immediateActionCount > 0 ? "먼저 처리할 운영 업무가 있습니다" : "지금 처리할 운영 업무가 없습니다"}</h2>
              <p>{opsQueueHasError ? "인증 또는 개인정보 요청 현황을 불러오지 못했습니다. 해당 메뉴에서 데이터를 확인해 주세요." : immediateActionCount > 0 ? "문의, 권한 검토, 개인정보 요청, 구독·결제 점검을 우선순위로 모았습니다." : "대기 중인 문의·권한 검토·개인정보 요청·구독 점검 항목이 없습니다."}</p>
            </div>
            <div className="opsPulseCount">
              <strong>{opsQueueHasError ? "!" : immediateActionCount.toLocaleString()}</strong>
              <span>{opsQueueHasError ? "데이터 확인 필요" : "우선 확인 항목"}</span>
            </div>
          </section>

          <section className="immediateActionGrid" aria-label="즉시 처리 업무">
            <button className={`immediateAction ${kpi.urgentTickets > 0 ? "danger" : kpi.openTickets > 0 ? "warn" : ""}`} onClick={() => setActiveTab("tickets")}>
              <span className="immediateActionTitle"><OpsIcon name="support" />문의·장애</span>
              <span className="immediateActionMeta"><small>{kpi.urgentTickets > 0 ? `긴급 ${kpi.urgentTickets.toLocaleString()}건을 먼저 확인하세요.` : "미처리 문의와 장애를 확인합니다."}</small><b>{kpi.openTickets.toLocaleString()}건</b></span>
            </button>
            <button className={`immediateAction ${opsWorkQueue.businessVerificationCount > 0 || opsWorkQueue.businessVerificationError ? "warn" : ""}`} disabled={Boolean(opsWorkQueue.businessVerificationError)} onClick={() => setActiveTab("businessVerification")}>
              <span className="immediateActionTitle"><OpsIcon name="shield" />사업자 인증</span>
              <span className="immediateActionMeta"><small>{opsWorkQueue.businessVerificationError || queueAgeLabel(opsWorkQueue.oldestBusinessVerificationAt, "매장 생성 전 사업체와 증빙을 검토합니다.")}</small><b>{opsWorkQueue.loading || opsWorkQueue.businessVerificationError ? "-" : `${opsWorkQueue.businessVerificationCount.toLocaleString()}건`}</b></span>
            </button>
            <button className={`immediateAction ${opsWorkQueue.privacyRequestCount > 0 || opsWorkQueue.privacyRequestError ? "danger" : ""}`} disabled={Boolean(opsWorkQueue.privacyRequestError)} onClick={() => setActiveTab("privacyRequests")}>
              <span className="immediateActionTitle"><OpsIcon name="privacy" />개인정보 요청</span>
              <span className="immediateActionMeta"><small>{opsWorkQueue.privacyRequestError || queueAgeLabel(opsWorkQueue.oldestPrivacyRequestAt, "요청 범위와 처리 기한을 확인합니다.")}</small><b>{opsWorkQueue.loading || opsWorkQueue.privacyRequestError ? "-" : `${opsWorkQueue.privacyRequestCount.toLocaleString()}건`}</b></span>
            </button>
            <button className={`immediateAction ${subscriptionCheckCount > 0 ? "warn" : ""}`} onClick={() => setActiveTab("stores")}>
              <span className="immediateActionTitle"><OpsIcon name="card" />구독·결제 점검</span>
              <span className="immediateActionMeta"><small>결제 없는 유료 매장과 만료 임박 매장을 확인합니다.</small><b>{subscriptionCheckCount.toLocaleString()}개</b></span>
            </button>
          </section>
          {aiOpsNeedsAttention ? <section className={`card aiOpsAlert ${aiOpsSignal.error || aiOpsSignal.failedCount > 0 ? "danger" : "warn"}`}><div><span><OpsIcon name="sparkles" />AI 운영 확인</span><strong>{aiOpsSignal.error || aiOpsSignal.failedCount > 0 ? `오류 ${aiOpsSignal.failedCount.toLocaleString()}건을 확인해 주세요.` : aiOpsSignal.blockedCount > 0 ? `차단된 AI 요청 ${aiOpsSignal.blockedCount.toLocaleString()}건이 있습니다.` : `이번 달 AI 예산 ${aiOpsSignal.monthlyCostRate}%를 사용했습니다.`}</strong><p>AI 운영 화면에서 매장별 사용량·비용·한도와 중지 상태를 확인할 수 있습니다.</p></div><button onClick={() => setActiveTab("ai")}>AI 운영 열기</button></section> : null}
        </>
      ) : null}

      {!loading && activeTab === "overview" ? <section className="kpis">
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
      </section> : null}

      {loading ? (
        <section className="card">
          <p className="muted">OPS 데이터를 로딩 중입니다...</p>
        </section>
      ) : null}

      {!loading && activeTab === "overview" ? (
        <section className="dashboardGrid">
          <div className="dashboardColumn">
            <article className="card">
                        <div className="panelHeader">
                          <div>
                            <div className="sectionTitle">오늘 점검할 성장 신호</div>
                            <p>
                              즉시 처리 업무와 분리해, 사용 저하와 전환 기회를 살핍니다.
                            </p>
                          </div>
                          <span className="pill warn">운영 체크</span>
                        </div>
                        <div className="todoList">
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
                        </div>
                      </article>

            <article className="card">
                        <div className="sectionTitle">주의할 매장</div>
                        <div className="storeMiniList">
                          {riskStores.length === 0 ? (
                            <p className="muted">현재 우선 점검할 위험 신호가 없습니다.</p>
                          ) : null}
                          {riskStores.map((r, index) => (
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
                                <span className="pill danger">우선 {index + 1}</span>
                                <span className="pill warn">{storeRiskLabel(r)}</span>
                                <strong>{r.store_name || r.store_id}</strong>
                              </div>
                              <p className="muted">{storeInsight(r)}</p>
                            </div>
                          ))}
                        </div>
                      </article>
          </div>
          <div className="dashboardColumn">
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
          </div>
        </section>
      ) : null}

      {!loading && activeTab === "stores" ? (
        <section className="grid2">
          <article className="card">
            <div className="panelHeader">
              <div>
                <div className="sectionTitle">점주·매장 관리</div>
                <p>점주 계정과 매장 상태, 운영 현황 및 적용 혜택을 한곳에서 확인합니다.</p>
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
                <option value="trialing">무료 체험 중</option>
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
        <section className="subscriptionShell">
          <div className="subscriptionMain">
            <div className="subscriptionKpis" aria-label="구독 운영 요약">
              <div className="subscriptionKpi"><span>유료 구독</span><strong>{subscriptionPaidStores.toLocaleString()}개</strong><small>삭제 매장을 제외한 {subscriptionBaseRows.length.toLocaleString()}개 중</small></div>
              <div className="subscriptionKpi"><span>무료 체험 중</span><strong>{subscriptionTrialStores.toLocaleString()}개</strong><small>체험 종료일과 남은 기간 확인</small></div>
              <div className="subscriptionKpi"><span>7일 내 종료</span><strong>{subscriptionExpiringStores.toLocaleString()}개</strong><small>구독·체험 기간 사전 확인</small></div>
              <div className="subscriptionKpi"><span>점검 필요</span><strong>{noPaymentPaidStores.filter((r) => r.status !== "deleted").length.toLocaleString()}개</strong><small>유료 상태·결제 이력 불일치</small></div>
            </div>
            <article className="card">
              <div className="panelHeader"><div><div className="sectionTitle">구독 현황</div><p>매장별 구독 상태, 이용 기간과 결제 현황을 확인합니다.</p></div><span className="pill">총 {subscriptionRows.length.toLocaleString()}개</span></div>
              <div className="subscriptionToolbar">
                <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="매장명·매장 ID·점주 계정 검색" aria-label="구독 매장 검색" />
              <select className="select" value={subFilter} onChange={(event) => setSubFilter(event.target.value)}><option value="all">구독 전체</option><option value="active">유료 구독</option><option value="trialing">무료 체험 중</option><option value="inactive">미구독·기타</option><option value="expiring">종료 임박</option></select>
              <select className="select" value={sortBy} onChange={(event) => setSortBy(event.target.value as StoreSort)}><option value="expiring">만료 임박순</option><option value="monthlyRevenue">구독매출 높은순</option><option value="risk">점검 우선순</option></select>
                <button className="btn" disabled={!query && subFilter === "all" && sortBy === "expiring"} onClick={() => { setQuery(""); setSubFilter("all"); setSortBy("expiring"); }}>필터 초기화</button>
              </div>
              <div className="subscriptionResult"><span>검색 결과 {subscriptionRows.length.toLocaleString()}개</span><span>삭제된 매장은 구독 관리 대상에서 제외됩니다.</span></div>
              <div style={{ marginTop: 12 }}>{renderSubscriptionTable()}</div>
            </article>
          </div>
          {renderSubscriptionDetail()}
        </section>
      ) : null}

      {!loading && activeTab === "payments" && canManageBilling ? (
        <section className="noticeList paymentStack">
          <div className="refundSummary" aria-label="환불 처리 현황">
            <div className="notice"><span>처리 필요</span><strong>{refundCases.filter((item) => ["requested", "reviewing", "approved", "processing"].includes(item.status)).length}건</strong></div>
            <div className="notice"><span>확인 필요</span><strong>{refundCases.filter((item) => item.status === "reconcile_required").length}건</strong></div>
            <div className="notice"><span>주문 결제취소 확인</span><strong>{orderCancelCases.length}건</strong></div>
            <div className="notice"><span>완료된 수동 환불</span><strong>{refundCases.filter((item) => item.status === "completed").length}건</strong></div>
          </div>
          <article className="card">
            <div className="panelHeader">
              <div><div className="sectionTitle">고객 주문 결제취소 예외</div><p>주문은 취소됐지만 PG 취소 완료가 확인되지 않은 건을 조회하고 동일 멱등키로 재시도합니다.</p></div>
              <button className="btn" disabled={orderCancelLoading} onClick={() => void loadOrderCancelCases()}>{orderCancelLoading ? "불러오는 중" : "새로고침"}</button>
            </div>
            <div className="tableWrap">
              <table className="opsTable">
                <thead><tr><th>요청일시</th><th>매장·주문</th><th>내부 상태</th><th>PG 상태</th><th>시도</th><th>오류</th><th>확인·재시도</th></tr></thead>
                <tbody>
                  {orderCancelCases.map((item) => {
                    const isWorking = orderCancelActionId === item.id;
                    const reason = orderCancelReasons[item.id] || "";
                    return (
                      <tr key={item.id}>
                        <td>{fmtDateTime(item.requested_at)}</td>
                        <td><div className="cellMain"><strong>{item.store_id}</strong><small>{item.kind === "partial" ? `부분 환불 ${Number(item.refund_amount || 0).toLocaleString()}원` : "전체 취소"} · 주문 {shortId(item.order_id)}</small></div></td>
                        <td><span className={`pill ${item.status === "reconcile_required" ? "danger" : "warn"}`}>{refundStatusLabel(item.status)}</span></td>
                        <td><span className={`pill ${item.pg_status === "CANCELED" ? "ok" : item.pg_status ? "warn" : ""}`}>{tossStatusLabel(item.pg_status)}</span></td>
                        <td><div className="cellMain"><strong>{item.attempt_count}회</strong><small>{fmtDateTime(item.last_attempt_at)}</small></div></td>
                        <td><div className="cellMain"><strong>{item.failure_code || "확인 대기"}</strong><small title={item.failure_detail || ""}>{item.failure_detail || "-"}</small></div></td>
                        <td>
                          <div className="refundActions">
                            <input className="input" value={reason} maxLength={240} placeholder="처리 사유" onChange={(event) => setOrderCancelReasons((prev) => ({ ...prev, [item.id]: event.target.value }))} />
                            <button className="btn" disabled={isWorking || reason.trim().length < 2} onClick={() => void reconcileOrderCancel(item.id, "inspect", item.kind)}>PG 상태 확인</button>
                            <button className="btn primary" disabled={isWorking || reason.trim().length < 2} onClick={() => void reconcileOrderCancel(item.id, "retry", item.kind)}>{isWorking ? "처리 중" : "동일 키로 재시도"}</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!orderCancelLoading && orderCancelCases.length === 0 ? <p className="emptyState">확인이 필요한 고객 주문 결제취소 건이 없습니다.</p> : null}
          </article>
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
            {!refundLoading && refundCases.length === 0 ? <p className="emptyState">접수된 기간 경과 환불 요청이 없습니다.</p> : null}
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
            {!refundLoading && refundRows.filter((row) => refundStatusFilter === "all" || row.status === refundStatusFilter).length === 0 ? <p className="emptyState">조건에 맞는 환불 이력이 없습니다.</p> : null}
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

      {!loading && activeTab === "businessVerification" ? <OpsBusinessVerifications embedded /> : null}
      {!loading && activeTab === "privacyRequests" ? <OpsPrivacyRequests embedded /> : null}
      {!loading && activeTab === "ai" ? <OpsAiUsage embedded /> : null}

      {!loading && activeTab === "tickets" ? <OpsSupportDesk /> : null}
      {false && !loading && activeTab === "tickets" ? (
        <section className="card">
          <div className="panelHeader">
            <div>
              <div className="sectionTitle">문의·장애</div>
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
                  <p className="emptyState">조건에 맞는 티켓이 없습니다.</p>
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
                    {t.body ? <p className="ticketExcerpt">{t.body}</p> : null}
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
            <div><div className="sectionTitle" id="founder-editor-title">베타 테스터 혜택 관리</div><p className="muted">{selectedStore.store_name || selectedStore.store_id} · 현재 상태 {benefit?.baseStatus || "-"}</p></div>
            <label className="checkRow"><input type="checkbox" checked={benefitForm.founderMember} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderMember: e.target.checked, founderBase: e.target.checked ? prev.founderBase : false, founderAddon: e.target.checked ? prev.founderAddon : false }))}/><span>베타 테스터로 지정</span></label>
            <label className="checkRow"><input type="checkbox" disabled={!benefitForm.founderMember} checked={benefitForm.founderBase} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderBase: e.target.checked }))}/><span>기본 구독 베타 40%</span></label>
            <label className="checkRow"><input type="checkbox" disabled={!benefitForm.founderMember} checked={benefitForm.founderAddon} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderAddon: e.target.checked }))}/><span>온라인 선결제 베타 40%</span></label>
            <textarea className="input" rows={3} maxLength={240} placeholder="베타 자격 지정·변경 사유(필수)" value={benefitForm.founderReason} onChange={(e) => setBenefitForm((prev) => ({ ...prev, founderReason: e.target.value }))}/>
            <button className="btn primary" disabled={benefitSaving || !benefitForm.founderReason.trim()} onClick={() => void saveFounderBenefit()}>{benefitSaving ? "저장 중..." : "베타 테스터 혜택 저장"}</button>
            <button className="btn" disabled={benefitSaving} onClick={() => setBenefitEditorOpen(false)}>닫기</button>
          </section>
        </div>
      ) : null}

      {trialEditorOpen && selectedStore && isOpsMaster ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => !benefitSaving && setTrialEditorOpen(false)}>
          <section className="opsModal" role="dialog" aria-modal="true" aria-labelledby="trial-editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <div><div className="sectionTitle" id="trial-editor-title">{benefit?.trialEndAt ? "무료 체험 기간 연장" : "무료 체험 시작"}</div><p className="muted">{selectedStore.store_name || selectedStore.store_id}의 무료 체험 이용 기간을 설정합니다.</p></div>
            <div className="trialPreview">
              <div><span>현재 종료일</span><strong>{fmtDate(benefit?.trialEndAt || null)}</strong></div>
              <div><span>변경 후 종료일</span><strong>{benefitForm.trialEndAt ? fmtDate(`${benefitForm.trialEndAt}T23:59:59+09:00`) : "날짜를 선택해 주세요"}</strong></div>
            </div>
            <div><div className="sectionTitle">빠른 연장</div><div className="trialPresetGrid">
              {[7, 14, 30].map((days) => <button key={days} className="btn" type="button" onClick={() => setBenefitForm((prev) => ({ ...prev, trialEndAt: addDaysToDateInput(prev.trialEndAt || ymd(new Date()), days) }))}>+{days}일</button>)}
            </div></div>
            <label className="opsField"><span>무료 체험 종료일</span><input className="input" type="date" min={addDaysToDateInput(benefit?.trialEndAt ? new Date(benefit.trialEndAt).toISOString().slice(0, 10) : ymd(new Date()), 1)} value={benefitForm.trialEndAt} onChange={(event) => setBenefitForm((prev) => ({ ...prev, trialEndAt: event.target.value }))}/></label>
            <label className="opsField"><span>연장 사유 (필수)</span><textarea className="textarea" rows={3} maxLength={240} placeholder="초기 운영 지원 등 연장 근거를 입력해 주세요." value={benefitForm.trialReason} onChange={(event) => setBenefitForm((prev) => ({ ...prev, trialReason: event.target.value }))}/></label>
            {!benefitForm.trialReason.trim() ? <p className="muted">무료 체험 시작 또는 기간 연장을 위해 사유를 입력해 주세요.</p> : null}
            {trialMessage ? <p className="trialMessage" role="status" aria-live="polite">{trialMessage}</p> : null}
            <p className="muted">이 변경은 마스터 계정과 사유, 변경 전·후 기간이 감사 기록에 저장됩니다.</p>
            <div className="modalActions"><button className="btn" disabled={benefitSaving} onClick={() => setTrialEditorOpen(false)}>닫기</button><button className="btn primary" disabled={benefitSaving} onClick={() => void saveTrial()}>{benefitSaving ? "처리 중..." : benefit?.trialEndAt ? "무료 체험 기간 연장" : "무료 체험 시작"}</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
