import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../../_lib/storeAuth";

type ConfirmBody = {
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  storeId?: string;
  pgMode?: "store" | "platform" | string;
};

type PgMode = "store" | "platform";

function parsePgMode(rawPgMode: unknown, defaultMode: PgMode): PgMode | null {
  const pgMode = String(rawPgMode || defaultMode).trim();
  return pgMode === "store" || pgMode === "platform" ? pgMode : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ConfirmBody;
    const paymentKey = String(body?.paymentKey || "").trim();
    const orderId = String(body?.orderId || "").trim();
    const storeId = String(body?.storeId || "").trim();
    const pgMode = parsePgMode(body?.pgMode, "store");
    const amount = Number(body?.amount || 0);

    if (!paymentKey || !orderId || !storeId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, message: "필수 파라미터가 누락되었습니다." }, { status: 400 });
    }

    if (!pgMode) {
      return NextResponse.json({ ok: false, message: "지원하지 않는 PG 결제 모드입니다." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    if (pgMode === "platform") {
      await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    }

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
      return NextResponse.json(
        { ok: false, message: pgMode === "platform" ? "플랫폼 Secret Key가 없습니다." : "매장 Secret Key가 없습니다." },
        { status: 400 }
      );
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

    const toss = asRecord(parsed);
    const tossPaymentKey = String(toss.paymentKey || "").trim();
    const tossOrderId = String(toss.orderId || "").trim();
    const tossStatus = String(toss.status || "").trim();
    const tossTotalAmount = Number(toss.totalAmount ?? toss.amount ?? NaN);

    if (
      tossPaymentKey !== paymentKey ||
      tossOrderId !== orderId ||
      !Number.isFinite(tossTotalAmount) ||
      Math.round(tossTotalAmount) !== Math.round(amount) ||
      tossStatus !== "DONE"
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "토스 승인 응답이 요청한 결제 정보와 일치하지 않습니다.",
          toss: parsed,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, toss: parsed });
  } catch (e: unknown) {
    return apiErrorResponse(e);
  }
}
