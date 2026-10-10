export function captureBetaVisit() {
  const now = Date.now();
  let previous: { id: string; expires: number } | null = null;
  try { previous = JSON.parse(sessionStorage.getItem("rion-beta-visit") || "null"); } catch { /* Storage can be disabled. */ }
  const valid = previous && previous.expires > now && typeof previous.id === "string";
  const session = previous && valid ? { id: previous.id, expires: previous.expires } : { id: crypto.randomUUID(), expires: now + 30 * 60 * 1000 };
  try { sessionStorage.setItem("rion-beta-visit", JSON.stringify(session)); } catch { /* Best effort; no persistent identifier. */ }
  return { sessionId: session.id };
}
