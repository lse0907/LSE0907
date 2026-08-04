"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { CustomerIcon } from "../_components/CustomerIcon";
import { CustomerSheet } from "../_components/CustomerSheet";
import {
  MeDashboardSkeleton,
  MePlatformHeader,
  type ActiveOrderSummary,
} from "./MeDashboardSections";

type WalletRow = {
  store_id: string;
  point_balance: number;
  tier: "general" | "regular" | "vip" | string;
  lifetime_spent: number;
  lifetime_orders: number;
  updated_at?: string | null;
};

type ProfileRow = {
  name: string | null;
  phone: string | null;
};

type StoreNameRow = {
  store_id: string;
  store_name: string | null;
};
type CustomerOrder = {
  id: string;
  store_id: string;
  created_at: string;
  display_no: string | null;
  total_count: number | null;
  total_price: number | null;
  status: string;
  earned_points: number | null;
  access_token: string | null;
  store: { name: string; logo: string };
};
type CustomerCoupon = {
  id: string;
  store_id: string;
  expires_at: string | null;
  template: {
    name: string | null;
    discount_type: string | null;
    discount_value: number | null;
    min_order_amount: number | null;
    max_discount_amount: number | null;
  } | null;
};

type BarcodeScanResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<BarcodeScanResult[]>;
};
type BarcodeDetectorCtor = new (opts: {
  formats: string[];
}) => BarcodeDetectorLike;

function tierLabel(raw: string | null | undefined) {
  const v = String(raw || "").toLowerCase();
  if (v === "vip") return "VIP";
  if (v === "regular") return "단골";
  return "일반";
}

function formatWon(v: number) {
  return `${Math.max(0, Number(v || 0)).toLocaleString()}원`;
}
function couponBenefitText(coupon: CustomerCoupon) {
  const template = coupon.template;
  if (!template) return "혜택 정보를 확인해 주세요.";
  const value = Math.max(0, Number(template.discount_value || 0));
  const discount =
    template.discount_type === "percent"
      ? `${value}% 할인`
      : `${value.toLocaleString()}원 할인`;
  const conditions = [
    Number(template.min_order_amount || 0) > 0
      ? `${Number(template.min_order_amount).toLocaleString()}원 이상 주문`
      : "",
    Number(template.max_discount_amount || 0) > 0
      ? `최대 ${Number(template.max_discount_amount).toLocaleString()}원`
      : "",
  ].filter(Boolean);
  return [discount, ...conditions].join(" · ");
}
function orderStatusLabel(status: string) {
  return (
    (
      {
        new: "접수 대기",
        checked: "매장 확인",
        making: "준비 중",
        ready_for_packing: "준비 완료",
        completed: "수령 완료",
        cancelled: "주문 취소",
      } as Record<string, string>
    )[status] || "확인 중"
  );
}
function orderStatusTone(status: string) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "making") return "warning";
  if (status === "ready_for_packing") return "ready";
  return "info";
}
function formatOrderDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ko-KR", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function formatPhone(raw: string) {
  const digits = String(raw || "")
    .replace(/[^\d]/g, "")
    .slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length < 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function isValidPhone(raw: string) {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  return digits.length === 0 || (digits.length >= 9 && digits.length <= 11);
}

function MePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [storeNameMap, setStoreNameMap] = useState<Record<string, string>>({});
  const [couponCountMap, setCouponCountMap] = useState<Record<string, number>>(
    {},
  );
  const [coupons, setCoupons] = useState<CustomerCoupon[]>([]);
  const [benefitView, setBenefitView] = useState<
    "stores" | "points" | "coupons"
  >("stores");
  const [orderBannerDismissed, setOrderBannerDismissed] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [editingBasic, setEditingBasic] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingBasic, setSavingBasic] = useState(false);
  const [activePanel, setActivePanel] = useState<
    "orders" | "stores" | "account" | null
  >(null);
  const [recentOrders, setRecentOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRequestRef = useRef(0);
  const returnTo = useMemo(
    () => String(sp.get("return_to") || sp.get("next") || "").trim(),
    [sp],
  );

  const isSafeInternalPath = (v: string) =>
    !!v && v.startsWith("/") && !v.startsWith("//");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        router.replace("/login?next=/me");
        return;
      }

      const uid = userData.user.id;
      setCurrentUserId(uid);
      setEmail(String(userData.user.email || ""));

      const [profileRes, walletsRes, couponRes] = await Promise.all([
        supabase
          .from("customer_profiles")
          .select("name,phone")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("customer_store_wallets")
          .select(
            "store_id, point_balance, tier, lifetime_spent, lifetime_orders, updated_at",
          )
          .eq("customer_user_id", uid)
          .order("updated_at", { ascending: false }),
        supabase
          .from("customer_coupons")
          .select(
            "id,store_id,expires_at,template:store_coupon_templates(name,discount_type,discount_value,min_order_amount,max_discount_amount)",
          )
          .eq("customer_user_id", uid)
          .eq("status", "issued")
          .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`),
      ]);

      if (profileRes.error) {
        setMsg("일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        const nextProfile = (profileRes.data as ProfileRow | null) || null;
        setProfile(nextProfile);
        setEditName(String(nextProfile?.name || ""));
        setEditPhone(String(nextProfile?.phone || ""));
      }

      let nextWallets: WalletRow[] = [];
      if (walletsRes.error) {
        setMsg("일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        nextWallets = (walletsRes.data as WalletRow[]) || [];
        setWallets(nextWallets);
      }

      if (couponRes.error) {
        setMsg("일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      } else {
        const rows = (couponRes.data || []) as unknown as CustomerCoupon[];
        setCoupons(rows);
        const map: Record<string, number> = {};
        for (const row of rows) {
          const sid = String(row.store_id || "").trim();
          if (!sid) continue;
          map[sid] = (map[sid] || 0) + 1;
        }
        setCouponCountMap(map);
      }

      const storeIds = Array.from(
        new Set(
          nextWallets
            .map((w) => String(w.store_id || "").trim())
            .filter(Boolean),
        ),
      );
      if (storeIds.length) {
        const { data: storeRows, error: storeErr } = await supabase.rpc(
          "get_store_names",
          { p_store_ids: storeIds },
        );

        if (storeErr) {
          setMsg("일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        } else {
          const map: Record<string, string> = {};
          for (const row of (storeRows || []) as StoreNameRow[]) {
            const sid = String(row.store_id || "").trim();
            if (!sid) continue;
            map[sid] = String(row.store_name || "").trim();
          }
          setStoreNameMap(map);
        }
      } else {
        setStoreNameMap({});
      }

      setLoading(false);
    })();
  }, [router]);

  const stopScanner = () => {
    scanRequestRef.current += 1;
    if (scanIntervalRef.current != null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setScannerOpen(false);
  };

  useEffect(() => {
    return () => {
      if (scanIntervalRef.current != null)
        window.clearInterval(scanIntervalRef.current);
      if (streamRef.current)
        streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    let alive = true;
    let timer: number | null = null;
    const loadOrders = async (initial = false) => {
      if (initial) setOrdersLoading(true);
      try {
        const res = await fetch("/api/customer/orders", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !json?.ok) throw new Error();
        if (!alive) return false;
        const orders = Array.isArray(json.orders) ? json.orders : [];
        setRecentOrders(orders);
        setOrdersError("");
        return orders.some((order: CustomerOrder) =>
          ["new", "checked", "making", "ready_for_packing"].includes(
            order.status,
          ),
        );
      } catch {
        if (alive) setOrdersError("주문 정보를 불러오지 못했어요.");
        return false;
      } finally {
        if (alive && initial) setOrdersLoading(false);
      }
    };
    void loadOrders(true).then((hasActiveOrder) => {
      if (!alive || !hasActiveOrder) return;
      timer = window.setInterval(() => {
        void loadOrders().then((stillActive) => {
          if (!stillActive && timer != null) {
            window.clearInterval(timer);
            timer = null;
          }
        });
      }, 15000);
    });
    return () => {
      alive = false;
      if (timer != null) window.clearInterval(timer);
    };
  }, [currentUserId]);

  const moveByScannedText = (raw: string) => {
    const text = String(raw || "").trim();
    if (!text) return;
    try {
      const asUrl = new URL(text, window.location.origin);
      if (asUrl.origin !== window.location.origin) {
        setScanError("현재 서비스 도메인의 QR만 사용할 수 있어요.");
        return;
      }
      const sid = (asUrl.searchParams.get("store") || "").trim();
      if (!sid) {
        setScanError("스토어 정보(store)가 없는 QR이에요.");
        return;
      }
      stopScanner();
      router.push(
        `/?store=${encodeURIComponent(sid)}${asUrl.searchParams.get("table") ? `&table=${encodeURIComponent(asUrl.searchParams.get("table") || "")}` : ""}`,
      );
    } catch {
      setScanError("인식된 QR 형식이 올바르지 않습니다.");
    }
  };

  const startQrScanner = async () => {
    setActivePanel(null);
    stopScanner();
    const requestId = scanRequestRef.current;
    setScanError("");
    setScannerOpen(true);

    const detectorCtor = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;
    if (!detectorCtor) {
      setScanError(
        "현재 브라우저는 실시간 QR 스캔을 지원하지 않아요. 최신 Chrome/Safari를 사용해 주세요.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (requestId !== scanRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        setScanError("카메라 초기화에 실패했어요.");
        return;
      }
      video.srcObject = stream;
      await video.play();

      const detector = new detectorCtor({ formats: ["qr_code"] });
      setScanning(true);

      scanIntervalRef.current = window.setInterval(async () => {
        if (!videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const first = Array.isArray(found) ? found[0] : null;
          const value = String(first?.rawValue || "").trim();
          if (value) moveByScannedText(value);
        } catch {
          // keep scanning
        }
      }, 500);
    } catch {
      setScanError(
        "카메라 권한이 없거나 기기에서 카메라를 사용할 수 없습니다.",
      );
    }
  };

  const openPanel = (panel: "orders" | "stores" | "account") => {
    stopScanner();
    setActivePanel(panel);
  };

  const summary = useMemo(() => {
    const totalPoints = wallets.reduce(
      (acc, row) => acc + Math.max(0, Number(row.point_balance || 0)),
      0,
    );
    const totalCoupons = wallets.reduce(
      (acc, row) => acc + (couponCountMap[row.store_id] || 0),
      0,
    );
    return { totalPoints, stores: wallets.length, totalCoupons };
  }, [wallets, couponCountMap]);

  const activeOrder = useMemo(
    () =>
      recentOrders.find((order) =>
        ["new", "checked", "making", "ready_for_packing"].includes(
          order.status,
        ),
      ) || null,
    [recentOrders],
  );
  const recentOrderPreview = useMemo(
    () =>
      activeOrder
        ? recentOrders.find((order) =>
            ["completed", "cancelled"].includes(order.status),
          ) || null
        : recentOrders[0] || null,
    [activeOrder, recentOrders],
  );
  const activeOrderSummary = useMemo<ActiveOrderSummary | null>(() => {
    if (activeOrder) {
      return {
        storeName: activeOrder.store.name,
        detail: `${Number(activeOrder.total_count || 0)}개 · ${formatWon(Number(activeOrder.total_price || 0))}`,
        statusLabel: orderStatusLabel(activeOrder.status),
        statusTone: orderStatusTone(activeOrder.status),
        actionLabel: "주문 상태 보기",
      };
    }
    if (!isSafeInternalPath(returnTo)) return null;
    return {
      storeName:
        storeNameMap[String(sp.get("store") || "")] || "이용 중인 매장",
      detail: "담은 메뉴를 확인하고 주문을 이어가세요.",
      actionLabel: "주문 계속하기",
    };
  }, [activeOrder, returnTo, sp, storeNameMap]);

  const openActiveOrder = () => {
    stopScanner();
    if (activeOrder?.access_token) {
      router.push(
        `/status?store=${encodeURIComponent(activeOrder.store_id)}&orderId=${encodeURIComponent(activeOrder.id)}&access_token=${encodeURIComponent(activeOrder.access_token)}`,
      );
      return;
    }
    if (isSafeInternalPath(returnTo)) router.push(returnTo);
    else openPanel("orders");
  };

  const saveBasicProfile = async () => {
    setMsg("");
    setSavingBasic(true);
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      setMsg("로그인 정보가 만료되어 다시 로그인해 주세요.");
      setSavingBasic(false);
      return;
    }

    const uid = authData.user.id;
    const payload = {
      user_id: uid,
      name: editName.trim() || null,
      phone: formatPhone(editPhone).trim() || null,
    };

    if (!isValidPhone(payload.phone || "")) {
      setMsg(
        "전화번호 형식이 올바르지 않아요. 숫자 기준 9~11자리로 입력해 주세요.",
      );
      setSavingBasic(false);
      return;
    }

    const { data: upserted, error } = await supabase
      .from("customer_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("name,phone")
      .maybeSingle();

    if (error) {
      setMsg("정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setSavingBasic(false);
      return;
    }

    setProfile(
      (upserted as ProfileRow | null) || {
        name: payload.name,
        phone: payload.phone,
      },
    );
    setEditingBasic(false);
    setSavingBasic(false);
  };

  const theme = {
    textSubtle: "#6b7280",
    cardBg: "#ffffff",
    cardBorder: "#e5e7eb",
    cardText: "#111827",
    itemBg: "#f8fafc",
    itemBorder: "#e5e7eb",
    btnSecondaryBg: "#ffffff",
    btnSecondaryBorder: "#d1d5db",
    btnSecondaryText: "#111827",
    inputBg: "#ffffff",
    inputText: "#111827",
    accent: "#2563eb",
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "20px 16px 40px",
        color: theme.cardText,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style jsx global>{`
        :root {
          color-scheme: light;
        }
        body {
          background: #f3f5f8;
          color: #111827;
        }
        .meHero {
          padding: 20px;
          border: 1px solid #dfe4eb;
          border-radius: 22px;
          background: linear-gradient(145deg, #fff 0%, #f8fafc 100%);
          box-shadow: 0 18px 48px rgba(15, 31, 61, 0.08);
        }
        .meBrand {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 30px;
        }
        .meBrandName {
          display: grid;
          gap: 1px;
          color: #0f1f3d;
          line-height: 1.1;
        }
        .meBrandName strong {
          font-size: 16px;
          letter-spacing: -0.02em;
        }
        .meBrandName small {
          color: #667085;
          font-size: 10px;
          font-weight: 700;
        }
        .sectionLabel {
          margin: 0 0 5px;
          color: #315fba;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.15em;
          line-height: 1.3;
        }
        .meSkeleton {
          display: grid;
          gap: 18px;
        }
        .skeletonLine,
        .skeletonCard {
          background: linear-gradient(
            90deg,
            #e8edf4 25%,
            #f5f7fa 50%,
            #e8edf4 75%
          );
          background-size: 200% 100%;
          animation: meShimmer 1.35s infinite linear;
        }
        .skeletonLine {
          width: 62%;
          height: 76px;
          border-radius: 14px;
        }
        .skeletonGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .skeletonCard {
          height: 64px;
          border-radius: 14px;
        }
        @keyframes meShimmer {
          to {
            background-position: -200% 0;
          }
        }
        .meHero h1 {
          margin: 0;
          color: #0f1f3d;
          font-size: clamp(27px, 7vw, 36px);
          line-height: 1.12;
          letter-spacing: -0.045em;
        }
        .meHeroDescription {
          margin: 9px 0 0;
          color: #5c6678;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.6;
        }
        .meContext {
          display: inline-flex;
          margin-top: 14px;
          min-height: 28px;
          align-items: center;
          padding: 5px 10px;
          border-radius: 999px;
          background: #e9eef6;
          color: #30415f;
          font-size: 12px;
          font-weight: 800;
        }
        .returnButton {
          width: 100%;
          min-height: 46px;
          margin-top: 16px;
          border: 0;
          border-radius: 13px;
          background: #0f1f3d;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
        }
        .activeOrderBanner {
          display: grid;
          gap: 11px;
          margin-top: 16px;
          padding: 14px;
          border: 1px solid #cbd9f3;
          border-radius: 16px;
          background: #f3f7ff;
        }
        .activeOrderTop {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .activeOrderTop strong {
          display: block;
          color: #0f1f3d;
          font-size: 16px;
        }
        .activeOrderTop p {
          margin: 4px 0 0;
          color: #5c6678;
          font-size: 12px;
          font-weight: 700;
        }
        .activeOrderActions {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
        }
        .dismissButton {
          min-height: 46px;
          padding: 0 14px;
          border: 1px solid #c6cfdd;
          border-radius: 13px;
          background: #fff;
          color: #475467;
          font-weight: 850;
        }
        .sectionHeading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 12px;
          margin: 20px 2px 9px;
        }
        .sectionHeading h2 {
          margin: 0;
          color: #0f1f3d;
          font-size: 19px;
        }
        .benefitGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .benefitItem {
          display: grid;
          gap: 5px;
          min-width: 0;
          padding: 14px 10px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f8fafc;
          text-align: center;
          color: #0f1f3d;
        }
        button.benefitItem {
          cursor: pointer;
        }
        .benefitItem.active {
          border-color: #315fba;
          background: #edf3ff;
          box-shadow: 0 0 0 1px #315fba inset;
        }
        .benefitItem span {
          color: #6b7280;
          font-size: 12px;
          font-weight: 800;
        }
        .benefitItem strong {
          color: #0f1f3d;
          font-size: clamp(16px, 4vw, 21px);
          overflow-wrap: anywhere;
        }
        .benefitDetail {
          display: grid;
          gap: 9px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e5e7eb;
        }
        .benefitRow {
          display: grid;
          gap: 4px;
          padding: 12px;
          border: 1px solid #e1e7ef;
          border-radius: 13px;
          background: #f8fafc;
        }
        .benefitRowHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: #0f1f3d;
        }
        .benefitRow p {
          margin: 0;
          color: #667085;
          font-size: 12px;
          line-height: 1.5;
        }
        @media (max-width: 359px) {
          .benefitGrid {
            grid-template-columns: 1fr;
          }
        }
        .quickGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .quickCard {
          min-height: 92px;
          padding: 12px;
          border: 1px solid #e1e7ef;
          border-radius: 17px;
          background: #fff;
          color: #111827;
          text-align: left;
          display: grid;
          grid-template-columns: 40px 1fr;
          align-content: center;
          gap: 10px;
          box-shadow: 0 8px 24px rgba(15, 31, 61, 0.05);
        }
        .quickIcon {
          width: 40px;
          height: 40px;
          border-radius: 13px;
          display: grid;
          place-items: center;
          background: #eaf2ff;
          color: #235da8;
        }
        .quickIcon.purple {
          background: #e8edf7;
          color: #0f1f3d;
        }
        .quickIcon.green {
          background: #ecf9f2;
          color: #168657;
        }
        .quickIcon.gray {
          background: #edf1f7;
          color: #405a7c;
        }
        .quickCopy {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .quickCopy strong {
          font-size: 15px;
        }
        .quickCopy small {
          color: #6b7280;
          font-size: 11px;
          line-height: 1.4;
        }
        .sheetList {
          display: grid;
          gap: 10px;
        }
        .sheetCard {
          padding: 15px;
          border: 1px solid #e1e7ef;
          border-radius: 16px;
          background: #f8fafc;
        }
        .sheetCardHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .sheetCard h3 {
          margin: 0;
          font-size: 17px;
        }
        .sheetCard p {
          margin: 7px 0 0;
          color: #667085;
          font-size: 13px;
        }
        .sheetAction {
          width: 100%;
          min-height: 46px;
          margin-top: 12px;
          border: 0;
          border-radius: 12px;
          background: #0f1f3d;
          color: #fff;
          font-weight: 900;
        }
        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 28px;
          padding: 5px 8px;
          border-radius: 999px;
          background: #eaf2ff;
          color: #235da8;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
          white-space: nowrap;
        }
        .statusBadge.success {
          background: #e9f8ef;
          color: #137a45;
        }
        .statusBadge.danger {
          background: #fff0f0;
          color: #b42318;
        }
        .statusBadge.warning {
          background: #fff4df;
          color: #9a5b00;
        }
        .statusBadge.ready {
          background: #f0ebff;
          color: #6941c6;
        }
        @media (max-width: 520px) {
          .meHero {
            padding: 17px;
            border-radius: 18px;
          }
        }
        @media (max-width: 340px) {
          .quickGrid {
            gap: 8px;
          }
          .quickCard {
            padding: 11px;
            grid-template-columns: 34px 1fr;
          }
          .quickIcon {
            width: 34px;
            height: 34px;
          }
          .quickCopy small {
            display: none;
          }
        }
      `}</style>
      {loading ? (
        <MeDashboardSkeleton />
      ) : (
        <MePlatformHeader
          name={profile?.name}
          storeCount={summary.stores}
          couponCount={summary.totalCoupons}
          activeOrder={activeOrderSummary}
          bannerDismissed={orderBannerDismissed}
          onActiveOrder={openActiveOrder}
          onDismissBanner={() => setOrderBannerDismissed(true)}
        />
      )}

      <div className="sectionHeading">
        <div>
          <p className="sectionLabel">QUICK MENU</p>
          <h2>빠른 메뉴</h2>
        </div>
      </div>
      <div className="quickGrid" aria-label="빠른 메뉴">
        <button className="quickCard" onClick={() => openPanel("orders")}>
          <span className="quickIcon">
            <CustomerIcon name="orders" />
          </span>
          <span className="quickCopy">
            <strong>주문 내역</strong>
            <small>최근 주문 확인</small>
          </span>
        </button>
        <button className="quickCard" onClick={() => openPanel("stores")}>
          <span className="quickIcon green">
            <CustomerIcon name="store" />
          </span>
          <span className="quickCopy">
            <strong>내 매장</strong>
            <small>포인트·쿠폰</small>
          </span>
        </button>
        <button className="quickCard" onClick={startQrScanner}>
          <span className="quickIcon purple">
            <CustomerIcon name="qr" />
          </span>
          <span className="quickCopy">
            <strong>QR 주문</strong>
            <small>매장 QR 스캔</small>
          </span>
        </button>
        <button className="quickCard" onClick={() => openPanel("account")}>
          <span className="quickIcon gray">
            <CustomerIcon name="user" />
          </span>
          <span className="quickCopy">
            <strong>계정 정보</strong>
            <small>확인·수정</small>
          </span>
        </button>
      </div>
      {!ordersLoading && recentOrderPreview ? (
        <>
          <div className="sectionHeading">
            <div>
              <p className="sectionLabel">RECENT ORDER</p>
              <h2>최근 주문</h2>
            </div>
          </div>
          <button
            className="quickCard"
            style={{
              marginTop: 12,
              width: "100%",
              gridTemplateColumns: "40px 1fr auto",
            }}
            onClick={() => openPanel("orders")}
          >
            <span className="quickIcon">
              <CustomerIcon name="orders" />
            </span>
            <span className="quickCopy">
              <strong>{recentOrderPreview.store.name}</strong>
              <small>
                {formatOrderDate(recentOrderPreview.created_at)} ·{" "}
                {formatWon(Number(recentOrderPreview.total_price || 0))}
              </small>
            </span>
            <span
              className={`statusBadge ${orderStatusTone(recentOrderPreview.status)}`}
            >
              {orderStatusLabel(recentOrderPreview.status)}
            </span>
          </button>
        </>
      ) : null}

      {msg ? (
        <div
          style={{
            marginTop: 14,
            color: "#b91c1c",
            fontWeight: 800,
            whiteSpace: "pre-wrap",
          }}
        >
          <p style={{ margin: 0 }}>{msg}</p>
          <button
            type="button"
            className="dismissButton"
            style={{ marginTop: 10 }}
            onClick={() => window.location.reload()}
          >
            다시 불러오기
          </button>
        </div>
      ) : null}
      {scannerOpen ? (
        <section
          style={{
            ...scanCardStyle,
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
          }}
        >
          <div>
            <p className="sectionLabel">QR SCAN</p>
            <p style={{ margin: "0 0 10px", fontWeight: 800 }}>
              매장 QR을 화면 안에 맞춰주세요.
            </p>
          </div>
          <video ref={videoRef} style={videoStyle} muted playsInline />
          <button
            type="button"
            onClick={stopScanner}
            style={{
              ...secondaryBtnStyle,
              border: `1px solid ${theme.btnSecondaryBorder}`,
              background: theme.btnSecondaryBg,
              color: theme.btnSecondaryText,
            }}
          >
            {scanning ? "스캔 닫기" : "닫기"}
          </button>
          {scanError ? (
            <p style={{ margin: 0, color: "#b91c1c", fontWeight: 800 }}>
              {scanError}
            </p>
          ) : null}
        </section>
      ) : null}

      {!loading ? (
        <section
          style={{
            ...cardStyle,
            order: 3,
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
            color: theme.cardText,
          }}
        >
          <p className="sectionLabel">MY BENEFITS</p>
          <h2 style={sectionTitleStyle}>혜택 요약</h2>
          <div className="benefitGrid">
            {(
              [
                ["stores", "이용 매장", `${summary.stores}곳`],
                [
                  "points",
                  "총 보유 포인트",
                  `${summary.totalPoints.toLocaleString()}P`,
                ],
                ["coupons", "내 쿠폰", `${summary.totalCoupons}장`],
              ] as const
            ).map(([key, label, value]) => (
              <button
                type="button"
                className={`benefitItem ${benefitView === key ? "active" : ""}`}
                aria-pressed={benefitView === key}
                onClick={() => setBenefitView(key)}
                key={key}
              >
                <span>{label}</span>
                <strong>{value}</strong>
              </button>
            ))}
          </div>
          <div className="benefitDetail" aria-live="polite">
            {benefitView === "coupons" ? (
              coupons.length ? (
                coupons.map((coupon) => (
                  <article className="benefitRow" key={coupon.id}>
                    <div className="benefitRowHead">
                      <strong>{coupon.template?.name || "매장 쿠폰"}</strong>
                      <span>{storeNameMap[coupon.store_id] || "매장"}</span>
                    </div>
                    <p>{couponBenefitText(coupon)}</p>
                    <p>
                      {coupon.expires_at
                        ? `${new Date(coupon.expires_at).toLocaleDateString("ko-KR")}까지`
                        : "사용 기한 제한 없음"}
                    </p>
                  </article>
                ))
              ) : (
                <div className="benefitRow">
                  <p>사용할 수 있는 쿠폰이 없어요.</p>
                </div>
              )
            ) : wallets.length ? (
              wallets.map((wallet) => (
                <article
                  className="benefitRow"
                  key={`${benefitView}-${wallet.store_id}`}
                >
                  <div className="benefitRowHead">
                    <strong>{storeNameMap[wallet.store_id] || "매장"}</strong>
                    {benefitView === "points" ? (
                      <strong>
                        {Number(wallet.point_balance || 0).toLocaleString()}P
                      </strong>
                    ) : (
                      <span>{tierLabel(wallet.tier)}</span>
                    )}
                  </div>
                  {benefitView === "stores" ? (
                    <p>
                      주문 {Number(wallet.lifetime_orders || 0)}회 · 매장 포인트{" "}
                      {Number(wallet.point_balance || 0).toLocaleString()}P ·
                      쿠폰 {couponCountMap[wallet.store_id] || 0}장
                    </p>
                  ) : (
                    <p>이 매장에서 사용할 수 있는 포인트예요.</p>
                  )}
                </article>
              ))
            ) : (
              <div className="benefitRow">
                <p>아직 이용한 매장이 없어요.</p>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {activePanel === "orders" ? (
        <CustomerSheet title="주문 내역" onClose={() => setActivePanel(null)}>
          <div className="sheetList">
            {ordersLoading ? (
              <p>불러오는 중...</p>
            ) : ordersError ? (
              <p>{ordersError}</p>
            ) : recentOrders.length === 0 ? (
              <div className="sheetCard">
                <h3>아직 주문 내역이 없어요</h3>
                <p>QR을 스캔해 첫 주문을 시작해 보세요.</p>
                <button
                  className="sheetAction"
                  onClick={() => {
                    setActivePanel(null);
                    startQrScanner();
                  }}
                >
                  QR 주문
                </button>
              </div>
            ) : (
              recentOrders.map((order) => (
                <article className="sheetCard" key={order.id}>
                  <div className="sheetCardHead">
                    <h3>{order.store.name}</h3>
                    <span
                      className={`statusBadge ${orderStatusTone(order.status)}`}
                    >
                      {orderStatusLabel(order.status)}
                    </span>
                  </div>
                  <p>
                    {formatOrderDate(order.created_at)} · 주문{" "}
                    {order.display_no || "-"}
                  </p>
                  <p>
                    {Number(order.total_count || 0)}개 ·{" "}
                    {formatWon(Number(order.total_price || 0))}
                    {Number(order.earned_points || 0) > 0
                      ? ` · +${Number(order.earned_points).toLocaleString()}P`
                      : ""}
                  </p>
                </article>
              ))
            )}
          </div>
        </CustomerSheet>
      ) : null}

      {activePanel === "stores" ? (
        <CustomerSheet
          title={`내 매장 ${wallets.length}곳`}
          onClose={() => setActivePanel(null)}
        >
          <div className="sheetList">
            {wallets.length === 0 ? (
              <div className="sheetCard">
                <h3>이용 중인 매장이 없어요</h3>
                <p>QR 주문 후 포인트와 쿠폰을 확인할 수 있어요.</p>
              </div>
            ) : (
              wallets.map((w) => {
                const sid = String(w.store_id || "");
                return (
                  <article className="sheetCard" key={sid}>
                    <div className="sheetCardHead">
                      <h3>{storeNameMap[sid] || "매장"}</h3>
                      <span className="statusBadge">{tierLabel(w.tier)}</span>
                    </div>
                    <p>
                      <b>
                        매장 포인트{" "}
                        {Number(w.point_balance || 0).toLocaleString()}P
                      </b>{" "}
                      · 쿠폰 {couponCountMap[sid] || 0}장
                    </p>
                    <p>
                      주문 {Number(w.lifetime_orders || 0)}회 · 누적{" "}
                      {formatWon(w.lifetime_spent)}
                    </p>
                    <button
                      className="sheetAction"
                      onClick={() =>
                        router.push(`/menu?store=${encodeURIComponent(sid)}`)
                      }
                    >
                      메뉴 보기
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </CustomerSheet>
      ) : null}

      {activePanel === "account" ? (
        <CustomerSheet title="계정 정보" onClose={() => setActivePanel(null)}>
          <div className="sheetCard">
            {editingBasic ? (
              <div style={{ display: "grid", gap: 12 }}>
                <label>
                  이름
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>
                <label>
                  전화번호
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>
                <button
                  className="sheetAction"
                  onClick={saveBasicProfile}
                  disabled={savingBasic}
                >
                  {savingBasic ? "저장 중" : "저장"}
                </button>
              </div>
            ) : (
              <>
                <p>
                  <b>이메일</b>
                  <br />
                  {email || "-"}
                </p>
                <p>
                  <b>이름</b>
                  <br />
                  {profile?.name || "-"}
                </p>
                <p>
                  <b>전화번호</b>
                  <br />
                  {profile?.phone || "-"}
                </p>
                <button
                  className="sheetAction"
                  onClick={() => setEditingBasic(true)}
                >
                  수정
                </button>
              </>
            )}
          </div>
        </CustomerSheet>
      ) : null}

      {activePanel === "orders" ? (
        <CustomerSheet title="주문 내역" onClose={() => setActivePanel(null)}>
          <div className="sheetList">
            {ordersLoading ? (
              <p>불러오는 중...</p>
            ) : ordersError ? (
              <p>{ordersError}</p>
            ) : recentOrders.length === 0 ? (
              <div className="sheetCard">
                <h3>아직 주문 내역이 없어요</h3>
                <p>QR을 스캔해 첫 주문을 시작해 보세요.</p>
                <button
                  className="sheetAction"
                  onClick={() => {
                    setActivePanel(null);
                    startQrScanner();
                  }}
                >
                  QR 주문
                </button>
              </div>
            ) : (
              recentOrders.map((order) => (
                <article className="sheetCard" key={order.id}>
                  <div className="sheetCardHead">
                    <h3>{order.store.name}</h3>
                    <span
                      className={`statusBadge ${orderStatusTone(order.status)}`}
                    >
                      {orderStatusLabel(order.status)}
                    </span>
                  </div>
                  <p>
                    {formatOrderDate(order.created_at)} · 주문{" "}
                    {order.display_no || "-"}
                  </p>
                  <p>
                    {Number(order.total_count || 0)}개 ·{" "}
                    {formatWon(Number(order.total_price || 0))}
                    {Number(order.earned_points || 0) > 0
                      ? ` · +${Number(order.earned_points).toLocaleString()}P`
                      : ""}
                  </p>
                </article>
              ))
            )}
          </div>
        </CustomerSheet>
      ) : null}

      {activePanel === "stores" ? (
        <CustomerSheet
          title={`내 매장 ${wallets.length}곳`}
          onClose={() => setActivePanel(null)}
        >
          <div className="sheetList">
            {wallets.length === 0 ? (
              <div className="sheetCard">
                <h3>이용 중인 매장이 없어요</h3>
                <p>QR 주문 후 포인트와 쿠폰을 확인할 수 있어요.</p>
              </div>
            ) : (
              visibleWallets.map((w) => {
                const sid = String(w.store_id || "");
                return (
                  <article className="sheetCard" key={sid}>
                    <div className="sheetCardHead">
                      <h3>{storeNameMap[sid] || "매장"}</h3>
                      <span className="statusBadge">{tierLabel(w.tier)}</span>
                    </div>
                    <p>
                      <b>
                        매장 포인트{" "}
                        {Number(w.point_balance || 0).toLocaleString()}P
                      </b>{" "}
                      · 쿠폰 {couponCountMap[sid] || 0}장
                    </p>
                    <p>
                      주문 {Number(w.lifetime_orders || 0)}회 · 누적{" "}
                      {formatWon(w.lifetime_spent)}
                    </p>
                    <button
                      className="sheetAction"
                      onClick={() =>
                        router.push(`/menu?store=${encodeURIComponent(sid)}`)
                      }
                    >
                      메뉴 보기
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </CustomerSheet>
      ) : null}

      {activePanel === "account" ? (
        <CustomerSheet title="계정 정보" onClose={() => setActivePanel(null)}>
          <div className="sheetCard">
            {editingBasic ? (
              <div style={{ display: "grid", gap: 12 }}>
                <label>
                  이름
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>
                <label>
                  전화번호
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </label>
                <button
                  className="sheetAction"
                  onClick={saveBasicProfile}
                  disabled={savingBasic}
                >
                  {savingBasic ? "저장 중" : "저장"}
                </button>
              </div>
            ) : (
              <>
                <p>
                  <b>이메일</b>
                  <br />
                  {email || "-"}
                </p>
                <p>
                  <b>이름</b>
                  <br />
                  {profile?.name || "-"}
                </p>
                <p>
                  <b>전화번호</b>
                  <br />
                  {profile?.phone || "-"}
                </p>
                <button
                  className="sheetAction"
                  onClick={() => setEditingBasic(true)}
                >
                  수정
                </button>
              </>
            )}
          </div>
        </CustomerSheet>
      ) : null}
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: 16,
  borderRadius: 12,
  padding: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  margin: "0 0 10px",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  fontWeight: 700,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  fontWeight: 900,
  cursor: "pointer",
};

const scanCardStyle: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 12,
  padding: 12,
  display: "grid",
  gap: 8,
};

const videoStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  background: "#000",
  aspectRatio: "3 / 4",
  objectFit: "cover",
};

export default function MePage() {
  return (
    <Suspense fallback={<MeDashboardSkeleton />}>
      <MePageInner />
    </Suspense>
  );
}
