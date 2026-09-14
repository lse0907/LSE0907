import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: NextRequest) {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const secret = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();
  if (!url || !anon || !secret)
    return NextResponse.json(
      { ok: false, message: "서버 설정을 확인해 주세요." },
      { status: 500 },
    );
  const auth = createServerClient(url, anon, {
    cookies: {
      get: (name) => req.cookies.get(name)?.value,
      set() {},
      remove() {},
    },
  });
  const { data } = await auth.auth.getUser();
  if (!data.user)
    return NextResponse.json(
      { ok: false, message: "로그인이 필요합니다." },
      { status: 401 },
    );
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: orders, error } = await admin
    .from("orders")
    .select(
      "id,store_id,created_at,display_no,mode,table_no,total_count,refunded_count,total_price,adjusted_total_price,refunded_amount,status,payment_status,earned_points,effective_earned_points",
    )
    .eq("customer_user_id", data.user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error)
    return NextResponse.json(
      { ok: false, message: "주문 내역을 불러오지 못했어요." },
      { status: 500 },
    );
  const storeIds = [
    ...new Set(
      (orders || []).map((row) => String(row.store_id || "")).filter(Boolean),
    ),
  ];
  const stores = storeIds.length
    ? await admin
        .from("stores")
        .select("store_id,store_name,logo_image_url")
        .in("store_id", storeIds)
    : { data: [] };
  const storeMap = Object.fromEntries(
    (stores.data || []).map((row) => [
      row.store_id,
      { name: row.store_name || "매장", logo: row.logo_image_url || "" },
    ]),
  );
  const orderIds = (orders || []).map((order) => String(order.id || "")).filter(Boolean);
  const { data: orderItems, error: orderItemsError } = orderIds.length
    ? await admin
        .from("order_items")
        .select("id,order_id,name,price,qty,refunded_qty")
        .in("order_id", orderIds)
    : { data: [], error: null };
  if (orderItemsError)
    return NextResponse.json(
      { ok: false, message: "주문 메뉴를 불러오지 못했어요." },
      { status: 500 },
    );

  const itemIds = (orderItems || []).map((item) => String(item.id || "")).filter(Boolean);
  const { data: itemOptions, error: itemOptionsError } = itemIds.length
    ? await admin
        .from("order_item_options")
        .select("order_item_id,name,price_delta,qty")
        .in("order_item_id", itemIds)
    : { data: [], error: null };
  if (itemOptionsError)
    return NextResponse.json(
      { ok: false, message: "주문 옵션을 불러오지 못했어요." },
      { status: 500 },
    );

  const optionsByItemId = new Map<string, Array<{ name: string; price_delta: number; qty: number }>>();
  for (const option of itemOptions || []) {
    const itemId = String(option.order_item_id || "");
    if (!itemId) continue;
    const list = optionsByItemId.get(itemId) || [];
    list.push({
      name: String(option.name || "옵션"),
      price_delta: Math.max(0, Number(option.price_delta || 0)),
      qty: Math.max(1, Number(option.qty || 1)),
    });
    optionsByItemId.set(itemId, list);
  }
  const itemsByOrderId = new Map<string, Array<Record<string, unknown>>>();
  for (const item of orderItems || []) {
    const orderId = String(item.order_id || "");
    if (!orderId) continue;
    const list = itemsByOrderId.get(orderId) || [];
    list.push({
      id: String(item.id || ""),
      name: String(item.name || "메뉴"),
      price: Math.max(0, Number(item.price || 0)),
      qty: Math.max(0, Number(item.qty || 0)),
      refunded_qty: Math.max(0, Number(item.refunded_qty || 0)),
      options: optionsByItemId.get(String(item.id || "")) || [],
    });
    itemsByOrderId.set(orderId, list);
  }
  return NextResponse.json({
    ok: true,
    orders: (orders || []).map((order) => ({
      ...order,
      store: storeMap[order.store_id] || { name: "매장", logo: "" },
      items: itemsByOrderId.get(String(order.id || "")) || [],
    })),
  });
}
