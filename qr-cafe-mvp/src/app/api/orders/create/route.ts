import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createValidatedOrder } from "../_lib/orderInsert";
import { OrderMode, PaymentStatus, validateOrderPayload } from "../_lib/orderValidation";

type CreateBody = {
  storeId?: string;
  cartLines?: unknown;
  mode?: OrderMode;
  table?: string | null;
  requestNote?: string | null;
  customerUserId?: string | null;
  usedPoints?: number;
  usedCouponId?: string | null;
  paymentStatus?: PaymentStatus;
  paymentKey?: string | null;
  tossOrderId?: string | null;
  paidAmount?: number;
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

function normalizeMode(raw: unknown): OrderMode {
  return raw === "takeout" ? "takeout" : "dine-in";
}

function normalizePaymentStatus(raw: unknown): PaymentStatus {
  return raw === "paid" || raw === "pending" ? raw : "not_required";
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
    const body = (await req.json()) as CreateBody;
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return NextResponse.json({ ok: false, message: "매장 정보가 없습니다." }, { status: 400 });

    const paymentStatus = normalizePaymentStatus(body.paymentStatus);
    const requestUserId = await getRequestUserId(req);
    const supabaseAdmin = adminClient();
    const validated = await validateOrderPayload({
      supabaseAdmin,
      storeId,
      cartLines: body.cartLines,
      customerUserId: requestUserId,
      usedPoints: requestUserId ? body.usedPoints || 0 : 0,
      usedCouponId: requestUserId ? body.usedCouponId || null : null,
    });

    if (paymentStatus === "paid") {
      const paidAmount = Number(body.paidAmount || 0);
      if (!Number.isFinite(paidAmount) || Math.round(paidAmount) !== validated.payableAmount) {
        return NextResponse.json(
          { ok: false, message: "결제 금액이 현재 주문 금액과 일치하지 않습니다.", expectedAmount: validated.payableAmount },
          { status: 409 }
        );
      }
      if (!String(body.paymentKey || "").trim() || !String(body.tossOrderId || "").trim()) {
        return NextResponse.json({ ok: false, message: "결제 식별자가 누락되었습니다." }, { status: 400 });
      }
    }

    const created = await createValidatedOrder({
      supabaseAdmin,
      storeId,
      mode: normalizeMode(body.mode),
      table: body.table || null,
      requestNote: body.requestNote || "",
      paymentStatus,
      paymentKey: body.paymentKey || null,
      tossOrderId: body.tossOrderId || null,
      customerUserId: requestUserId,
      validated,
    });

    return NextResponse.json({ ok: true, order: created });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
