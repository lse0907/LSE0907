"use client";

import { useEffect, useRef, useState } from "react";
import { setInstallPrompt, type InstallPromptEvent } from "./pwaInstallPrompt";

export function PwaRuntime() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const updateRequestedRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPrompt(null);
    const onControllerChange = () => {
      if (updateRequestedRef.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(worker);
          });
        });
      })
      .catch((error: unknown) => console.error("[PWA] 서비스 워커 등록 실패", error));
    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!waitingWorker) return null;
  const activateUpdate = () => {
    updateRequestedRef.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <aside className="pwaUpdateNotice" role="status" aria-live="polite">
      <span>새 버전이 준비되었습니다.</span>
      <button type="button" onClick={activateUpdate}>업데이트</button>
      <style jsx>{`
        .pwaUpdateNotice { position: fixed; z-index: 10000; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid #dbe3ee; border-radius: 14px; background: #fff; color: #0f1f3d; box-shadow: 0 14px 36px rgba(15,31,61,.2); font-size: 14px; font-weight: 700; }
        button { min-height: 38px; padding: 0 14px; border: 0; border-radius: 10px; background: #0f1f3d; color: #fff; font: inherit; cursor: pointer; }
      `}</style>
    </aside>
  );
}
