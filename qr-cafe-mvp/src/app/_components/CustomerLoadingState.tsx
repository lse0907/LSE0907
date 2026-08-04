"use client";

import Image from "next/image";

type Props = {
  title?: string;
  description?: string;
  fullPage?: boolean;
};

export function CustomerLoadingState({
  title = "매장 정보를 확인하고 있어요",
  description = "잠시만 기다리면 주문을 시작할 수 있어요.",
  fullPage = true,
}: Props) {
  return (
    <div
      className={fullPage ? "loadingState fullPage" : "loadingState"}
      role="status"
      aria-live="polite"
    >
      <div className="loadingCard">
        <Image
          src="/rion-logo-deepnavy.png"
          width={120}
          height={34}
          alt="RION Order"
          priority
        />
        <div className="dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <style jsx>{`
        .loadingState {
          display: grid;
          place-items: center;
          padding: 24px 16px;
          color: #0f1f3d;
          background: #f3f5f8;
        }
        .fullPage {
          min-height: 100dvh;
          padding-top: calc(24px + env(safe-area-inset-top));
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
        }
        .loadingCard {
          width: min(440px, 100%);
          padding: 32px 22px;
          border: 1px solid #dfe4eb;
          border-radius: 24px;
          background: #fff;
          box-shadow: 0 20px 55px rgba(15, 31, 61, 0.1);
          text-align: center;
        }
        .loadingCard :global(img) {
          width: auto;
          height: 27px;
          object-fit: contain;
        }
        h1 {
          margin: 18px 0 0;
          font-size: 20px;
          letter-spacing: -0.03em;
        }
        p {
          margin: 8px 0 0;
          color: #667085;
          font-size: 14px;
          font-weight: 650;
          line-height: 1.6;
        }
        .dots {
          display: flex;
          justify-content: center;
          gap: 6px;
          margin-top: 22px;
        }
        .dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #0f1f3d;
          animation: pulse 1.25s ease-in-out infinite;
        }
        .dots span:nth-child(2) {
          animation-delay: 0.15s;
        }
        .dots span:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes pulse {
          0%,
          100% {
            opacity: 0.25;
            transform: translateY(0);
          }
          50% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .dots span {
            animation: none;
            opacity: 0.65;
          }
        }
      `}</style>
    </div>
  );
}

export function StoreAccessError({
  message,
  onRetry,
  onScan,
}: {
  message?: string;
  onRetry?: () => void;
  onScan?: () => void;
}) {
  return (
    <main className="errorPage">
      <section>
        <Image
          src="/rion-logo-deepnavy.png"
          width={120}
          height={34}
          alt="RION Order"
        />
        <h1>매장 정보를 확인할 수 없어요</h1>
        <p>{message || "QR이 올바른지 확인한 뒤 다시 시도해 주세요."}</p>
        <div>
          {onRetry ? <button onClick={onRetry}>다시 시도</button> : null}
          {onScan ? (
            <button className="secondary" onClick={onScan}>
              QR 다시 스캔하기
            </button>
          ) : null}
        </div>
      </section>
      <style jsx>{`
        .errorPage {
          min-height: 100dvh;
          display: grid;
          place-items: center;
          padding: 24px 16px;
          background: #f3f5f8;
          color: #0f1f3d;
        }
        .errorPage section {
          width: min(440px, 100%);
          padding: 28px 22px;
          border: 1px solid #dfe4eb;
          border-radius: 24px;
          background: #fff;
          text-align: center;
          box-shadow: 0 20px 55px rgba(15, 31, 61, 0.1);
        }
        section :global(img) {
          width: auto;
          height: 27px;
        }
        h1 {
          margin: 22px 0 0;
          font-size: 22px;
        }
        p {
          color: #667085;
          line-height: 1.6;
        }
        section div {
          display: grid;
          gap: 8px;
          margin-top: 20px;
        }
        button {
          min-height: 48px;
          border: 1px solid #0f1f3d;
          border-radius: 13px;
          background: #0f1f3d;
          color: #fff;
          font-weight: 900;
        }
        .secondary {
          background: #fff;
          color: #0f1f3d;
        }
      `}</style>
    </main>
  );
}
