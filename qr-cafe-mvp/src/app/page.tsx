// src/app/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStoreProfile } from "./lib/storeProfile";
import {
  getStoreIdFromSearchParams,
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
} from "./lib/storeScope";
import { supabase } from "./lib/supabaseClient";
import { CustomerTrustFooter } from "./_components/StoreCustomerBrand";
import { CustomerBrand } from "./_components/CustomerBrand";
import {
  CustomerLoadingState,
  StoreAccessError,
} from "./_components/CustomerLoadingState";
import { CustomerIcon } from "./_components/CustomerIcon";
import { CustomerQrScannerSheet } from "./_components/CustomerQrScannerSheet";

const orderHiddenKey = (storeId: string) => `qrCafeOrderHidden:${storeId}`; // ✅ ready 확인 후 홈에서 숨김
type BarcodeScanResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<BarcodeScanResult[]>;
};
type BarcodeDetectorCtor = new (opts: {
  formats: string[];
}) => BarcodeDetectorLike;

const FALLBACK_OVERLAY = `linear-gradient(
  to bottom,
  rgba(8,22,45,0.30) 0%,
  rgba(8,22,45,0.52) 55%,
  rgba(8,22,45,0.78) 100%
)`;

function HomeStartInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const rawStoreId = useMemo(() => (sp.get("store") || "").trim(), [sp]);
  const isStoreScoped = !!rawStoreId;
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);
  const {
    profile,
    loading: profileLoading,
    loadError,
    refresh,
  } = useStoreProfile(storeId);

  // ✅ hydration mismatch 방지 + localStorage 안전 처리
  const [mounted, setMounted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastOrderToken, setLastOrderToken] = useState<string>("");
  const [orderHidden, setOrderHidden] = useState<boolean>(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Hydration is complete here; the remaining state mirrors browser storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    try {
      const lastOrderKey = lsLastOrderIdKey(storeId);
      const v = (localStorage.getItem(lastOrderKey) || "").trim();
      setLastOrderId(v);
      const token = (
        localStorage.getItem(lsLastOrderTokenKey(storeId)) || ""
      ).trim();
      setLastOrderToken(token);

      const hidden = (
        localStorage.getItem(orderHiddenKey(storeId)) || ""
      ).trim();
      setOrderHidden(hidden === "true");
    } catch {
      setLastOrderId("");
      setOrderHidden(false);
    }
  }, [storeId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (alive) {
        setAuthUserId(data?.user?.id || null);
        setAuthLoading(false);
      }
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAuthUserId(session?.user?.id || null);
        setAuthLoading(false);
      },
    );
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // 테이블 QR이면 /?table=3
  const table = useMemo(() => (sp.get("table") || "").trim(), [sp]);
  const nextUrl = useMemo(() => {
    const q = sp.toString();
    return q ? `/?${q}` : "/";
  }, [sp]);

  const STORE_NAME = profile.storeName;
  const STORE_DESC = profile.storeDesc;
  const HERO_IMAGE = profile.mainImage;

  // ✅ 서버/첫 렌더에서는 고정값(항상 동일) 사용
  // ✅ 마운트 후에만 profile 기반 오버레이 계산
  const overlayBg = useMemo(() => {
    if (!mounted) return FALLBACK_OVERLAY;

    const strength = Math.max(
      0,
      Math.min(100, Number(profile.mainImageOverlayStrength ?? 55)),
    );
    const aTop = 0.1 + 0.35 * (strength / 100); // 0.10 ~ 0.45
    const aMid = 0.18 + 0.45 * (strength / 100); // 0.18 ~ 0.63
    const aBot = 0.25 + 0.6 * (strength / 100); // 0.25 ~ 0.85

    return `linear-gradient(
      to bottom,
      rgba(8,22,45,${aTop}) 0%,
      rgba(8,22,45,${aMid}) 55%,
      rgba(8,22,45,${aBot}) 100%
    )`;
  }, [mounted, profile.mainImageOverlayStrength]);

  const onStart = () => {
    // ✅ 새 주문 시작이므로 “숨김” 해제 (다음 주문은 상태 버튼이 다시 뜨게)
    try {
      localStorage.removeItem(orderHiddenKey(storeId));
      setOrderHidden(false);
    } catch {}

    const qs = new URLSearchParams();
    qs.set("store", storeId);
    if (table) qs.set("table", table);
    const suffix = qs.toString();
    router.push(suffix ? `/menu?${suffix}` : "/menu");
  };

  const onStatus = () => {
    if (!lastOrderId) return;
    router.push(
      `/status?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(
        lastOrderId,
      )}&accessToken=${encodeURIComponent(lastOrderToken)}`,
    );
  };

  // ✅ 버튼 표시 조건:
  // - 마운트 완료
  // - lastOrderId 존재
  // - ready 이후 숨김 처리 상태가 아님
  const showStatusButton = mounted && !!lastOrderId && !orderHidden;

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
      if (scanIntervalRef.current != null) {
        window.clearInterval(scanIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
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
      router.push(`${asUrl.pathname}${asUrl.search}`);
    } catch {
      setScanError("인식된 QR 형식이 올바르지 않습니다.");
    }
  };

  const startQrScanner = async () => {
    setScanError("");
    setScannerOpen(true);

    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setScanError("브라우저 환경에서만 QR 스캔을 사용할 수 있어요.");
      return;
    }
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
          // ignore and continue scanning
        }
      }, 500);
    } catch {
      setScanError(
        "카메라 권한이 없거나 기기에서 카메라를 사용할 수 없습니다.",
      );
    }
  };

  if (!isStoreScoped) {
    return (
      <main className="wrap">
        <style jsx>{`
          .wrap {
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: radial-gradient(
              circle at 20% 10%,
              #1d4b8f 0%,
              #132d59 42%,
              #0c1b35 100%
            );
            color: #fff;
            padding: 20px;
          }
          .card {
            width: min(560px, 100%);
            border-radius: 26px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            background: rgba(255, 255, 255, 0.09);
            backdrop-filter: blur(14px);
            padding: 32px 24px;
            display: grid;
            gap: 14px;
          }
          .title {
            margin: 12px 0 0;
            font-size: clamp(30px, 8vw, 44px);
            font-weight: 850;
            line-height: 1.12;
            letter-spacing: -0.045em;
          }
          .sub {
            color: rgba(255, 255, 255, 0.9);
            line-height: 1.6;
            font-weight: 500;
          }
          .btnPrimary {
            border: 0;
            border-radius: 14px;
            min-height: 56px;
            padding: 14px;
            background: #fff;
            color: #0f1f3d;
            font-weight: 750;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 9px;
          }
          .btnGhost {
            border: 1px solid rgba(255, 255, 255, 0.4);
            border-radius: 14px;
            padding: 12px;
            background: transparent;
            color: #fff;
            font-weight: 650;
            cursor: pointer;
          }
          .err {
            padding: 12px 14px;
            border-radius: 14px;
            background: rgba(190, 18, 60, 0.18);
            color: #ffe4e6;
            font-weight: 600;
            font-size: 13px;
            white-space: pre-line;
          }
        `}</style>
        <section className="card">
          <CustomerBrand inverse />
          <h1 className="title">QR로 주문을 시작하세요</h1>
          <p className="sub">
            테이블이나 카운터의 QR을 스캔하면 해당 매장의 주문 화면으로
            연결됩니다.
          </p>
          <button className="btnPrimary" onClick={startQrScanner}>
            <CustomerIcon name="qr" size={21} /> QR 스캔하고 주문하기
          </button>
          {scannerOpen ? (
            <CustomerQrScannerSheet
              videoRef={videoRef}
              scanning={scanning}
              error={scanError}
              onRetry={() => {
                stopScanner();
                void startQrScanner();
              }}
              onClose={stopScanner}
            />
          ) : null}
          {!authLoading ? (
            authUserId ? (
              <button className="btnGhost" onClick={() => router.push("/me")}>
                내 주문과 혜택
              </button>
            ) : (
              <button
                className="btnGhost"
                onClick={() => router.push("/login?next=%2Fme")}
              >
                로그인
              </button>
            )
          ) : (
            <div style={{ minHeight: 44 }} aria-hidden />
          )}
        </section>
      </main>
    );
  }

  if (profileLoading) return <CustomerLoadingState />;
  if (loadError || !profile.storeName)
    return (
      <StoreAccessError
        message={loadError || "등록된 매장을 찾을 수 없어요."}
        onRetry={refresh}
        onScan={() => router.push("/")}
      />
    );

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          --bg: #f3f5f8;
          --card: #ffffff;
          --text: #14213a;
          --muted: #667085;
          --line: #dfe4eb;
          --brand: #0f1f3d;
          --radius: 22px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          min-height: 100vh;
          display: grid;
          grid-template-rows: auto 1fr;
        }

        .hero {
          position: relative;
          height: 48vh;
          min-height: 330px;
          max-height: 520px;
          overflow: hidden;
          background: linear-gradient(
            125deg,
            #0c1b35 0%,
            #132d59 60%,
            #1d4b8f 100%
          );
        }

        .heroImg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .overlay {
          position: absolute;
          inset: 0;
        }

        .heroInner {
          position: relative;
          height: 100%;
          display: grid;
          align-content: end;
          gap: 10px;
          padding: 18px;
          max-width: 680px;
          margin: 0 auto;
        }
        .topActions {
          position: absolute;
          top: 12px;
          right: 12px;
          display: flex;
          gap: 8px;
          z-index: 3;
        }
        .topBtn {
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(17, 24, 39, 0.5);
          color: #fff;
          font-weight: 650;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          cursor: pointer;
        }

        .logoRow {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .logo {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.22);
          display: grid;
          place-items: center;
          overflow: hidden;
          flex: 0 0 auto;
        }

        .logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .storeName {
          margin: 0;
          color: #fff;
          font-weight: 850;
          font-size: clamp(28px, 7vw, 40px);
          letter-spacing: -0.045em;
          line-height: 1.15;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 2px;
          color: rgba(255, 255, 255, 0.85);
          font-weight: 650;
          font-size: 13px;
        }

        .tagDot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.85);
          display: inline-block;
        }

        .content {
          padding: 16px 16px 4px;
          display: grid;
          align-content: start;
        }

        .card {
          max-width: 680px;
          margin: 0 auto;
          width: 100%;
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 22px;
          box-shadow: var(--customer-shadow);
          transform: translateY(-22px);
        }

        .desc {
          white-space: pre-line;
          margin: 0;
          color: var(--text);
          font-size: 15px;
          line-height: 1.55;
          font-weight: 500;
          line-height: 1.65;
        }

        .ctaRow {
          margin-top: 0;
          display: grid;
          gap: 10px;
        }

        .btnPrimary {
          width: 100%;
          border: 0;
          border-radius: 14px;
          min-height: 56px;
          padding: 14px;
          background: var(--brand);
          color: #fff;
          font-weight: 750;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          box-shadow: 0 10px 24px rgba(15, 31, 61, 0.2);
        }
        .btnPrimary:active {
          transform: translateY(1px);
        }

        /* ✅ 주문 상태 확인(보조 버튼) */
        .btnGhost {
          width: 100%;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px 14px;
          background: #fff;
          min-height: 50px;
          font-weight: 700;
          cursor: pointer;
          color: var(--text);
        }
        .btnGhost:active {
          transform: translateY(1px);
        }
        .descDetails {
          border: 0;
          border-radius: 14px;
          padding: 14px;
          background: #f4f7fb;
          display: grid;
          gap: 6px;
        }
        .statusIntro {
          margin: 4px 0 -2px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
          text-align: center;
        }
        @media (max-width: 480px) {
          .hero {
            height: 46vh;
            min-height: 310px;
          }
          .storeName {
            font-size: 24px;
          }
          .desc {
            font-size: 14px;
          }
        }
      `}</style>

      <section className="hero">
        {HERO_IMAGE ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="heroImg"
            src={HERO_IMAGE}
            alt={`${STORE_NAME} 대표 이미지`}
          />
        ) : null}

        {/* ✅ hydration-safe */}
        <div className="overlay" style={{ background: overlayBg }} />

        <div className="heroInner">
          <div className="topActions">
            {authUserId ? (
              <>
                <button
                  className="topBtn"
                  onClick={() =>
                    router.push(
                      `/me?store=${encodeURIComponent(storeId)}&return_to=${encodeURIComponent(nextUrl)}`,
                    )
                  }
                >
                  내 정보
                </button>
                <button
                  className="topBtn"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setAuthUserId(null);
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button
                  className="topBtn"
                  onClick={() =>
                    router.push(`/login?next=${encodeURIComponent(nextUrl)}`)
                  }
                >
                  로그인
                </button>
                <button
                  className="topBtn"
                  onClick={() =>
                    router.push(`/signup?next=${encodeURIComponent(nextUrl)}`)
                  }
                >
                  회원가입
                </button>
              </>
            )}
          </div>
          <div className="logoRow">
            <div style={{ minWidth: 0 }}>
              <h1 className="storeName">{STORE_NAME}</h1>
              <div className="tag">
                <span className="tagDot" />
                {table ? `매장 이용 · 테이블 ${table}` : "매장 주문"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="content">
        <div className="card">
          <div className="ctaRow">
            <button className="btnPrimary" onClick={onStart}>
              <CustomerIcon name="orders" size={21} /> 주문 시작하기
            </button>

            <div className="descDetails">
              <p className="desc">{STORE_DESC}</p>
            </div>

            {/* ✅ “주문 상태 확인” 버튼은 조건부로만 표시(ready 이후 숨김 포함) */}
            {showStatusButton ? (
              <>
                <p className="statusIntro">
                  최근 주문의 준비 상태를 확인할 수 있어요.
                </p>
                <button className="btnGhost" onClick={onStatus}>
                  주문 상태 확인하기
                </button>
              </>
            ) : null}
          </div>
        </div>
      </section>
      <CustomerTrustFooter />
    </main>
  );
}

export default function HomeStartPage() {
  return (
    <Suspense
      fallback={
        <CustomerLoadingState
          title="주문 화면을 준비하고 있어요"
          description="매장 정보를 안전하게 불러오고 있어요."
        />
      }
    >
      <HomeStartInner />
    </Suspense>
  );
}
