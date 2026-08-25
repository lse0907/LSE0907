import { NextRequest, NextResponse } from "next/server";
import {
  finalizeCheckoutAttempt,
  getCheckoutAttempt,
  orderResponse,
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
      const finalized = await finalizeCheckoutAttempt(supabaseAdmin, attempt.id);
      return NextResponse.json({ ok: true, state: "completed", order: orderResponse(finalized) });
    }

    const publicState = ["quoted", "confirming", "failed", "expired", "cancel_pending", "cancelled"].includes(
      attempt.status,
    )
      ? attempt.status
      : "confirming";
    return NextResponse.json({ ok: true, state: publicState, order: null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, code: "CHECKOUT_RECOVERY_FAILED", message },
      { status: 500 },
    );
  }
}
