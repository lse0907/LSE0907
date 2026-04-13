import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ConfirmBody = {
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  storeId?: string;
  pgMode?: "store" | "platform" | string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmBody;
    const paymentKey = String(body?.paymentKey || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const storeId = String(body?.storeId || "").trim();
    const pgMode = String(body?.pgMode || "store").trim();
    const amount = Number(body?.amount || 0);

    if (!paymentKey || !orderId || !storeId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, message: "필수 파라미터가 누락되었습니다." }, { status: 400 });
    }

    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
    const serviceRole =
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || "").trim();

    if (!supabaseUrl || !serviceRole) {
      const missing: string[] = [];
      if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL(or SUPABASE_URL)");
      if (!serviceRole) missing.push("SUPABASE_SERVICE_ROLE_KEY(or SUPABASE_SECRET_KEY)");

      return NextResponse.json(
        {
          ok: false,
          message: `서버 환경변수가 필요합니다: ${missing.join(", ")}`,
        },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const pgRes =
      pgMode === "platform"
        ? await supabaseAdmin
            .from("platform_pg_config")
            .select("secret_key")
            .eq("id", 1)
            .maybeSingle()
        : await supabaseAdmin
            .from("store_pg_config")
            .select("secret_key")
            .eq("store_id", storeId)
            .maybeSingle();
    const pgRow = pgRes.data;
    const pgErr = pgRes.error;

    if (pgErr) {
      return NextResponse.json({ ok: false, message: `PG 조회 실패: ${pgErr.message}` }, { status: 500 });
    }

    const secretKey = String(pgRow?.secret_key || "").trim();
    if (!secretKey) {
      return NextResponse.json({ ok: false, message: "매장 Secret Key가 없습니다." }, { status: 400 });
    }

    const basicToken = Buffer.from(`${secretKey}:`).toString("base64");
    const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
      cache: "no-store",
    });

    const raw = await tossRes.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!tossRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: "토스 승인 실패",
          toss: parsed,
        },
        { status: tossRes.status }
      );
    }

    return NextResponse.json({ ok: true, toss: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
