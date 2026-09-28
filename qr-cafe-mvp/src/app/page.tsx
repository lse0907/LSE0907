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
import {
  CustomerLoadingState,
  StoreAccessError,
} from "./_components/CustomerLoadingState";
import { CustomerIcon } from "./_components/CustomerIcon";
import { CustomerQrScannerSheet } from "./_components/CustomerQrScannerSheet";
import { NeutralPwaHome } from "./_components/NeutralPwaHome";
import {
  EMPTY_VIEWER_ACCESS,
  resolveViewerAccess,
  type ViewerAccess,
} from "./lib/viewerAccess";
import { resolveQrScanTarget, waitForQrScannerVideo } from "./lib/qrScanTarget";

const orderHiddenKey = (storeId: string) => `qrCafeOrderHidden:${storeId}`; // ✅ ready 확인 후 홈에서 숨김

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
  const [storeGuideOpen, setStoreGuideOpen] = useState(false);
  const [viewerAccess, setViewerAccess] = useState<ViewerAccess | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const scanRequestRef = useRef(0);

  useEffect(() => {
    // Hydration is complete here; the remaining state mirrors browser storage.
    setMounted(true);
    if (!storeId) {
      setLastOrderId("");
      setLastOrderToken("");
      setOrderHidden(false);
      return;
    }
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
    const applyUser = async (user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]) => {
      if (!user) {
        if (alive) {
          setAuthUserId(null);
          setViewerAccess(null);
          setAuthLoading(false);
        }
        return;
      }
      const access = await resolveViewerAccess(user).catch(() => EMPTY_VIEWER_ACCESS);
      if (alive) {
        setAuthUserId(user.id);
        setViewerAccess(access);
        setAuthLoading(false);
      }
    };
    (async () => {
      const { data } = await supabase.auth.getUser();
      await applyUser(data.user);
    })();
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        window.setTimeout(() => void applyUser(session?.user || null), 0);
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
    if (!storeId) return;
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
    if (!storeId || !lastOrderId || !lastOrderToken) return;
    router.push(
      `/status?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(
        lastOrderId,
      )}`,
    );
  };

  // ✅ 버튼 표시 조건:
  // - 마운트 완료
  // - lastOrderId 존재
  // - ready 이후 숨김 처리 상태가 아님
  const showStatusButton = mounted && !!lastOrderId && !orderHidden;

  const stopScanner = () => {
    scanRequestRef.current += 1;
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setScanning(false);
    setScannerOpen(false);
  };

  useEffect(() => {
    return () => {
      scannerControlsRef.current?.stop();
    };
  }, []);

  const moveByScannedText = (raw: string) => {
    const target = resolveQrScanTarget(raw, window.location.origin);
    if (!target.ok) {
      setScanError(target.message);
      return;
    }
    stopScanner();
    if (target.isExternalOrigin) {
      window.location.assign(target.href);
      return;
    }
    router.push(target.href);
  };

  const startQrScanner = async () => {
    stopScanner();
    const requestId = scanRequestRef.current;
    setScanError("");
    setScannerOpen(true);

    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setScanError("브라우저 환경에서만 QR 스캔을 사용할 수 있어요.");
      return;
    }
    try {
      const video = await waitForQrScannerVideo(videoRef);
      if (requestId !== scanRequestRef.current) return;
      if (!video) {
        setScanError("카메라 초기화에 실패했어요.");
        return;
      }
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 250,
        delayBetweenScanSuccess: 1000,
      });
      const controls = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        video,
        (result) => {
          if (requestId !== scanRequestRef.current) return;
          const value = result?.getText().trim();
          if (value) moveByScannedText(value);
        },
      );
      if (requestId !== scanRequestRef.current) {
        controls.stop();
        return;
      }
      scannerControlsRef.current = controls;
      setScanning(true);
    } catch {
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      setScanning(false);
      setScanError(
        "카메라 권한이 없거나 기기에서 카메라를 사용할 수 없습니다.",
      );
    }
  };

  if (!isStoreScoped) {
    return (
      <NeutralPwaHome
        access={viewerAccess}
        authLoading={authLoading}
        onScan={() => void startQrScanner()}
        onNavigate={(href) => router.push(href)}
        onLogout={() => void supabase.auth.signOut().then(() => router.replace("/"))}
        scanner={scannerOpen ? (
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
      />
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
          padding: 16px 18px 22px;
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
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 1px solid rgba(255, 255, 255, 0.46);
          background: rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(10px);
          color: #fff;
          font-weight: 750;
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 12px;
          cursor: pointer;
        }
        .topBtn:active { transform: translateY(1px); }

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
          margin-top: 8px;
          padding: 6px 10px;
          border: 1px solid rgba(255, 255, 255, 0.28);
          border-radius: 999px;
          background: rgba(9, 23, 47, 0.32);
          color: rgba(255, 255, 255, 0.94);
          font-weight: 750;
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
          padding: 18px;
          box-shadow: var(--customer-shadow);
          transform: translateY(-18px);
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
        .storeGuide {
          display: grid;
          gap: 4px;
        }
        .storeGuideToggle {
          width: fit-content;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
          color: #31415b;
          font-size: 13px;
          font-weight: 750;
        }
        .storeGuideToggle::after {
          content: "⌄";
          margin-left: 6px;
          color: #63738b;
        }
        .storeGuideToggle[aria-expanded="true"]::after { content: "⌃"; }
        .storeGuide .desc {
          display: -webkit-box;
          overflow: hidden;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
        }
        .storeGuide .descExpanded {
          display: block;
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
              <button
                className="topBtn"
                onClick={() =>
                  router.push(
                    `/me?store=${encodeURIComponent(storeId)}&return_to=${encodeURIComponent(nextUrl)}`,
                  )
                }
              >
                <CustomerIcon name="user" size={15} /> 내 정보
              </button>
            ) : (
              <button
                className="topBtn"
                onClick={() =>
                  router.push(`/login?next=${encodeURIComponent(nextUrl)}`)
                }
              >
                <CustomerIcon name="user" size={15} /> 로그인
              </button>
            )}
          </div>
          <div className="logoRow">
            <div style={{ minWidth: 0 }}>
              <h1 className="storeName">{STORE_NAME}</h1>
              <div className="tag">
                <span className="tagDot" />
                {table ? `테이블 ${table}에서 주문 중` : "포장·카운터 주문"}
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

            {STORE_DESC ? (
              <div className="descDetails">
                <div className="storeGuide">
                  <p className={`desc ${storeGuideOpen ? "descExpanded" : ""}`}>{STORE_DESC}</p>
                  {STORE_DESC.length > 58 ? (
                    <button
                      type="button"
                      className="storeGuideToggle"
                      aria-expanded={storeGuideOpen}
                      onClick={() => setStoreGuideOpen((open) => !open)}
                    >
                      {storeGuideOpen ? "매장 안내 접기" : "매장 안내 보기"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

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
