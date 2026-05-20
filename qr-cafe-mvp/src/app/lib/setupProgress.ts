"use client";

export type SetupStepKey = "step1" | "step2" | "step3";
export type SetupProgressState = {
  step1: boolean;
  step2: boolean;
  step3: boolean;
};

const emptyState: SetupProgressState = {
  step1: false,
  step2: false,
  step3: false,
};

function key(storeId: string) {
  return `setup_progress_v1:${storeId}`;
}

export function getSetupProgress(storeId: string): SetupProgressState {
  if (!storeId || typeof window === "undefined") return emptyState;
  try {
    const raw = localStorage.getItem(key(storeId));
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as Partial<SetupProgressState>;
    return {
      step1: Boolean(parsed.step1),
      step2: Boolean(parsed.step2),
      step3: Boolean(parsed.step3),
    };
  } catch {
    return emptyState;
  }
}

export function setSetupStepConfirmed(storeId: string, step: SetupStepKey, value: boolean) {
  if (!storeId || typeof window === "undefined") return;
  const prev = getSetupProgress(storeId);
  const next = { ...prev, [step]: value };
  localStorage.setItem(key(storeId), JSON.stringify(next));
}

export function clearSetupProgress(storeId: string) {
  if (!storeId || typeof window === "undefined") return;
  localStorage.removeItem(key(storeId));
}
