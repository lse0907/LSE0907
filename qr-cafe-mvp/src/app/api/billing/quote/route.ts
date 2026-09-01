import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { buildBillingQuote, normalizePlanMonths } from "../_lib/pricing";

type QuoteBody = { storeId?: unknown; planMonths?: unknown; payBase?: unknown; payAddon?: unknown; creditToUse?: unknown; prepare?: unknown };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuoteBody;
    const storeId = String(body.storeId || "").trim();
    const planMonths = normalizePlanMonths(body.planMonths);
    const payBase = body.payBase === true;
    const payAddon = body.payAddon === true;
    if (!storeId || !planMonths || (!payBase && !payAddon)) {
      return NextResponse.json({ ok: false, message: "결제 상품과 기간을 확인해 주세요." }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { userId } = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });
    const creditRequestedKrw = Math.max(0, Math.round(Number(body.creditToUse || 0)));
    const quote = await buildBillingQuote({ supabaseAdmin, storeId, userId, planMonths, payBase, payAddon, creditRequestedKrw });
    if (!body.prepare) return NextResponse.json({ ok: true, quote });

    const orderId = `bill_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const snapshot = { ...quote, discountReason: quote.discountLabels.join(" / ") || "", calculatedAt: new Date().toISOString() };
    const prepared = await supabaseAdmin.rpc("prepare_billing_payment_attempt_v2", {
      p_order_id: orderId, p_store_id: storeId, p_user_id: userId, p_quote: snapshot,
    });
    if (prepared.error) throw new Error(`결제 준비 정보 저장 실패: ${prepared.error.message}`);
    return NextResponse.json({ ok: true, quote, orderId, zeroPayment: quote.externalAmountKrw === 0 });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
