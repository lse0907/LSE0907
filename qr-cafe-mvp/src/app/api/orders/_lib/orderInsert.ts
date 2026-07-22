import { SupabaseClient } from "@supabase/supabase-js";
import { ValidatedOrder, OrderMode, PaymentStatus } from "./orderValidation";

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function format4(n: number) {
  return String(Math.max(1, Math.min(9999, Math.floor(n)))).padStart(4, "0");
}

function isDuplicateDisplayNoError(msg: string) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("duplicate key value violates unique constraint") ||
    m.includes("orders_display_no_unique") ||
    m.includes("orders_store_date_display_no_unique") ||
    m.includes("unique constraint") ||
    m.includes("23505")
  );
}

async function nextDisplayNo(supabaseAdmin: SupabaseClient, storeId: string, orderDate: string, offset: number) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("display_no")
    .eq("store_id", storeId)
    .eq("order_date", orderDate)
    .order("display_no", { ascending: false })
    .limit(1);
  if (error) throw new Error(`주문번호 생성 실패: ${error.message}`);

  const current = Array.isArray(data) && data[0]?.display_no ? Number(data[0].display_no) : 0;
  return format4((Number.isFinite(current) ? current : 0) + 1 + offset);
}

async function insertOrderWithFallback(supabaseAdmin: SupabaseClient, row: Record<string, unknown>) {
  const first = await supabaseAdmin.from("orders").insert([row]);
  if (!first.error) return first;

  const msg = String(first.error.message || "").toLowerCase();
  const fallbackRow = { ...row };
  let changed = false;
  for (const col of ["payment_status", "payment_key", "toss_order_id", "used_points", "used_coupon_id", "applied_discount_type", "customer_user_id"]) {
    if (msg.includes(col) && (msg.includes("column") || msg.includes("schema cache"))) {
      delete fallbackRow[col];
      changed = true;
    }
  }
  if (!changed) return first;
  return supabaseAdmin.from("orders").insert([fallbackRow]);
}

export async function createValidatedOrder(params: {
  supabaseAdmin: SupabaseClient;
  storeId: string;
  mode: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  paymentStatus: PaymentStatus;
  paymentKey?: string | null;
  tossOrderId?: string | null;
  customerUserId?: string | null;
  validated: ValidatedOrder;
}) {
  const orderId = uuid();
  const accessToken = uuid();
  const orderDate = todayKey();
  const createdAtIso = new Date().toISOString();
  let displayNo = "";

  const MAX_TRY = 5;
  for (let attempt = 0; attempt < MAX_TRY; attempt++) {
    displayNo = await nextDisplayNo(params.supabaseAdmin, params.storeId, orderDate, attempt);
    const orderRow: Record<string, unknown> = {
      id: orderId,
      access_token: accessToken,
      created_at: createdAtIso,
      order_date: orderDate,
      display_no: displayNo,
      mode: params.mode,
      table_no: params.mode === "dine-in" ? String(params.table || "").trim() || null : null,
      request_note: String(params.requestNote || "").trim(),
      total_count: params.validated.totalCount,
      total_price: params.validated.totalPrice,
      status: "new",
      payment_status: params.paymentStatus,
      payment_key: params.paymentKey || null,
      toss_order_id: params.tossOrderId || null,
      customer_user_id: params.customerUserId || null,
      used_points: params.validated.usedPoints,
      used_coupon_id: params.validated.usedCouponId,
      applied_discount_type: params.validated.usedCouponId ? "coupon" : params.validated.usedPoints > 0 ? "point" : null,
      store_id: params.storeId,
    };

    const insertOrder = await insertOrderWithFallback(params.supabaseAdmin, orderRow);
    if (!insertOrder.error) break;

    const msg = insertOrder.error.message || String(insertOrder.error);
    if (!isDuplicateDisplayNoError(msg) || attempt === MAX_TRY - 1) throw new Error(`[orders insert] ${msg}`);
  }

  const orderItemRows: Array<Record<string, unknown>> = [];
  const optionRows: Array<Record<string, unknown>> = [];

  for (const line of params.validated.cartLines) {
    const orderItemId = uuid();
    orderItemRows.push({
      id: orderItemId,
      order_id: orderId,
      menu_id: line.menuId,
      name: line.name,
      price: line.basePrice,
      qty: line.qty,
      store_id: params.storeId,
    });

    for (const group of line.options) {
      for (const item of group.items) {
        optionRows.push({
          id: uuid(),
          order_item_id: orderItemId,
          group_id: group.groupId,
          group_name: group.groupName,
          option_id: item.id,
          name: item.name,
          price_delta: item.priceDelta,
          qty: item.qty,
          store_id: params.storeId,
        });
      }
    }
  }

  const { error: itemErr } = await params.supabaseAdmin.from("order_items").insert(orderItemRows);
  if (itemErr) throw new Error(`[order_items insert] ${itemErr.message}`);

  if (optionRows.length) {
    const optionInsert = await params.supabaseAdmin.from("order_item_options").insert(optionRows);
    if (optionInsert.error) {
      const msg = String(optionInsert.error.message || "").toLowerCase();
      if (msg.includes("group_name") && (msg.includes("column") || msg.includes("schema cache"))) {
        const fallbackRows = optionRows.map((row) => {
          const next = { ...row };
          delete next.group_name;
          return next;
        });
        const retry = await params.supabaseAdmin.from("order_item_options").insert(fallbackRows);
        if (retry.error) throw new Error(`[order_item_options insert] ${retry.error.message}`);
      } else {
        throw new Error(`[order_item_options insert] ${optionInsert.error.message}`);
      }
    }
  }

  if (params.customerUserId) {
    const { error: loyaltyErr } = await params.supabaseAdmin.rpc("apply_loyalty_on_paid_order", {
      p_order_id: orderId,
      p_store_id: params.storeId,
      p_customer_user_id: params.customerUserId,
      p_order_amount: params.validated.totalPrice,
      p_used_points: params.validated.usedPoints,
      p_used_coupon_id: params.validated.usedCouponId,
      p_idempotency_key: `${orderId}:loyalty`,
    });
    if (loyaltyErr) console.warn("[orders/create] loyalty apply failed:", loyaltyErr.message);
  }

  return {
    orderId,
    accessToken,
    orderDate,
    displayNo,
    totalCount: params.validated.totalCount,
    totalPrice: params.validated.totalPrice,
    payableAmount: params.validated.payableAmount,
    cartLines: params.validated.cartLines,
  };
}
