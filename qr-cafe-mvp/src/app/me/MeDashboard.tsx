"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { CustomerSheet } from "../_components/CustomerSheet";
import { MeAccountSheet } from "./MeAccountSheet";
import { MeBenefitSections } from "./MeBenefitSections";
import { MePlatformHeader } from "./MePlatformHeader";
import { MeQrScannerSheet } from "./MeQrScannerSheet";
import { MeQuickMenu } from "./MeQuickMenu";
import { PwaInstallGuide } from "../_components/PwaInstallGuide";
import {
  OrderDetailSheet,
  OrderHistorySheet,
  RecentOrderCard,
} from "./MeOrderSections";
import {
  type BenefitView,
  type CustomerCoupon,
  type CustomerOrder,
  type LoyaltyStatusMap,
  type WalletRow,
  formatWon,
  orderStatusLabel,
  orderStatusTone,
  tierLabel,
} from "./meUtils";

type ProfileRow = {
  name: string | null;
  phone: string | null;
};

type StoreNameRow = {
  store_id: string;
  store_name: string | null;
};
type BarcodeScanResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<BarcodeScanResult[]>;
};
type BarcodeDetectorCtor = new (opts: {
  formats: string[];
}) => BarcodeDetectorLike;

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

export function MeDashboard() {
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
  const [loyaltyStatusMap, setLoyaltyStatusMap] = useState<LoyaltyStatusMap>({});
  const [coupons, setCoupons] = useState<CustomerCoupon[]>([]);
  const [benefitView, setBenefitView] = useState<BenefitView>(null);
  const [orderBannerDismissed, setOrderBannerDismissed] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("qrCafeFavoriteStores");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((v) => String(v || "").trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  });
  const [editingBasic, setEditingBasic] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingBasic, setSavingBasic] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const [overlayResetKey, setOverlayResetKey] = useState(0);
  const [activePanel, setActivePanel] = useState<
    "orders" | "stores" | "account" | null
  >(null);
  const [recentOrders, setRecentOrders] = useState<CustomerOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(
    null,
  );
  const ordersRequestRef = useRef(false);
  const [cartSummary, setCartSummary] = useState<{
    storageKey: string;
    storeName: string;
    count: number;
    total: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanRequestRef = useRef(0);
  const detectingRef = useRef(false);
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
          .from("customer_point_summaries")
          .select(
            "store_id, point_balance, tier, lifetime_spent, lifetime_orders, nearest_expiry_at, expiring_soon_points, updated_at",
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
        setMsg(
          (prev) =>
            (prev ? `${prev}\n` : "") +
            `일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`,
        );
      } else {
        nextWallets = (walletsRes.data as WalletRow[]) || [];
        setWallets(nextWallets);
      }

      if (couponRes.error) {
        setMsg(
          (prev) =>
            (prev ? `${prev}\n` : "") +
            `일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`,
        );
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
        const storeResult = await supabase.rpc("get_store_names", { p_store_ids: storeIds });
        const { data: storeRows, error: storeErr } = storeResult;

        if (storeErr) {
          setMsg(
            (prev) =>
              (prev ? `${prev}\n` : "") +
              `일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`,
          );
        } else {
          const map: Record<string, string> = {};
          for (const row of (storeRows || []) as StoreNameRow[]) {
            const sid = String(row.store_id || "").trim();
            if (!sid) continue;
            map[sid] = String(row.store_name || "").trim();
          }
          setStoreNameMap(map);
        }
        try {
          const loyaltyResponse = await fetch("/api/customer/loyalty-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeIds }),
          });
          const loyaltyJson = await loyaltyResponse.json();
          const statusMap: LoyaltyStatusMap = {};
          if (loyaltyResponse.ok && loyaltyJson?.ok && Array.isArray(loyaltyJson.stores)) {
            for (const row of loyaltyJson.stores) {
              const sid = String(row?.storeId || "").trim();
              if (!sid) continue;
              statusMap[sid] = {
                pointsEnabled: row?.pointsEnabled !== false,
                couponsEnabled: row?.couponsEnabled !== false,
                pointsProgramStatus: String(row?.pointsProgramStatus || ""),
                couponsProgramStatus: String(row?.couponsProgramStatus || ""),
                pointsRedemptionEndsAt: row?.pointsRedemptionEndsAt || null,
              };
            }
          }
          setLoyaltyStatusMap(statusMap);
        } catch {
          setLoyaltyStatusMap({});
        }
      } else {
        setStoreNameMap({});
        setLoyaltyStatusMap({});
      }

      const favoriteRes = await supabase
        .from("customer_favorite_stores")
        .select("store_id")
        .eq("customer_user_id", uid);

      if (favoriteRes.error) {
        if (favoriteRes.error.code !== "42P01") {
          setMsg(
            (prev) =>
              (prev ? `${prev}\n` : "") +
              `일부 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`,
          );
        }
      } else {
        const dbFavorites = (favoriteRes.data || [])
          .map((row: { store_id: string | null }) =>
            String(row.store_id || "").trim(),
          )
          .filter(Boolean);
        setFavoriteStoreIds(dbFavorites);
        try {
          localStorage.setItem(
            "qrCafeFavoriteStores",
            JSON.stringify(dbFavorites),
          );
        } catch {
          // ignore
        }
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
    detectingRef.current = false;
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

  const loadOrders = useCallback(
    async (background = false) => {
      if (!currentUserId || ordersRequestRef.current) return;
      ordersRequestRef.current = true;
      if (!background) setOrdersLoading(true);
      setOrdersError("");
      try {
        const response = await fetch("/api/customer/orders", {
          cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok || !json?.ok) throw new Error("orders");
        setRecentOrders(Array.isArray(json.orders) ? json.orders : []);
      } catch {
        setOrdersError(
          "주문 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        );
      } finally {
        ordersRequestRef.current = false;
        if (!background) setOrdersLoading(false);
      }
    },
    [currentUserId],
  );

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const hasActiveOrder = recentOrders.some((order) =>
    ["new", "checked", "making", "ready_for_packing"].includes(order.status),
  );

  useEffect(() => {
    if (!hasActiveOrder) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadOrders(true);
    };
    const timer = window.setInterval(refresh, 12_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasActiveOrder, loadOrders]);

  useEffect(() => {
    if (!isSafeInternalPath(returnTo)) {
      setCartSummary(null);
      return;
    }
    try {
      const target = new URL(returnTo, window.location.origin);
      const storeId = target.searchParams.get("store") || sp.get("store") || "";
      const table = target.searchParams.get("table") || "counter";
      if (!storeId) return;
      const storageKey = `qrCafeCart:${storeId}:${table}`;
      const lines = JSON.parse(
        sessionStorage.getItem(storageKey) || "[]",
      ) as Array<{
        qty?: number;
        basePrice?: number;
        optionTotal?: number;
      }>;
      const count = lines.reduce(
        (sum, line) => sum + Math.max(0, Number(line.qty || 0)),
        0,
      );
      const total = lines.reduce(
        (sum, line) =>
          sum +
          Math.max(0, Number(line.qty || 0)) *
            Math.max(
              0,
              Number(line.basePrice || 0) + Number(line.optionTotal || 0),
            ),
        0,
      );
      setCartSummary(
        count
          ? {
              storageKey,
              storeName: storeNameMap[storeId] || "이용 중인 매장",
              count,
              total,
            }
          : null,
      );
    } catch {
      setCartSummary(null);
    }
  }, [returnTo, sp, storeNameMap]);

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
    setSelectedOrder(null);
    setOverlayResetKey((value) => value + 1);
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
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setScanError("카메라 초기화에 실패했어요.");
        return;
      }
      video.srcObject = stream;
      await video.play();

      const detector = new detectorCtor({ formats: ["qr_code"] });
      setScanning(true);

      scanIntervalRef.current = window.setInterval(async () => {
        if (!videoRef.current || detectingRef.current) return;
        detectingRef.current = true;
        try {
          const found = await detector.detect(videoRef.current);
          const first = Array.isArray(found) ? found[0] : null;
          const value = String(first?.rawValue || "").trim();
          if (value) moveByScannedText(value);
        } catch {
          // keep scanning
        } finally {
          detectingRef.current = false;
        }
      }, 500);
    } catch {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setScanning(false);
      setScanError(
        "카메라 권한이 없거나 기기에서 카메라를 사용할 수 없습니다.",
      );
    }
  };

  const openPanel = (panel: "orders" | "stores" | "account") => {
    stopScanner();
    setSelectedOrder(null);
    setOverlayResetKey((value) => value + 1);
    if (panel === "account") {
      setAccountError("");
      setAccountNotice("");
    }
    setActivePanel(panel);
  };

  const returnToOrder = () => {
    stopScanner();
    if (isSafeInternalPath(returnTo)) router.push(returnTo);
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

  const recentOrder = useMemo(
    () =>
      (activeOrder
        ? recentOrders.find((order) =>
            ["completed", "cancelled"].includes(order.status),
          )
        : recentOrders[0]) || null,
    [activeOrder, recentOrders],
  );

  const favoriteSet = useMemo(
    () => new Set(favoriteStoreIds),
    [favoriteStoreIds],
  );

  const visibleWallets = useMemo(
    () =>
      [...wallets].sort((a, b) => {
        const af = favoriteSet.has(a.store_id) ? 1 : 0;
        const bf = favoriteSet.has(b.store_id) ? 1 : 0;
        if (af !== bf) return bf - af;
        const ad = new Date(String(a.updated_at || 0)).getTime() || 0;
        const bd = new Date(String(b.updated_at || 0)).getTime() || 0;
        return bd - ad;
      }),
    [wallets, favoriteSet],
  );

  const saveBasicProfile = async () => {
    setAccountError("");
    setAccountNotice("");
    setSavingBasic(true);
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData?.user) {
      setAccountError("로그인 정보가 만료됐어요. 다시 로그인해 주세요.");
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
      setAccountError("전화번호를 다시 확인해 주세요.");
      setSavingBasic(false);
      return;
    }

    const { data: upserted, error } = await supabase
      .from("customer_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("name,phone")
      .maybeSingle();

    if (error) {
      setAccountError("정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
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
    setAccountNotice("정보를 수정했어요.");
    setSavingBasic(false);
  };

  const signOut = async () => {
    setAccountError("");
    setAccountNotice("");
    setSigningOut(true);
    stopScanner();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAccountError("로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.");
      setSigningOut(false);
      return;
    }
    setActivePanel(null);
    router.replace("/");
    router.refresh();
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
          width: fit-content;
          min-height: 44px;
          color: inherit;
          text-decoration: none;
        }
        .meHeroCopy {
          margin-top: 22px;
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
        .sectionLink {
          min-height: 36px;
          border: 0;
          background: transparent;
          color: #315fba;
          font-size: 12px;
          font-weight: 900;
        }
        .benefitGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .benefitSection {
          order: 3;
          margin-top: 16px;
          padding: 16px;
          border: 1px solid #dfe4eb;
          border-radius: 16px;
          background: #fff;
          color: #111827;
        }
        .benefitSection h2 {
          margin: 0 0 12px;
          color: #0f1f3d;
          font-size: 19px;
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
        button:focus-visible {
          outline: 3px solid rgba(49, 95, 186, 0.35);
          outline-offset: 2px;
        }
        .loadingCard {
          min-height: 104px;
          margin-top: 14px;
          border: 1px solid #e1e7ef;
          border-radius: 16px;
          background: linear-gradient(
            90deg,
            #eef2f7 25%,
            #f8fafc 50%,
            #eef2f7 75%
          );
          background-size: 200% 100%;
          animation: meShimmer 1.4s infinite linear;
        }
        @keyframes meShimmer {
          to {
            background-position: -200% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .loadingCard {
            animation: none;
          }
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
        .benefitRowHead > strong:first-child {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .benefitTotal {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px;
          border-radius: 13px;
          background: #edf3ff;
          color: #0f1f3d;
          font-weight: 800;
        }
        .benefitMoreButton {
          min-height: 46px;
          border: 1px solid #cbd9f3;
          border-radius: 13px;
          background: #fff;
          color: #315fba;
          font-weight: 900;
        }
        .expiryBadge {
          flex: 0 0 auto;
          padding: 5px 8px;
          border-radius: 999px;
          background: #edf1f7;
          color: #475467;
          font-size: 11px;
          font-weight: 900;
          white-space: nowrap;
        }
        .tierBadge {
          flex: 0 0 auto;
          padding: 5px 8px;
          border: 1px solid #d6e2f3;
          border-radius: 8px;
          background: #eef4fc;
          color: #284f82;
          font-size: 11px;
          font-weight: 900;
          line-height: 1.2;
          white-space: nowrap;
        }
        .expiryBadge.soon {
          background: #fff4df;
          color: #9a5b00;
        }
        .expiryBadge.urgent {
          background: #fff0f0;
          color: #b42318;
        }
        .benefitRow p {
          margin: 0;
          color: #667085;
          font-size: 12px;
          line-height: 1.5;
        }
        @media (max-width: 359px) {
          .benefitGrid {
            gap: 5px;
          }
          .benefitItem {
            min-height: 72px;
            padding: 10px 5px;
          }
          .benefitItem span {
            font-size: 10px;
          }
          .benefitItem strong {
            font-size: 15px;
            white-space: nowrap;
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
        .quickCard.emphasis {
          border-color: #9db9e8;
          background: #f3f7ff;
          box-shadow: 0 8px 24px rgba(49, 95, 186, 0.1);
        }
        .recentOrderCard {
          width: 100%;
          min-height: 112px;
          padding: 14px;
          border: 1px solid #d8e2f2;
          border-radius: 17px;
          background: #fff;
          color: #111827;
          text-align: left;
          display: grid;
          grid-template-columns: 40px minmax(0, 1fr) auto;
          gap: 10px;
          box-shadow: 0 8px 24px rgba(15, 31, 61, 0.05);
        }
        .recentOrderCard .quickCopy strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .recentOrderLink {
          grid-column: 2 / -1;
          color: #315fba;
          font-size: 12px;
          font-weight: 900;
        }
        .recentOrderEmpty {
          margin-top: 20px;
          padding: 16px;
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          background: #fff;
        }
        .recentOrderEmpty h2 {
          margin: 0;
          color: #0f1f3d;
          font-size: 19px;
        }
        .recentOrderEmpty p:not(.sectionLabel) {
          margin: 8px 0 0;
          color: #667085;
          font-size: 13px;
          line-height: 1.55;
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
        .sheetOrderButton {
          width: 100%;
          display: grid;
          gap: 7px;
          color: #475467;
          text-align: left;
        }
        .sheetOrderButton > span:not(.sheetCardHead) {
          font-size: 13px;
        }
        .orderDetailList {
          display: grid;
          gap: 0;
          margin: 14px 0 0;
        }
        .orderDetailList > div {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 0;
          border-bottom: 1px solid #e1e7ef;
        }
        .orderDetailList dt {
          color: #667085;
        }
        .orderDetailList dd {
          margin: 0;
          color: #0f1f3d;
          font-weight: 900;
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
        .accountForm {
          display: grid;
          gap: 12px;
        }
        .accountForm label {
          display: grid;
          gap: 6px;
          color: #344054;
          font-size: 13px;
          font-weight: 800;
        }
        .accountForm input {
          width: 100%;
          min-height: 46px;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 11px;
          background: #fff;
          color: #111827;
          font: inherit;
        }
        .accountForm input[readonly] {
          background: #f2f4f7;
          color: #667085;
        }
        .accountActions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .accountActions .sheetAction {
          margin-top: 0;
        }
        .accountSecondary,
        .logoutButton {
          min-height: 46px;
          border: 1px solid #cfd6e1;
          border-radius: 12px;
          background: #fff;
          color: #344054;
          font-weight: 900;
        }
        .logoutButton {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          background: #f8fafc;
          color: #344054;
        }
        .logoutButton:disabled {
          cursor: wait;
          opacity: 0.6;
        }
        .accountError {
          margin: 0;
          color: #b42318;
          font-size: 13px;
          font-weight: 800;
        }
        .accountNotice {
          margin: 0;
          color: #137a45;
          font-size: 13px;
          font-weight: 800;
        }
        .accountSummary hr {
          margin: 16px 0;
          border: 0;
          border-top: 1px solid #e1e7ef;
        }
        .qrScanner {
          display: grid;
          gap: 10px;
        }
        .qrScannerGuide,
        .qrScannerStatus {
          margin: 0;
          color: #667085;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.5;
        }
        .qrVideoFrame {
          position: relative;
          width: min(100%, 430px);
          margin: 0 auto;
          overflow: hidden;
          border-radius: 16px;
          background: #05070a;
          aspect-ratio: 3 / 4;
        }
        .qrVideoFrame video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .qrTarget {
          position: absolute;
          inset: 23%;
          border: 3px solid rgba(255, 255, 255, 0.92);
          border-radius: 18px;
          box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.28);
        }
        .qrScannerError {
          padding: 12px;
          border: 1px solid #f0d5a8;
          border-radius: 12px;
          background: #fffaf1;
        }
        .qrScannerError p {
          margin: 5px 0 0;
          color: #667085;
          font-size: 13px;
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
          .recentOrderCard {
            grid-template-columns: 34px minmax(0, 1fr);
          }
          .recentOrderCard .statusBadge {
            grid-column: 2;
            justify-self: start;
          }
        }
      `}</style>
      <MePlatformHeader
        name={profile?.name}
        loading={loading}
        storeCount={wallets.length}
        couponCount={summary.totalCoupons}
      >
        {(cartSummary || activeOrder) && !orderBannerDismissed ? (
          <section className="activeOrderBanner" aria-label="진행 중인 주문">
            <div className="activeOrderTop">
              <div>
                <p className="sectionLabel">
                  {cartSummary ? "CART IN PROGRESS" : "ORDER IN PROGRESS"}
                </p>
                <strong>
                  {cartSummary?.storeName ||
                    activeOrder?.store.name ||
                    "이용 중인 매장"}
                </strong>
                <p>
                  {cartSummary
                    ? `담은 메뉴 ${cartSummary.count}개 · ${formatWon(cartSummary.total)}`
                    : activeOrder
                      ? `주문 ${activeOrder.display_no || "-"} · ${Math.max(0, Number(activeOrder.total_count || 0) - Number(activeOrder.refunded_count || 0))}개 · ${formatWon(Number(activeOrder.adjusted_total_price ?? activeOrder.total_price ?? 0))}`
                      : ""}
                </p>
              </div>
              {activeOrder ? (
                <span
                  className={`statusBadge ${orderStatusTone(activeOrder.status)}`}
                >
                  {orderStatusLabel(activeOrder.status)}
                </span>
              ) : null}
            </div>
            <div className="activeOrderActions">
              <button
                className="returnButton"
                style={{ marginTop: 0 }}
                type="button"
                onClick={() =>
                  cartSummary ? returnToOrder() : openPanel("orders")
                }
              >
                {cartSummary ? "주문 계속하기" : "주문 상태 보기"}
              </button>
              <button
                className="dismissButton"
                type="button"
                onClick={() => {
                  if (cartSummary) {
                    if (
                      !window.confirm(
                        "이 매장의 장바구니를 비울까요? 다른 매장의 장바구니에는 영향을 주지 않아요.",
                      )
                    )
                      return;
                    sessionStorage.removeItem(cartSummary.storageKey);
                    setCartSummary(null);
                    return;
                  }
                  setOrderBannerDismissed(true);
                }}
                aria-label={
                  cartSummary
                    ? "이 매장의 장바구니 비우기"
                    : "진행 중인 주문 안내를 나중에 보기"
                }
              >
                {cartSummary ? "그만두기" : "나중에"}
              </button>
            </div>
          </section>
        ) : null}
      </MePlatformHeader>

      <PwaInstallGuide audience="customer" />

      <MeQuickMenu
        hasActiveOrder={Boolean(activeOrder)}
        onOrders={() => openPanel("orders")}
        onStores={() => openPanel("stores")}
        onQr={() => void startQrScanner()}
        onAccount={() => openPanel("account")}
      />
      {!ordersLoading && recentOrder ? (
        <RecentOrderCard
          order={recentOrder}
          onOpen={() => setSelectedOrder(recentOrder)}
        />
      ) : null}
      {!ordersLoading && !recentOrder ? (
        <section className="recentOrderEmpty">
          <p className="sectionLabel">RECENT ORDER</p>
          <h2>최근 주문</h2>
          <p>
            {activeOrder
              ? "진행 중인 주문이 완료되면 최근 주문에 표시돼요."
              : "아직 주문 내역이 없어요. QR을 스캔해 첫 주문을 시작해 보세요."}
          </p>
          {!activeOrder ? (
            <button
              type="button"
              className="sheetAction"
              onClick={startQrScanner}
            >
              QR 주문 시작
            </button>
          ) : null}
        </section>
      ) : null}

      {loading ? (
        <div
          className="loadingCard"
          role="status"
          aria-label="혜택 정보를 불러오는 중"
        />
      ) : null}
      {msg ? (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 14,
            border: "1px solid #f0d5a8",
            borderRadius: 14,
            background: "#fffaf1",
            color: "#475467",
          }}
        >
          <strong style={{ color: "#0f1f3d" }}>
            일부 정보를 불러오지 못했어요.
          </strong>
          <p style={{ margin: "5px 0 10px" }}>잠시 후 다시 시도해 주세요.</p>
          <button
            type="button"
            className="dismissButton"
            onClick={() => window.location.reload()}
          >
            다시 불러오기
          </button>
        </div>
      ) : null}
      {scannerOpen ? (
        <MeQrScannerSheet
          videoRef={videoRef}
          scanning={scanning}
          error={scanError}
          onRetry={() => void startQrScanner()}
          onClose={stopScanner}
        />
      ) : null}

      {!loading ? (
        <MeBenefitSections
          key={overlayResetKey}
          view={benefitView}
          onChange={setBenefitView}
          wallets={wallets}
          coupons={coupons}
          storeNameMap={storeNameMap}
          couponCountMap={couponCountMap}
          totalPoints={summary.totalPoints}
          totalCoupons={summary.totalCoupons}
          loyaltyStatusMap={loyaltyStatusMap}
        />
      ) : null}

      {activePanel === "orders" ? (
        <OrderHistorySheet
          orders={recentOrders}
          loading={ordersLoading}
          error={ordersError}
          onRetry={() => void loadOrders()}
          onClose={() => setActivePanel(null)}
          onSelect={(order) => {
            setActivePanel(null);
            setSelectedOrder(order);
          }}
          onStartQr={() => {
            setActivePanel(null);
            void startQrScanner();
          }}
        />
      ) : null}

      {selectedOrder ? (
        <OrderDetailSheet
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
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
                      <span className="tierBadge">{tierLabel(w.tier)}</span>
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
                      type="button"
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
        <MeAccountSheet
          email={email}
          name={profile?.name}
          phone={profile?.phone}
          editing={editingBasic}
          editName={editName}
          editPhone={editPhone}
          saving={savingBasic}
          signingOut={signingOut}
          error={accountError}
          notice={accountNotice}
          onEdit={() => {
            setAccountError("");
            setAccountNotice("");
            setEditingBasic(true);
          }}
          onCancel={() => {
            setAccountError("");
            setAccountNotice("");
            setEditingBasic(false);
            setEditName(profile?.name || "");
            setEditPhone(profile?.phone || "");
          }}
          onNameChange={setEditName}
          onPhoneChange={(value) => setEditPhone(formatPhone(value))}
          onSave={() => void saveBasicProfile()}
          onSignOut={() => void signOut()}
          onClose={() => {
            setAccountError("");
            setAccountNotice("");
            setActivePanel(null);
          }}
        />
      ) : null}
    </main>
  );
}
