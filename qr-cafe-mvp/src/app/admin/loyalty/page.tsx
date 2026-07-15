"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId } from "@/app/lib/currentStore";

type LoyaltySettingsRow = {
  store_id: string;
  tier_general_rate_pct: number;
  tier_regular_rate_pct: number;
  tier_vip_rate_pct: number;
  thank_you_every_n_orders: number;
  max_redeem_pct: number;
  min_redeem_points: number;
  point_expiry_months: number;
  allow_point_or_coupon_only: boolean;
};

type TierRulesRow = {
  store_id: string;
  lookback_months: number;
  regular_min_spent: number;
  regular_min_orders: number;
  vip_min_spent: number;
  vip_min_orders: number;
};

type CouponTemplateRow = {
  id: string;
  coupon_kind: "first_order" | "thank_you" | "event";
  name: string;
  discount_type: "fixed_amount" | "percent";
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
  valid_days: number;
  is_active: boolean;
};

type CouponIssueTargetRow = {
  customer_user_id: string;
  name: string | null;
  phone: string | null;
  point_balance: number;
  tier: "general" | "regular" | "vip";
  lifetime_spent: number;
  lifetime_orders: number;
  last_order_at: string | null;
  registered_at: string | null;
  already_has_coupon: boolean;
};

type BulkIssueResult = {
  requested_count?: number;
  valid_count?: number;
  issued_count?: number;
  skipped_existing_count?: number;
  invalid_customer_count?: number;
};

type CustomerProfileRow = {
  user_id: string;
  name: string | null;
  phone: string | null;
};

type IssuedCouponRow = {
  id: string;
  customer_user_id: string;
  status: string;
  issued_at: string;
  expires_at: string | null;
  template_id: string | null;
  template?: {
    name?: string | null;
    coupon_kind?: string | null;
    discount_type?: string | null;
    discount_value?: number | null;
  } | null;
};

type LoyaltyTab = "policy" | "coupons" | "issue" | "history";

const loyaltyTabs: Array<{ id: LoyaltyTab; label: string; desc: string }> = [
  { id: "policy", label: "정책 설정", desc: "적립·등급" },
  { id: "coupons", label: "쿠폰 관리", desc: "생성·수정" },
  { id: "issue", label: "쿠폰 발급", desc: "고객 검색" },
  { id: "history", label: "발급 내역", desc: "조회·취소" },
];

const issuedStatusOptions: Array<[string, string]> = [["all", "전체"], ["issued", "사용 가능"], ["used", "사용 완료"], ["expired", "만료"], ["cancelled", "취소"]];
const issuedPeriodOptions: Array<[string, string]> = [["30", "최근 30일"], ["7", "최근 7일"], ["90", "최근 90일"], ["all", "전체"]];
const ISSUED_PAGE_SIZE = 30;
const targetTierOptions: Array<[string, string]> = [["all", "전체"], ["general", "일반"], ["regular", "단골"], ["vip", "VIP"]];
const targetRecentOptions: Array<[string, string]> = [["all", "전체"], ["7", "최근 7일 주문"], ["30", "최근 30일 주문"], ["90", "최근 90일 주문"]];
const targetInactiveOptions: Array<[string, string]> = [["all", "전체"], ["30", "30일 미방문"], ["60", "60일 미방문"], ["90", "90일 미방문"]];
const targetRegisteredOptions: Array<[string, string]> = [["all", "전체"], ["30", "등록 30일 이상"], ["90", "등록 90일 이상"], ["180", "등록 180일 이상"]];

function toNumber(v: string, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function money(n: number) {
  return Math.round(Number(n || 0)).toLocaleString();
}

function tierLabel(tier: string) {
  if (tier === "vip") return "VIP";
  if (tier === "regular") return "단골";
  return "일반";
}

function couponKindLabel(kind: string | null | undefined) {
  if (kind === "first_order") return "첫주문 자동";
  if (kind === "thank_you") return "감사 자동";
  return "이벤트 수동";
}

function couponStatusLabel(status: string) {
  if (status === "issued") return "사용 가능";
  if (status === "used") return "사용 완료";
  if (status === "expired") return "만료";
  if (status === "cancelled") return "취소";
  return status || "-";
}

function phoneText(phone?: string | null) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length < 4) return "전화번호 없음";
  return `끝자리 ${digits.slice(-4)}`;
}

function shortCustomerId(userId?: string | null) {
  const compact = String(userId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
  return compact ? `고객 ${compact}` : "고객";
}

function maskCustomerName(name?: string | null) {
  const value = String(name || "").trim();
  if (!value) return "";
  if (value.length <= 1) return value;
  if (/^[a-zA-Z\s]+$/.test(value)) return `${value[0]}${"*".repeat(Math.min(value.replace(/\s/g, "").length - 1, 3))}`;
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(value.length - 2)}${value[value.length - 1]}`;
}

function customerDisplayName(profile?: CustomerProfileRow | null, userId?: string | null) {
  return maskCustomerName(profile?.name) || shortCustomerId(userId);
}

function dateText(v?: string | null) {
  if (!v) return "-";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function discountText(row: Pick<CouponTemplateRow, "discount_type" | "discount_value" | "max_discount_amount">) {
  if (row.discount_type === "fixed_amount") return `${money(row.discount_value)}원 할인`;
  return `${Number(row.discount_value || 0)}% 할인${row.max_discount_amount ? ` · 최대 ${money(row.max_discount_amount)}원` : ""}`;
}

function AdminLoyaltyInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(() => (sp.get("store") || getCurrentStoreId() || "").trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"info" | "error" | "success">("info");
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingTier, setSavingTier] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [cancellingCouponId, setCancellingCouponId] = useState("");
  const [issuedLoading, setIssuedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<LoyaltyTab>("policy");
  const [issuedSearch, setIssuedSearch] = useState("");
  const [issuedStatusFilter, setIssuedStatusFilter] = useState("all");
  const [issuedPeriodFilter, setIssuedPeriodFilter] = useState("30");
  const [issuedHasMore, setIssuedHasMore] = useState(false);
  const [issuedSummary, setIssuedSummary] = useState("최근 30건");

  const [settings, setSettings] = useState<LoyaltySettingsRow>({
    store_id: "",
    tier_general_rate_pct: 2,
    tier_regular_rate_pct: 3,
    tier_vip_rate_pct: 5,
    thank_you_every_n_orders: 10,
    max_redeem_pct: 30,
    min_redeem_points: 100,
    point_expiry_months: 12,
    allow_point_or_coupon_only: true,
  });

  const [tierRules, setTierRules] = useState<TierRulesRow>({
    store_id: "",
    lookback_months: 6,
    regular_min_spent: 200000,
    regular_min_orders: 10,
    vip_min_spent: 500000,
    vip_min_orders: 25,
  });

  const [templates, setTemplates] = useState<CouponTemplateRow[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [savingEditTemplate, setSavingEditTemplate] = useState(false);
  const [customerProfilesById, setCustomerProfilesById] = useState<Record<string, CustomerProfileRow>>({});
  const [issuedCoupons, setIssuedCoupons] = useState<IssuedCouponRow[]>([]);
  const [issueTemplateId, setIssueTemplateId] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [targetTier, setTargetTier] = useState("all");
  const [targetMinPoints, setTargetMinPoints] = useState("0");
  const [targetMinOrders, setTargetMinOrders] = useState("0");
  const [targetMinSpent, setTargetMinSpent] = useState("0");
  const [targetRecentDays, setTargetRecentDays] = useState("all");
  const [targetInactiveDays, setTargetInactiveDays] = useState("all");
  const [targetRegisteredDays, setTargetRegisteredDays] = useState("all");
  const [targetExcludeExisting, setTargetExcludeExisting] = useState(true);
  const [showAdvancedTargetFilters, setShowAdvancedTargetFilters] = useState(false);
  const [targetRows, setTargetRows] = useState<CouponIssueTargetRow[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [bulkIssuing, setBulkIssuing] = useState(false);
  const [bulkConfirmChecked, setBulkConfirmChecked] = useState(false);
  const [bulkIssueResult, setBulkIssueResult] = useState<BulkIssueResult | null>(null);
  const [newTemplate, setNewTemplate] = useState({
    coupon_kind: "event" as CouponTemplateRow["coupon_kind"],
    name: "",
    discount_type: "fixed_amount" as CouponTemplateRow["discount_type"],
    discount_value: "1000",
    min_order_amount: "0",
    max_discount_amount: "",
    valid_days: "30",
  });

  const [editTemplate, setEditTemplate] = useState({
    coupon_kind: "event" as CouponTemplateRow["coupon_kind"],
    name: "",
    discount_type: "fixed_amount" as CouponTemplateRow["discount_type"],
    discount_value: "1000",
    min_order_amount: "0",
    max_discount_amount: "",
    valid_days: "30",
  });

  const showMsg = (text: string, tone: "info" | "error" | "success" = "info") => {
    setMsg(text);
    setMsgTone(tone);
  };

  const loadProfiles = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return {};
    const { data, error } = await supabase.from("customer_profiles").select("user_id,name,phone").in("user_id", uniqueIds);
    if (error) {
      showMsg(`고객 정보 조회 실패: ${error.message}`, "error");
      return {};
    }
    const map: Record<string, CustomerProfileRow> = {};
    for (const row of Array.isArray(data) ? data : []) {
      const r = row as CustomerProfileRow;
      map[r.user_id] = r;
    }
    return map;
  };

  const loadTemplates = async () => {
    if (!storeId) return;
    setTemplatesLoading(true);
    const { data, error } = await supabase
      .from("store_coupon_templates")
      .select("id,coupon_kind,name,discount_type,discount_value,min_order_amount,max_discount_amount,valid_days,is_active")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });

    if (error) showMsg(`쿠폰 목록 조회 실패: ${error.message}`, "error");
    const rows = (Array.isArray(data) ? data : []) as CouponTemplateRow[];
    setTemplates(rows);
    setIssueTemplateId((prev) => prev || String(rows[0]?.id || ""));
    setTemplatesLoading(false);
  };

  const loadIssuedCoupons = async (mode: "reset" | "more" = "reset", filters?: { search?: string; status?: string; period?: string }) => {
    if (!storeId) return;
    const isMore = mode === "more";
    const queryText = (filters?.search ?? issuedSearch).trim();
    const statusFilter = filters?.status ?? issuedStatusFilter;
    const periodFilter = filters?.period ?? issuedPeriodFilter;
    const from = isMore ? issuedCoupons.length : 0;
    const to = from + ISSUED_PAGE_SIZE - 1;
    setIssuedLoading(true);

    let profileMap: Record<string, CustomerProfileRow> = {};
    let matchedProfileIds: string[] | null = null;

    if (queryText) {
      const [nameRes, phoneRes] = await Promise.all([
        supabase.from("customer_profiles").select("user_id,name,phone").ilike("name", `%${queryText}%`).limit(100),
        supabase.from("customer_profiles").select("user_id,name,phone").ilike("phone", `%${queryText}%`).limit(100),
      ]);

      if (nameRes.error || phoneRes.error) {
        showMsg(`발급 내역 검색 실패: ${(nameRes.error || phoneRes.error)?.message}`, "error");
        if (!isMore) setIssuedCoupons([]);
        setIssuedLoading(false);
        return;
      }

      const profileRows = [
        ...((Array.isArray(nameRes.data) ? nameRes.data : []) as CustomerProfileRow[]),
        ...((Array.isArray(phoneRes.data) ? phoneRes.data : []) as CustomerProfileRow[]),
      ];
      profileMap = Object.fromEntries(profileRows.map((row) => [row.user_id, row]));
      matchedProfileIds = Array.from(new Set(profileRows.map((row) => row.user_id).filter(Boolean)));

      if (!matchedProfileIds.length) {
        if (!isMore) setIssuedCoupons([]);
        setIssuedHasMore(false);
        setIssuedSummary("검색 결과 0건");
        setIssuedLoading(false);
        return;
      }
    }

    let query = supabase
      .from("customer_coupons")
      .select("id,customer_user_id,status,issued_at,expires_at,template_id,template:store_coupon_templates(name,coupon_kind,discount_type,discount_value)")
      .eq("store_id", storeId)
      .order("issued_at", { ascending: false })
      .range(from, to);

    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (periodFilter !== "all") {
      const days = Number(periodFilter);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("issued_at", since);
    }
    if (matchedProfileIds) query = query.in("customer_user_id", matchedProfileIds);

    const { data, error } = await query;

    if (error) {
      showMsg(`발급 내역 조회 실패: ${error.message}`, "error");
      if (!isMore) setIssuedCoupons([]);
      setIssuedLoading(false);
      return;
    }

    const rows = (Array.isArray(data) ? data : []) as IssuedCouponRow[];
    setIssuedCoupons((prev) => (isMore ? [...prev, ...rows] : rows));
    setIssuedHasMore(rows.length === ISSUED_PAGE_SIZE);
    setIssuedSummary(queryText || statusFilter !== "all" || periodFilter !== "30" ? `검색 결과 ${from + rows.length}건` : `최근 ${from + rows.length}건`);
    const profiles = await loadProfiles(rows.map((r) => r.customer_user_id));
    setCustomerProfilesById((prev) => ({ ...prev, ...profileMap, ...profiles }));
    setIssuedLoading(false);
  };

  const loadData = async () => {
    if (!storeId) {
      showMsg("관리자 홈에서 매장을 먼저 선택해 주세요.", "error");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMsg("");

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id || "";
    if (!uid) {
      router.replace("/login");
      return;
    }

    const { data: member } = await supabase
      .from("store_members")
      .select("id")
      .eq("user_id", uid)
      .eq("store_id", storeId)
      .maybeSingle();

    if (!member) {
      showMsg("선택한 매장에 대한 접근 권한이 없습니다.", "error");
      setLoading(false);
      return;
    }

    const [settingsRes, tierRes] = await Promise.all([
      supabase
        .from("store_loyalty_settings")
        .select("store_id,tier_general_rate_pct,tier_regular_rate_pct,tier_vip_rate_pct,thank_you_every_n_orders,max_redeem_pct,min_redeem_points,point_expiry_months,allow_point_or_coupon_only")
        .eq("store_id", storeId)
        .maybeSingle(),
      supabase
        .from("store_tier_rules")
        .select("store_id,lookback_months,regular_min_spent,regular_min_orders,vip_min_spent,vip_min_orders")
        .eq("store_id", storeId)
        .maybeSingle(),
    ]);

    if (settingsRes.error) showMsg(`포인트 설정 조회 실패: ${settingsRes.error.message}`, "error");
    if (tierRes.error) showMsg(`등급 규칙 조회 실패: ${tierRes.error.message}`, "error");

    setSettings(settingsRes.data ? (settingsRes.data as LoyaltySettingsRow) : (prev) => ({ ...prev, store_id: storeId }));
    setTierRules(tierRes.data ? (tierRes.data as TierRulesRow) : (prev) => ({ ...prev, store_id: storeId }));

    await Promise.all([loadTemplates(), loadIssuedCoupons()]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const activeTemplates = templates.filter((row) => row.is_active).length;
  const selectedTemplate = templates.find((row) => row.id === issueTemplateId) || null;
  const allTargetsSelected = targetRows.length > 0 && targetRows.every((row) => selectedTargetIds.includes(row.customer_user_id));
  const selectedIssueButtonLabel = bulkIssuing
    ? "발급 중"
    : selectedTargetIds.length
      ? `선택 ${selectedTargetIds.length}명 발급`
      : "고객 선택 후 발급";
  const targetFilterSummary = [
    targetTier !== "all" ? tierLabel(targetTier) : "전체 등급",
    toNumber(targetMinPoints, 0) > 0 ? `${money(toNumber(targetMinPoints, 0))}P 이상` : "포인트 전체",
    toNumber(targetMinOrders, 0) > 0 ? `${money(toNumber(targetMinOrders, 0))}회 이상` : "주문 전체",
    toNumber(targetMinSpent, 0) > 0 ? `${money(toNumber(targetMinSpent, 0))}원 이상` : "이용금액 전체",
    targetRecentDays !== "all" ? `최근 ${targetRecentDays}일 주문` : "최근 주문 전체",
    targetInactiveDays !== "all" ? `${targetInactiveDays}일 미방문` : "미방문 전체",
    targetRegisteredDays !== "all" ? `등록 ${targetRegisteredDays}일 이상` : "등록 기간 전체",
  ].join(" · ");
  const previewOrderAmount = 10000;
  const newTemplatePreview = {
    discount_type: newTemplate.discount_type,
    discount_value: Math.max(1, Math.floor(toNumber(newTemplate.discount_value, 1000))),
    max_discount_amount: newTemplate.max_discount_amount.trim() ? Math.max(0, Math.floor(toNumber(newTemplate.max_discount_amount, 0))) : null,
  };

  const validateSettings = () => {
    if (settings.max_redeem_pct < 0 || settings.max_redeem_pct > 100) return "최대 사용 비율은 0~100 사이로 입력해 주세요.";
    if ([settings.tier_general_rate_pct, settings.tier_regular_rate_pct, settings.tier_vip_rate_pct].some((v) => v < 0 || v > 100)) {
      return "적립률은 0~100 사이로 입력해 주세요.";
    }
    return "";
  };

  const saveSettings = async () => {
    if (!storeId) return;
    const validation = validateSettings();
    if (validation) return showMsg(validation, "error");
    setSavingSettings(true);
    setMsg("");
    const payload: LoyaltySettingsRow = { ...settings, store_id: storeId };
    const { error } = await supabase.from("store_loyalty_settings").upsert(payload, { onConflict: "store_id" });
    if (error) showMsg(`포인트 정책 저장 실패: ${error.message}`, "error");
    else showMsg("포인트 정책을 저장했습니다.", "success");
    setSavingSettings(false);
  };

  const saveTierRules = async () => {
    if (!storeId) return;
    setSavingTier(true);
    setMsg("");
    const payload: TierRulesRow = { ...tierRules, store_id: storeId };
    const { error } = await supabase.from("store_tier_rules").upsert(payload, { onConflict: "store_id" });
    if (error) showMsg(`등급 규칙 저장 실패: ${error.message}`, "error");
    else showMsg("등급 규칙을 저장했습니다.", "success");
    setSavingTier(false);
  };

  const createTemplate = async () => {
    if (!storeId) return;
    if (!newTemplate.name.trim()) return showMsg("쿠폰 이름을 입력해 주세요.", "error");
    const discountValue = Math.max(1, Math.floor(toNumber(newTemplate.discount_value, 1000)));
    if (newTemplate.discount_type === "percent" && discountValue > 100) return showMsg("정률 할인은 100% 이하로 입력해 주세요.", "error");

    setSavingTemplate(true);
    setMsg("");
    const payload = {
      store_id: storeId,
      coupon_kind: newTemplate.coupon_kind,
      name: newTemplate.name.trim(),
      discount_type: newTemplate.discount_type,
      discount_value: discountValue,
      min_order_amount: Math.max(0, Math.floor(toNumber(newTemplate.min_order_amount, 0))),
      max_discount_amount: newTemplate.max_discount_amount.trim() ? Math.max(0, Math.floor(toNumber(newTemplate.max_discount_amount, 0))) : null,
      valid_days: Math.max(1, Math.floor(toNumber(newTemplate.valid_days, 30))),
      is_active: true,
    };
    const { error } = await supabase.from("store_coupon_templates").insert(payload);
    if (error) showMsg(`쿠폰 생성 실패: ${error.message}`, "error");
    else {
      showMsg("쿠폰 템플릿을 생성했습니다.", "success");
      setNewTemplate({ coupon_kind: "event", name: "", discount_type: "fixed_amount", discount_value: "1000", min_order_amount: "0", max_discount_amount: "", valid_days: "30" });
      await loadTemplates();
    }
    setSavingTemplate(false);
  };

  const searchCouponTargets = async () => {
    if (!storeId) return;
    if (!issueTemplateId) return showMsg("발급할 쿠폰을 먼저 선택해 주세요.", "error");
    const tpl = templates.find((row) => row.id === issueTemplateId);
    if (tpl && !tpl.is_active) return showMsg("비활성 쿠폰은 먼저 활성화해 주세요.", "error");

    setTargetLoading(true);
    setBulkIssueResult(null);
    setBulkConfirmChecked(false);
    setMsg("");
    const { data, error } = await supabase.rpc("admin_search_coupon_targets", {
      p_store_id: storeId,
      p_query: targetSearch.trim(),
      p_tier: targetTier,
      p_min_points: Math.max(0, Math.floor(toNumber(targetMinPoints, 0))),
      p_min_orders: Math.max(0, Math.floor(toNumber(targetMinOrders, 0))),
      p_min_spent: Math.max(0, Math.floor(toNumber(targetMinSpent, 0))),
      p_recent_days: targetRecentDays === "all" ? null : Number(targetRecentDays),
      p_inactive_days: targetInactiveDays === "all" ? null : Number(targetInactiveDays),
      p_registered_min_days: targetRegisteredDays === "all" ? null : Number(targetRegisteredDays),
      p_template_id: issueTemplateId,
      p_exclude_existing: targetExcludeExisting,
      p_limit: 200,
    });

    if (error) {
      showMsg(`대상 고객 검색 실패: ${error.message}`, "error");
      setTargetRows([]);
      setSelectedTargetIds([]);
    } else {
      const rows = (Array.isArray(data) ? data : []) as CouponIssueTargetRow[];
      setTargetRows(rows);
      setSelectedTargetIds([]);
      const profiles = Object.fromEntries(rows.map((row) => [row.customer_user_id, { user_id: row.customer_user_id, name: row.name, phone: row.phone }]));
      setCustomerProfilesById((prev) => ({ ...prev, ...profiles }));
      showMsg(`검색 결과 ${rows.length}명을 확인했습니다.`, rows.length ? "success" : "info");
    }
    setTargetLoading(false);
  };

  const toggleTargetSelection = (customerId: string) => {
    setSelectedTargetIds((prev) => prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]);
  };

  const toggleAllTargets = () => {
    setSelectedTargetIds(allTargetsSelected ? [] : targetRows.map((row) => row.customer_user_id));
  };

  const issueCouponToSelectedTargets = async () => {
    if (!storeId) return;
    if (!issueTemplateId) return showMsg("발급할 쿠폰을 선택해 주세요.", "error");
    if (!selectedTargetIds.length) return showMsg("발급할 고객을 선택해 주세요.", "error");
    if (!bulkConfirmChecked) return showMsg("선택 고객 발급 확인을 체크해 주세요.", "error");
    const tpl = templates.find((row) => row.id === issueTemplateId);
    if (tpl && !tpl.is_active) return showMsg("비활성 쿠폰은 먼저 활성화해 주세요.", "error");

    setBulkIssuing(true);
    setMsg("");
    const { data, error } = await supabase.rpc("admin_issue_coupon_to_selected_customers", {
      p_store_id: storeId,
      p_template_id: issueTemplateId,
      p_customer_user_ids: selectedTargetIds,
      p_exclude_existing: targetExcludeExisting,
    });

    if (error) showMsg(`선택 고객 발급 실패: ${error.message}`, "error");
    else {
      const result = (data || {}) as BulkIssueResult;
      const issuedTargetIds = [...selectedTargetIds];
      setBulkIssueResult(result);
      showMsg(`선택 ${result.requested_count || selectedTargetIds.length}명 중 ${result.issued_count || 0}명에게 발급했습니다.`, "success");
      setBulkConfirmChecked(false);
      setSelectedTargetIds([]);
      if (targetExcludeExisting) setTargetRows((prev) => prev.filter((row) => !issuedTargetIds.includes(row.customer_user_id)));
      await loadIssuedCoupons("reset");
    }
    setBulkIssuing(false);
  };

  const handleIssuedSearch = async () => {
    await loadIssuedCoupons("reset");
  };

  const resetIssuedSearch = async () => {
    setIssuedSearch("");
    setIssuedStatusFilter("all");
    setIssuedPeriodFilter("30");
    setIssuedSummary("최근 30건");
    await loadIssuedCoupons("reset", { search: "", status: "all", period: "30" });
  };

  const handleIssueTemplateChange = (templateId: string) => {
    setIssueTemplateId(templateId);
    setTargetRows([]);
    setSelectedTargetIds([]);
    setBulkIssueResult(null);
    setBulkConfirmChecked(false);
  };

  const selectIssueTemplate = (templateId: string) => {
    handleIssueTemplateChange(templateId);
    setActiveTab("issue");
  };

  const cancelIssuedCoupon = async (row: IssuedCouponRow) => {
    if (!storeId || row.status !== "issued") return;
    if (!window.confirm("사용 전 쿠폰만 취소됩니다. 취소할까요?")) return;

    setCancellingCouponId(row.id);
    setMsg("");
    const { error } = await supabase.rpc("admin_cancel_customer_coupon", {
      p_store_id: storeId,
      p_coupon_id: row.id,
    });
    if (error) showMsg(`쿠폰 취소 실패: ${error.message}`, "error");
    else {
      showMsg("쿠폰을 취소했습니다.", "success");
      await loadIssuedCoupons("reset");
    }
    setCancellingCouponId("");
  };

  const startEditTemplate = (row: CouponTemplateRow) => {
    setEditingTemplateId(row.id);
    setEditTemplate({
      coupon_kind: row.coupon_kind,
      name: row.name,
      discount_type: row.discount_type,
      discount_value: String(row.discount_value),
      min_order_amount: String(row.min_order_amount),
      max_discount_amount: row.max_discount_amount == null ? "" : String(row.max_discount_amount),
      valid_days: String(row.valid_days),
    });
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId("");
    setSavingEditTemplate(false);
  };

  const saveTemplateEdit = async (row: CouponTemplateRow) => {
    if (!storeId || editingTemplateId !== row.id) return;
    const name = editTemplate.name.trim();
    if (!name) return showMsg("쿠폰 이름을 입력해 주세요.", "error");
    const discountValue = Math.max(1, Math.floor(toNumber(editTemplate.discount_value, row.discount_value)));
    if (editTemplate.discount_type === "percent" && discountValue > 100) return showMsg("정률 할인은 100% 이하로 입력해 주세요.", "error");

    setSavingEditTemplate(true);
    setMsg("");
    const payload = {
      coupon_kind: editTemplate.coupon_kind,
      name,
      discount_type: editTemplate.discount_type,
      discount_value: discountValue,
      min_order_amount: Math.max(0, Math.floor(toNumber(editTemplate.min_order_amount, row.min_order_amount))),
      max_discount_amount: editTemplate.max_discount_amount.trim()
        ? Math.max(0, Math.floor(toNumber(editTemplate.max_discount_amount, 0)))
        : null,
      valid_days: Math.max(1, Math.min(3660, Math.floor(toNumber(editTemplate.valid_days, row.valid_days)))),
    };
    const { error } = await supabase
      .from("store_coupon_templates")
      .update(payload)
      .eq("id", row.id)
      .eq("store_id", storeId);

    if (error) showMsg(`쿠폰 수정 실패: ${error.message}`, "error");
    else {
      showMsg("쿠폰 템플릿을 수정했습니다.", "success");
      setEditingTemplateId("");
      await loadTemplates();
    }
    setSavingEditTemplate(false);
  };

  const toggleTemplate = async (row: CouponTemplateRow) => {
    const { error } = await supabase.from("store_coupon_templates").update({ is_active: !row.is_active }).eq("id", row.id);
    if (error) showMsg(`쿠폰 상태 변경 실패: ${error.message}`, "error");
    else await loadTemplates();
  };

  if (loading) return <main className="loyaltyPage">불러오는 중...</main>;

  return (
    <main className="loyaltyPage">
      <section className="heroCard">
        <div>
          <p className="eyebrow">관리자 설정</p>
          <h1>포인트/쿠폰 설정</h1>
          <p className="heroDesc">정책 설정과 쿠폰 발급 관리</p>
          <p className="storeLine">현재 매장: <b>{storeId || "-"}</b></p>
        </div>
        <div className="heroActions">
          <button className="btn" type="button" onClick={() => router.push(storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")}>관리자 홈</button>
          <button className="btn btnDark" type="button" onClick={loadData}>새로고침</button>
        </div>
      </section>

      {msg ? <div className={`notice notice-${msgTone}`} role="status">{msg}</div> : null}

      <section className="summaryGrid" aria-label="포인트 쿠폰 요약">
        <SummaryCard title="적립률" main={`일반 ${settings.tier_general_rate_pct}%`} sub={`단골 ${settings.tier_regular_rate_pct}% · VIP ${settings.tier_vip_rate_pct}%`} />
        <SummaryCard title="사용 제한" main={`최소 ${money(settings.min_redeem_points)}P`} sub={`최대 ${settings.max_redeem_pct}%`} />
        <SummaryCard title="쿠폰 템플릿" main={`활성 ${activeTemplates}개`} sub={`전체 ${templates.length}개`} />
        <SummaryCard title="최근 발급" main={`사용 가능 ${issuedCoupons.filter((row) => row.status === "issued").length}장`} sub={`최근 ${issuedCoupons.length}건`} />
      </section>

      <nav className="tabBar" aria-label="포인트 쿠폰 관리 탭">
        {loyaltyTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tabButton ${activeTab === tab.id ? "tabButtonOn" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
          >
            <strong>{tab.label}</strong>
            <span>{tab.desc}</span>
          </button>
        ))}
      </nav>

      {activeTab === "policy" ? (
        <>
          <section className="sectionCard">
            <div className="sectionHead">
              <div>
                <h2>포인트 정책</h2>
            <p>적립률과 사용 한도</p>
          </div>
          <button className="btn btnDark" type="button" onClick={saveSettings} disabled={savingSettings}>{savingSettings ? "저장 중" : "저장"}</button>
        </div>
        <div className="formGrid">
          <LabelInput label="일반 적립률" suffix="%" value={String(settings.tier_general_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_general_rate_pct: clampNumber(toNumber(v, p.tier_general_rate_pct), 0, 100) }))} />
          <LabelInput label="단골 적립률" suffix="%" value={String(settings.tier_regular_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_regular_rate_pct: clampNumber(toNumber(v, p.tier_regular_rate_pct), 0, 100) }))} />
          <LabelInput label="VIP 적립률" suffix="%" value={String(settings.tier_vip_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_vip_rate_pct: clampNumber(toNumber(v, p.tier_vip_rate_pct), 0, 100) }))} />
          <LabelInput label="감사 쿠폰 기준" suffix="주문" value={String(settings.thank_you_every_n_orders)} onChange={(v) => setSettings((p) => ({ ...p, thank_you_every_n_orders: Math.max(1, Math.floor(toNumber(v, p.thank_you_every_n_orders))) }))} />
          <LabelInput label="최대 사용 비율" suffix="%" value={String(settings.max_redeem_pct)} onChange={(v) => setSettings((p) => ({ ...p, max_redeem_pct: clampNumber(toNumber(v, p.max_redeem_pct), 0, 100) }))} />
          <LabelInput label="최소 사용 포인트" suffix="P" value={String(settings.min_redeem_points)} onChange={(v) => setSettings((p) => ({ ...p, min_redeem_points: Math.max(0, Math.floor(toNumber(v, p.min_redeem_points))) }))} />
          <LabelInput label="포인트 만료" suffix="개월" value={String(settings.point_expiry_months)} onChange={(v) => setSettings((p) => ({ ...p, point_expiry_months: Math.max(0, Math.floor(toNumber(v, p.point_expiry_months))) }))} />
        </div>
        <label className="checkRow">
          <input type="checkbox" checked={settings.allow_point_or_coupon_only} onChange={(e) => setSettings((p) => ({ ...p, allow_point_or_coupon_only: e.target.checked }))} />
          포인트와 쿠폰 동시 사용 금지
        </label>
        <div className="previewBox">
          10,000원 주문 시 적립: 일반 {money((previewOrderAmount * settings.tier_general_rate_pct) / 100)}P · 단골 {money((previewOrderAmount * settings.tier_regular_rate_pct) / 100)}P · VIP {money((previewOrderAmount * settings.tier_vip_rate_pct) / 100)}P
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHead">
          <div>
            <h2>등급 규칙</h2>
            <p>결제금액 또는 주문수 기준</p>
          </div>
          <button className="btn btnDark" type="button" onClick={saveTierRules} disabled={savingTier}>{savingTier ? "저장 중" : "저장"}</button>
        </div>
        <div className="formGrid">
          <LabelInput label="집계 기간" suffix="개월" value={String(tierRules.lookback_months)} onChange={(v) => setTierRules((p) => ({ ...p, lookback_months: Math.max(1, Math.floor(toNumber(v, p.lookback_months))) }))} />
          <LabelInput label="단골 최소 결제" suffix="원" value={String(tierRules.regular_min_spent)} onChange={(v) => setTierRules((p) => ({ ...p, regular_min_spent: Math.max(0, Math.floor(toNumber(v, p.regular_min_spent))) }))} />
          <LabelInput label="단골 최소 주문" suffix="회" value={String(tierRules.regular_min_orders)} onChange={(v) => setTierRules((p) => ({ ...p, regular_min_orders: Math.max(0, Math.floor(toNumber(v, p.regular_min_orders))) }))} />
          <LabelInput label="VIP 최소 결제" suffix="원" value={String(tierRules.vip_min_spent)} onChange={(v) => setTierRules((p) => ({ ...p, vip_min_spent: Math.max(0, Math.floor(toNumber(v, p.vip_min_spent))) }))} />
          <LabelInput label="VIP 최소 주문" suffix="회" value={String(tierRules.vip_min_orders)} onChange={(v) => setTierRules((p) => ({ ...p, vip_min_orders: Math.max(0, Math.floor(toNumber(v, p.vip_min_orders))) }))} />
        </div>
        <div className="previewBox">최근 {tierRules.lookback_months}개월 기준 · 단골 {money(tierRules.regular_min_spent)}원 또는 {tierRules.regular_min_orders}회 · VIP {money(tierRules.vip_min_spent)}원 또는 {tierRules.vip_min_orders}회</div>
          </section>
        </>
      ) : null}

      {activeTab === "coupons" ? (
        <>
          <section className="sectionCard">
            <div className="sectionHead">
              <div>
                <h2>쿠폰 만들기</h2>
            <p>조건 충족 시 자동 발급</p>
          </div>
          <button className="btn btnDark" type="button" onClick={createTemplate} disabled={savingTemplate}>{savingTemplate ? "생성 중" : "생성"}</button>
        </div>
        <div className="formGrid">
          <LabelInput label="쿠폰명" value={newTemplate.name} onChange={(v) => setNewTemplate((p) => ({ ...p, name: v }))} />
          <SelectInput label="쿠폰 종류" value={newTemplate.coupon_kind} onChange={(v) => setNewTemplate((p) => ({ ...p, coupon_kind: v as CouponTemplateRow["coupon_kind"] }))} options={[['first_order', '첫주문 자동'], ['thank_you', '감사 자동'], ['event', '이벤트 수동']]} />
          <SelectInput label="할인 방식" value={newTemplate.discount_type} onChange={(v) => setNewTemplate((p) => ({ ...p, discount_type: v as CouponTemplateRow["discount_type"] }))} options={[['fixed_amount', '정액'], ['percent', '정률']]} />
          <LabelInput label="할인값" suffix={newTemplate.discount_type === "percent" ? "%" : "원"} value={newTemplate.discount_value} onChange={(v) => setNewTemplate((p) => ({ ...p, discount_value: v }))} />
          <LabelInput label="최소 주문금액" suffix="원" value={newTemplate.min_order_amount} onChange={(v) => setNewTemplate((p) => ({ ...p, min_order_amount: v }))} />
          <LabelInput label="최대 할인금액" suffix="원" value={newTemplate.max_discount_amount} onChange={(v) => setNewTemplate((p) => ({ ...p, max_discount_amount: v }))} placeholder="선택" />
          <LabelInput label="유효기간" suffix="일" value={newTemplate.valid_days} onChange={(v) => setNewTemplate((p) => ({ ...p, valid_days: v }))} />
        </div>
        <div className="previewBox">미리보기: {discountText(newTemplatePreview)} · {money(toNumber(newTemplate.min_order_amount, 0))}원 이상 · {Math.max(1, Math.floor(toNumber(newTemplate.valid_days, 30)))}일</div>
      </section>

      <section className="sectionCard">
        <div className="sectionHead">
          <div>
            <h2>쿠폰 목록</h2>
            <p>비활성 쿠폰은 발급 중지</p>
          </div>
        </div>
        {templatesLoading ? <p className="muted">쿠폰 목록 로딩 중...</p> : null}
        {!templatesLoading && !templates.length ? <p className="emptyText">등록된 쿠폰이 없습니다.</p> : null}
        <div className="itemGrid">
          {templates.map((row) => {
            const editing = editingTemplateId === row.id;
            return (
              <article key={row.id} className="itemCard">
                <div className="itemTop">
                  <strong>{row.name}</strong>
                  <span className={`badge ${row.is_active ? "badgeGreen" : "badgeGray"}`}>{row.is_active ? "활성" : "비활성"}</span>
                </div>
                <p>{couponKindLabel(row.coupon_kind)} · {discountText(row)}</p>
                <p>최소 {money(row.min_order_amount)}원 · 유효 {row.valid_days}일</p>
                {editing ? (
                  <div className="editBox">
                    <div className="formGrid formGridCompact">
                      <LabelInput label="쿠폰명" value={editTemplate.name} onChange={(v) => setEditTemplate((p) => ({ ...p, name: v }))} />
                      <SelectInput label="쿠폰 종류" value={editTemplate.coupon_kind} onChange={(v) => setEditTemplate((p) => ({ ...p, coupon_kind: v as CouponTemplateRow["coupon_kind"] }))} options={[["first_order", "첫주문 자동"], ["thank_you", "감사 자동"], ["event", "이벤트 수동"]]} />
                      <SelectInput label="할인 방식" value={editTemplate.discount_type} onChange={(v) => setEditTemplate((p) => ({ ...p, discount_type: v as CouponTemplateRow["discount_type"] }))} options={[["fixed_amount", "정액"], ["percent", "정률"]]} />
                      <LabelInput label="할인값" suffix={editTemplate.discount_type === "percent" ? "%" : "원"} value={editTemplate.discount_value} onChange={(v) => setEditTemplate((p) => ({ ...p, discount_value: v }))} />
                      <LabelInput label="최소 주문금액" suffix="원" value={editTemplate.min_order_amount} onChange={(v) => setEditTemplate((p) => ({ ...p, min_order_amount: v }))} />
                      <LabelInput label="최대 할인금액" suffix="원" value={editTemplate.max_discount_amount} onChange={(v) => setEditTemplate((p) => ({ ...p, max_discount_amount: v }))} placeholder="선택" />
                      <LabelInput label="유효기간" suffix="일" value={editTemplate.valid_days} onChange={(v) => setEditTemplate((p) => ({ ...p, valid_days: v }))} />
                    </div>
                    <p className="hintText">수정 내용은 새 발급부터 적용됩니다.</p>
                    <div className="actionRow">
                      <button className="btn btnDark" type="button" onClick={() => saveTemplateEdit(row)} disabled={savingEditTemplate}>{savingEditTemplate ? "저장 중" : "저장"}</button>
                      <button className="btn" type="button" onClick={cancelEditTemplate} disabled={savingEditTemplate}>취소</button>
                    </div>
                  </div>
                ) : (
                  <div className="actionRow">
                    <button className="btn" type="button" onClick={() => startEditTemplate(row)}>수정</button>
                    <button className="btn" type="button" onClick={() => toggleTemplate(row)}>{row.is_active ? "비활성화" : "활성화"}</button>
                    <button className="btn btnDark" type="button" onClick={() => selectIssueTemplate(row.id)}>발급 선택</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
          </section>
        </>
      ) : null}

      {activeTab === "issue" ? (
        <section className="sectionCard">
          <div className="sectionHead">
            <div>
              <h2>쿠폰 발급</h2>
              <p>고객을 선택해 발급</p>
            </div>
            <button
              className="btn btnDark"
              type="button"
              onClick={issueCouponToSelectedTargets}
              disabled={bulkIssuing || !selectedTargetIds.length}
            >
              {selectedIssueButtonLabel}
            </button>
          </div>

          <div className="issueGrid">
            <label className="field">
              <span>발급 쿠폰</span>
              <div className="fieldBox">
                <select value={issueTemplateId} onChange={(e) => handleIssueTemplateChange(e.target.value)}>
                  <option value="">선택해 주세요</option>
                  {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name} · {couponKindLabel(tpl.coupon_kind)}{tpl.is_active ? "" : " [비활성]"}</option>)}
                </select>
              </div>
            </label>
            <div className="selectedBox">
              <span>선택 쿠폰</span>
              <strong>{selectedTemplate?.name || "선택 전"}</strong>
              <p>{selectedTemplate ? discountText(selectedTemplate) : "쿠폰을 선택해 주세요."}</p>
            </div>
            <div className="selectedBox">
              <span>선택 고객</span>
              <strong>{selectedTargetIds.length}명 선택</strong>
              <p>{targetRows.length ? `검색 결과 ${targetRows.length}명` : "고객을 검색하고 체크해 주세요."}</p>
            </div>
          </div>

          <div className="targetPanel">
            <div className="listHead">
              <h3 className="subTitle">대상 고객 검색</h3>
              <button className="btn" type="button" onClick={() => setShowAdvancedTargetFilters((prev) => !prev)}>
                {showAdvancedTargetFilters ? "상세 조건 닫기" : "상세 조건 열기"}
              </button>
            </div>
            <div className="formGrid targetBasicGrid">
              <LabelInput label="이름/전화번호" value={targetSearch} onChange={setTargetSearch} placeholder="이름 또는 전화번호" />
              <SelectInput label="등급" value={targetTier} onChange={setTargetTier} options={targetTierOptions} />
            </div>
            {showAdvancedTargetFilters ? (
              <div className="formGrid targetFilterGrid">
                <LabelInput label="보유 포인트" suffix="P 이상" value={targetMinPoints} onChange={setTargetMinPoints} />
                <LabelInput label="누적 주문수" suffix="회 이상" value={targetMinOrders} onChange={setTargetMinOrders} />
                <LabelInput label="누적 이용금액" suffix="원 이상" value={targetMinSpent} onChange={setTargetMinSpent} />
                <SelectInput label="최근 주문" value={targetRecentDays} onChange={setTargetRecentDays} options={targetRecentOptions} />
                <SelectInput label="미방문" value={targetInactiveDays} onChange={setTargetInactiveDays} options={targetInactiveOptions} />
                <SelectInput label="고객 등록" value={targetRegisteredDays} onChange={setTargetRegisteredDays} options={targetRegisteredOptions} />
              </div>
            ) : null}
            <div className="targetActions">
              <label className="checkRow">
                <input type="checkbox" checked={targetExcludeExisting} onChange={(e) => setTargetExcludeExisting(e.target.checked)} />
                이미 같은 쿠폰 받은 고객 제외
              </label>
              <div className="actionRow">
                <button className="btn btnDark" type="button" onClick={searchCouponTargets} disabled={targetLoading}>{targetLoading ? "검색 중" : "대상 검색"}</button>
                <button className="btn" type="button" onClick={toggleAllTargets} disabled={!targetRows.length}>{allTargetsSelected ? "전체 해제" : "표시된 고객 전체 선택"}</button>
              </div>
            </div>
            <div className="listHead">
              <h3 className="subTitle">검색 결과 {targetRows.length}명</h3>
              <span>선택 {selectedTargetIds.length}명</span>
            </div>
            {targetLoading ? <p className="muted">대상 고객 검색 중...</p> : null}
            {!targetLoading && targetRows.length === 0 ? <p className="emptyText">조건에 맞는 고객을 검색해 주세요.</p> : null}
            <div className="targetList">
              {targetRows.map((row) => {
                const checked = selectedTargetIds.includes(row.customer_user_id);
                return (
                  <label key={row.customer_user_id} className={`targetRow ${checked ? "targetRowOn" : ""}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleTargetSelection(row.customer_user_id)} />
                    <div>
                      <strong>{customerDisplayName({ user_id: row.customer_user_id, name: row.name, phone: row.phone }, row.customer_user_id)}</strong>
                      <p>{phoneText(row.phone)} · {tierLabel(row.tier)} · {money(row.point_balance)}P</p>
                      <p className="targetMeta">주문 {money(row.lifetime_orders)}회 · 이용 {money(row.lifetime_spent)}원 · 최근 {dateText(row.last_order_at)} · 등록 {dateText(row.registered_at)}</p>
                    </div>
                    {row.already_has_coupon ? <span className="badge badgeGray">보유</span> : null}
                  </label>
                );
              })}
            </div>
            <div className="confirmBox">
              <div>
                <span>발급 전 확인</span>
                <strong>{selectedTemplate?.name || "쿠폰 선택 전"} · 선택 {selectedTargetIds.length}명</strong>
                <p>{targetFilterSummary}</p>
                <p>{targetExcludeExisting ? "같은 쿠폰 보유 고객 제외" : "같은 쿠폰 보유 고객도 포함"}</p>
              </div>
              <label className="checkRow">
                <input type="checkbox" checked={bulkConfirmChecked} onChange={(e) => setBulkConfirmChecked(e.target.checked)} />
                선택 고객 발급 확인
              </label>
            </div>
            <button
              className="btn btnDark issueSubmitButton"
              type="button"
              onClick={issueCouponToSelectedTargets}
              disabled={bulkIssuing || !selectedTargetIds.length}
            >
              {selectedIssueButtonLabel}
            </button>
            {bulkIssueResult ? <div className="previewBox resultBox">발급 {bulkIssueResult.issued_count || 0}명 · 제외 {bulkIssueResult.skipped_existing_count || 0}명 · 유효하지 않음 {bulkIssueResult.invalid_customer_count || 0}명</div> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "history" ? (
        <section className="sectionCard">
          <div className="sectionHead">
            <div>
              <h2>발급 내역</h2>
              <p>검색·필터로 확인</p>
            </div>
          </div>

          <div className="searchPanel historySearchPanel">
            <label className="field searchField">
              <span>고객 검색</span>
              <div className="fieldBox">
                <input
                  value={issuedSearch}
                  placeholder="이름 또는 전화번호"
                  onChange={(e) => setIssuedSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleIssuedSearch(); }}
                />
              </div>
            </label>
            <SelectInput label="상태" value={issuedStatusFilter} onChange={setIssuedStatusFilter} options={issuedStatusOptions} />
            <SelectInput label="기간" value={issuedPeriodFilter} onChange={setIssuedPeriodFilter} options={issuedPeriodOptions} />
            <div className="searchActions">
              <button className="btn btnDark" type="button" onClick={handleIssuedSearch} disabled={issuedLoading}>{issuedLoading ? "조회 중" : "조회"}</button>
              <button className="btn" type="button" onClick={resetIssuedSearch} disabled={issuedLoading}>초기화</button>
            </div>
          </div>

          <div className="listHead">
            <h3 className="subTitle">{issuedSummary}</h3>
            <span>{issuedCoupons.length}건 표시</span>
          </div>
          {issuedLoading ? <p className="muted">발급 내역 로딩 중...</p> : null}
          {!issuedLoading && issuedCoupons.length === 0 ? <p className="emptyText">발급 내역이 없습니다.</p> : null}

          <div className="historyTableWrap">
            <table className="historyTable">
              <thead>
                <tr>
                  <th>상태</th>
                  <th>고객</th>
                  <th>쿠폰</th>
                  <th>발급</th>
                  <th>만료</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {issuedCoupons.map((row) => {
                  const profile = customerProfilesById[row.customer_user_id];
                  return (
                    <tr key={row.id}>
                      <td><span className={`badge ${row.status === "issued" ? "badgeGreen" : "badgeGray"}`}>{couponStatusLabel(row.status)}</span></td>
                      <td><strong>{customerDisplayName(profile, row.customer_user_id)}</strong><p>{phoneText(profile?.phone)}</p></td>
                      <td><strong>{row.template?.name || "템플릿 없음"}</strong><p>{row.template ? couponKindLabel(row.template.coupon_kind) : "-"}</p></td>
                      <td>{dateText(row.issued_at)}</td>
                      <td>{dateText(row.expires_at)}</td>
                      <td>{row.status === "issued" ? <button className="btn btnDanger" type="button" disabled={cancellingCouponId === row.id} onClick={() => cancelIssuedCoupon(row)}>{cancellingCouponId === row.id ? "취소 중" : "취소"}</button> : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="historyCards">
            {issuedCoupons.map((row) => {
              const profile = customerProfilesById[row.customer_user_id];
              return (
                <article key={row.id} className="itemCard">
                  <div className="itemTop">
                    <strong>{row.template?.name || "템플릿 없음"}</strong>
                    <span className={`badge ${row.status === "issued" ? "badgeGreen" : "badgeGray"}`}>{couponStatusLabel(row.status)}</span>
                  </div>
                  <p>{customerDisplayName(profile, row.customer_user_id)} · {phoneText(profile?.phone)}</p>
                  <p>발급 {dateText(row.issued_at)} · 만료 {dateText(row.expires_at)}</p>
                  {row.status === "issued" ? (
                    <button
                      className="btn btnDanger"
                      type="button"
                      disabled={cancellingCouponId === row.id}
                      onClick={() => cancelIssuedCoupon(row)}
                    >
                      {cancellingCouponId === row.id ? "취소 중" : "쿠폰 취소"}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>

          {issuedHasMore ? <button className="btn" type="button" onClick={() => loadIssuedCoupons("more")} disabled={issuedLoading}>{issuedLoading ? "불러오는 중" : "더보기"}</button> : null}
        </section>
      ) : null}

      <style jsx global>{`
        .loyaltyPage { max-width: 1120px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; color: #0f172a; font-size: 14px; }
        .loyaltyPage .heroCard, .loyaltyPage .sectionCard, .loyaltyPage .summaryCard { border: 1px solid #dbe3ef; border-radius: 20px; background: #fff; box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06); }
        .loyaltyPage .heroCard { padding: 24px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); }
        .loyaltyPage .eyebrow { margin: 0 0 7px; color: #7c3aed; font-weight: 900; font-size: 12px; }
        .loyaltyPage h1, .loyaltyPage h2, .loyaltyPage h3, .loyaltyPage p { margin: 0; }
        .loyaltyPage h1 { font-size: 27px; font-weight: 950; letter-spacing: -0.04em; line-height: 1.15; }
        .loyaltyPage h2 { font-size: 19px; font-weight: 950; letter-spacing: -0.03em; line-height: 1.2; }
        .loyaltyPage .heroDesc, .loyaltyPage .storeLine, .loyaltyPage .sectionHead p, .loyaltyPage .itemCard p, .loyaltyPage .selectedBox p, .loyaltyPage .confirmBox p, .loyaltyPage .muted, .loyaltyPage .emptyText { color: #64748b; font-weight: 650; line-height: 1.45; }
        .loyaltyPage .heroDesc { margin-top: 9px; }
        .loyaltyPage .storeLine { margin-top: 9px; }
        .loyaltyPage .heroActions, .loyaltyPage .actionRow { display: flex; gap: 8px; flex-wrap: wrap; }
        .loyaltyPage .btn { min-height: 40px; border: 1px solid #cbd5e1; background: #fff; color: #111827; border-radius: 12px; padding: 0 14px; font-weight: 850; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: background .15s ease, border-color .15s ease, transform .15s ease; }
        .loyaltyPage .btn:hover:not(:disabled) { transform: translateY(-1px); border-color: #94a3b8; }
        .loyaltyPage .btnDark { border-color: #111827; background: #111827; color: #fff; }
        .loyaltyPage .btnDanger { border-color: #fecaca; background: #fff5f5; color: #b91c1c; }
        .loyaltyPage .btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
        .loyaltyPage .notice { padding: 13px 15px; border-radius: 14px; font-weight: 850; white-space: pre-wrap; }
        .loyaltyPage .notice-success { background: #ecfdf5; color: #047857; border: 1px solid #86efac; }
        .loyaltyPage .notice-error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .loyaltyPage .notice-info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .loyaltyPage .summaryGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .loyaltyPage .summaryCard { position: relative; padding: 18px 18px 18px 20px; min-height: 104px; display: grid; align-content: center; gap: 8px; overflow: hidden; }
        .loyaltyPage .summaryCard::before { content: ""; position: absolute; left: 0; top: 18px; bottom: 18px; width: 4px; border-radius: 999px; background: #111827; }
        .loyaltyPage .summaryCard span { color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: -0.01em; }
        .loyaltyPage .summaryCard strong { display: block; font-size: 19px; font-weight: 950; line-height: 1.2; letter-spacing: -0.03em; }
        .loyaltyPage .summaryCard p { color: #64748b; font-size: 13px; font-weight: 750; line-height: 1.35; }
        .loyaltyPage .tabBar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .loyaltyPage .tabButton { min-height: 62px; border: 1px solid #dbe3ef; background: #fff; border-radius: 16px; padding: 12px 13px; text-align: left; cursor: pointer; display: grid; gap: 3px; align-content: center; color: #0f172a; box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04); }
        .loyaltyPage .tabButton strong { font-size: 14px; font-weight: 900; }
        .loyaltyPage .tabButton span { color: #64748b; font-size: 12px; font-weight: 750; }
        .loyaltyPage .tabButtonOn { border-color: #111827; background: #111827; color: #fff; }
        .loyaltyPage .tabButtonOn span { color: #d1d5db; }
        .loyaltyPage .sectionCard { padding: 20px; display: grid; gap: 16px; }
        .loyaltyPage .sectionHead { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .loyaltyPage .formGrid, .loyaltyPage .issueGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
        .loyaltyPage .searchPanel { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(160px, .6fr) auto; gap: 12px; align-items: end; padding: 14px; border: 1px solid #dbe3ef; border-radius: 18px; background: #f8fafc; }
        .loyaltyPage .searchActions { display: flex; gap: 8px; align-items: center; }
        .loyaltyPage .targetPanel { display: grid; gap: 15px; }
        .loyaltyPage .targetBasicGrid { grid-template-columns: minmax(0, 1.5fr) minmax(180px, .7fr); }
        .loyaltyPage .targetFilterGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .loyaltyPage .targetActions { display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; }
        .loyaltyPage .targetList { display: grid; gap: 9px; }
        .loyaltyPage .targetRow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; border: 1px solid #dbe3ef; border-radius: 16px; padding: 14px; background: #fff; cursor: pointer; }
        .loyaltyPage .targetRow strong { font-weight: 900; font-size: 15px; }
        .loyaltyPage .targetRow p { margin-top: 5px; color: #64748b; font-weight: 700; line-height: 1.35; }
        .loyaltyPage .targetMeta { font-size: 12px; }
        .loyaltyPage .targetRowOn { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, .12); background: #fbfaff; }
        .loyaltyPage .confirmBox { display: flex; justify-content: space-between; gap: 14px; align-items: center; border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 16px; padding: 14px; }
        .loyaltyPage .confirmBox span { display: block; color: #64748b; font-size: 12px; font-weight: 850; margin-bottom: 5px; }
        .loyaltyPage .confirmBox strong { display: block; font-size: 15px; font-weight: 950; margin-bottom: 4px; }
        .loyaltyPage .resultBox { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
        .loyaltyPage .issueSubmitButton { justify-self: end; min-width: 180px; }
        .loyaltyPage .listHead { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
        .loyaltyPage .listHead span { color: #64748b; font-size: 13px; font-weight: 800; }
        .loyaltyPage .customerList { display: grid; gap: 9px; }
        .loyaltyPage .customerRow { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; border: 1px solid #dbe3ef; border-radius: 16px; padding: 14px; background: #fff; }
        .loyaltyPage .customerRow strong { font-weight: 900; }
        .loyaltyPage .customerRow p { margin-top: 4px; color: #64748b; font-weight: 700; }
        .loyaltyPage .customerRowOn { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, .12); }
        .loyaltyPage .historySearchPanel { grid-template-columns: minmax(0, 1.3fr) minmax(140px, .5fr) minmax(140px, .5fr) auto; }
        .loyaltyPage .historyTableWrap { overflow-x: auto; border: 1px solid #dbe3ef; border-radius: 16px; }
        .loyaltyPage .historyTable { width: 100%; border-collapse: collapse; min-width: 760px; background: #fff; }
        .loyaltyPage .historyTable th, .loyaltyPage .historyTable td { padding: 13px 14px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: middle; }
        .loyaltyPage .historyTable th { background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 850; }
        .loyaltyPage .historyTable td { color: #0f172a; font-weight: 700; }
        .loyaltyPage .historyTable td p { margin-top: 4px; color: #64748b; font-weight: 650; }
        .loyaltyPage .historyCards { display: none; gap: 10px; }
        .loyaltyPage .field { display: grid; gap: 9px; color: #334155; font-weight: 850; font-size: 13px; letter-spacing: -0.01em; }
        .loyaltyPage .fieldBox { min-height: 52px; display: flex; align-items: center; border: 1px solid #cbd5e1; border-radius: 15px; overflow: hidden; background: #fff; box-shadow: inset 0 1px 0 rgba(15, 23, 42, .03); transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
        .loyaltyPage .fieldBox:focus-within { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, .12); background: #fff; }
        .loyaltyPage .field input, .loyaltyPage .field select { width: 100%; min-height: 50px; border: 0; outline: 0; border-radius: 0; padding: 0 14px; font: inherit; font-size: 15px; font-weight: 800; background: transparent; color: #0f172a; }
        .loyaltyPage .field input::placeholder { color: #94a3b8; font-weight: 750; }
        .loyaltyPage .field select { appearance: none; background-image: linear-gradient(45deg, transparent 50%, #64748b 50%), linear-gradient(135deg, #64748b 50%, transparent 50%); background-position: calc(100% - 18px) 22px, calc(100% - 11px) 22px; background-size: 7px 7px, 7px 7px; background-repeat: no-repeat; padding-right: 36px; }
        .loyaltyPage .fieldSuffix { min-width: 54px; align-self: stretch; border-left: 1px solid #e2e8f0; background: #f8fafc; color: #475569; font-size: 13px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; }
        .loyaltyPage .checkRow { display: inline-flex; align-items: center; gap: 8px; color: #334155; font-weight: 850; }
        .loyaltyPage .checkRow input, .loyaltyPage .targetRow input { width: 16px; height: 16px; accent-color: #111827; }
        .loyaltyPage .previewBox, .loyaltyPage .selectedBox, .loyaltyPage .editBox { border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 16px; padding: 14px; color: #334155; font-weight: 850; }
        .loyaltyPage .editBox { display: grid; gap: 10px; }
        .loyaltyPage .hintText { color: #64748b; font-size: 12px; font-weight: 800; }
        .loyaltyPage .formGridCompact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .loyaltyPage .selectedBox span { display: block; color: #64748b; font-size: 12px; font-weight: 850; margin-bottom: 6px; }
        .loyaltyPage .selectedBox strong { font-size: 16px; font-weight: 950; }
        .loyaltyPage .itemGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .loyaltyPage .itemCard { border: 1px solid #dbe3ef; border-radius: 18px; padding: 15px; display: grid; gap: 10px; background: #fff; }
        .loyaltyPage .itemCardOn { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, .12); }
        .loyaltyPage .itemTop { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
        .loyaltyPage .itemTop strong { font-weight: 950; }
        .loyaltyPage .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 850; white-space: nowrap; }
        .loyaltyPage .badgeGreen { background: #dcfce7; color: #166534; }
        .loyaltyPage .badgeGray { background: #f1f5f9; color: #475569; }
        .loyaltyPage .badgePurple { background: #ede9fe; color: #6d28d9; }
        .loyaltyPage .subTitle { margin-top: 4px; font-size: 16px; font-weight: 900; }
        .loyaltyPage .emptyText { padding: 10px 0; }
        @media (max-width: 900px) {
          .loyaltyPage .summaryGrid, .loyaltyPage .formGrid, .loyaltyPage .issueGrid, .loyaltyPage .targetBasicGrid, .loyaltyPage .targetFilterGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .loyaltyPage .tabBar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .loyaltyPage .searchPanel { grid-template-columns: 1fr 1fr; }
          .loyaltyPage .searchActions { grid-column: 1 / -1; }
        }
        @media (max-width: 640px) {
          .loyaltyPage { padding: 14px; gap: 12px; }
          .loyaltyPage .heroCard { display: grid; padding: 18px; border-radius: 18px; }
          .loyaltyPage .heroActions { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
          .loyaltyPage .sectionHead { display: grid; }
          .loyaltyPage .sectionHead .btn, .loyaltyPage .actionRow .btn { width: 100%; }
          .loyaltyPage .btn { width: 100%; text-align: center; }
          .loyaltyPage h1 { font-size: 24px; }
          .loyaltyPage h2 { font-size: 18px; }
          .loyaltyPage .summaryGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .loyaltyPage .summaryCard { min-height: 88px; padding: 14px 14px 14px 18px; }
          .loyaltyPage .summaryCard strong { font-size: 15px; }
          .loyaltyPage .summaryCard p { font-size: 12px; }
          .loyaltyPage .tabBar { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .loyaltyPage .tabButton { min-height: 54px; padding: 10px 12px; }
          .loyaltyPage .formGrid, .loyaltyPage .issueGrid, .loyaltyPage .itemGrid, .loyaltyPage .searchPanel, .loyaltyPage .customerRow, .loyaltyPage .targetBasicGrid, .loyaltyPage .targetFilterGrid, .loyaltyPage .targetRow, .loyaltyPage .historySearchPanel { grid-template-columns: 1fr; }
          .loyaltyPage .targetActions, .loyaltyPage .confirmBox { display: grid; }
          .loyaltyPage .issueSubmitButton { justify-self: stretch; }
          .loyaltyPage .searchActions { display: grid; grid-template-columns: 1fr 1fr; }
          .loyaltyPage .historyTableWrap { display: none; }
          .loyaltyPage .historyCards { display: grid; }
        }
      `}</style>
    </main>
  );
}

function SummaryCard({ title, main, sub }: { title: string; main: string; sub?: string }) {
  return (
    <article className="summaryCard">
      <span>{title}</span>
      <strong>{main}</strong>
      {sub ? <p>{sub}</p> : null}
    </article>
  );
}

function LabelInput({ label, value, onChange, suffix, placeholder }: { label: string; value: string; onChange: (next: string) => void; suffix?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="fieldBox">
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="fieldSuffix">{suffix}</span> : null}
      </div>
    </label>
  );
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (next: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="fieldBox">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
        </select>
      </div>
    </label>
  );
}

export default function AdminLoyaltyPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>로딩 중...</div>}>
      <AdminLoyaltyInner />
    </Suspense>
  );
}
