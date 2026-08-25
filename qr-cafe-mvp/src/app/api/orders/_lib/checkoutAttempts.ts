import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { OrderMode, ValidatedOrder } from "./orderValidation";

export type CheckoutType = "postpaid" | "prepaid";

export type CheckoutAttemptRow = {
  id: string;
  store_id: string;
  client_request_id: string;
  request_fingerprint: string;
  checkout_type: CheckoutType;
  status: string;
  customer_user_id: string | null;
  mode: OrderMode;
  table_no: string | null;
  request_note: string;
  cart_snapshot: ValidatedOrder["cartLines"];
  total_count: number;
  total_price: number;
  used_points: number;
  used_coupon_id: string | null;
  coupon_discount: number;
  payable_amount: number;
  toss_order_id: string | null;
  payment_key: string | null;
  pg_status: string | null;
  confirm_idempotency_key: string | null;
  order_id: string | null;
  recovery_token_hash: string;
  expires_at: string;
};

export type FinalizedOrder = {
  order_id: string;
  access_token: string;
  order_date: string;
  display_no: string;
  total_count: number;
  total_price: number;
  payable_amount: number;
  payment_status: string;
};

const ATTEMPT_COLUMNS = [
  "id",
  "store_id",
  "client_request_id",
  "request_fingerprint",
  "checkout_type",
  "status",
  "customer_user_id",
  "mode",
  "table_no",
  "request_note",
  "cart_snapshot",
  "total_count",
  "total_price",
  "used_points",
  "used_coupon_id",
  "coupon_discount",
  "payable_amount",
  "toss_order_id",
  "payment_key",
  "pg_status",
  "confirm_idempotency_key",
  "order_id",
  "recovery_token_hash",
  "expires_at",
].join(",");

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function recoverySecret() {
  const secret = String(
    process.env.ORDER_RECOVERY_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      "",
  ).trim();
  if (!secret) throw new Error("주문 복구 토큰을 생성할 서버 키가 없습니다.");
  return secret;
}

function recoveryToken(attemptId: string, clientRequestId: string) {
  return createHmac("sha256", recoverySecret())
    .update(`${attemptId}:${clientRequestId}`)
    .digest("base64url");
}

function safeTokenEqual(expectedHash: string, rawToken: string) {
  const actual = Buffer.from(sha256(rawToken), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeClientRequestId(raw: unknown) {
  const value = String(raw || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("CLIENT_REQUEST_ID_INVALID");
  }
  return value;
}

function attemptFingerprint(params: {
  storeId: string;
  checkoutType: CheckoutType;
  mode: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  validated: ValidatedOrder;
}) {
  const stableCartLines = params.validated.cartLines.map((line) => ({
    menuId: line.menuId,
    name: line.name,
    basePrice: line.basePrice,
    qty: line.qty,
    options: line.options,
    optionTotal: line.optionTotal,
    lineTotal: line.lineTotal,
  }));

  return sha256(
    JSON.stringify({
      storeId: params.storeId,
      checkoutType: params.checkoutType,
      mode: params.mode,
      table: params.mode === "dine-in" ? String(params.table || "").trim() : null,
      requestNote: String(params.requestNote || "").trim(),
      customerUserId: params.customerUserId || null,
      cartLines: stableCartLines,
      totalCount: params.validated.totalCount,
      totalPrice: params.validated.totalPrice,
      usedPoints: params.validated.usedPoints,
      usedCouponId: params.validated.usedCouponId,
      couponDiscount: params.validated.couponDiscount,
      payableAmount: params.validated.payableAmount,
    }),
  );
}

function tossOrderId() {
  return `RION_${randomUUID()}`;
}

export async function createCheckoutAttempt(params: {
  supabaseAdmin: SupabaseClient;
  storeId: string;
  clientRequestId: string;
  checkoutType: CheckoutType;
  mode: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  validated: ValidatedOrder;
}) {
  const attemptId = randomUUID();
  const fingerprint = attemptFingerprint(params);
  const token = recoveryToken(attemptId, params.clientRequestId);
  const row = {
    id: attemptId,
    store_id: params.storeId,
    client_request_id: params.clientRequestId,
    request_fingerprint: fingerprint,
    checkout_type: params.checkoutType,
    status: "quoted",
    customer_user_id: params.customerUserId || null,
    mode: params.mode,
    table_no: params.mode === "dine-in" ? String(params.table || "").trim() || null : null,
    request_note: String(params.requestNote || "").trim(),
    cart_snapshot: params.validated.cartLines,
    total_count: params.validated.totalCount,
    total_price: params.validated.totalPrice,
    used_points: params.validated.usedPoints,
    used_coupon_id: params.validated.usedCouponId,
    coupon_discount: params.validated.couponDiscount,
    payable_amount: params.validated.payableAmount,
    toss_order_id: params.checkoutType === "prepaid" ? tossOrderId() : null,
    confirm_idempotency_key: params.checkoutType === "prepaid" ? randomUUID() : null,
    recovery_token_hash: sha256(token),
  };

  const inserted = await params.supabaseAdmin
    .from("order_checkout_attempts")
    .insert(row)
    .select(ATTEMPT_COLUMNS)
    .single();

  if (!inserted.error && inserted.data) {
    return { attempt: inserted.data as unknown as CheckoutAttemptRow, recoveryToken: token, duplicate: false };
  }

  if (inserted.error?.code !== "23505") {
    throw new Error(`CHECKOUT_ATTEMPT_CREATE_FAILED: ${inserted.error?.message || "unknown error"}`);
  }

  const existing = await params.supabaseAdmin
    .from("order_checkout_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("store_id", params.storeId)
    .eq("client_request_id", params.clientRequestId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    throw new Error(`CHECKOUT_ATTEMPT_LOOKUP_FAILED: ${existing.error?.message || "not found"}`);
  }

  const attempt = existing.data as unknown as CheckoutAttemptRow;
  if (attempt.request_fingerprint !== fingerprint || attempt.checkout_type !== params.checkoutType) {
    throw new Error("CLIENT_REQUEST_ID_REUSED_WITH_DIFFERENT_ORDER");
  }

  return {
    attempt,
    recoveryToken: recoveryToken(attempt.id, attempt.client_request_id),
    duplicate: true,
  };
}

export async function getCheckoutAttempt(params: {
  supabaseAdmin: SupabaseClient;
  attemptId?: string | null;
  tossOrderId?: string | null;
}) {
  let query = params.supabaseAdmin.from("order_checkout_attempts").select(ATTEMPT_COLUMNS);
  if (params.attemptId) query = query.eq("id", params.attemptId);
  else if (params.tossOrderId) query = query.eq("toss_order_id", params.tossOrderId);
  else throw new Error("CHECKOUT_ATTEMPT_IDENTIFIER_REQUIRED");

  const result = await query.maybeSingle();
  if (result.error) throw new Error(`CHECKOUT_ATTEMPT_LOOKUP_FAILED: ${result.error.message}`);
  return (result.data || null) as CheckoutAttemptRow | null;
}

export function verifyCheckoutRecoveryToken(attempt: CheckoutAttemptRow, rawToken: unknown) {
  const token = String(rawToken || "").trim();
  return !!token && safeTokenEqual(attempt.recovery_token_hash, token);
}

export async function finalizeCheckoutAttempt(supabaseAdmin: SupabaseClient, attemptId: string) {
  const result = await supabaseAdmin.rpc("finalize_order_checkout_attempt", {
    p_attempt_id: attemptId,
  });
  if (result.error) throw new Error(`ORDER_FINALIZE_FAILED: ${result.error.message}`);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row?.order_id || !row?.access_token) throw new Error("ORDER_FINALIZE_RESULT_MISSING");
  return row as FinalizedOrder;
}

export function orderResponse(row: FinalizedOrder) {
  return {
    orderId: row.order_id,
    accessToken: row.access_token,
    orderDate: row.order_date,
    displayNo: row.display_no,
    totalCount: Number(row.total_count || 0),
    totalPrice: Number(row.total_price || 0),
    payableAmount: Number(row.payable_amount || 0),
    paymentStatus: row.payment_status,
  };
}
