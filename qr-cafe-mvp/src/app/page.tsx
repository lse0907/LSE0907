// src/app/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStoreProfile } from "./lib/storeProfile";
import { getStoreIdFromSearchParams, lsLastOrderIdKey } from "./lib/storeScope";

const orderHiddenKey = (storeId: string) => `qrCafeOrderHidden:${storeId}`; // ✅ ready 확인 후 홈에서 숨김

function HomeStartInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);
  const { profile } = useStoreProfile(storeId);

  // ✅ hydration mismatch 방지 + localStorage 안전 처리
  const [mounted, setMounted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [orderHidden, setOrderHidden] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    try {
      const lastOrderKey = lsLastOrderIdKey(storeId);
      const v = (localStorage.getItem(lastOrderKey) || "").trim();
      setLastOrderId(v);

      const hidden = (localStorage.getItem(orderHiddenKey(storeId)) || "").trim();
      setOrderHidden(hidden === "true");
    } catch {
      setLastOrderId("");
      setOrderHidden(false);
    }
  }, [storeId]);

  // 테이블 QR이면 /?table=3
  const table = useMemo(() => (sp.get("table") || "").trim(), [sp]);

  const STORE_NAME = profile.storeName;
  const STORE_DESC = profile.storeDesc;
  const HERO_IMAGE = profile.mainImage;
  const LOGO_IMAGE = profile.logoImage;

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

    const strength = Math.max(0, Math.min(100, Number(profile.mainImageOverlayStrength ?? 55)));
    const aTop = 0.10 + 0.35 * (strength / 100); // 0.10 ~ 0.45
    const aMid = 0.18 + 0.45 * (strength / 100); // 0.18 ~ 0.63
    const aBot = 0.25 + 0.60 * (strength / 100); // 0.25 ~ 0.85

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
      `/status?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(lastOrderId)}`
    );
  };

  // ✅ 버튼 표시 조건:
  // - 마운트 완료
  // - lastOrderId 존재
  // - ready 이후 숨김 처리 상태가 아님
  const showStatusButton = mounted && !!lastOrderId && !orderHidden;

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
        .summary {
          font-size: 14px;
          font-weight: 800;
          color: var(--text);
        }
        .descDetails {
          border: 1px dashed var(--line);
          border-radius: 12px;
          padding: 10px 12px;
          background: #fafafa;
        }
        .descDetails summary {
          font-weight: 900;
          font-size: 13px;
          color: var(--muted);
          cursor: pointer;
        }
        .descDetails[open] summary {
          margin-bottom: 6px;
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
          <img className="heroImg" src={HERO_IMAGE} alt="store hero" />
        ) : null}

        {/* ✅ hydration-safe */}
        <div className="overlay" style={{ background: overlayBg }} />

        <div className="heroInner">
          <div className="logoRow">
            {LOGO_IMAGE ? (
              <div className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LOGO_IMAGE} alt="logo" />
              </div>
            ) : (
              <div className="logo" aria-hidden="true">
                <span style={{ color: "white", fontWeight: 950 }}>QR</span>
              </div>
            )}

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

            <div className="summary">{STORE_DESC.split("\n")[0]}</div>

            <details className="descDetails">
              <summary>매장 소개</summary>
              <p className="desc">{STORE_DESC}</p>
            </details>

            {/* ✅ “주문 상태 확인” 버튼은 조건부로만 표시(ready 이후 숨김 포함) */}
            {showStatusButton ? (
              <button className="btnGhost" onClick={onStatus}>
                주문 상태 확인
              </button>
            ) : null}
          </div>
        </div>
      </section>
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
