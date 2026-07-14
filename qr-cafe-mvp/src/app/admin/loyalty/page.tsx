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

type WalletCustomerRow = {
  customer_user_id: string;
  point_balance: number;
  tier: "general" | "regular" | "vip";
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
  const [issuingCoupon, setIssuingCoupon] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [issuedLoading, setIssuedLoading] = useState(false);

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
  const [walletCustomers, setWalletCustomers] = useState<WalletCustomerRow[]>([]);
  const [customerProfilesById, setCustomerProfilesById] = useState<Record<string, CustomerProfileRow>>({});
  const [issuedCoupons, setIssuedCoupons] = useState<IssuedCouponRow[]>([]);
  const [issueCustomerId, setIssueCustomerId] = useState("");
  const [issueTemplateId, setIssueTemplateId] = useState("");
  const [newTemplate, setNewTemplate] = useState({
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

  const loadWalletCustomers = async () => {
    if (!storeId) return;
    setCustomersLoading(true);
    const { data, error } = await supabase
      .from("customer_store_wallets")
      .select("customer_user_id,point_balance,tier")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      showMsg(`고객 목록 조회 실패: ${error.message}`, "error");
      setWalletCustomers([]);
      setCustomersLoading(false);
      return;
    }

    const rows = (Array.isArray(data) ? data : []) as WalletCustomerRow[];
    setWalletCustomers(rows);
    const profiles = await loadProfiles(rows.map((r) => r.customer_user_id));
    setCustomerProfilesById((prev) => ({ ...prev, ...profiles }));
    setCustomersLoading(false);
  };

  const loadIssuedCoupons = async () => {
    if (!storeId) return;
    setIssuedLoading(true);
    const { data, error } = await supabase
      .from("customer_coupons")
      .select("id,customer_user_id,status,issued_at,expires_at,template_id,template:store_coupon_templates(name,coupon_kind,discount_type,discount_value)")
      .eq("store_id", storeId)
      .order("issued_at", { ascending: false })
      .limit(30);

    if (error) {
      showMsg(`발급 내역 조회 실패: ${error.message}`, "error");
      setIssuedCoupons([]);
      setIssuedLoading(false);
      return;
    }
    const rows = (Array.isArray(data) ? data : []) as IssuedCouponRow[];
    setIssuedCoupons(rows);
    const profiles = await loadProfiles(rows.map((r) => r.customer_user_id));
    setCustomerProfilesById((prev) => ({ ...prev, ...profiles }));
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

    await Promise.all([loadTemplates(), loadWalletCustomers(), loadIssuedCoupons()]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const activeTemplates = templates.filter((row) => row.is_active).length;
  const selectedCustomer = issueCustomerId ? customerProfilesById[issueCustomerId] : null;
  const selectedTemplate = templates.find((row) => row.id === issueTemplateId) || null;
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

  const issueCouponToCustomer = async () => {
    if (!storeId) return;
    const customerId = issueCustomerId.trim();
    const templateId = issueTemplateId.trim();
    if (!customerId) return showMsg("쿠폰을 발급할 고객을 선택해 주세요.", "error");
    if (!templateId) return showMsg("발급할 쿠폰을 선택해 주세요.", "error");
    const tpl = templates.find((row) => row.id === templateId);
    if (tpl && !tpl.is_active) return showMsg("비활성 쿠폰은 먼저 활성화해 주세요.", "error");

    setIssuingCoupon(true);
    setMsg("");
    const { error } = await supabase.rpc("issue_customer_coupon", { p_store_id: storeId, p_customer_user_id: customerId, p_template_id: templateId });
    if (error) showMsg(`쿠폰 발급 실패: ${error.message}`, "error");
    else {
      const profile = customerProfilesById[customerId];
      showMsg(`${profile?.name || "선택 고객"}에게 쿠폰을 발급했습니다.`, "success");
      await Promise.all([loadIssuedCoupons(), loadWalletCustomers()]);
    }
    setIssuingCoupon(false);
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
          <p className="heroDesc">적립률·쿠폰 발급 관리</p>
          <p className="storeLine">현재 매장: <b>{storeId || "-"}</b></p>
        </div>
        <div className="heroActions">
          <button className="btn" type="button" onClick={() => router.push(storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")}>관리자 홈</button>
          <button className="btn btnDark" type="button" onClick={loadData}>새로고침</button>
        </div>
      </section>

      {msg ? <div className={`notice notice-${msgTone}`} role="status">{msg}</div> : null}

      <section className="summaryGrid" aria-label="포인트 쿠폰 요약">
        <SummaryCard title="적립률" value={`일반 ${settings.tier_general_rate_pct}% · 단골 ${settings.tier_regular_rate_pct}% · VIP ${settings.tier_vip_rate_pct}%`} />
        <SummaryCard title="사용 제한" value={`최소 ${money(settings.min_redeem_points)}P · 최대 ${settings.max_redeem_pct}%`} />
        <SummaryCard title="쿠폰 템플릿" value={`활성 ${activeTemplates}개 · 전체 ${templates.length}개`} />
        <SummaryCard title="최근 발급" value={`사용 가능 ${issuedCoupons.filter((row) => row.status === "issued").length}장 · 최근 ${issuedCoupons.length}건`} />
      </section>

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
          {templates.map((row) => (
            <article key={row.id} className="itemCard">
              <div className="itemTop">
                <strong>{row.name}</strong>
                <span className={`badge ${row.is_active ? "badgeGreen" : "badgeGray"}`}>{row.is_active ? "활성" : "비활성"}</span>
              </div>
              <p>{couponKindLabel(row.coupon_kind)} · {discountText(row)}</p>
              <p>최소 {money(row.min_order_amount)}원 · 유효 {row.valid_days}일</p>
              <div className="actionRow">
                <button className="btn" type="button" onClick={() => toggleTemplate(row)}>{row.is_active ? "비활성화" : "활성화"}</button>
                <button className="btn btnDark" type="button" onClick={() => setIssueTemplateId(row.id)}>발급 선택</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHead">
          <div>
            <h2>쿠폰 발급</h2>
            <p>고객과 쿠폰 선택</p>
          </div>
          <button className="btn btnDark" type="button" onClick={issueCouponToCustomer} disabled={issuingCoupon}>{issuingCoupon ? "발급 중" : "발급"}</button>
        </div>
        <div className="issueGrid">
          <div className="selectedBox">
            <span>선택 고객</span>
            <strong>{selectedCustomer?.name || (issueCustomerId ? "이름 미등록" : "선택 전")}</strong>
            <p>{selectedCustomer ? phoneText(selectedCustomer.phone) : "고객을 선택해 주세요."}</p>
          </div>
          <label className="field">
            <span>발급 쿠폰</span>
            <select value={issueTemplateId} onChange={(e) => setIssueTemplateId(e.target.value)}>
              <option value="">선택해 주세요</option>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name} · {couponKindLabel(tpl.coupon_kind)}{tpl.is_active ? "" : " [비활성]"}</option>)}
            </select>
          </label>
          <div className="selectedBox">
            <span>선택 쿠폰</span>
            <strong>{selectedTemplate?.name || "선택 전"}</strong>
            <p>{selectedTemplate ? discountText(selectedTemplate) : "쿠폰을 선택해 주세요."}</p>
          </div>
        </div>

        <h3 className="subTitle">최근 고객</h3>
        {customersLoading ? <p className="muted">고객 목록 로딩 중...</p> : null}
        {!customersLoading && walletCustomers.length === 0 ? <p className="emptyText">고객 지갑 데이터가 아직 없습니다.</p> : null}
        <div className="itemGrid">
          {walletCustomers.map((row) => {
            const profile = customerProfilesById[row.customer_user_id];
            const active = issueCustomerId === row.customer_user_id;
            return (
              <article key={row.customer_user_id} className={`itemCard ${active ? "itemCardOn" : ""}`}>
                <div className="itemTop">
                  <strong>{profile?.name || "이름 미등록"}</strong>
                  <span className="badge badgePurple">{tierLabel(row.tier)}</span>
                </div>
                <p>{money(row.point_balance)}P · {phoneText(profile?.phone)}</p>
                <button className="btn btnDark" type="button" onClick={() => setIssueCustomerId(row.customer_user_id)}>{active ? "선택됨" : "고객 선택"}</button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sectionCard">
        <div className="sectionHead">
          <div>
            <h2>최근 발급 내역</h2>
            <p>최근 30건</p>
          </div>
        </div>
        {issuedLoading ? <p className="muted">발급 내역 로딩 중...</p> : null}
        {!issuedLoading && issuedCoupons.length === 0 ? <p className="emptyText">아직 발급 내역이 없습니다.</p> : null}
        <div className="itemGrid">
          {issuedCoupons.map((row) => {
            const profile = customerProfilesById[row.customer_user_id];
            return (
              <article key={row.id} className="itemCard">
                <div className="itemTop">
                  <strong>{row.template?.name || "템플릿 없음"}</strong>
                  <span className={`badge ${row.status === "issued" ? "badgeGreen" : "badgeGray"}`}>{couponStatusLabel(row.status)}</span>
                </div>
                <p>{profile?.name || "이름 미등록"} · {phoneText(profile?.phone)}</p>
                <p>발급 {dateText(row.issued_at)} · 만료 {dateText(row.expires_at)}</p>
              </article>
            );
          })}
        </div>
      </section>

      <style jsx>{`
        .loyaltyPage { max-width: 1120px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; color: #0f172a; }
        .heroCard, .sectionCard, .summaryCard { border: 1px solid #e2e8f0; border-radius: 20px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
        .heroCard { padding: 22px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); }
        .eyebrow { margin: 0 0 6px; color: #7c3aed; font-weight: 900; font-size: 13px; }
        h1, h2, h3, p { margin: 0; }
        h1 { font-size: 28px; font-weight: 950; letter-spacing: -0.04em; }
        h2 { font-size: 20px; font-weight: 950; letter-spacing: -0.03em; }
        .heroDesc, .storeLine, .sectionHead p, .itemCard p, .selectedBox p, .muted, .emptyText { color: #64748b; font-weight: 750; }
        .heroDesc { margin-top: 8px; }
        .storeLine { margin-top: 10px; }
        .heroActions, .actionRow { display: flex; gap: 8px; flex-wrap: wrap; }
        .btn { border: 1px solid #d1d5db; background: #fff; color: #111827; border-radius: 12px; padding: 10px 13px; font-weight: 900; cursor: pointer; text-decoration: none; }
        .btnDark { border-color: #111827; background: #111827; color: #fff; }
        .btn:disabled { opacity: .55; cursor: not-allowed; }
        .notice { padding: 12px 14px; border-radius: 14px; font-weight: 900; white-space: pre-wrap; }
        .notice-success { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
        .notice-error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .notice-info { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
        .summaryGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        .summaryCard { padding: 16px; }
        .summaryCard span { color: #64748b; font-size: 13px; font-weight: 900; }
        .summaryCard strong { display: block; margin-top: 8px; font-size: 16px; font-weight: 950; }
        .sectionCard { padding: 18px; display: grid; gap: 14px; }
        .sectionHead { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .formGrid, .issueGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .field { display: grid; gap: 7px; color: #334155; font-weight: 900; }
        .fieldControl { display: flex; align-items: center; border: 1px solid #d1d5db; border-radius: 12px; overflow: hidden; background: #fff; }
        .field input, .field select { width: 100%; border: 0; outline: 0; padding: 11px 12px; font: inherit; font-weight: 850; background: #fff; color: #0f172a; }
        .field select { border: 1px solid #d1d5db; border-radius: 12px; }
        .suffix { padding-right: 11px; color: #64748b; font-weight: 950; white-space: nowrap; }
        .checkRow { display: inline-flex; align-items: center; gap: 8px; color: #334155; font-weight: 900; }
        .previewBox, .selectedBox { border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 14px; padding: 12px; color: #334155; font-weight: 900; }
        .selectedBox span { display: block; color: #64748b; font-size: 12px; font-weight: 950; margin-bottom: 6px; }
        .selectedBox strong { font-size: 16px; }
        .itemGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .itemCard { border: 1px solid #e2e8f0; border-radius: 16px; padding: 13px; display: grid; gap: 9px; background: #fff; }
        .itemCardOn { border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124, 58, 237, .12); }
        .itemTop { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
        .itemTop strong { font-weight: 950; }
        .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: 12px; font-weight: 950; white-space: nowrap; }
        .badgeGreen { background: #dcfce7; color: #166534; }
        .badgeGray { background: #f1f5f9; color: #475569; }
        .badgePurple { background: #ede9fe; color: #6d28d9; }
        .subTitle { margin-top: 4px; font-size: 16px; font-weight: 950; }
        .emptyText { padding: 10px 0; }
        @media (max-width: 900px) { .summaryGrid, .formGrid, .issueGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 640px) {
          .loyaltyPage { padding: 16px; }
          .heroCard, .sectionHead { display: grid; }
          .heroActions, .sectionHead .btn, .actionRow .btn { width: 100%; }
          .btn { width: 100%; text-align: center; }
          .summaryGrid, .formGrid, .issueGrid, .itemGrid { grid-template-columns: 1fr; }
          h1 { font-size: 24px; }
        }
      `}</style>
    </main>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="summaryCard">
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function LabelInput({ label, value, onChange, suffix, placeholder }: { label: string; value: string; onChange: (next: string) => void; suffix?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="fieldControl">
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <em className="suffix">{suffix}</em> : null}
      </div>
    </label>
  );
}

function SelectInput({ label, value, onChange, options }: { label: string; value: string; onChange: (next: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, labelText]) => <option key={optionValue} value={optionValue}>{labelText}</option>)}
      </select>
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
