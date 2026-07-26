import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, createSupabaseAdminClient, requireStoreRole } from "../../_lib/storeAuth";
import { buildBillingQuote, normalizePlanMonths } from "../_lib/pricing";

type QuoteBody = { storeId?: unknown; planMonths?: unknown; payBase?: unknown; payAddon?: unknown; prepare?: unknown };

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
    const quote = await buildBillingQuote({ supabaseAdmin, storeId, userId, planMonths, payBase, payAddon });
    if (!body.prepare) return NextResponse.json({ ok: true, quote });

    const orderId = `bill_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const snapshot = { ...quote, calculatedAt: new Date().toISOString() };
    const { error } = await supabaseAdmin.from("billing_payment_attempts").insert({
      order_id: orderId,
      store_id: storeId,
      payer_user_id: userId,
      plan_months: quote.planMonths,
      base_selected: quote.payBase,
      addon_selected: quote.payAddon,
      base_monthly_krw: quote.baseMonthlyKrw,
      addon_monthly_krw: quote.addonMonthlyKrw,
      base_discount_bps: quote.baseDiscountBps,
      addon_discount_bps: quote.addonDiscountBps,
      term_discount_bps: quote.termDiscountBps,
      discount_reason: quote.discountLabels.join(" / ") || null,
      list_amount_krw: quote.listAmountKrw,
      discount_amount_krw: quote.discountAmountKrw,
      final_amount_krw: quote.finalAmountKrw,
      price_policy_version: quote.pricePolicyVersion,
      quote_snapshot: snapshot,
      status: "payment_requested",
    });
    if (error) throw new Error(`결제 준비 정보 저장 실패: ${error.message}`);
    return NextResponse.json({ ok: true, quote, orderId });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
