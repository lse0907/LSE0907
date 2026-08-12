"use client";

import type { RefObject } from "react";
import { CustomerSheet } from "./CustomerSheet";

export function CustomerQrScannerSheet({
  videoRef,
  scanning,
  error,
  onRetry,
  onClose,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  scanning: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <CustomerSheet title="QR 주문" onClose={onClose} closeLabel="QR 스캔 닫기">
      <div className="customerQrScanner">
        <p className="customerQrLabel">QR SCAN</p>
        <p className="customerQrGuide">매장 QR을 화면 안에 맞춰 주세요.</p>
        <div className="customerQrVideoFrame">
          <video ref={videoRef} muted playsInline />
          <span className="customerQrTarget" aria-hidden="true" />
        </div>
        {error ? (
          <div className="customerQrError" role="alert">
            <strong>QR 스캔을 확인해 주세요.</strong>
            <p>{error}</p>
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        ) : (
          <p className="customerQrStatus" role="status">
            {scanning
              ? "카메라가 QR을 자동으로 인식해요."
              : "카메라를 준비하고 있어요."}
          </p>
        )}
      </div>
      <style jsx>{`
        .customerQrScanner {
          display: grid;
          gap: 10px;
        }
        .customerQrLabel {
          margin: 0;
          color: #315fba;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.15em;
        }
        .customerQrGuide,
        .customerQrStatus {
          margin: 0;
          color: #667085;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.55;
        }
        .customerQrVideoFrame {
          position: relative;
          width: min(100%, 430px);
          max-height: 64dvh;
          margin: 2px auto 0;
          overflow: hidden;
          border-radius: 18px;
          background: #05070a;
          aspect-ratio: 3/4;
        }
        .customerQrVideoFrame video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .customerQrTarget {
          position: absolute;
          inset: 23%;
          border: 3px solid rgba(255, 255, 255, 0.94);
          border-radius: 18px;
          box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.3);
        }
        .customerQrError {
          padding: 14px;
          border: 1px solid #f0d5a8;
          border-radius: 14px;
          background: #fffaf1;
        }
        .customerQrError strong {
          color: #0f1f3d;
          font-size: 14px;
          font-weight: 750;
        }
        .customerQrError p {
          margin: 6px 0 0;
          color: #667085;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.55;
          white-space: pre-line;
        }
        .customerQrError button {
          width: 100%;
          min-height: 46px;
          margin-top: 12px;
          border: 1px solid #0f1f3d;
          border-radius: 13px;
          background: #0f1f3d;
          color: #fff;
          font-weight: 700;
        }
        @media (max-width: 380px) {
          .customerQrVideoFrame {
            max-height: 58dvh;
          }
        }
      `}</style>
    </CustomerSheet>
  );
}
