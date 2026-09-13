import { NextRequest, NextResponse } from "next/server";
import {
  finalizeCheckoutAttempt,
  getCheckoutAttempt,
  orderResponse,
  recordApprovedCheckoutRecoveryFailure,
  verifyCheckoutRecoveryToken,
} from "../../_lib/checkoutAttempts";
import { createSupabaseAdminClient } from "../../../_lib/storeAuth";

type RecoverBody = {
  checkoutAttemptId?: string;
  recoveryToken?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RecoverBody;
    const attemptId = String(body.checkoutAttemptId || "").trim();
    if (!attemptId) {
      return NextResponse.json(
        { ok: false, code: "CHECKOUT_ATTEMPT_REQUIRED", message: "주문 복구 정보가 없습니다." },
        { status: 400 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const attempt = await getCheckoutAttempt({ supabaseAdmin, attemptId });
    if (!attempt || !verifyCheckoutRecoveryToken(attempt, body.recoveryToken)) {
      return NextResponse.json(
        { ok: false, code: "CHECKOUT_RECOVERY_FORBIDDEN", message: "주문 복구 정보가 올바르지 않습니다." },
        { status: 403 },
      );
    }

    if (attempt.status === "completed" || (attempt.status === "approved_not_applied" && attempt.pg_status === "DONE")) {
      try {
        const finalized = await finalizeCheckoutAttempt(supabaseAdmin, attempt.id);
        return NextResponse.json({ ok: true, state: "completed", order: orderResponse(finalized) });
      } catch (error: unknown) {
        await recordApprovedCheckoutRecoveryFailure(supabaseAdmin, attempt.id, error);
        return NextResponse.json(
          {
            ok: true,
            state: "recovery_pending",
            order: null,
            message: "결제는 확인되었습니다. 주문을 매장에 전달하고 있습니다. 재결제하지 마세요.",
          },
          { status: 202 },
        );
      }
    }

    const publicState = ["quoted", "confirming", "failed", "expired", "cancel_pending", "cancelled"].includes(
      attempt.status,
    )
      ? attempt.status
      : "confirming";
    return NextResponse.json({ ok: true, state: publicState, order: null });
  } catch {
    return NextResponse.json(
      { ok: false, code: "CHECKOUT_RECOVERY_FAILED", message: "주문 상태를 확인하지 못했습니다. 잠시 후 다시 확인해주세요." },
      { status: 500 },
    );
  }
}
