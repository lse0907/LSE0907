export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(prompt: InstallPromptEvent | null) => void>();

export function setInstallPrompt(prompt: InstallPromptEvent | null) {
  deferredPrompt = prompt;
  listeners.forEach((listener) => listener(prompt));
}

export function getInstallPrompt() {
  return deferredPrompt;
}

export function subscribeInstallPrompt(listener: (prompt: InstallPromptEvent | null) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
