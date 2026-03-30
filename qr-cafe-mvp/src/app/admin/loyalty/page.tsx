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

function AdminLoyaltyInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(
    () => (sp.get("store") || getCurrentStoreId() || "").trim(),
    [sp]
  );

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
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

  const loadData = async () => {
    if (!storeId) {
      setMsg("매장을 먼저 선택해 주세요.");
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
      setMsg("선택한 매장에 대한 접근 권한이 없습니다.");
      setLoading(false);
      return;
    }

    const [settingsRes, tierRes] = await Promise.all([
      supabase
        .from("store_loyalty_settings")
        .select(
          "store_id,tier_general_rate_pct,tier_regular_rate_pct,tier_vip_rate_pct,max_redeem_pct,min_redeem_points,point_expiry_months,allow_point_or_coupon_only"
        )
        .eq("store_id", storeId)
        .maybeSingle(),
      supabase
        .from("store_tier_rules")
        .select(
          "store_id,lookback_months,regular_min_spent,regular_min_orders,vip_min_spent,vip_min_orders"
        )
        .eq("store_id", storeId)
        .maybeSingle(),
    ]);

    if (settingsRes.error) setMsg(`포인트 설정 조회 실패: ${settingsRes.error.message}`);
    if (tierRes.error) setMsg((p) => `${p ? `${p}\n` : ""}등급 규칙 조회 실패: ${tierRes.error?.message || ""}`);

    if (settingsRes.data) {
      setSettings(settingsRes.data as LoyaltySettingsRow);
    } else {
      setSettings((prev) => ({ ...prev, store_id: storeId }));
    }

    if (tierRes.data) {
      setTierRules(tierRes.data as TierRulesRow);
    } else {
      setTierRules((prev) => ({ ...prev, store_id: storeId }));
    }

    await Promise.all([loadTemplates(), loadWalletCustomers(), loadIssuedCoupons()]);
    setLoading(false);
  };

  const loadTemplates = async () => {
    if (!storeId) return;
    setTemplatesLoading(true);
    const { data, error } = await supabase
      .from("store_coupon_templates")
      .select(
        "id,coupon_kind,name,discount_type,discount_value,min_order_amount,max_discount_amount,valid_days,is_active"
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });

    if (error) setMsg((p) => `${p ? `${p}\n` : ""}쿠폰 목록 조회 실패: ${error.message}`);
    setTemplates((Array.isArray(data) ? data : []) as CouponTemplateRow[]);
    if (!issueTemplateId && Array.isArray(data) && data.length > 0) {
      setIssueTemplateId(String(data[0]?.id || ""));
    }
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
      setMsg((p) => `${p ? `${p}\n` : ""}고객 목록 조회 실패: ${error.message}`);
      setWalletCustomers([]);
      setCustomerProfilesById({});
      setCustomersLoading(false);
      return;
    }

    const rows = (Array.isArray(data) ? data : []) as WalletCustomerRow[];
    setWalletCustomers(rows);

    const ids = rows.map((r) => r.customer_user_id).filter(Boolean);
    if (!ids.length) {
      setCustomerProfilesById({});
      setCustomersLoading(false);
      return;
    }

    const { data: profileData, error: profileErr } = await supabase
      .from("customer_profiles")
      .select("user_id,name,phone")
      .in("user_id", ids);
    if (profileErr) {
      setMsg((p) => `${p ? `${p}\n` : ""}고객 프로필 조회 실패: ${profileErr.message}`);
      setCustomerProfilesById({});
      setCustomersLoading(false);
      return;
    }

    const profileMap: Record<string, CustomerProfileRow> = {};
    for (const row of Array.isArray(profileData) ? profileData : []) {
      const r = row as CustomerProfileRow;
      profileMap[r.user_id] = r;
    }
    setCustomerProfilesById(profileMap);
    setCustomersLoading(false);
  };

  const loadIssuedCoupons = async () => {
    if (!storeId) return;
    setIssuedLoading(true);
    const { data, error } = await supabase
      .from("customer_coupons")
      .select(
        "id,customer_user_id,status,issued_at,expires_at,template_id,template:store_coupon_templates(name,coupon_kind,discount_type,discount_value)"
      )
      .eq("store_id", storeId)
      .order("issued_at", { ascending: false })
      .limit(30);

    if (error) {
      setMsg((p) => `${p ? `${p}\n` : ""}발급 내역 조회 실패: ${error.message}`);
      setIssuedCoupons([]);
      setIssuedLoading(false);
      return;
    }
    setIssuedCoupons((Array.isArray(data) ? data : []) as IssuedCouponRow[]);
    setIssuedLoading(false);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const saveSettings = async () => {
    if (!storeId) return;
    setSavingSettings(true);
    setMsg("");
    const payload: LoyaltySettingsRow = { ...settings, store_id: storeId };
    const { error } = await supabase
      .from("store_loyalty_settings")
      .upsert(payload, { onConflict: "store_id" });
    if (error) setMsg(`포인트 설정 저장 실패: ${error.message}`);
    else setMsg("포인트 설정을 저장했습니다.");
    setSavingSettings(false);
  };

  const saveTierRules = async () => {
    if (!storeId) return;
    setSavingTier(true);
    setMsg("");
    const payload: TierRulesRow = { ...tierRules, store_id: storeId };
    const { error } = await supabase
      .from("store_tier_rules")
      .upsert(payload, { onConflict: "store_id" });
    if (error) setMsg(`등급 규칙 저장 실패: ${error.message}`);
    else setMsg("등급 규칙을 저장했습니다.");
    setSavingTier(false);
  };

  const createTemplate = async () => {
    if (!storeId) return;
    if (!newTemplate.name.trim()) {
      setMsg("쿠폰 이름을 입력해 주세요.");
      return;
    }
    setSavingTemplate(true);
    setMsg("");
    const payload = {
      store_id: storeId,
      coupon_kind: newTemplate.coupon_kind,
      name: newTemplate.name.trim(),
      discount_type: newTemplate.discount_type,
      discount_value: Math.max(1, Math.floor(toNumber(newTemplate.discount_value, 1000))),
      min_order_amount: Math.max(0, Math.floor(toNumber(newTemplate.min_order_amount, 0))),
      max_discount_amount: newTemplate.max_discount_amount.trim()
        ? Math.max(0, Math.floor(toNumber(newTemplate.max_discount_amount, 0)))
        : null,
      valid_days: Math.max(1, Math.floor(toNumber(newTemplate.valid_days, 30))),
      is_active: true,
    };
    const { error } = await supabase.from("store_coupon_templates").insert(payload);
    if (error) setMsg(`쿠폰 생성 실패: ${error.message}`);
    else {
      setMsg("쿠폰 템플릿을 생성했습니다.");
      setNewTemplate({
        coupon_kind: "event",
        name: "",
        discount_type: "fixed_amount",
        discount_value: "1000",
        min_order_amount: "0",
        max_discount_amount: "",
        valid_days: "30",
      });
      await loadTemplates();
    }
    setSavingTemplate(false);
  };

  const issueCouponToCustomer = async () => {
    if (!storeId) return;
    const customerId = issueCustomerId.trim();
    const templateId = issueTemplateId.trim();
    if (!customerId) {
      setMsg("쿠폰을 발급할 고객 UUID를 입력해 주세요.");
      return;
    }
    if (!templateId) {
      setMsg("발급할 쿠폰 템플릿을 선택해 주세요.");
      return;
    }

    setIssuingCoupon(true);
    setMsg("");
    const { error } = await supabase.rpc("issue_customer_coupon", {
      p_store_id: storeId,
      p_customer_user_id: customerId,
      p_template_id: templateId,
    });
    if (error) {
      setMsg(`쿠폰 발급 실패: ${error.message}`);
    } else {
      setMsg("쿠폰을 발급했습니다.");
      await Promise.all([loadIssuedCoupons(), loadWalletCustomers()]);
    }
    setIssuingCoupon(false);
  };

  const toggleTemplate = async (row: CouponTemplateRow) => {
    const { error } = await supabase
      .from("store_coupon_templates")
      .update({ is_active: !row.is_active })
      .eq("id", row.id);
    if (error) setMsg(`쿠폰 상태 변경 실패: ${error.message}`);
    else await loadTemplates();
  };

  if (loading) return <main style={{ maxWidth: 860, margin: "0 auto", padding: 24 }}>불러오는 중...</main>;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: 24, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>포인트/쿠폰 설정</h1>
      <p style={{ margin: 0, color: "#6b7280", fontWeight: 700 }}>매장: <b>{storeId || "-"}</b></p>
      {msg ? <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "#b91c1c", fontWeight: 800 }}>{msg}</p> : null}

      <section style={cardStyle}>
        <h2 style={titleStyle}>포인트 정책</h2>
        <div style={gridStyle}>
          <LabelInput label="General 적립률(%)" value={String(settings.tier_general_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_general_rate_pct: toNumber(v, p.tier_general_rate_pct) }))} />
          <LabelInput label="Regular 적립률(%)" value={String(settings.tier_regular_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_regular_rate_pct: toNumber(v, p.tier_regular_rate_pct) }))} />
          <LabelInput label="VIP 적립률(%)" value={String(settings.tier_vip_rate_pct)} onChange={(v) => setSettings((p) => ({ ...p, tier_vip_rate_pct: toNumber(v, p.tier_vip_rate_pct) }))} />
          <LabelInput label="최대 사용 비율(%)" value={String(settings.max_redeem_pct)} onChange={(v) => setSettings((p) => ({ ...p, max_redeem_pct: toNumber(v, p.max_redeem_pct) }))} />
          <LabelInput label="최소 사용 포인트" value={String(settings.min_redeem_points)} onChange={(v) => setSettings((p) => ({ ...p, min_redeem_points: Math.max(0, Math.floor(toNumber(v, p.min_redeem_points))) }))} />
          <LabelInput label="포인트 만료 개월" value={String(settings.point_expiry_months)} onChange={(v) => setSettings((p) => ({ ...p, point_expiry_months: Math.max(0, Math.floor(toNumber(v, p.point_expiry_months))) }))} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={settings.allow_point_or_coupon_only}
            onChange={(e) =>
              setSettings((p) => ({ ...p, allow_point_or_coupon_only: e.target.checked }))
            }
          />
          포인트/쿠폰 동시 사용 금지(OR 정책)
        </label>
        <button style={btnStyle} onClick={saveSettings} disabled={savingSettings}>
          {savingSettings ? "저장 중..." : "포인트 정책 저장"}
        </button>
      </section>

      <section style={cardStyle}>
        <h2 style={titleStyle}>등급 규칙</h2>
        <div style={gridStyle}>
          <LabelInput label="집계 기간(개월)" value={String(tierRules.lookback_months)} onChange={(v) => setTierRules((p) => ({ ...p, lookback_months: Math.max(1, Math.floor(toNumber(v, p.lookback_months))) }))} />
          <LabelInput label="Regular 최소 누적결제" value={String(tierRules.regular_min_spent)} onChange={(v) => setTierRules((p) => ({ ...p, regular_min_spent: Math.max(0, Math.floor(toNumber(v, p.regular_min_spent))) }))} />
          <LabelInput label="Regular 최소 주문수" value={String(tierRules.regular_min_orders)} onChange={(v) => setTierRules((p) => ({ ...p, regular_min_orders: Math.max(0, Math.floor(toNumber(v, p.regular_min_orders))) }))} />
          <LabelInput label="VIP 최소 누적결제" value={String(tierRules.vip_min_spent)} onChange={(v) => setTierRules((p) => ({ ...p, vip_min_spent: Math.max(0, Math.floor(toNumber(v, p.vip_min_spent))) }))} />
          <LabelInput label="VIP 최소 주문수" value={String(tierRules.vip_min_orders)} onChange={(v) => setTierRules((p) => ({ ...p, vip_min_orders: Math.max(0, Math.floor(toNumber(v, p.vip_min_orders))) }))} />
        </div>
        <button style={btnStyle} onClick={saveTierRules} disabled={savingTier}>
          {savingTier ? "저장 중..." : "등급 규칙 저장"}
        </button>
      </section>

      <section style={cardStyle}>
        <h2 style={titleStyle}>쿠폰 템플릿</h2>
        <div style={gridStyle}>
          <LabelInput label="쿠폰명" value={newTemplate.name} onChange={(v) => setNewTemplate((p) => ({ ...p, name: v }))} />
          <label style={labelStyle}>
            <span>쿠폰 종류</span>
            <select
              style={inputStyle}
              value={newTemplate.coupon_kind}
              onChange={(e) => setNewTemplate((p) => ({ ...p, coupon_kind: e.target.value as CouponTemplateRow["coupon_kind"] }))}
            >
              <option value="first_order">first_order</option>
              <option value="thank_you">thank_you</option>
              <option value="event">event</option>
            </select>
          </label>
          <label style={labelStyle}>
            <span>할인 방식</span>
            <select
              style={inputStyle}
              value={newTemplate.discount_type}
              onChange={(e) => setNewTemplate((p) => ({ ...p, discount_type: e.target.value as CouponTemplateRow["discount_type"] }))}
            >
              <option value="fixed_amount">정액</option>
              <option value="percent">정률(%)</option>
            </select>
          </label>
          <LabelInput label="할인값" value={newTemplate.discount_value} onChange={(v) => setNewTemplate((p) => ({ ...p, discount_value: v }))} />
          <LabelInput label="최소 주문금액" value={newTemplate.min_order_amount} onChange={(v) => setNewTemplate((p) => ({ ...p, min_order_amount: v }))} />
          <LabelInput label="최대 할인금액(선택)" value={newTemplate.max_discount_amount} onChange={(v) => setNewTemplate((p) => ({ ...p, max_discount_amount: v }))} />
          <LabelInput label="유효기간(일)" value={newTemplate.valid_days} onChange={(v) => setNewTemplate((p) => ({ ...p, valid_days: v }))} />
        </div>
        <button style={btnStyle} onClick={createTemplate} disabled={savingTemplate}>
          {savingTemplate ? "생성 중..." : "쿠폰 템플릿 생성"}
        </button>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {templatesLoading ? <p>쿠폰 목록 로딩 중...</p> : null}
          {!templatesLoading && !templates.length ? <p style={{ color: "#6b7280", fontWeight: 700 }}>등록된 쿠폰이 없습니다.</p> : null}
          {templates.map((row) => (
            <article key={row.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
              <p style={{ margin: 0, fontWeight: 900 }}>
                {row.name} <span style={{ color: "#6b7280", fontWeight: 700 }}>({row.coupon_kind})</span>
              </p>
              <p style={{ margin: "6px 0 0", color: "#4b5563", fontWeight: 700 }}>
                {row.discount_type === "fixed_amount" ? `정액 ${row.discount_value}원` : `정률 ${row.discount_value}%`} · 최소주문 {row.min_order_amount}원 · 유효 {row.valid_days}일
              </p>
              <div style={{ marginTop: 8 }}>
                <button style={smallBtnStyle} onClick={() => toggleTemplate(row)}>
                  {row.is_active ? "비활성화" : "활성화"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={titleStyle}>쿠폰 발급</h2>
        <p style={{ marginTop: 0, color: "#6b7280", fontWeight: 700 }}>
          고객 UUID를 지정해 선택한 템플릿 쿠폰을 발급합니다.
        </p>
        <div style={gridStyle}>
          <LabelInput
            label="고객 UUID"
            value={issueCustomerId}
            onChange={setIssueCustomerId}
          />
          <label style={labelStyle}>
            <span>발급 템플릿</span>
            <select
              style={inputStyle}
              value={issueTemplateId}
              onChange={(e) => setIssueTemplateId(e.target.value)}
            >
              <option value="">선택해 주세요</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.coupon_kind}) {tpl.is_active ? "" : "[비활성]"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button style={btnStyle} onClick={issueCouponToCustomer} disabled={issuingCoupon}>
          {issuingCoupon ? "발급 중..." : "쿠폰 발급"}
        </button>

        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <h3 style={{ margin: "4px 0", fontSize: 16, fontWeight: 900 }}>최근 고객 (포인트 지갑 기준)</h3>
          {customersLoading ? <p>고객 목록 로딩 중...</p> : null}
          {!customersLoading && walletCustomers.length === 0 ? (
            <p style={{ color: "#6b7280", fontWeight: 700 }}>고객 지갑 데이터가 아직 없습니다.</p>
          ) : null}
          {walletCustomers.map((row) => {
            const profile = customerProfilesById[row.customer_user_id];
            return (
              <article key={row.customer_user_id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
                <p style={{ margin: 0, fontWeight: 900 }}>
                  {profile?.name || "이름 미등록"} · {row.tier.toUpperCase()} · {Number(row.point_balance || 0).toLocaleString()}P
                </p>
                <p style={{ margin: "6px 0 0", color: "#4b5563", fontWeight: 700 }}>
                  UUID: {row.customer_user_id}
                  {profile?.phone ? ` · ${profile.phone}` : ""}
                </p>
                <button
                  style={{ ...smallBtnStyle, marginTop: 8 }}
                  onClick={() => setIssueCustomerId(row.customer_user_id)}
                >
                  이 고객 선택
                </button>
              </article>
            );
          })}
        </div>

        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          <h3 style={{ margin: "4px 0", fontSize: 16, fontWeight: 900 }}>최근 쿠폰 발급 내역</h3>
          {issuedLoading ? <p>발급 내역 로딩 중...</p> : null}
          {!issuedLoading && issuedCoupons.length === 0 ? (
            <p style={{ color: "#6b7280", fontWeight: 700 }}>아직 발급 내역이 없습니다.</p>
          ) : null}
          {issuedCoupons.map((row) => (
            <article key={row.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10 }}>
              <p style={{ margin: 0, fontWeight: 900 }}>
                {row.template?.name || "템플릿 없음"} · {row.status}
              </p>
              <p style={{ margin: "6px 0 0", color: "#4b5563", fontWeight: 700 }}>
                고객 UUID: {row.customer_user_id}
              </p>
              <p style={{ margin: "4px 0 0", color: "#4b5563", fontWeight: 700 }}>
                발급일: {new Date(row.issued_at).toLocaleString()} / 만료일: {row.expires_at ? new Date(row.expires_at).toLocaleString() : "-"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function LabelInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <input style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
  background: "#fff",
};
const titleStyle: React.CSSProperties = { margin: "0 0 10px", fontSize: 18, fontWeight: 900 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 };
const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontWeight: 800, color: "#374151" };
const inputStyle: React.CSSProperties = { border: "1px solid #d1d5db", borderRadius: 10, padding: "8px 10px", fontWeight: 700 };
const btnStyle: React.CSSProperties = { marginTop: 10, border: "1px solid #111827", background: "#111827", color: "white", padding: "10px 14px", borderRadius: 10, fontWeight: 900, cursor: "pointer" };
const smallBtnStyle: React.CSSProperties = { border: "1px solid #d1d5db", background: "white", padding: "6px 10px", borderRadius: 8, fontWeight: 800, cursor: "pointer" };

export default function AdminLoyaltyPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>로딩 중...</div>}>
      <AdminLoyaltyInner />
    </Suspense>
  );
}
