"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

type WalletRow = {
  store_id: string;
  point_balance: number;
  tier: "general" | "regular" | "vip" | string;
  lifetime_spent: number;
  lifetime_orders: number;
};

type ProfileRow = {
  name: string | null;
  phone: string | null;
};
type BarcodeScanResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<BarcodeScanResult[]>;
};
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function MePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const storeFromQuery = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const returnTo = useMemo(() => String(sp.get("return_to") || sp.get("next") || "").trim(), [sp]);

  const isSafeInternalPath = (v: string) => !!v && v.startsWith("/") && !v.startsWith("//");

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
      setEmail(String(userData.user.email || ""));

      const [profileRes, walletsRes] = await Promise.all([
        supabase.from("customer_profiles").select("name,phone").eq("user_id", uid).maybeSingle(),
        supabase
          .from("customer_store_wallets")
          .select("store_id, point_balance, tier, lifetime_spent, lifetime_orders")
          .eq("customer_user_id", uid)
          .order("updated_at", { ascending: false }),
      ]);

      if (profileRes.error) {
        setMsg(`고객 프로필 조회 실패: ${profileRes.error.message}`);
      } else {
        setProfile((profileRes.data as ProfileRow | null) || null);
      }

      if (walletsRes.error) {
        setMsg((prev) => (prev ? `${prev}\n` : "") + `포인트 지갑 조회 실패: ${walletsRes.error.message}`);
      } else {
        setWallets((walletsRes.data as WalletRow[]) || []);
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
      if (scanIntervalRef.current != null) window.clearInterval(scanIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
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
      router.push(`/menu?store=${encodeURIComponent(sid)}${asUrl.searchParams.get("table") ? `&table=${encodeURIComponent(asUrl.searchParams.get("table") || "")}` : ""}`);
    } catch {
      setScanError("인식된 QR 형식이 올바르지 않습니다.");
    }
  };

  const startQrScanner = async () => {
    setScanError("");
    setScannerOpen(true);

    const detectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!detectorCtor) {
      setScanError("현재 브라우저는 실시간 QR 스캔을 지원하지 않아요. 최신 Chrome/Safari를 사용해 주세요.");
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
      setScanError("카메라 권한이 없거나 기기에서 카메라를 사용할 수 없습니다.");
    }
  };

  const summary = useMemo(() => {
    const totalPoints = wallets.reduce((acc, row) => acc + Math.max(0, Number(row.point_balance || 0)), 0);
    return { totalPoints, stores: wallets.length };
  }, [wallets]);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>회원 정보</h1>
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
          style={secondaryBtnStyle}
        >
          QR 스캔
        </button>
      </div>
      <p style={{ color: "#6b7280", marginTop: 8, fontWeight: 700 }}>
        RION Order 회원 정보와 매장별 포인트를 확인할 수 있어요.
      </p>

      {loading ? <p style={{ marginTop: 14 }}>불러오는 중...</p> : null}
      {msg ? <p style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800, whiteSpace: "pre-wrap" }}>{msg}</p> : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>기본 정보</h2>
          <p><b>이메일:</b> {email || "-"}</p>
          <p><b>이름:</b> {profile?.name || "-"}</p>
          <p><b>전화번호:</b> {profile?.phone || "-"}</p>
        </section>
      ) : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>요약</h2>
          <p><b>전체 포인트:</b> {summary.totalPoints.toLocaleString()}P</p>
          <p><b>혜택 매장 수:</b> {summary.stores}개</p>
        </section>
      ) : null}

      {!loading ? (
        <section style={cardStyle}>
          <h2 style={sectionTitleStyle}>매장별 포인트</h2>
          {wallets.length === 0 ? (
            <p style={{ color: "#6b7280", fontWeight: 700 }}>아직 적립된 포인트가 없어요.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {wallets.map((w) => (
                <article key={w.store_id} style={walletItemStyle}>
                  <p style={{ margin: 0 }}><b>매장 ID:</b> {w.store_id}</p>
                  <p style={{ margin: "6px 0 0" }}><b>등급:</b> {w.tier}</p>
                  <p style={{ margin: "6px 0 0" }}><b>포인트:</b> {Number(w.point_balance || 0).toLocaleString()}P</p>
                  <p style={{ margin: "6px 0 0" }}><b>누적 결제:</b> {Number(w.lifetime_spent || 0).toLocaleString()}원</p>
                  <p style={{ margin: "6px 0 0" }}><b>주문 횟수:</b> {Number(w.lifetime_orders || 0)}회</p>
                  <button
                    type="button"
                    style={{ ...actionBtnStyle, marginTop: 10 }}
                    onClick={() => router.push(`/menu?store=${encodeURIComponent(w.store_id)}`)}
                  >
                    이 매장 주문하기
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 14,
};

const walletItemStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  margin: "0 0 10px",
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
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};

const scanCardStyle: React.CSSProperties = {
  marginTop: 12,
  border: "1px solid #e5e7eb",
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
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <MePageInner />
    </Suspense>
  );
}
      {scannerOpen ? (
        <section style={scanCardStyle}>
          <video ref={videoRef} style={videoStyle} muted playsInline />
          <button type="button" onClick={stopScanner} style={secondaryBtnStyle}>
            {scanning ? "스캔 닫기" : "닫기"}
          </button>
          {scanError ? <p style={{ margin: 0, color: "#b91c1c", fontWeight: 800 }}>{scanError}</p> : null}
        </section>
      ) : null}
