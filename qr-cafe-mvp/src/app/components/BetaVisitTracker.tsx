"use client";
import { useEffect } from "react";
import { captureBetaVisit } from "@/app/lib/betaVisit";

export default function BetaVisitTracker() {
  useEffect(() => {
    // Local previews must never pollute the live recruitment metrics.
    if (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("localPreview")) return;
    if (navigator.webdriver) return;
    const visit = captureBetaVisit();
    void fetch("/api/beta-visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(visit), keepalive: true }).catch(() => {});
  }, []);
  return null;
}
