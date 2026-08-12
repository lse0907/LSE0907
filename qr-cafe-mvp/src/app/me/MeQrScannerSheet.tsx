"use client";
import type { RefObject } from "react";
import { CustomerQrScannerSheet } from "../_components/CustomerQrScannerSheet";
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
    <CustomerQrScannerSheet
      {...{ videoRef, scanning, error, onRetry, onClose }}
    />
  );
}
