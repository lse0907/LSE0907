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
      "id,store_id,created_at,display_no,mode,table_no,total_count,total_price,status,earned_points,access_token",
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
  return NextResponse.json({
    ok: true,
    orders: (orders || []).map((order) => ({
      ...order,
      store: storeMap[order.store_id] || { name: "매장", logo: "" },
    })),
  });
}
