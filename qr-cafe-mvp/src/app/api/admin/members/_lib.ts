import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";

export type PinRole = "staff" | "manager";

export function normalizePinRole(raw: unknown): PinRole {
  return String(raw || "").trim() === "manager" ? "manager" : "staff";
}

export function makePinHash(pin: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPinHash(pin: string, stored: string) {
  const [method, salt, hash] = String(stored || "").split(":");
  if (method !== "scrypt" || !salt || !hash) return false;
  const next = makePinHash(pin, salt).split(":")[2];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
}

export function hashDeviceFingerprint(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function recordSecurityEvent(
  supabaseAdmin: SupabaseClient,
  event: {
    storeId: string;
    userId?: string | null;
    eventType: string;
    deviceId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await supabaseAdmin.from("security_events").insert({
    store_id: event.storeId,
    user_id: event.userId || null,
    event_type: event.eventType,
    device_id: event.deviceId || null,
    metadata: event.metadata || {},
  });
  if (error) console.warn("[security_events] insert skipped:", error.message);
}
