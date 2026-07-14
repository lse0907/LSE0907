// src/app/confirm/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextDailySequence, format4, todayKey } from "../lib/orderNumber";
import { supabase } from "@/app/lib/supabaseClient";
import {
  getStoreIdFromSearchParams,
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
  lsOrdersKey,
} from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";
type PaymentStatus = "not_required" | "pending" | "paid";

type PgConfig = {
  clientKey: string;
  mid: string;
};

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

type CartLine = {
  lineId: string;
  menuId: string;
  name: string;
  basePrice: number;
  qty: number;
  image?: string;
  options: SelectedGroup[];
  optionTotal: number;
};

type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;

  items: Array<{
    id: string;
    name: string;
    price: number;
    qty: number;
    options?: SelectedGroup[];
    optionTotal?: number;
    lineTotal?: number;
  }>;

  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
};

type WalletSummary = {
  point_balance: number;
  tier: string;
};

type CheckoutLoyaltySettings = {
  max_redeem_pct: number;
  min_redeem_points: number;
  allow_point_or_coupon_only: boolean;
};

const DEFAULT_CHECKOUT_LOYALTY_SETTINGS: CheckoutLoyaltySettings = {
  max_redeem_pct: 30,
  min_redeem_points: 100,
  allow_point_or_coupon_only: true,
};

function toPaymentCustomerName(name?: string | null, phone?: string | null) {
  const trimmedName = String(name || "").trim();
  if (trimmedName) return trimmedName.slice(0, 30);
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length >= 4) return `고객 ${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  return "현장고객";
}

type CouponTemplateSummary = {
  name: string;
  discount_type: "fixed_amount" | "percent" | string;
  discount_value: number;
  min_order_amount: number;
  max_discount_amount: number | null;
};

type IssuedCoupon = {
  id: string;
  expires_at: string;
  template: CouponTemplateSummary | null;
};

type RawIssuedCoupon = {
  id: string;
  expires_at: string;
  template: CouponTemplateSummary | CouponTemplateSummary[] | null;
  coupon_name_snapshot: string | null;
  discount_type_snapshot: "fixed_amount" | "percent" | string | null;
  discount_value_snapshot: number | null;
  min_order_amount_snapshot: number | null;
  max_discount_amount_snapshot: number | null;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";
const PREPAY_PENDING_KEY = "qrCafePrepayPending";

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function normalizeCartLines(raw: any): CartLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x: any) => ({
      lineId: String(x.lineId || uuid()),
      menuId: String(x.menuId || x.id || ""),
      name: String(x.name || ""),
      basePrice: Number(x.basePrice ?? x.price ?? 0),
      qty: Math.max(0, Number(x.qty ?? 0)),
      image: typeof x.image === "string" ? x.image : "",
      options: Array.isArray(x.options)
        ? x.options.map((g: any) => ({
            ...g,
            items: Array.isArray(g?.items)
              ? g.items
                  .map((it: any) => ({
                    id: String(it?.id || ""),
                    name: String(it?.name || ""),
                    priceDelta: Number(it?.priceDelta ?? 0),
                    qty: Math.max(1, Number(it?.qty ?? 1)),
                  }))
                  .filter((it: SelectedOptionItem) => it.id)
              : [],
          }))
        : [],
      optionTotal: Number(x.optionTotal ?? 0),
    }))
    .filter((x) => x.menuId && x.qty > 0);
}

function parseCart(cartParam: string | null): CartLine[] {
  if (!cartParam) return [];
  try {
    const decoded = decodeURIComponent(cartParam);
    const parsed = JSON.parse(decoded);
    return normalizeCartLines(parsed);
  } catch {
    return [];
  }
}

function loadOrders(storeId: string): OrderRecord[] {
  try {
    const raw = localStorage.getItem(lsOrdersKey(storeId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveOrders(storeId: string, list: OrderRecord[]) {
  localStorage.setItem(lsOrdersKey(storeId), JSON.stringify(list));
}

function isDuplicateDisplayNoError(msg: string) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("duplicate key value violates unique constraint") ||
    m.includes("orders_display_no_unique") ||
    m.includes("orders_store_date_display_no_unique") ||
    m.includes("unique constraint") ||
    m.includes("23505")
  );
}

function paymentOrderId() {
  const raw = (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`).replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );
  return `pay_${raw}`.slice(0, 64);
}

function tierLabel(raw: string | null | undefined) {
  const v = String(raw || "").toLowerCase();
  if (v === "vip") return "VIP";
  if (v === "regular") return "단골";
  return "일반";
}

function ConfirmPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  // ✅ 멀티매장 핵심: URL(store) > env fallback
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);
  const nextUrl = useMemo(() => {
    const q = sp.toString();
    return q ? `/confirm?${q}` : "/confirm";
  }, [sp]);

  const tableFromMenu = (sp.get("table") || "").trim();
  const isTableQr = !!tableFromMenu;
  const initialCartLines = useMemo(() => parseCart(sp.get("cart")), [sp]);
  const cartStorageKey = useMemo(
    () => `qrCafeCart:${storeId}:${isTableQr ? tableFromMenu : "counter"}`,
    [storeId, isTableQr, tableFromMenu]
  );
  const [cartLines, setCartLines] = useState<CartLine[]>(initialCartLines);

  useEffect(() => {
    setCartLines(initialCartLines);
  }, [initialCartLines]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(cartStorageKey);
      if (!raw) return;
      const parsed = normalizeCartLines(JSON.parse(raw));
      if (!parsed.length) return;
      setCartLines(parsed);
    } catch {
      // ignore storage parse errors
    }
  }, [cartStorageKey]);

  useEffect(() => {
    try {
      if (!cartLines.length) sessionStorage.removeItem(cartStorageKey);
      else sessionStorage.setItem(cartStorageKey, JSON.stringify(cartLines));
    } catch {
      // ignore storage write errors
    }
  }, [cartLines, cartStorageKey]);

  const totalCount = useMemo(
    () => cartLines.reduce((s, x) => s + (x.qty || 0), 0),
    [cartLines]
  );

  const totalPrice = useMemo(
    () =>
      cartLines.reduce(
        (s, x) => s + (x.basePrice + x.optionTotal) * (x.qty || 0),
        0
      ),
    [cartLines]
  );

  const [mode, setMode] = useState<OrderMode>(isTableQr ? "dine-in" : "takeout");
  const [tableInput, setTableInput] = useState<string>(tableFromMenu);

  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isPrepayStore, setIsPrepayStore] = useState(false);
  const [prepayLoading, setPrepayLoading] = useState(true);
  const [pgConfig, setPgConfig] = useState<PgConfig>({ clientKey: "", mid: "" });
  const [customerUserId, setCustomerUserId] = useState<string | null>(null);
  const [customerPayName, setCustomerPayName] = useState("현장고객");
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loyaltySettings, setLoyaltySettings] = useState<CheckoutLoyaltySettings>(DEFAULT_CHECKOUT_LOYALTY_SETTINGS);
  const [issuedCouponCount, setIssuedCouponCount] = useState(0);
  const [issuedCoupons, setIssuedCoupons] = useState<IssuedCoupon[]>([]);
  const [usedPointsInput, setUsedPointsInput] = useState("0");
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);

  const effectiveMode: OrderMode = isTableQr ? "dine-in" : mode;

  const effectiveTable =
    effectiveMode === "dine-in"
      ? isTableQr
        ? tableFromMenu
        : tableInput.trim()
        ? tableInput.trim()
        : ""
      : "";

  const canSubmit = totalCount > 0 && !submitting && !prepayLoading;

  const fetchPrepayAddonActive = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc("get_store_checkout_mode", {
        p_store_id: storeId,
      });
      if (error) return false;
      const row = Array.isArray(data) ? data[0] : null;
      return !!row?.is_prepay;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const active = await fetchPrepayAddonActive();
      if (!mounted) return;
      setIsPrepayStore(active);
      setPrepayLoading(false);
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id || null;
      if (!mounted) return;
      setCustomerUserId(uid);

      if (!uid) {
        setCustomerPayName("현장고객");
        setWallet(null);
        setIssuedCouponCount(0);
        setIssuedCoupons([]);
        setLoyaltySettings(DEFAULT_CHECKOUT_LOYALTY_SETTINGS);
        setUsedPointsInput("0");
        setSelectedCouponId(null);
        return;
      }

      const [walletRes, couponRes, profileRes, loyaltySettingsRes] = await Promise.all([
        supabase
          .from("customer_store_wallets")
          .select("point_balance,tier")
          .eq("customer_user_id", uid)
          .eq("store_id", storeId)
          .maybeSingle(),
        supabase
          .from("customer_coupons")
          .select(
            "id,expires_at,coupon_name_snapshot,discount_type_snapshot,discount_value_snapshot,min_order_amount_snapshot,max_discount_amount_snapshot,template:store_coupon_templates(name,discount_type,discount_value,min_order_amount,max_discount_amount)",
            { count: "exact" }
          )
          .eq("customer_user_id", uid)
          .eq("store_id", storeId)
          .eq("status", "issued"),
        supabase
          .from("customer_profiles")
          .select("name,phone")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("store_loyalty_settings")
          .select("max_redeem_pct,min_redeem_points,allow_point_or_coupon_only")
          .eq("store_id", storeId)
          .maybeSingle(),
      ]);

      if (!mounted) return;
      setWallet((walletRes.data as WalletSummary | null) || null);
      setCustomerPayName(
        toPaymentCustomerName(
          (profileRes.data as { name?: string | null; phone?: string | null } | null)?.name,
          (profileRes.data as { name?: string | null; phone?: string | null } | null)?.phone
        )
      );
      const settingsRow = loyaltySettingsRes.data as Partial<CheckoutLoyaltySettings> | null;
      setLoyaltySettings({
        max_redeem_pct: Math.min(100, Math.max(0, Number(settingsRow?.max_redeem_pct ?? DEFAULT_CHECKOUT_LOYALTY_SETTINGS.max_redeem_pct))),
        min_redeem_points: Math.max(0, Math.floor(Number(settingsRow?.min_redeem_points ?? DEFAULT_CHECKOUT_LOYALTY_SETTINGS.min_redeem_points))),
        allow_point_or_coupon_only: settingsRow?.allow_point_or_coupon_only ?? DEFAULT_CHECKOUT_LOYALTY_SETTINGS.allow_point_or_coupon_only,
      });
      setIssuedCouponCount(couponRes.count || 0);
      const couponRows = (Array.isArray(couponRes.data) ? couponRes.data : []) as RawIssuedCoupon[];
      const normalized: IssuedCoupon[] = couponRows.map((row) => ({
          id: row.id,
          expires_at: row.expires_at,
          template:
            (Array.isArray(row.template) ? row.template[0] || null : row.template) ||
            (row.discount_type_snapshot &&
            row.discount_value_snapshot != null &&
            row.min_order_amount_snapshot != null
              ? {
                  name: String(row.coupon_name_snapshot || "발급 쿠폰"),
                  discount_type: row.discount_type_snapshot,
                  discount_value: Number(row.discount_value_snapshot || 0),
                  min_order_amount: Number(row.min_order_amount_snapshot || 0),
                  max_discount_amount:
                    row.max_discount_amount_snapshot == null
                      ? null
                      : Number(row.max_discount_amount_snapshot),
                }
              : null),
      }));
      setIssuedCoupons(normalized);
    })();

    return () => {
      mounted = false;
    };
  }, [storeId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_store_checkout_client_config", {
          p_store_id: storeId,
        });

        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : null;

        if (!mounted) return;
        setPgConfig({
          clientKey: String(row?.client_key || "").trim(),
          mid: String(row?.mid || "").trim(),
        });
      } catch {
        if (!mounted) return;
        setPgConfig({ clientKey: "", mid: "" });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [storeId]);

  const resolvePaymentStatus = async (): Promise<PaymentStatus> => {
    const active = await fetchPrepayAddonActive();
    return active ? "paid" : "not_required";
  };

  const maxUsablePoints = useMemo(() => {
    const byBalance = Math.max(0, Number(wallet?.point_balance || 0));
    const byPrice = Math.max(0, Math.floor(totalPrice));
    const byPolicy = Math.max(0, Math.floor((byPrice * Math.max(0, Number(loyaltySettings.max_redeem_pct || 0))) / 100));
    return Math.min(byBalance, byPrice, byPolicy);
  }, [wallet?.point_balance, totalPrice, loyaltySettings.max_redeem_pct]);

  const rawUsedPoints = useMemo(() => {
    const raw = Math.floor(Number(usedPointsInput || "0"));
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }, [usedPointsInput]);

  const pointUsageNotice = useMemo(() => {
    if (selectedCouponId) return "쿠폰 선택 시 포인트는 자동으로 제외됩니다.";
    if (rawUsedPoints > 0 && rawUsedPoints < loyaltySettings.min_redeem_points) {
      return `포인트는 ${fmt(loyaltySettings.min_redeem_points)}P 이상부터 사용할 수 있어요.`;
    }
    if (rawUsedPoints > maxUsablePoints) {
      return `이번 주문은 최대 ${fmt(maxUsablePoints)}P까지 사용할 수 있어요.`;
    }
    return "";
  }, [selectedCouponId, rawUsedPoints, loyaltySettings.min_redeem_points, maxUsablePoints]);

  const usedPoints = useMemo(() => {
    if (rawUsedPoints <= 0) return 0;
    if (rawUsedPoints < loyaltySettings.min_redeem_points) return 0;
    return Math.min(rawUsedPoints, maxUsablePoints);
  }, [rawUsedPoints, loyaltySettings.min_redeem_points, maxUsablePoints]);

  const selectedCoupon = useMemo(
    () => issuedCoupons.find((c) => c.id === selectedCouponId) || null,
    [issuedCoupons, selectedCouponId]
  );

  const couponDiscount = useMemo(() => {
    if (!selectedCoupon?.template) return 0;
    const tpl = selectedCoupon.template;
    const orderAmount = Math.max(0, Math.floor(totalPrice));
    if (orderAmount < Math.max(0, Number(tpl.min_order_amount || 0))) return 0;
    if (tpl.discount_type === "fixed_amount") {
      return Math.min(orderAmount, Math.max(0, Math.floor(Number(tpl.discount_value || 0))));
    }
    if (tpl.discount_type === "percent") {
      const raw = Math.floor((orderAmount * Math.max(0, Number(tpl.discount_value || 0))) / 100);
      const cap = tpl.max_discount_amount == null ? raw : Math.max(0, Math.floor(Number(tpl.max_discount_amount || 0)));
      return Math.min(orderAmount, Math.min(raw, cap));
    }
    return 0;
  }, [selectedCoupon, totalPrice]);

  const selectedCouponIdForApply = selectedCouponId && couponDiscount > 0 ? selectedCouponId : null;
  const effectiveDiscount = selectedCouponIdForApply ? couponDiscount : usedPoints;
  const payableAmount = Math.max(0, Math.round(totalPrice) - effectiveDiscount);

  // NOTE: helper name intentionally unique to avoid duplicate-declaration merge regressions.
  const insertOrderRowWithPaymentFallback = async (row: Record<string, unknown>) => {
    const first = await supabase.from("orders").insert([row]);
    if (!first.error) return first;

    const msg = String(first.error.message || "").toLowerCase();
    const missingPaymentColumn =
      msg.includes("payment_status") && (msg.includes("column") || msg.includes("schema cache"));

    if (!missingPaymentColumn) return first;

    const fallbackRow = { ...row } as Record<string, unknown>;
    delete fallbackRow.payment_status;
    return supabase.from("orders").insert([fallbackRow]);
  };

  const loadTossScript = async () => {
    if (typeof window === "undefined") throw new Error("브라우저 환경에서만 결제창을 열 수 있습니다.");
    if ((window as any).TossPayments) return;

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.tosspayments.com/v1/payment";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("토스 결제 스크립트를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
  };

  const onSubmit = async () => {
    if (!canSubmit) return;

    try {
      setSubmitting(true);

      const orderId = uuid();
      const accessToken = uuid();
      const createdAtIso = new Date().toISOString();
      const orderDate = todayKey();
      let currentCustomerUserId = customerUserId;
      if (!currentCustomerUserId) {
        const { data: authData } = await supabase.auth.getUser();
        currentCustomerUserId = authData?.user?.id || null;
        setCustomerUserId(currentCustomerUserId);
      }

      const paymentStatus = await resolvePaymentStatus();

      if (paymentStatus === "paid") {
        if (!pgConfig.clientKey) {
          throw new Error("선결재 테스트용 Client Key가 없습니다. 관리자 결제/구독에서 키를 먼저 저장해주세요.");
        }

        const payOrderId = paymentOrderId();
        const pending = {
          createdAt: Date.now(),
          storeId,
          customerUserId: currentCustomerUserId,
          cartLines,
          mode: effectiveMode,
          table: effectiveMode === "dine-in" ? effectiveTable : "",
          requestNote,
          totalCount,
          totalPrice,
          usedPoints: selectedCouponIdForApply ? 0 : usedPoints,
          usedCouponId: selectedCouponIdForApply,
        };

        localStorage.setItem(`${PREPAY_PENDING_KEY}:${payOrderId}`, JSON.stringify(pending));

        await loadTossScript();
        const tossPayments = (window as any).TossPayments(pgConfig.clientKey);
        const orderName =
          cartLines.length > 1 ? `${cartLines[0]?.name || "주문"} 외 ${cartLines.length - 1}건` : cartLines[0]?.name || "주문";
        const base = window.location.origin;
        const successUrl = `${base}/confirm/success?store=${encodeURIComponent(storeId)}&poid=${encodeURIComponent(payOrderId)}`;
        const failUrl = `${base}/confirm/fail?store=${encodeURIComponent(storeId)}&poid=${encodeURIComponent(payOrderId)}`;

        await tossPayments.requestPayment("카드", {
          amount: payableAmount,
          orderId: payOrderId,
          orderName,
          customerName: customerPayName,
          successUrl,
          failUrl,
        });

        return;
      }

      let finalDisplayNo = "";
      const MAX_TRY = 5;

      for (let attempt = 0; attempt < MAX_TRY; attempt++) {
        const seq = nextDailySequence();
        const displayNo = format4(seq);
        finalDisplayNo = displayNo;

        const orderRow: any = {
          id: orderId,
          access_token: accessToken,
          created_at: createdAtIso,
          order_date: orderDate,
          display_no: displayNo,
          mode: effectiveMode,
          table_no:
            effectiveMode === "dine-in" ? (effectiveTable || null) : null,
          request_note: requestNote.trim() || "",
          total_count: totalCount,
          total_price: Math.round(totalPrice),
          status: "new",
          payment_status: paymentStatus,
          customer_user_id: currentCustomerUserId,
          used_points: selectedCouponIdForApply ? 0 : usedPoints,
          used_coupon_id: selectedCouponIdForApply,
          applied_discount_type: selectedCouponIdForApply
            ? "coupon"
            : (usedPoints > 0 ? "point" : null),
          store_id: storeId,
        };

        const { error: oErr } = await insertOrderRowWithPaymentFallback(orderRow);

        if (!oErr) break;

        const msg = oErr.message || String(oErr);
        const duplicated = isDuplicateDisplayNoError(msg);

        if (!duplicated || attempt === MAX_TRY - 1) {
          throw new Error(`[orders insert] ${msg}`);
        }
      }

      // order_items
      const orderItemRows: any[] = cartLines.map((ln) => {
        const orderItemId = uuid();
        (ln as any).__orderItemId = orderItemId;

        return {
          id: orderItemId,
          order_id: orderId,
          menu_id: ln.menuId,
          name: ln.name,
          price: Math.round(ln.basePrice),
          qty: Math.round(ln.qty),
          store_id: storeId,
        };
      });

      const { error: oiErr } = await supabase.from("order_items").insert(orderItemRows);
      if (oiErr) throw new Error(`[order_items insert] ${oiErr.message}`);

      // order_item_options
      const optionRows: any[] = [];
      for (const ln of cartLines) {
        const orderItemId = (ln as any).__orderItemId;
        const groups = Array.isArray(ln.options) ? ln.options : [];

        for (const g of groups) {
          const items = Array.isArray(g.items) ? g.items : [];
          for (const it of items) {
            optionRows.push({
              id: uuid(),
              order_item_id: orderItemId,
              group_id: g.groupId,
              option_id: it.id,
              name: it.name,
              price_delta: Math.round(Number(it.priceDelta || 0)),
              qty: Math.max(1, Math.round(Number(it.qty || 1))),
              store_id: storeId,
            });
          }
        }
      }

      if (optionRows.length) {
        const { error: oioErr } = await supabase.from("order_item_options").insert(optionRows);
        if (oioErr) throw new Error(`[order_item_options insert] ${oioErr.message}`);
      }

      if (currentCustomerUserId) {
        const { error: loyaltyErr } = await supabase.rpc("apply_loyalty_on_paid_order", {
          p_order_id: orderId,
          p_store_id: storeId,
          p_customer_user_id: currentCustomerUserId,
          p_order_amount: Math.round(totalPrice),
          p_used_points: selectedCouponIdForApply ? 0 : usedPoints,
          p_used_coupon_id: selectedCouponIdForApply,
          p_idempotency_key: `${orderId}:loyalty`,
        });
        if (loyaltyErr) {
          console.warn("[loyalty] apply failed:", loyaltyErr.message);
        }
      }

      // 로컬 저장(임시 유지)
      const order: OrderRecord = {
        id: orderId,
        createdAt: Date.now(),
        orderDate,
        displayNo: finalDisplayNo,
        mode: effectiveMode,
        table:
          effectiveMode === "dine-in" ? (effectiveTable || undefined) : undefined,
        requestNote: requestNote.trim(),
        items: cartLines.map((ln) => {
          const unit = ln.basePrice + ln.optionTotal;
          return {
            id: ln.menuId,
            name: ln.name,
            price: ln.basePrice,
            qty: ln.qty,
            options: ln.options,
            optionTotal: ln.optionTotal,
            lineTotal: unit * ln.qty,
          };
        }),
        totalCount,
        totalPrice,
        status: "new",
        paymentStatus,
      };

      const list = loadOrders(storeId);
      list.unshift(order);
      saveOrders(storeId, list);

      // ✅ 핵심: lastOrderId + lastStoreId 함께 저장
      localStorage.setItem(lsLastOrderIdKey(storeId), orderId);
      localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
      localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
      sessionStorage.removeItem(cartStorageKey);

      router.push(
        `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(
          orderId
        )}&accessToken=${encodeURIComponent(accessToken)}`
      );
    } catch (e: any) {
      console.error(e);
      alert(String(e?.message || e));
      setSubmitting(false);
    }
  };

  const goMenu = () => {
    const base = `/menu?store=${encodeURIComponent(storeId)}`;
    if (isTableQr) router.push(`${base}&table=${encodeURIComponent(tableFromMenu)}`);
    else router.push(base);
  };

  const decLine = (lineId: string) => {
    setCartLines((prev) =>
      prev
        .map((ln) => (ln.lineId !== lineId ? ln : { ...ln, qty: Math.max(0, Number(ln.qty || 0) - 1) }))
        .filter((ln) => ln.qty > 0)
    );
  };

  const incLine = (lineId: string) => {
    setCartLines((prev) =>
      prev.map((ln) => (ln.lineId !== lineId ? ln : { ...ln, qty: Math.max(1, Number(ln.qty || 0) + 1) }))
    );
  };

  const removeLine = (lineId: string) => {
    setCartLines((prev) => prev.filter((ln) => ln.lineId !== lineId));
  };

  const modeBtnStyle = (active: boolean, disabled: boolean) => ({
    padding: 12,
    flex: 1,
    borderRadius: 12,
    border: active ? "2px solid #111" : "1px solid #ddd",
    background: "white",
    color: "#111827",
    WebkitTextFillColor: "currentColor" as const,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.55 : 1,
  });

  const dineInDisabled = false;
  const takeoutDisabled = isTableQr;

  return (
    <>
      <style jsx global>{`
        :root {
          color-scheme: light;
        }
        body {
          background: #f6f7f9;
          color: #111827;
        }
      `}</style>
      <main style={{ padding: 16, maxWidth: 720, margin: "0 auto", color: "#111827" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ margin: 0, fontWeight: 950 }}>주문 확인</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {customerUserId ? (
            <>
              <button
                onClick={() =>
                  router.push(
                    `/me?store=${encodeURIComponent(storeId)}&return_to=${encodeURIComponent(nextUrl)}`
                  )
                }
                style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "6px 10px", fontWeight: 900, background: "white" }}
              >
                내정보
              </button>
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  setCustomerUserId(null);
                  setWallet(null);
                  setIssuedCouponCount(0);
                }}
                style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "6px 10px", fontWeight: 900, background: "white" }}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => router.push(`/login?next=${encodeURIComponent(nextUrl)}`)}
                style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "6px 10px", fontWeight: 900, background: "white" }}
              >
                로그인
              </button>
              <button
                onClick={() => router.push(`/signup?next=${encodeURIComponent(nextUrl)}`)}
                style={{ borderRadius: 999, border: "1px solid #d1d5db", padding: "6px 10px", fontWeight: 900, background: "white" }}
              >
                회원가입
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontWeight: 950 }}>주문 내역</h2>
          <span
            style={{
              border: "1px solid #d1d5db",
              borderRadius: 999,
              padding: "4px 10px",
              color: "#374151",
              fontWeight: 900,
              fontSize: 12,
              background: "white",
              whiteSpace: "nowrap",
            }}
          >
            {isTableQr ? "QR 주문" : "카운터 주문"}
          </span>
        </div>

        {cartLines.length === 0 ? (
          <p style={{ color: "crimson", fontWeight: 900, marginTop: 10 }}>
            장바구니 데이터가 없습니다. 메뉴에서 다시 담아주세요.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {cartLines.map((ln) => {
              const unit = ln.basePrice + ln.optionTotal;
              const optText =
                ln.options
                  .map((g) => {
                    if (!g.items?.length) return null;
                    return g.items.map((x) => `${x.name}×${Math.max(1, Number(x.qty || 1))}`).join(", ");
                  })
                  .filter(Boolean)
                  .join(" / ") || "";

              return (
                <div
                  key={ln.lineId}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    background: "white",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 950 }}>
                      {ln.name} · {ln.qty}개
                    </div>
                    <div style={{ fontWeight: 950 }}>{fmt(unit * ln.qty)}원</div>
                  </div>

                  <div style={{ color: "#6b7280", fontWeight: 850, fontSize: 13 }}>
                    기본 {fmt(ln.basePrice)}원
                    {ln.optionTotal ? ` + 옵션 ${fmt(ln.optionTotal)}원` : ""}
                    {"  "}· 1개당 {fmt(unit)}원
                  </div>

                  {optText ? (
                    <div style={{ color: "#111827", fontWeight: 850, fontSize: 13 }}>
                      옵션: {optText}
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {ln.qty <= 1 ? (
                      <button
                        onClick={() => removeLine(ln.lineId)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ef4444", color: "#b91c1c", background: "white", fontWeight: 900 }}
                      >
                        삭제
                      </button>
                    ) : (
                      <button
                        onClick={() => decLine(ln.lineId)}
                        style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "white", fontWeight: 900 }}
                      >
                        -1
                      </button>
                    )}
                    <button
                      onClick={() => incLine(ln.lineId)}
                      style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "white", fontWeight: 900 }}
                    >
                      +1
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={goMenu}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #d1d5db",
            background: "white",
            fontWeight: 900,
            color: "#111827",
            WebkitTextFillColor: "currentColor",
          }}
        >
          + 메뉴 더 담기
        </button>
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 900 }}>
          총 수량: <b>{totalCount}</b>
        </div>
        <div style={{ fontWeight: 900 }}>
          총 금액: <b>{fmt(totalPrice)}원</b>
        </div>
      </div>

      <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
        {customerUserId ? (
          <>
              <p style={{ margin: 0, fontWeight: 800 }}>
                내 등급: <b>{tierLabel(wallet?.tier)}</b> · 내 포인트: <b>{fmt(Number(wallet?.point_balance || 0))}P</b> · 내 쿠폰: <b>{issuedCouponCount}장</b>
              </p>
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, color: "#374151" }}>
                포인트 사용
                <span style={{ color: "#6b7280", fontSize: 12, fontWeight: 700 }}>
                  최대 {fmt(maxUsablePoints)}P · 최소 {fmt(loyaltySettings.min_redeem_points)}P
                </span>
                <input
                  value={usedPointsInput}
                  onChange={(e) => setUsedPointsInput(e.target.value.replace(/[^\d]/g, ""))}
                  disabled={!!selectedCouponIdForApply}
                  inputMode="numeric"
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #d1d5db",
                    fontWeight: 800,
                    background: selectedCouponIdForApply ? "#f3f4f6" : "white",
                  }}
                />
              </label>
              {pointUsageNotice ? (
                <p style={{ margin: 0, color: "#b45309", fontSize: 12, fontWeight: 800 }}>{pointUsageNotice}</p>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCouponId(null);
                    setUsedPointsInput(String(maxUsablePoints));
                  }}
                  style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "6px 10px", background: "white", fontWeight: 800 }}
                >
                  최대 사용
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCouponId(null);
                    setUsedPointsInput("0");
                  }}
                  style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "6px 10px", background: "white", fontWeight: 800 }}
                >
                  초기화
                </button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {issuedCoupons.map((c) => {
                  const tpl = c.template;
                  if (!tpl) {
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled
                        style={{
                          textAlign: "left",
                          border: "1px solid #d1d5db",
                          borderRadius: 12,
                          padding: "10px 12px",
                          background: "white",
                          color: "#111827",
                          fontWeight: 800,
                          opacity: 0.6,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 900 }}>사용 불가 쿠폰</span>
                          <span style={{ color: "#374151", fontSize: 12 }}>템플릿 없음</span>
                        </div>
                        <div style={{ marginTop: 4, color: "#b45309", fontSize: 12, fontWeight: 800 }}>
                          쿠폰 템플릿 정보를 찾을 수 없어 사용할 수 없습니다. 관리자에게 문의해 주세요.
                        </div>
                      </button>
                    );
                  }
                  const orderAmount = Math.max(0, Math.floor(totalPrice));
                  const minOrder = Math.max(0, Number(tpl.min_order_amount || 0));
                  const disabledByMin = orderAmount < minOrder;
                  const maxDiscount = tpl.max_discount_amount == null ? null : Math.max(0, Math.floor(Number(tpl.max_discount_amount || 0)));
                  const expectedDiscount =
                    tpl.discount_type === "fixed_amount"
                      ? Math.min(orderAmount, Math.max(0, Math.floor(Number(tpl.discount_value || 0))))
                      : Math.min(
                          orderAmount,
                          Math.min(
                            Math.floor((orderAmount * Math.max(0, Number(tpl.discount_value || 0))) / 100),
                            maxDiscount == null
                              ? Math.floor((orderAmount * Math.max(0, Number(tpl.discount_value || 0))) / 100)
                              : maxDiscount
                          )
                        );
                  const disabledByDiscount = expectedDiscount <= 0;
                  const reason = disabledByMin
                    ? `최소주문 ${fmt(minOrder)}원 이상 사용 가능`
                    : disabledByDiscount
                      ? "현재 주문에는 할인 적용이 어려워요"
                      : null;
                  const active = selectedCouponIdForApply === c.id;
                  const expires = c.expires_at ? new Date(c.expires_at) : null;
                  const expiresText =
                    expires && Number.isFinite(expires.getTime())
                      ? `만료 ${expires.toLocaleDateString()}`
                      : "만료일 정보 없음";
                  const label =
                    tpl.discount_type === "fixed_amount"
                      ? `정액 ${fmt(Number(tpl.discount_value || 0))}원`
                      : `정률 ${Number(tpl.discount_value || 0)}%`;

                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={!!reason}
                      onClick={() => {
                        setSelectedCouponId(c.id);
                        setUsedPointsInput("0");
                      }}
                      style={{
                        textAlign: "left",
                        border: active ? "1px solid #111827" : "1px solid #d1d5db",
                        borderRadius: 12,
                        padding: "10px 12px",
                        background: active ? "#f9fafb" : "white",
                        color: "#111827",
                        fontWeight: 800,
                        opacity: reason ? 0.6 : 1,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontWeight: 900 }}>{tpl.name}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {active ? (
                            <span
                              style={{
                                background: "#111827",
                                color: "white",
                                borderRadius: 999,
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 900,
                              }}
                            >
                              선택됨
                            </span>
                          ) : null}
                          <span style={{ color: "#374151", fontSize: 12 }}>{label}</span>
                        </span>
                      </div>
                      <div style={{ marginTop: 4, color: "#4b5563", fontSize: 12, fontWeight: 700 }}>
                        최소주문 {fmt(minOrder)}원 · 예상 할인 {fmt(expectedDiscount)}원 · {expiresText}
                      </div>
                      {reason ? (
                        <div style={{ marginTop: 4, color: "#b45309", fontSize: 12, fontWeight: 800 }}>{reason}</div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: 0, color: "#6b7280", fontWeight: 700, fontSize: 13 }}>
                할인 적용: <b>{fmt(effectiveDiscount)}원</b> · 예상 결제금액: <b>{fmt(payableAmount)}원</b>
              </p>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, fontWeight: 900 }}>비회원 주문 중입니다.</p>
            <p style={{ margin: "6px 0 0", color: "#6b7280", fontWeight: 700, fontSize: 13 }}>
              회원가입 후 주문하면 매장별 포인트를 적립받을 수 있어요.
            </p>
          </>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontWeight: 950 }}>요청사항 (주문 전체 1개)</h2>
        <textarea
          value={requestNote}
          onChange={(e) => setRequestNote(e.target.value)}
          placeholder=""
          style={{
            width: "100%",
            minHeight: 90,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            marginTop: 10,
          }}
        />
        <p style={{ marginTop: 8, color: "#666", fontWeight: 800 }}>
          * 요청사항은 참고용입니다.
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontWeight: 950 }}>이용 방식 선택</h2>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            onClick={() => {
              if (isTableQr) return;
              setMode("dine-in");
            }}
            disabled={isTableQr}
            style={modeBtnStyle(effectiveMode === "dine-in", dineInDisabled)}
          >
            매장 이용
          </button>

          <button
            onClick={() => {
              if (isTableQr) return;
              setMode("takeout");
            }}
            disabled={isTableQr}
            style={modeBtnStyle(effectiveMode === "takeout", takeoutDisabled)}
          >
            포장
          </button>
        </div>

        {effectiveMode === "dine-in" && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", color: "#444", fontWeight: 900 }}>
              테이블 번호 {isTableQr ? "(고정)" : "(선택)"}
              <input
                value={isTableQr ? tableFromMenu : tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                placeholder="예: 3"
                disabled={isTableQr}
                readOnly={isTableQr}
                style={{
                  display: "block",
                  marginTop: 8,
                  padding: 10,
                  width: 200,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: isTableQr ? "#f3f4f6" : "white",
                  color: "#111",
                  fontWeight: 900,
                  opacity: isTableQr ? 0.9 : 1,
                  cursor: isTableQr ? "not-allowed" : "text",
                }}
              />
            </label>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 18,
          position: "sticky",
          bottom: 0,
          background: "#f6f7f9",
          paddingTop: 10,
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
          zIndex: 20,
        }}
      >
        <button onClick={goMenu} style={{ padding: 12, flex: 1, fontWeight: 900, color: "#111827", WebkitTextFillColor: "currentColor" }}>
          메뉴로 돌아가기
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            padding: 12,
            flex: 1,
            opacity: canSubmit ? 1 : 0.5,
            fontWeight: 900,
            color: "#111827",
            WebkitTextFillColor: "currentColor",
          }}
        >
          {submitting ? "저장 중..." : isPrepayStore ? "결제하기" : "주문 접수"}
        </button>
      </div>
      <div style={{ height: 10 }} />

      <p style={{ marginTop: 8, color: "#6b7280", fontWeight: 800, fontSize: 13 }}>
        {prepayLoading
          ? "매장 결제 옵션 확인 중..."
          : isPrepayStore
          ? "결제 완료 후 주문이 접수됩니다."
          : "결제는 매장에서 진행됩니다."}
      </p>
      </main>
    </>
  );
}
export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <ConfirmPageInner />
    </Suspense>
  );
}
