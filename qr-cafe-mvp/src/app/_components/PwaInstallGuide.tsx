"use client";

import { useEffect, useState } from "react";
import {
  getInstallPrompt,
  setInstallPrompt,
  subscribeInstallPrompt,
  type InstallPromptEvent,
} from "./pwaInstallPrompt";

type Audience = "customer" | "admin" | "staff";

const HIDE_FOR_MS = 14 * 24 * 60 * 60 * 1000;
const COPY: Record<Audience, { title: string; description: string }> = {
  customer: { title: "Rion Order를 홈 화면에 추가하세요", description: "다음 방문 때 더 빠르게 이용할 수 있어요." },
  admin: { title: "관리 화면을 빠르게 실행하세요", description: "홈 화면에 추가하면 Rion 관리 화면을 쉽게 열 수 있습니다." },
  staff: { title: "주문 화면을 홈에 추가하세요", description: "다음 근무 때 주문 현황을 빠르게 열 수 있습니다." },
};

function dismissedUntilKey(audience: Audience) {
  return `rionOrderPwaInstallDismissedUntil:${audience}`;
}

function isIosSafari() {
  const agent = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(agent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent);
  return isIos && isSafari;
}

function isStandalone() {
  const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

export function PwaInstallGuide({ audience, eligible = true }: { audience: Audience; eligible?: boolean }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(() => getInstallPrompt());
  const [iosManualInstall, setIosManualInstall] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const dismissedUntil = Number(window.localStorage.getItem(dismissedUntilKey(audience)) || 0);
    const canShow = !isStandalone() && dismissedUntil <= Date.now();
    const stateTimer = window.setTimeout(() => {
      setDismissed(!canShow);
      setIosManualInstall(canShow && isIosSafari());
    }, 0);
    const unsubscribe = subscribeInstallPrompt(setPromptEvent);
    return () => {
      window.clearTimeout(stateTimer);
      unsubscribe();
    };
  }, [audience]);

  if (!eligible || dismissed || (!promptEvent && !iosManualInstall)) return null;

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") setDismissed(true);
  };
  const dismiss = () => {
    window.localStorage.setItem(dismissedUntilKey(audience), String(Date.now() + HIDE_FOR_MS));
    setDismissed(true);
  };

  return (
    <aside className="pwaInstallGuide" aria-label="Rion Order 앱 설치 안내">
      <div className="pwaInstallCopy">
        <strong>{COPY[audience].title}</strong>
        <p>{COPY[audience].description}</p>
        {iosManualInstall ? <small>Safari의 공유 버튼을 누른 후 홈 화면에 추가를 선택해 주세요.</small> : null}
      </div>
      <div className="pwaInstallActions">
        {!iosManualInstall ? <button type="button" className="install" onClick={install}>홈 화면에 추가</button> : null}
        <button type="button" onClick={dismiss}>나중에</button>
      </div>
      <style jsx>{`
        .pwaInstallGuide { margin: 20px 0; padding: 18px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border: 1px solid #dbe3ee; border-radius: 16px; background: #f8fafc; color: #0f1f3d; }
        .pwaInstallCopy { min-width: 0; }
        strong { display: block; font-size: 15px; line-height: 1.45; }
        p, small { display: block; margin: 5px 0 0; color: #64748b; font-size: 13px; line-height: 1.5; }
        small { color: #315fba; font-weight: 700; }
        .pwaInstallActions { display: flex; flex-shrink: 0; gap: 8px; }
        button { min-height: 40px; padding: 0 13px; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #334155; font-weight: 750; cursor: pointer; }
        button.install { border-color: #0f1f3d; background: #0f1f3d; color: #fff; }
        @media (max-width: 560px) { .pwaInstallGuide { align-items: stretch; flex-direction: column; } .pwaInstallActions button { flex: 1; } }
      `}</style>
    </aside>
  );
}
