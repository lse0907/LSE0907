"use client";
import type { RefObject } from "react";
import { CustomerSheet } from "../_components/CustomerSheet";
export function MeQrScannerSheet({
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
      <div className="qrScanner">
        <p className="sectionLabel">QR SCAN</p>
        <p className="qrScannerGuide">매장 QR을 화면 안에 맞춰주세요.</p>
        <div className="qrVideoFrame">
          <video ref={videoRef} muted playsInline />
          <span className="qrTarget" aria-hidden="true" />
        </div>
        {error ? (
          <div className="qrScannerError" role="alert">
            <strong>QR 스캔을 확인해 주세요.</strong>
            <p>{error}</p>
            <button type="button" className="sheetAction" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        ) : (
          <p className="qrScannerStatus" role="status">
            {scanning
              ? "카메라가 QR을 자동으로 인식해요."
              : "카메라를 준비하고 있어요."}
          </p>
        )}
      </div>
    </CustomerSheet>
  );
}
