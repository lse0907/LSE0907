import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { validateOrderPayload } from "../_lib/orderValidation";

type QuoteBody = {
  storeId?: string;
  cartLines?: unknown;
  customerUserId?: string | null;
  usedPoints?: number;
  usedCouponId?: string | null;
};

function adminClient() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRole =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!supabaseUrl || !serviceRole) throw new Error("서버 환경변수(SUPABASE)가 필요합니다.");
  return createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getRequestUserId(req: NextRequest) {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!supabaseUrl || !anonKey) return null;

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuoteBody;
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });

    const requestUserId = await getRequestUserId(req);
    const validated = await validateOrderPayload({
      supabaseAdmin: adminClient(),
      storeId,
      cartLines: body.cartLines,
      customerUserId: requestUserId,
      usedPoints: requestUserId ? body.usedPoints || 0 : 0,
      usedCouponId: requestUserId ? body.usedCouponId || null : null,
    });

    return NextResponse.json({ ok: true, quote: validated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
