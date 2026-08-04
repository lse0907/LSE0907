"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { CustomerBrand } from "../_components/CustomerBrand";
import { CustomerIcon } from "../_components/CustomerIcon";
import { CustomerSheet } from "../_components/CustomerSheet";

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
  store: { name: string; logo: string };
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
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const showStores = true;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<"recent" | "orders" | "points">(
    "recent",
  );
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
          .select("store_id,expires_at")
          .eq("customer_user_id", uid)
          .eq("status", "issued")
          .or(`expires_at.is.null,expires_at.gte.${new Date().toISOString()}`),
      ]);

      if (profileRes.error) {
        setMsg(`고객 프로필 조회 실패: ${profileRes.error.message}`);
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
            `포인트 지갑 조회 실패: ${walletsRes.error.message}`,
        );
      } else {
        nextWallets = (walletsRes.data as WalletRow[]) || [];
        setWallets(nextWallets);
      }

      if (couponRes.error) {
        setMsg(
          (prev) =>
            (prev ? `${prev}\n` : "") +
            `쿠폰 조회 실패: ${couponRes.error.message}`,
        );
      } else {
        const rows = (couponRes.data || []) as Array<{
          store_id: string | null;
          expires_at?: string | null;
        }>;
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
          setMsg(
            (prev) =>
              (prev ? `${prev}\n` : "") +
              `매장명 조회 실패: ${storeErr.message}`,
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
      } else {
        setStoreNameMap({});
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
              `즐겨찾기 조회 실패: ${favoriteRes.error.message}`,
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
    Promise.resolve()
      .then(() => {
        if (!alive) return;
        setOrdersLoading(true);
        setOrdersError("");
        return fetch("/api/customer/orders");
      })
      .then((res) => {
        if (!res) return null;
        return res.json();
      })
      .then((json) => {
        if (!alive || !json) return;
        if (!json?.ok)
          throw new Error(json?.message || "주문 내역을 불러오지 못했어요.");
        setRecentOrders(Array.isArray(json.orders) ? json.orders : []);
      })
      .catch(
        (error) =>
          alive &&
          setOrdersError(
            error instanceof Error
              ? error.message
              : "주문 내역을 불러오지 못했어요.",
          ),
      )
      .finally(() => alive && setOrdersLoading(false));
    return () => {
      alive = false;
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

  const favoriteSet = useMemo(
    () => new Set(favoriteStoreIds),
    [favoriteStoreIds],
  );

  const visibleWallets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arranged = [...wallets].sort((a, b) => {
      const af = favoriteSet.has(a.store_id) ? 1 : 0;
      const bf = favoriteSet.has(b.store_id) ? 1 : 0;
      if (af !== bf) return bf - af;
      if (sortKey === "points") {
        return Number(b.point_balance || 0) - Number(a.point_balance || 0);
      }
      if (sortKey === "orders") {
        return Number(b.lifetime_orders || 0) - Number(a.lifetime_orders || 0);
      }
      const ad = new Date(String(a.updated_at || 0)).getTime() || 0;
      const bd = new Date(String(b.updated_at || 0)).getTime() || 0;
      return bd - ad;
    });

    if (!q) return arranged;

    return arranged.filter((w) => {
      const name = String(storeNameMap[w.store_id] || "").toLowerCase();
      return name.includes(q);
    });
  }, [wallets, query, favoriteSet, storeNameMap, sortKey]);

  const persistFavorites = (next: string[]) => {
    setFavoriteStoreIds(next);
    try {
      localStorage.setItem("qrCafeFavoriteStores", JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const toggleFavorite = async (storeId: string) => {
    const sid = String(storeId || "").trim();
    if (!sid) return;

    const removing = favoriteSet.has(sid);
    const next = removing
      ? favoriteStoreIds.filter((id) => id !== sid)
      : [sid, ...favoriteStoreIds.filter((id) => id !== sid)];
    persistFavorites(next);

    if (!currentUserId) return;

    if (removing) {
      const { error } = await supabase
        .from("customer_favorite_stores")
        .delete()
        .eq("customer_user_id", currentUserId)
        .eq("store_id", sid);
      if (error && error.code !== "42P01") {
        setMsg(
          (prev) =>
            (prev ? `${prev}\n` : "") +
            `즐겨찾기 해제 저장 실패: ${error.message}`,
        );
      }
      return;
    }

    const { error } = await supabase.from("customer_favorite_stores").upsert(
      {
        customer_user_id: currentUserId,
        store_id: sid,
      },
      { onConflict: "customer_user_id,store_id" },
    );
    if (error && error.code !== "42P01") {
      setMsg(
        (prev) =>
          (prev ? `${prev}\n` : "") + `즐겨찾기 저장 실패: ${error.message}`,
      );
    }
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
      setMsg(`기본 정보 저장 실패: ${error.message}`);
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
          min-height: 30px;
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
        .benefitItem {
          display: grid;
          gap: 5px;
          min-width: 0;
          padding: 14px 10px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f8fafc;
          text-align: center;
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
          padding: 5px 8px;
          border-radius: 999px;
          background: #eaf2ff;
          color: #235da8;
          font-size: 11px;
          font-weight: 900;
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
      <header className="meHero">
        <div className="meBrand">
          <CustomerBrand />
        </div>
        <div style={{ marginTop: 22 }}>
          <p className="sectionLabel">MY RION</p>
          <h1>내 주문·혜택</h1>
          <p className="meHeroDescription">
            {profile?.name
              ? `${profile.name}님, 매장별 포인트와 쿠폰을 확인하세요.`
              : "매장별 포인트와 쿠폰을 확인하세요."}
          </p>
          <span className="meContext">
            {wallets.length}개 매장 · 쿠폰 {summary.totalCoupons}장
          </span>
        </div>
        {isSafeInternalPath(returnTo) ? (
          <button
            className="returnButton"
            type="button"
            onClick={returnToOrder}
          >
            주문으로 돌아가기
          </button>
        ) : null}
      </header>

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
      {!ordersLoading && recentOrders[0] ? (
        <>
          <div className="sectionHeading">
            <div>
              <p className="sectionLabel">RECENT ORDER</p>
              <h2>최근 주문</h2>
            </div>
            <button className="sectionLink" onClick={() => openPanel("orders")}>
              전체 보기 →
            </button>
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
              <strong>{recentOrders[0].store.name}</strong>
              <small>
                {formatOrderDate(recentOrders[0].created_at)} ·{" "}
                {formatWon(Number(recentOrders[0].total_price || 0))}
              </small>
            </span>
            <span
              className={`statusBadge ${orderStatusTone(recentOrders[0].status)}`}
            >
              {orderStatusLabel(recentOrders[0].status)}
            </span>
          </button>
        </>
      ) : null}

      {loading ? <p style={{ marginTop: 14 }}>불러오는 중...</p> : null}
      {msg ? (
        <p
          style={{
            marginTop: 14,
            color: "#b91c1c",
            fontWeight: 800,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </p>
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
            order: 5,
            display: "none",
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
            color: theme.cardText,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h2 style={sectionTitleStyle}>기본 정보</h2>
            {!editingBasic ? (
              <button
                type="button"
                style={{
                  ...secondaryBtnStyle,
                  border: `1px solid ${theme.btnSecondaryBorder}`,
                  background: theme.btnSecondaryBg,
                  color: theme.btnSecondaryText,
                }}
                onClick={() => {
                  setEditingBasic(true);
                  setEditName(String(profile?.name || ""));
                  setEditPhone(String(profile?.phone || ""));
                }}
              >
                수정
              </button>
            ) : null}
          </div>

          {!editingBasic ? (
            <>
              <p>
                <b>이메일:</b> {email || "-"}
              </p>
              <p>
                <b>이름:</b> {profile?.name || "-"}
              </p>
              <p>
                <b>전화번호:</b> {profile?.phone || "-"}
              </p>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, fontWeight: 800 }}>
                이름
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    ...inputStyle,
                    border: `1px solid ${theme.btnSecondaryBorder}`,
                    background: theme.inputBg,
                    color: theme.inputText,
                  }}
                  placeholder="이름을 입력해 주세요"
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontWeight: 800 }}>
                전화번호
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(formatPhone(e.target.value))}
                  style={{
                    ...inputStyle,
                    border: `1px solid ${theme.btnSecondaryBorder}`,
                    background: theme.inputBg,
                    color: theme.inputText,
                  }}
                  placeholder="전화번호를 입력해 주세요"
                />
              </label>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  style={{
                    ...secondaryBtnStyle,
                    border: `1px solid ${theme.btnSecondaryBorder}`,
                    background: theme.btnSecondaryBg,
                    color: theme.btnSecondaryText,
                  }}
                  onClick={() => setEditingBasic(false)}
                  disabled={savingBasic}
                >
                  취소
                </button>
                <button
                  type="button"
                  style={actionBtnStyle}
                  onClick={saveBasicProfile}
                  disabled={savingBasic}
                >
                  {savingBasic ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          )}
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
            <div className="benefitItem">
              <span>이용 매장</span>
              <strong>{summary.stores}곳</strong>
            </div>
            <div className="benefitItem">
              <span>총 보유 포인트</span>
              <strong>{summary.totalPoints.toLocaleString()}P</strong>
            </div>
            <div className="benefitItem">
              <span>내 쿠폰</span>
              <strong>{summary.totalCoupons}장</strong>
            </div>
          </div>
        </section>
      ) : null}

      {!loading && showStores ? (
        <section
          style={{
            ...cardStyle,
            order: 4,
            display: "none",
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
            color: theme.cardText,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <h2 style={sectionTitleStyle}>내 매장 목록</h2>
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <select
                value={sortKey}
                onChange={(e) =>
                  setSortKey(e.target.value as "recent" | "orders" | "points")
                }
                style={{
                  ...inputStyle,
                  padding: "10px",
                  border: `1px solid ${theme.btnSecondaryBorder}`,
                  background: theme.inputBg,
                  color: theme.inputText,
                }}
              >
                <option value="recent">최근 주문순</option>
                <option value="orders">주문횟수순</option>
                <option value="points">포인트순</option>
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="매장명 검색"
                style={{
                  ...inputStyle,
                  width: 220,
                  border: `1px solid ${theme.btnSecondaryBorder}`,
                  background: theme.inputBg,
                  color: theme.inputText,
                }}
              />
            </div>
          </div>

          {wallets.length === 0 ? (
            <p style={{ color: theme.textSubtle, fontWeight: 700 }}>
              아직 주문/적립된 매장이 없어요.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleWallets.map((w) => {
                const sid = String(w.store_id || "");
                const isFavorite = favoriteSet.has(sid);
                return (
                  <article
                    key={sid}
                    style={{
                      ...walletItemStyle,
                      border: `1px solid ${theme.itemBorder}`,
                      background: theme.itemBg,
                      color: theme.cardText,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <p style={{ margin: 0, fontWeight: 900 }}>
                        매장명: {storeNameMap[sid] || "등록된 매장"}
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(sid)}
                        style={{
                          ...secondaryBtnStyle,
                          padding: "6px 10px",
                          border: `1px solid ${theme.btnSecondaryBorder}`,
                          background: theme.btnSecondaryBg,
                          color: theme.btnSecondaryText,
                        }}
                      >
                        {isFavorite ? "★ 즐겨찾기" : "☆ 즐겨찾기"}
                      </button>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 6,
                        marginTop: 8,
                      }}
                    >
                      <p style={{ margin: 0 }}>
                        <b>등급:</b> {tierLabel(w.tier)}
                      </p>
                      <p style={{ margin: 0 }}>
                        <b>주문 횟수:</b> {Number(w.lifetime_orders || 0)}회
                      </p>
                      <p style={{ margin: 0 }}>
                        <b>내 포인트:</b>{" "}
                        {Number(w.point_balance || 0).toLocaleString()}P
                      </p>
                      <p style={{ margin: 0 }}>
                        <b>내 쿠폰:</b> {couponCountMap[sid] || 0}장
                      </p>
                      <p style={{ margin: 0 }}>
                        <b>누적 결제:</b> {formatWon(w.lifetime_spent)}
                      </p>
                    </div>

                    <button
                      type="button"
                      style={{ ...actionBtnStyle, marginTop: 10 }}
                      onClick={() =>
                        router.push(`/menu?store=${encodeURIComponent(sid)}`)
                      }
                    >
                      매장 주문하기
                    </button>
                  </article>
                );
              })}
            </div>
          )}
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

const walletItemStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: 12,
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

const actionBtnStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #111827",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
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
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <MePageInner />
    </Suspense>
  );
}
