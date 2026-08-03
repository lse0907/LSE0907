"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { CustomerPageHeader } from "../_components/CustomerBrand";

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
  const [showStores, setShowStores] = useState(false);
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
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const storeFromQuery = useMemo(
    () => String(sp.get("store") || "").trim(),
    [sp],
  );
  const returnTo = useMemo(
    () => String(sp.get("return_to") || sp.get("next") || "").trim(),
    [sp],
  );

  const isSafeInternalPath = (v: string) =>
    !!v && v.startsWith("/") && !v.startsWith("//");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setIsDark(!!e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

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
        `/menu?store=${encodeURIComponent(sid)}${asUrl.searchParams.get("table") ? `&table=${encodeURIComponent(asUrl.searchParams.get("table") || "")}` : ""}`,
      );
    } catch {
      setScanError("인식된 QR 형식이 올바르지 않습니다.");
    }
  };

  const startQrScanner = async () => {
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

  const theme = useMemo(() => {
    if (isDark) {
      return {
        textSubtle: "#cbd5e1",
        cardBg: "#111827",
        cardBorder: "#374151",
        cardText: "#f3f4f6",
        itemBg: "#0f172a",
        itemBorder: "#334155",
        btnSecondaryBg: "#1f2937",
        btnSecondaryBorder: "#374151",
        btnSecondaryText: "#f9fafb",
        inputBg: "#0b1220",
        inputText: "#e5e7eb",
        accent: "#93c5fd",
      };
    }
    return {
      textSubtle: "#6b7280",
      cardBg: "#ffffff",
      cardBorder: "#e5e7eb",
      cardText: "#111827",
      itemBg: "#ffffff",
      itemBorder: "#e5e7eb",
      btnSecondaryBg: "#ffffff",
      btnSecondaryBorder: "#d1d5db",
      btnSecondaryText: "#111827",
      inputBg: "#ffffff",
      inputText: "#111827",
      accent: "#2563eb",
    };
  }, [isDark]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <CustomerPageHeader
          title={
            profile?.name ? `${profile.name}님의 RION` : "나의 주문과 혜택"
          }
          description="포인트와 쿠폰, 자주 이용하는 매장을 한곳에서 확인하세요."
          context={`${wallets.length}개 매장 · 쿠폰 ${summary.totalCoupons}장`}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            marginLeft: "auto",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (isSafeInternalPath(returnTo)) {
                router.push(returnTo);
                return;
              }
              const sid = storeFromQuery || wallets[0]?.store_id || "";
              if (!sid) {
                router.push("/");
                return;
              }
              router.push(`/menu?store=${encodeURIComponent(sid)}`);
            }}
            style={actionBtnStyle}
          >
            주문화면
          </button>
          <button
            type="button"
            onClick={startQrScanner}
            style={{
              ...secondaryBtnStyle,
              border: `1px solid ${theme.btnSecondaryBorder}`,
              background: theme.btnSecondaryBg,
              color: theme.btnSecondaryText,
            }}
          >
            <span aria-hidden>⌁</span> QR 스캔
          </button>
        </div>
      </div>
      <p style={{ color: theme.textSubtle, marginTop: 8, fontWeight: 700 }}>
        RION Order 내 정보와 매장별 포인트/쿠폰 혜택을 확인할 수 있어요.
      </p>

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
            border: `1px solid ${theme.cardBorder}`,
            background: theme.cardBg,
            color: theme.cardText,
          }}
        >
          <h2 style={sectionTitleStyle}>혜택 요약</h2>
          <p>
            <b>전체 매장 수:</b> {summary.stores}개
          </p>
          <p>
            <b>전체 포인트:</b> {summary.totalPoints.toLocaleString()}P
          </p>
          <p>
            <b>전체 보유쿠폰:</b> {summary.totalCoupons}장
          </p>
          <button
            type="button"
            style={{ ...actionBtnStyle, marginTop: 10 }}
            onClick={() => setShowStores((p) => !p)}
          >
            {showStores ? "내 매장 접기" : "내 매장 보기"}
          </button>
        </section>
      ) : null}

      {!loading && showStores ? (
        <section
          style={{
            ...cardStyle,
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
