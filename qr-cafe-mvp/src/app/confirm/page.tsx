/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/confirm/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  CustomerTrustFooter,
  StoreCustomerHeader,
} from "@/app/_components/StoreCustomerBrand";
import { CustomerOrderProgress } from "@/app/_components/CustomerOrderProgress";
import {
  getStoreIdFromSearchParams,
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
} from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
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
  if (digits.length >= 4)
    return `고객 ${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
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

function checkoutErrorMessage(code?: string, fallback?: string) {
  if (code === "AMOUNT_MISMATCH")
    return "금액이 변경됐어요. 다시 확인해주세요.";
  if (code === "PAYMENT_IDENTIFIERS_MISSING") return "결제 정보가 부족합니다.";
  if (code === "STORE_REQUIRED") return "매장 정보가 없습니다.";
  if (code === "ORDER_QUOTE_FAILED")
    return fallback || "주문 금액 확인에 실패했습니다.";
  if (code === "ORDER_CREATE_FAILED")
    return fallback || "주문 접수에 실패했습니다.";
  return fallback || "처리에 실패했습니다. 다시 시도해주세요.";
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

function paymentOrderId() {
  const raw = (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(16).slice(2)}`
  ).replace(/[^a-zA-Z0-9_-]/g, "");
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
    [storeId, isTableQr, tableFromMenu],
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
    [cartLines],
  );

  const totalPrice = useMemo(
    () =>
      cartLines.reduce(
        (s, x) => s + (x.basePrice + x.optionTotal) * (x.qty || 0),
        0,
      ),
    [cartLines],
  );

  const [mode, setMode] = useState<OrderMode>(
    isTableQr ? "dine-in" : "takeout",
  );
  const [tableInput, setTableInput] = useState<string>(tableFromMenu);

  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isPrepayStore, setIsPrepayStore] = useState(false);
  const [prepayLoading, setPrepayLoading] = useState(true);
  const [pgConfig, setPgConfig] = useState<PgConfig>({
    clientKey: "",
    mid: "",
  });
  const [customerUserId, setCustomerUserId] = useState<string | null>(null);
  const [customerPayName, setCustomerPayName] = useState("현장고객");
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loyaltySettings, setLoyaltySettings] =
    useState<CheckoutLoyaltySettings>(DEFAULT_CHECKOUT_LOYALTY_SETTINGS);
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

      const [walletRes, couponRes, profileRes, loyaltySettingsRes] =
        await Promise.all([
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
              { count: "exact" },
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
            .select(
              "max_redeem_pct,min_redeem_points,allow_point_or_coupon_only",
            )
            .eq("store_id", storeId)
            .maybeSingle(),
        ]);

      if (!mounted) return;
      setWallet((walletRes.data as WalletSummary | null) || null);
      setCustomerPayName(
        toPaymentCustomerName(
          (
            profileRes.data as {
              name?: string | null;
              phone?: string | null;
            } | null
          )?.name,
          (
            profileRes.data as {
              name?: string | null;
              phone?: string | null;
            } | null
          )?.phone,
        ),
      );
      const settingsRow =
        loyaltySettingsRes.data as Partial<CheckoutLoyaltySettings> | null;
      setLoyaltySettings({
        max_redeem_pct: Math.min(
          100,
          Math.max(
            0,
            Number(
              settingsRow?.max_redeem_pct ??
                DEFAULT_CHECKOUT_LOYALTY_SETTINGS.max_redeem_pct,
            ),
          ),
        ),
        min_redeem_points: Math.max(
          0,
          Math.floor(
            Number(
              settingsRow?.min_redeem_points ??
                DEFAULT_CHECKOUT_LOYALTY_SETTINGS.min_redeem_points,
            ),
          ),
        ),
        allow_point_or_coupon_only:
          settingsRow?.allow_point_or_coupon_only ??
          DEFAULT_CHECKOUT_LOYALTY_SETTINGS.allow_point_or_coupon_only,
      });
      setIssuedCouponCount(couponRes.count || 0);
      const couponRows = (
        Array.isArray(couponRes.data) ? couponRes.data : []
      ) as RawIssuedCoupon[];
      const normalized: IssuedCoupon[] = couponRows.map((row) => ({
        id: row.id,
        expires_at: row.expires_at,
        template:
          (Array.isArray(row.template)
            ? row.template[0] || null
            : row.template) ||
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
        const { data, error } = await supabase.rpc(
          "get_store_checkout_client_config",
          {
            p_store_id: storeId,
          },
        );

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
    const byPolicy = Math.max(
      0,
      Math.floor(
        (byPrice * Math.max(0, Number(loyaltySettings.max_redeem_pct || 0))) /
          100,
      ),
    );
    return Math.min(byBalance, byPrice, byPolicy);
  }, [wallet?.point_balance, totalPrice, loyaltySettings.max_redeem_pct]);

  const rawUsedPoints = useMemo(() => {
    const raw = Math.floor(Number(usedPointsInput || "0"));
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }, [usedPointsInput]);

  const pointUsageNotice = useMemo(() => {
    if (selectedCouponId) return "쿠폰 선택 시 포인트는 자동으로 제외됩니다.";
    if (
      rawUsedPoints > 0 &&
      rawUsedPoints < loyaltySettings.min_redeem_points
    ) {
      return `포인트는 ${fmt(loyaltySettings.min_redeem_points)}P 이상부터 사용할 수 있어요.`;
    }
    if (rawUsedPoints > maxUsablePoints) {
      return `이번 주문은 최대 ${fmt(maxUsablePoints)}P까지 사용할 수 있어요.`;
    }
    return "";
  }, [
    selectedCouponId,
    rawUsedPoints,
    loyaltySettings.min_redeem_points,
    maxUsablePoints,
  ]);

  const usedPoints = useMemo(() => {
    if (rawUsedPoints <= 0) return 0;
    if (rawUsedPoints < loyaltySettings.min_redeem_points) return 0;
    return Math.min(rawUsedPoints, maxUsablePoints);
  }, [rawUsedPoints, loyaltySettings.min_redeem_points, maxUsablePoints]);

  const selectedCoupon = useMemo(
    () => issuedCoupons.find((c) => c.id === selectedCouponId) || null,
    [issuedCoupons, selectedCouponId],
  );

  const couponDiscount = useMemo(() => {
    if (!selectedCoupon?.template) return 0;
    const tpl = selectedCoupon.template;
    const orderAmount = Math.max(0, Math.floor(totalPrice));
    if (orderAmount < Math.max(0, Number(tpl.min_order_amount || 0))) return 0;
    if (tpl.discount_type === "fixed_amount") {
      return Math.min(
        orderAmount,
        Math.max(0, Math.floor(Number(tpl.discount_value || 0))),
      );
    }
    if (tpl.discount_type === "percent") {
      const raw = Math.floor(
        (orderAmount * Math.max(0, Number(tpl.discount_value || 0))) / 100,
      );
      const cap =
        tpl.max_discount_amount == null
          ? raw
          : Math.max(0, Math.floor(Number(tpl.max_discount_amount || 0)));
      return Math.min(orderAmount, Math.min(raw, cap));
    }
    return 0;
  }, [selectedCoupon, totalPrice]);

  const selectedCouponIdForApply =
    selectedCouponId && couponDiscount > 0 ? selectedCouponId : null;
  const effectiveDiscount = selectedCouponIdForApply
    ? couponDiscount
    : usedPoints;
  const payableAmount = Math.max(0, Math.round(totalPrice) - effectiveDiscount);

  const loadTossScript = async () => {
    if (typeof window === "undefined")
      throw new Error("브라우저 환경에서만 결제창을 열 수 있습니다.");
    if ((window as any).TossPayments) return;

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://js.tosspayments.com/v1/payment";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("토스 결제 스크립트를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
  };

  const onSubmit = async () => {
    if (!canSubmit) return;

    try {
      setSubmitting(true);
      setSubmitError("");

      let currentCustomerUserId = customerUserId;
      if (!currentCustomerUserId) {
        const { data: authData } = await supabase.auth.getUser();
        currentCustomerUserId = authData?.user?.id || null;
        setCustomerUserId(currentCustomerUserId);
      }

      const paymentStatus = await resolvePaymentStatus();
      const commonPayload = {
        storeId,
        cartLines,
        mode: effectiveMode,
        table: effectiveMode === "dine-in" ? effectiveTable : "",
        requestNote,
        customerUserId: currentCustomerUserId,
        usedPoints: selectedCouponIdForApply ? 0 : usedPoints,
        usedCouponId: selectedCouponIdForApply,
      };

      if (paymentStatus === "paid") {
        if (!pgConfig.clientKey) {
          throw new Error(
            "선결제 테스트용 Client Key가 없습니다. 관리자 결제/구독에서 키를 먼저 저장해주세요.",
          );
        }

        const quoteRes = await fetch("/api/orders/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commonPayload),
        });
        const quoteJson = await quoteRes.json();
        if (!quoteRes.ok || !quoteJson?.ok) {
          throw new Error(
            checkoutErrorMessage(quoteJson?.code, quoteJson?.message),
          );
        }

        const serverQuote = quoteJson.quote;
        const payOrderId = paymentOrderId();
        const pending = {
          createdAt: Date.now(),
          storeId,
          customerUserId: currentCustomerUserId,
          cartLines,
          mode: effectiveMode,
          table: effectiveMode === "dine-in" ? effectiveTable : "",
          requestNote,
          totalCount: Number(serverQuote?.totalCount || totalCount),
          totalPrice: Number(serverQuote?.totalPrice || totalPrice),
          payableAmount: Number(serverQuote?.payableAmount || payableAmount),
          usedPoints: Number(serverQuote?.usedPoints || 0),
          usedCouponId: serverQuote?.usedCouponId || null,
        };

        localStorage.setItem(
          `${PREPAY_PENDING_KEY}:${payOrderId}`,
          JSON.stringify(pending),
        );

        await loadTossScript();
        const tossPayments = (window as any).TossPayments(pgConfig.clientKey);
        const orderName =
          cartLines.length > 1
            ? `${cartLines[0]?.name || "주문"} 외 ${cartLines.length - 1}건`
            : cartLines[0]?.name || "주문";
        const base = window.location.origin;
        const successUrl = `${base}/confirm/success?store=${encodeURIComponent(storeId)}&poid=${encodeURIComponent(payOrderId)}`;
        const failUrl = `${base}/confirm/fail?store=${encodeURIComponent(storeId)}&poid=${encodeURIComponent(payOrderId)}`;

        await tossPayments.requestPayment("카드", {
          amount: pending.payableAmount,
          orderId: payOrderId,
          orderName,
          customerName: customerPayName,
          successUrl,
          failUrl,
        });

        return;
      }

      const createRes = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonPayload, paymentStatus }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson?.ok || !createJson?.order) {
        throw new Error(
          checkoutErrorMessage(
            createJson?.code,
            createJson?.message || "주문 접수에 실패했습니다.",
          ),
        );
      }

      const created = createJson.order;
      const orderId = String(created.orderId || "");
      const accessToken = String(created.accessToken || "");
      if (!orderId || !accessToken)
        throw new Error("주문 확인 정보가 누락되었습니다.");

      localStorage.setItem(lsLastOrderIdKey(storeId), orderId);
      localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
      localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
      sessionStorage.removeItem(cartStorageKey);

      router.push(
        `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(
          orderId,
        )}&accessToken=${encodeURIComponent(accessToken)}`,
      );
    } catch (e: any) {
      console.error(e);
      setSubmitError(String(e?.message || e || "처리에 실패했습니다."));
      setSubmitting(false);
    }
  };

  const goMenu = () => {
    const base = `/menu?store=${encodeURIComponent(storeId)}`;
    if (isTableQr)
      router.push(`${base}&table=${encodeURIComponent(tableFromMenu)}`);
    else router.push(base);
  };

  const decLine = (lineId: string) => {
    setCartLines((prev) =>
      prev
        .map((ln) =>
          ln.lineId !== lineId
            ? ln
            : { ...ln, qty: Math.max(0, Number(ln.qty || 0) - 1) },
        )
        .filter((ln) => ln.qty > 0),
    );
  };

  const incLine = (lineId: string) => {
    setCartLines((prev) =>
      prev.map((ln) =>
        ln.lineId !== lineId
          ? ln
          : { ...ln, qty: Math.max(1, Number(ln.qty || 0) + 1) },
      ),
    );
  };

  const removeLine = (lineId: string) => {
    setCartLines((prev) => prev.filter((ln) => ln.lineId !== lineId));
  };

  return (
    <>
      <style jsx global>{`
        :root {
          color-scheme: light;
        }
        body {
          background: var(--customer-bg);
          color: var(--customer-ink);
        }
      `}</style>
      <style jsx>{`
        .confirmPage {
          width: 100%;
          max-width: 1180px;
          min-height: 100dvh;
          margin: 0 auto;
          padding: 24px 20px 0;
          color: var(--customer-ink);
        }
        .accountActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          flex-wrap: wrap;
        }
        .accountButton {
          min-height: 34px;
          padding: 6px 10px;
          border: 1px solid var(--customer-line);
          border-radius: 999px;
          background: #fff;
          color: #30415f;
          font-size: 12px;
          font-weight: 650;
          cursor: pointer;
        }
        .checkoutGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 20px;
          margin-top: 22px;
          align-items: start;
        }
        .checkoutMain {
          min-width: 0;
          display: grid;
          gap: 16px;
        }
        .checkoutSection,
        .summaryCard {
          padding: 22px;
          border: 1px solid var(--customer-line);
          border-radius: 22px;
          background: #fff;
          box-shadow: 0 10px 28px rgba(15, 31, 61, 0.055);
        }
        .sectionHeading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .sectionEyebrow {
          display: block;
          margin-bottom: 5px;
          color: #315fba;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.13em;
          line-height: 1.25;
        }
        h2 {
          margin: 0;
          color: var(--rion-navy);
          font-size: 20px;
          font-weight: 800;
          line-height: 1.3;
          letter-spacing: -0.025em;
        }
        .contextBadge {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 4px 10px;
          border-radius: 999px;
          background: #e9eef6;
          color: #30415f;
          font-size: 12px;
          font-weight: 650;
          white-space: nowrap;
        }
        .emptyCart {
          margin: 14px 0 0;
          padding: 13px 14px;
          border-radius: 14px;
          background: #fff1f2;
          color: #9f1239;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.55;
        }
        .orderList {
          display: grid;
          gap: 10px;
          margin-top: 14px;
        }
        .orderItem {
          display: grid;
          gap: 7px;
          padding: 16px;
          border: 1px solid var(--customer-line);
          border-radius: 16px;
          background: #fff;
        }
        .orderItemHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .orderItemHead > div {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
        }
        .orderItemHead strong {
          color: var(--customer-ink);
          font-size: 16px;
          font-weight: 700;
          line-height: 1.35;
        }
        .orderItemHead > strong {
          flex: 0 0 auto;
        }
        .orderItemHead span {
          flex: 0 0 auto;
          color: var(--customer-muted);
          font-size: 13px;
          font-weight: 550;
        }
        .itemMeta,
        .itemOptions {
          color: var(--customer-muted);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.55;
        }
        .itemOptions {
          color: #405069;
        }
        .quantityActions {
          display: flex;
          gap: 7px;
          margin-top: 5px;
        }
        .quantityButton {
          min-width: 44px;
          min-height: 36px;
          padding: 6px 11px;
          border: 1px solid var(--customer-line);
          border-radius: 11px;
          background: #f8fafc;
          color: var(--customer-ink);
          font-size: 13px;
          font-weight: 700;
        }
        .removeButton {
          border-color: #fecdd3;
          background: #fff7f8;
          color: #9f1239;
        }
        .addMenuButton {
          width: 100%;
          min-height: 46px;
          margin-top: 12px;
          border: 1px dashed #b8c5d8;
          border-radius: 13px;
          background: #f8fafc;
          color: #30415f;
          font-size: 14px;
          font-weight: 700;
        }
        .orderSubtotal {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px solid var(--customer-line);
        }
        .orderSubtotal span {
          color: var(--customer-muted);
          font-size: 14px;
          font-weight: 550;
        }
        .orderSubtotal strong {
          color: var(--rion-navy);
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.025em;
        }
        .benefitSection > p {
          margin: 14px 0 0 !important;
          color: #405069;
          font-size: 14px;
          font-weight: 600 !important;
          line-height: 1.6;
        }
        .benefitSection label {
          font-size: 14px;
          font-weight: 650 !important;
        }
        .benefitSection input {
          min-height: 44px;
          color: var(--customer-ink);
          font-weight: 650 !important;
        }
        .requestInput {
          width: 100%;
          min-height: 112px;
          margin-top: 14px;
          padding: 13px 14px;
          resize: vertical;
          border: 1px solid var(--customer-line);
          border-radius: 14px;
          background: #fbfcfe;
          color: var(--customer-ink);
          font-size: 15px;
          font-weight: 500;
          line-height: 1.6;
        }
        .requestInput::placeholder {
          color: #98a2b3;
        }
        .requestInput:focus {
          border-color: #7698d0;
          background: #fff;
          outline: 3px solid rgba(37, 99, 235, 0.12);
        }
        .fieldHint {
          margin: 8px 0 0;
          color: var(--customer-muted);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.55;
        }
        .modeButtons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 14px;
        }
        .modeButton {
          min-height: 50px;
          border: 1px solid var(--customer-line);
          border-radius: 14px;
          background: #fff;
          color: var(--customer-ink);
          font-size: 15px;
          font-weight: 700;
        }
        .modeButton.active {
          border-color: var(--rion-navy);
          background: #eef4ff;
          color: var(--rion-navy);
          box-shadow: inset 0 0 0 1px var(--rion-navy);
        }
        .modeButton:disabled {
          cursor: not-allowed;
        }
        .tableField {
          margin-top: 14px;
        }
        .fieldLabel {
          display: block;
          color: #405069;
          font-size: 14px;
          font-weight: 650;
        }
        .tableInput {
          display: block;
          width: min(220px, 100%);
          min-height: 46px;
          margin-top: 8px;
          padding: 10px 12px;
          border: 1px solid var(--customer-line);
          border-radius: 13px;
          background: #fff;
          color: var(--customer-ink);
          font-size: 15px;
          font-weight: 650;
        }
        .tableInput:disabled {
          background: #f2f4f7;
          color: #667085;
        }
        .checkoutAside {
          position: sticky;
          top: 18px;
        }
        .summaryCard h2 {
          font-size: 22px;
        }
        .summaryList {
          display: grid;
          gap: 13px;
          margin: 20px 0 0;
        }
        .summaryList > div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .summaryList dt {
          color: var(--customer-muted);
          font-size: 14px;
          font-weight: 500;
        }
        .summaryList dd {
          margin: 0;
          color: var(--customer-ink);
          font-size: 15px;
          font-weight: 700;
        }
        .summaryList .discount dd {
          color: #1d4ed8;
        }
        .summaryList .summaryTotal {
          margin-top: 4px;
          padding-top: 17px;
          border-top: 1px solid var(--customer-line);
          align-items: flex-end;
        }
        .summaryList .summaryTotal dt {
          color: var(--customer-ink);
          font-weight: 700;
        }
        .summaryList .summaryTotal dd {
          color: var(--rion-navy);
          font-size: 25px;
          font-weight: 900;
          letter-spacing: -0.035em;
        }
        .submitError {
          margin-top: 16px;
          padding: 12px 13px;
          border: 1px solid #fecdd3;
          border-radius: 13px;
          background: #fff1f2;
          color: #9f1239;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.55;
        }
        .submitActions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 9px;
          margin-top: 20px;
        }
        .submitActions button {
          min-height: 52px;
          border-radius: 14px;
          font-size: 15px;
          font-weight: 700;
        }
        .submitButton {
          grid-row: 1;
          border: 1px solid var(--rion-navy);
          background: var(--rion-navy);
          color: #fff;
          box-shadow: 0 10px 24px rgba(15, 31, 61, 0.2);
        }
        .submitButton:disabled {
          opacity: 0.45;
          box-shadow: none;
        }
        .backButton {
          border: 1px solid var(--customer-line);
          background: #fff;
          color: var(--customer-ink);
        }
        .paymentNotice {
          margin: 12px 0 0;
          color: var(--customer-muted);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.55;
          text-align: center;
        }
        @media (max-width: 860px) {
          .confirmPage {
            max-width: 760px;
            padding: 18px 16px 0;
          }
          .checkoutGrid {
            grid-template-columns: 1fr;
          }
          .checkoutAside {
            position: static;
          }
          .summaryCard {
            padding-bottom: calc(18px + env(safe-area-inset-bottom));
          }
          .submitActions {
            grid-template-columns: 1fr 1.35fr;
          }
          .submitButton {
            grid-row: auto;
          }
        }
        @media (max-width: 520px) {
          .confirmPage {
            padding: 12px 12px 0;
          }
          .checkoutSection,
          .summaryCard {
            padding: 17px;
            border-radius: 18px;
          }
          .checkoutGrid {
            gap: 12px;
            margin-top: 16px;
          }
          .orderItem {
            padding: 14px;
          }
          .orderItemHead {
            align-items: flex-start;
          }
          .orderItemHead > div {
            display: grid;
            gap: 2px;
          }
          .summaryCard {
            margin: 0 -12px;
            border-right: 0;
            border-left: 0;
            border-radius: 20px 20px 0 0;
          }
          .submitActions {
            grid-template-columns: 1fr;
          }
          .submitButton {
            grid-row: 1;
          }
        }
      `}</style>
      <main className="confirmPage customer-page">
        <StoreCustomerHeader
          storeId={storeId}
          title="주문을 확인해 주세요"
          description="메뉴와 할인, 이용 방식을 확인한 뒤 주문을 완료해 주세요."
          context={
            isTableQr ? `테이블 ${tableFromMenu} · 매장 이용` : "카운터 주문"
          }
          actions={
            <div className="accountActions">
              {customerUserId ? (
                <>
                  <button
                    onClick={() =>
                      router.push(
                        `/me?store=${encodeURIComponent(storeId)}&return_to=${encodeURIComponent(nextUrl)}`,
                      )
                    }
                    className="accountButton"
                  >
                    내 정보
                  </button>
                  <button
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setCustomerUserId(null);
                      setWallet(null);
                      setIssuedCouponCount(0);
                    }}
                    className="accountButton"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() =>
                      router.push(`/login?next=${encodeURIComponent(nextUrl)}`)
                    }
                    className="accountButton"
                  >
                    로그인
                  </button>
                  <button
                    onClick={() =>
                      router.push(`/signup?next=${encodeURIComponent(nextUrl)}`)
                    }
                    className="accountButton"
                  >
                    회원가입
                  </button>
                </>
              )}
            </div>
          }
        />
        <CustomerOrderProgress activeIndex={1} />

        <div className="checkoutGrid">
          <div className="checkoutMain">
            <section className="checkoutSection orderSection">
              <div className="sectionHeading">
                <div>
                  <span className="sectionEyebrow">ORDER DETAILS</span>
                  <h2>주문 내역</h2>
                </div>
                <span className="contextBadge">
                  {isTableQr ? "QR 주문" : "카운터 주문"}
                </span>
              </div>

              {cartLines.length === 0 ? (
                <p className="emptyCart" role="alert">
                  장바구니가 비어 있어요. 메뉴로 돌아가 상품을 담아 주세요.
                </p>
              ) : (
                <div className="orderList">
                  {cartLines.map((ln) => {
                    const unit = ln.basePrice + ln.optionTotal;
                    const optText =
                      ln.options
                        .map((g) => {
                          if (!g.items?.length) return null;
                          return g.items
                            .map(
                              (x) =>
                                `${x.name}×${Math.max(1, Number(x.qty || 1))}`,
                            )
                            .join(", ");
                        })
                        .filter(Boolean)
                        .join(" / ") || "";

                    return (
                      <article key={ln.lineId} className="orderItem">
                        <div className="orderItemHead">
                          <div>
                            <strong>{ln.name}</strong>
                            <span>{ln.qty}개</span>
                          </div>
                          <strong>{fmt(unit * ln.qty)}원</strong>
                        </div>

                        <div className="itemMeta">
                          기본 {fmt(ln.basePrice)}원
                          {ln.optionTotal
                            ? ` + 옵션 ${fmt(ln.optionTotal)}원`
                            : ""}
                          {"  "}· 1개당 {fmt(unit)}원
                        </div>

                        {optText ? (
                          <div className="itemOptions">옵션: {optText}</div>
                        ) : null}

                        <div className="quantityActions">
                          {ln.qty <= 1 ? (
                            <button
                              onClick={() => removeLine(ln.lineId)}
                              className="quantityButton removeButton"
                            >
                              삭제
                            </button>
                          ) : (
                            <button
                              onClick={() => decLine(ln.lineId)}
                              className="quantityButton"
                            >
                              -1
                            </button>
                          )}
                          <button
                            onClick={() => incLine(ln.lineId)}
                            className="quantityButton"
                          >
                            +1
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <button className="addMenuButton" onClick={goMenu}>
                메뉴 더 담기
              </button>
              <div className="orderSubtotal">
                <span>총 {totalCount}개</span>
                <strong>{fmt(totalPrice)}원</strong>
              </div>
            </section>

            <section className="checkoutSection benefitSection">
              <div className="sectionHeading">
                <div>
                  <span className="sectionEyebrow">MY BENEFITS</span>
                  <h2>할인 혜택</h2>
                </div>
              </div>
              {customerUserId ? (
                <>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    내 등급: <b>{tierLabel(wallet?.tier)}</b> · 내 포인트:{" "}
                    <b>{fmt(Number(wallet?.point_balance || 0))}P</b> · 내 쿠폰:{" "}
                    <b>{issuedCouponCount}장</b>
                  </p>
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    <label
                      style={{
                        display: "grid",
                        gap: 6,
                        fontWeight: 600,
                        color: "#374151",
                      }}
                    >
                      포인트 사용
                      <span
                        style={{
                          color: "#6b7280",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        최대 {fmt(maxUsablePoints)}P · 최소{" "}
                        {fmt(loyaltySettings.min_redeem_points)}P
                      </span>
                      <input
                        value={usedPointsInput}
                        onChange={(e) =>
                          setUsedPointsInput(
                            e.target.value.replace(/[^\d]/g, ""),
                          )
                        }
                        disabled={!!selectedCouponIdForApply}
                        inputMode="numeric"
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid #d1d5db",
                          fontWeight: 600,
                          background: selectedCouponIdForApply
                            ? "#f3f4f6"
                            : "white",
                        }}
                      />
                    </label>
                    {pointUsageNotice ? (
                      <p
                        style={{
                          margin: 0,
                          color: "#b45309",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {pointUsageNotice}
                      </p>
                    ) : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCouponId(null);
                          setUsedPointsInput(String(maxUsablePoints));
                        }}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 999,
                          padding: "6px 10px",
                          background: "white",
                          fontWeight: 600,
                        }}
                      >
                        최대 사용
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCouponId(null);
                          setUsedPointsInput("0");
                        }}
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 999,
                          padding: "6px 10px",
                          background: "white",
                          fontWeight: 600,
                        }}
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
                                fontWeight: 600,
                                opacity: 0.6,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                              >
                                <span style={{ fontWeight: 700 }}>
                                  사용 불가 쿠폰
                                </span>
                                <span
                                  style={{ color: "#374151", fontSize: 12 }}
                                >
                                  템플릿 없음
                                </span>
                              </div>
                              <div
                                style={{
                                  marginTop: 4,
                                  color: "#b45309",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                쿠폰 템플릿 정보를 찾을 수 없어 사용할 수
                                없습니다. 관리자에게 문의해 주세요.
                              </div>
                            </button>
                          );
                        }
                        const orderAmount = Math.max(0, Math.floor(totalPrice));
                        const minOrder = Math.max(
                          0,
                          Number(tpl.min_order_amount || 0),
                        );
                        const disabledByMin = orderAmount < minOrder;
                        const maxDiscount =
                          tpl.max_discount_amount == null
                            ? null
                            : Math.max(
                                0,
                                Math.floor(
                                  Number(tpl.max_discount_amount || 0),
                                ),
                              );
                        const expectedDiscount =
                          tpl.discount_type === "fixed_amount"
                            ? Math.min(
                                orderAmount,
                                Math.max(
                                  0,
                                  Math.floor(Number(tpl.discount_value || 0)),
                                ),
                              )
                            : Math.min(
                                orderAmount,
                                Math.min(
                                  Math.floor(
                                    (orderAmount *
                                      Math.max(
                                        0,
                                        Number(tpl.discount_value || 0),
                                      )) /
                                      100,
                                  ),
                                  maxDiscount == null
                                    ? Math.floor(
                                        (orderAmount *
                                          Math.max(
                                            0,
                                            Number(tpl.discount_value || 0),
                                          )) /
                                          100,
                                      )
                                    : maxDiscount,
                                ),
                              );
                        const disabledByDiscount = expectedDiscount <= 0;
                        const reason = disabledByMin
                          ? `최소주문 ${fmt(minOrder)}원 이상 사용 가능`
                          : disabledByDiscount
                            ? "현재 주문에는 할인 적용이 어려워요"
                            : null;
                        const active = selectedCouponIdForApply === c.id;
                        const expires = c.expires_at
                          ? new Date(c.expires_at)
                          : null;
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
                              border: active
                                ? "1px solid #111827"
                                : "1px solid #d1d5db",
                              borderRadius: 12,
                              padding: "10px 12px",
                              background: active ? "#f9fafb" : "white",
                              color: "#111827",
                              fontWeight: 600,
                              opacity: reason ? 0.6 : 1,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 8,
                              }}
                            >
                              <span style={{ fontWeight: 700 }}>
                                {tpl.name}
                              </span>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                {active ? (
                                  <span
                                    style={{
                                      background: "#111827",
                                      color: "white",
                                      borderRadius: 999,
                                      padding: "2px 8px",
                                      fontSize: 11,
                                      fontWeight: 700,
                                    }}
                                  >
                                    선택됨
                                  </span>
                                ) : null}
                                <span
                                  style={{ color: "#374151", fontSize: 12 }}
                                >
                                  {label}
                                </span>
                              </span>
                            </div>
                            <div
                              style={{
                                marginTop: 4,
                                color: "#4b5563",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              최소주문 {fmt(minOrder)}원 · 예상 할인{" "}
                              {fmt(expectedDiscount)}원 · {expiresText}
                            </div>
                            {reason ? (
                              <div
                                style={{
                                  marginTop: 4,
                                  color: "#b45309",
                                  fontSize: 12,
                                  fontWeight: 600,
                                }}
                              >
                                {reason}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        color: "#6b7280",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      할인 적용: <b>{fmt(effectiveDiscount)}원</b> · 예상
                      결제금액: <b>{fmt(payableAmount)}원</b>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: 0, fontWeight: 700 }}>
                    비회원 주문 중입니다.
                  </p>
                  <p
                    style={{
                      margin: "6px 0 0",
                      color: "#6b7280",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    회원가입 후 주문하면 매장별 포인트를 적립받을 수 있어요.
                  </p>
                </>
              )}
            </section>

            <section className="checkoutSection requestSection">
              <div className="sectionHeading">
                <div>
                  <span className="sectionEyebrow">ORDER NOTE</span>
                  <h2>요청사항</h2>
                </div>
              </div>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                className="requestInput"
                maxLength={200}
                placeholder="매장에 전달할 요청사항을 입력해 주세요."
              />
              <p className="fieldHint">
                요청사항은 매장 상황에 따라 반영이 어려울 수 있어요.
              </p>
            </section>

            <section className="checkoutSection modeSection">
              <div className="sectionHeading">
                <div>
                  <span className="sectionEyebrow">ORDER TYPE</span>
                  <h2>이용 방식</h2>
                </div>
              </div>
              <div className="modeButtons">
                <button
                  onClick={() => {
                    if (isTableQr) return;
                    setMode("dine-in");
                  }}
                  disabled={isTableQr}
                  className={`modeButton ${effectiveMode === "dine-in" ? "active" : ""}`}
                >
                  매장 이용
                </button>

                <button
                  onClick={() => {
                    if (isTableQr) return;
                    setMode("takeout");
                  }}
                  disabled={isTableQr}
                  className={`modeButton ${effectiveMode === "takeout" ? "active" : ""}`}
                >
                  포장
                </button>
              </div>

              {effectiveMode === "dine-in" && (
                <div className="tableField">
                  <label className="fieldLabel">
                    테이블 번호 {isTableQr ? "(고정)" : "(선택)"}
                    <input
                      value={isTableQr ? tableFromMenu : tableInput}
                      onChange={(e) => setTableInput(e.target.value)}
                      placeholder="예: 3"
                      disabled={isTableQr}
                      readOnly={isTableQr}
                      className="tableInput"
                    />
                  </label>
                </div>
              )}
            </section>
          </div>
          <aside className="checkoutAside">
            <section className="summaryCard">
              <span className="sectionEyebrow">ORDER SUMMARY</span>
              <h2>결제 요약</h2>
              <dl className="summaryList">
                <div>
                  <dt>주문 금액</dt>
                  <dd>{fmt(totalPrice)}원</dd>
                </div>
                {effectiveDiscount > 0 ? (
                  <div className="discount">
                    <dt>할인 금액</dt>
                    <dd>-{fmt(effectiveDiscount)}원</dd>
                  </div>
                ) : null}
                <div className="summaryTotal">
                  <dt>최종 결제 금액</dt>
                  <dd>{fmt(payableAmount)}원</dd>
                </div>
              </dl>

              {submitError ? (
                <div role="alert" className="submitError">
                  {submitError}
                </div>
              ) : null}

              <div className="submitActions">
                <button onClick={goMenu} className="backButton">
                  메뉴로 돌아가기
                </button>
                <button
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  className="submitButton"
                >
                  {submitting
                    ? "저장 중..."
                    : isPrepayStore
                      ? "결제하기"
                      : "주문 접수"}
                </button>
              </div>
              <p className="paymentNotice">
                {prepayLoading
                  ? "매장 결제 옵션 확인 중..."
                  : isPrepayStore
                    ? "결제 완료 후 주문이 접수됩니다."
                    : "결제는 매장에서 진행됩니다."}
              </p>
            </section>
          </aside>
        </div>
        <CustomerTrustFooter />
      </main>
    </>
  );
}
export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <ConfirmPageInner />
    </Suspense>
  );
}
