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

const orderHiddenKey = (storeId: string) => `qrCafeOrderHidden:${storeId}`; // ✅ ready 확인 후 홈에서 숨김
type BarcodeScanResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (input: HTMLVideoElement) => Promise<BarcodeScanResult[]>;
};
type BarcodeDetectorCtor = new (opts: {
  formats: string[];
}) => BarcodeDetectorLike;

function HomeStartInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const rawStoreId = useMemo(() => (sp.get("store") || "").trim(), [sp]);
  const isStoreScoped = !!rawStoreId;
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);
  const { profile } = useStoreProfile(storeId);

  // ✅ hydration mismatch 방지 + localStorage 안전 처리
  const [mounted, setMounted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastOrderToken, setLastOrderToken] = useState<string>("");
  const [orderHidden, setOrderHidden] = useState<boolean>(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [scanError, setScanError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
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
    (async () => {
      const { data } = await supabase.auth.getUser();
      setAuthUserId(data?.user?.id || null);
    })();
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
  const fallbackOverlay = `linear-gradient(
    to bottom,
    rgba(0,0,0,0.30) 0%,
    rgba(0,0,0,0.48) 55%,
    rgba(0,0,0,0.70) 100%
  )`;

  // ✅ 마운트 후에만 profile 기반 오버레이 계산
  const overlayBg = useMemo(() => {
    if (!mounted) return fallbackOverlay;

    const strength = Math.max(
      0,
      Math.min(100, Number(profile.mainImageOverlayStrength ?? 55)),
    );
    const aTop = 0.1 + 0.35 * (strength / 100); // 0.10 ~ 0.45
    const aMid = 0.18 + 0.45 * (strength / 100); // 0.18 ~ 0.63
    const aBot = 0.25 + 0.6 * (strength / 100); // 0.25 ~ 0.85

    return `linear-gradient(
      to bottom,
      rgba(0,0,0,${aTop}) 0%,
      rgba(0,0,0,${aMid}) 55%,
      rgba(0,0,0,${aBot}) 100%
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
              #2d3748 0%,
              #111827 45%,
              #0b1220 100%
            );
            color: #fff;
            padding: 20px;
          }
          .card {
            width: min(560px, 100%);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(6px);
            padding: 20px;
            display: grid;
            gap: 14px;
          }
          .title {
            font-size: 28px;
            font-weight: 900;
          }
          .sub {
            color: rgba(255, 255, 255, 0.9);
            line-height: 1.6;
            font-weight: 700;
          }
          .btnPrimary {
            border: 0;
            border-radius: 14px;
            padding: 14px;
            background: #fff;
            color: #111827;
            font-weight: 900;
            cursor: pointer;
          }
          .btnGhost {
            border: 1px solid rgba(255, 255, 255, 0.4);
            border-radius: 14px;
            padding: 12px;
            background: transparent;
            color: #fff;
            font-weight: 800;
            cursor: pointer;
          }
          .scanPane {
            margin-top: 8px;
            border-radius: 14px;
            border: 1px solid rgba(255, 255, 255, 0.35);
            background: rgba(17, 24, 39, 0.75);
            padding: 10px;
            display: grid;
            gap: 8px;
          }
          .video {
            width: 100%;
            border-radius: 10px;
            background: #000;
            aspect-ratio: 3 / 4;
            object-fit: cover;
          }
          .err {
            color: #fecaca;
            font-weight: 800;
            font-size: 13px;
            white-space: pre-line;
          }
        `}</style>
        <section className="card">
          <p
            style={{
              margin: 0,
              fontWeight: 800,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            RION Labs
          </p>
          <h1 className="title">RION Order</h1>
          <p className="sub">매장 QR을 스캔해 바로 주문을 시작하세요.</p>
          <button className="btnPrimary" onClick={startQrScanner}>
            QR 스캔 시작
          </button>
          {scannerOpen ? (
            <div className="scanPane">
              <video ref={videoRef} className="video" muted playsInline />
              <button className="btnGhost" onClick={stopScanner}>
                {scanning ? "스캔 닫기" : "닫기"}
              </button>
            </div>
          ) : null}
          {scanError ? <p className="err">{scanError}</p> : null}
          <button
            className="btnGhost"
            onClick={() => router.push("/login?next=%2Fme")}
          >
            로그인
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
          --radius: 16px;
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
          background: linear-gradient(135deg, #111827 0%, #374151 100%);
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
          max-width: 560px;
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
          font-weight: 900;
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
          font-weight: 950;
          font-size: 26px;
          letter-spacing: -0.02em;
          line-height: 1.15;
        }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 2px;
          color: rgba(255, 255, 255, 0.85);
          font-weight: 850;
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
          padding: 16px;
          display: grid;
          align-content: start;
        }

        .card {
          max-width: 560px;
          margin: 0 auto;
          width: 100%;
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          transform: translateY(-14px);
        }

        .desc {
          white-space: pre-line;
          margin: 0;
          color: var(--text);
          font-size: 15px;
          line-height: 1.55;
          font-weight: 750;
        }

        .ctaRow {
          margin-top: 14px;
          display: grid;
          gap: 10px;
        }

        .btnPrimary {
          width: 100%;
          border: 0;
          border-radius: 14px;
          padding: 16px 14px;
          background: var(--brand);
          color: #fff;
          font-weight: 950;
          font-size: 16px;
          cursor: pointer;
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
          font-weight: 900;
          cursor: pointer;
          color: var(--text);
        }
        .btnGhost:active {
          transform: translateY(1px);
        }
        .descDetails {
          border: 1px dashed var(--line);
          border-radius: 12px;
          padding: 10px 12px;
          background: #fafafa;
          display: grid;
          gap: 6px;
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
                  내정보
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
                {table ? `테이블 ${table} 주문` : "카운터 주문"}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="content">
        <div className="card">
          <div className="ctaRow">
            <button className="btnPrimary" onClick={onStart}>
              주문하기
            </button>

            <div className="descDetails">
              <p className="desc">{STORE_DESC}</p>
            </div>

            {/* ✅ “주문 상태 확인” 버튼은 조건부로만 표시(ready 이후 숨김 포함) */}
            {showStatusButton ? (
              <button className="btnGhost" onClick={onStatus}>
                주문 상태 확인
              </button>
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
    <Suspense fallback={<div style={{ padding: 16 }}>로딩중…</div>}>
      <HomeStartInner />
    </Suspense>
  );
}
