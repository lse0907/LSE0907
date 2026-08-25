type JsonRecord = Record<string, unknown>;

export type TossCancellationResult = {
  confirmed: boolean;
  paymentKey: string | null;
  tossOrderId: string | null;
  pgStatus: string | null;
  transactionKey: string | null;
  snapshot: JsonRecord | null;
  failureCode: string | null;
  failureDetail: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

async function responseJson(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw: raw.slice(0, 500) };
  }
}

function essentialPaymentSnapshot(value: unknown): JsonRecord {
  const payment = asRecord(value);
  const cancels = Array.isArray(payment.cancels)
    ? payment.cancels.slice(-10).map((cancel) => {
        const row = asRecord(cancel);
        return {
          cancelAmount: row.cancelAmount ?? null,
          cancelReason: row.cancelReason ?? null,
          canceledAt: row.canceledAt ?? null,
          cancelStatus: row.cancelStatus ?? null,
          transactionKey: row.transactionKey ?? null,
        };
      })
    : [];

  return {
    paymentKey: payment.paymentKey ?? null,
    orderId: payment.orderId ?? null,
    status: payment.status ?? null,
    totalAmount: payment.totalAmount ?? payment.amount ?? null,
    balanceAmount: payment.balanceAmount ?? null,
    lastTransactionKey: payment.lastTransactionKey ?? null,
    cancels,
  };
}

function cancelTransactionKey(value: unknown) {
  const payment = asRecord(value);
  if (Array.isArray(payment.cancels)) {
    for (const item of [...payment.cancels].reverse()) {
      const key = String(asRecord(item).transactionKey || "").trim();
      if (key) return key;
    }
  }
  return String(payment.lastTransactionKey || "").trim() || null;
}

function verifiedCancellation(
  value: unknown,
  expectedPaymentKey: string,
  expectedTossOrderId: string | null,
): TossCancellationResult | null {
  const payment = asRecord(value);
  const paymentKey = String(payment.paymentKey || "").trim();
  const tossOrderId = String(payment.orderId || "").trim();
  const pgStatus = String(payment.status || "").trim().toUpperCase();
  if (
    pgStatus !== "CANCELED" ||
    paymentKey !== expectedPaymentKey ||
    (expectedTossOrderId && tossOrderId !== expectedTossOrderId)
  ) {
    return null;
  }

  return {
    confirmed: true,
    paymentKey,
    tossOrderId: tossOrderId || expectedTossOrderId,
    pgStatus,
    transactionKey: cancelTransactionKey(payment),
    snapshot: essentialPaymentSnapshot(payment),
    failureCode: null,
    failureDetail: null,
  };
}

async function queryPayment(params: {
  basicToken: string;
  paymentKey?: string | null;
  tossOrderId?: string | null;
}) {
  const paymentKey = String(params.paymentKey || "").trim();
  const tossOrderId = String(params.tossOrderId || "").trim();
  if (!paymentKey && !tossOrderId) return { ok: false as const, value: null };

  const identifierPath = paymentKey
    ? encodeURIComponent(paymentKey)
    : `orders/${encodeURIComponent(tossOrderId)}`;
  try {
    const response = await fetch(`https://api.tosspayments.com/v1/payments/${identifierPath}`, {
      method: "GET",
      headers: { Authorization: `Basic ${params.basicToken}` },
      cache: "no-store",
    });
    return { ok: response.ok, value: await responseJson(response) };
  } catch {
    return { ok: false as const, value: null };
  }
}

function pendingResult(params: {
  paymentKey?: string | null;
  tossOrderId?: string | null;
  pgStatus?: string | null;
  code: string;
  detail: string;
}): TossCancellationResult {
  return {
    confirmed: false,
    paymentKey: String(params.paymentKey || "").trim() || null,
    tossOrderId: String(params.tossOrderId || "").trim() || null,
    pgStatus: String(params.pgStatus || "").trim().toUpperCase() || null,
    transactionKey: null,
    snapshot: null,
    failureCode: params.code.slice(0, 100),
    failureDetail: params.detail.slice(0, 1000),
  };
}

export async function inspectTossOrderPayment(params: {
  secretKey: string;
  paymentKey?: string | null;
  tossOrderId?: string | null;
}): Promise<TossCancellationResult> {
  const basicToken = Buffer.from(`${params.secretKey}:`).toString("base64");
  const expectedTossOrderId = String(params.tossOrderId || "").trim() || null;
  const queried = await queryPayment({
    basicToken,
    paymentKey: params.paymentKey,
    tossOrderId: params.paymentKey ? null : expectedTossOrderId,
  });
  const payment = asRecord(queried.value);
  const paymentKey = String(params.paymentKey || payment.paymentKey || "").trim();
  if (!queried.ok || !paymentKey) {
    return pendingResult({
      paymentKey,
      tossOrderId: expectedTossOrderId,
      code: "TOSS_PAYMENT_LOOKUP_FAILED",
      detail: "Toss payment status lookup failed.",
    });
  }

  const verified = verifiedCancellation(queried.value, paymentKey, expectedTossOrderId);
  if (verified) return verified;
  const pgStatus = String(payment.status || "").trim().toUpperCase();
  return pendingResult({
    paymentKey,
    tossOrderId: expectedTossOrderId,
    pgStatus,
    code: "TOSS_CANCELLATION_NOT_CONFIRMED",
    detail: `Toss payment status is ${pgStatus || "unknown"}.`,
  });
}

export async function cancelTossOrderPayment(params: {
  secretKey: string;
  paymentKey?: string | null;
  tossOrderId?: string | null;
  idempotencyKey: string;
  cancelReason: string;
}): Promise<TossCancellationResult> {
  const basicToken = Buffer.from(`${params.secretKey}:`).toString("base64");
  const expectedTossOrderId = String(params.tossOrderId || "").trim() || null;
  let paymentKey = String(params.paymentKey || "").trim();

  const initialQuery = await queryPayment({
    basicToken,
    paymentKey: paymentKey || null,
    tossOrderId: paymentKey ? null : expectedTossOrderId,
  });
  if (initialQuery.ok) {
    const queried = asRecord(initialQuery.value);
    paymentKey = paymentKey || String(queried.paymentKey || "").trim();
    if (paymentKey) {
      const alreadyCancelled = verifiedCancellation(initialQuery.value, paymentKey, expectedTossOrderId);
      if (alreadyCancelled) return alreadyCancelled;
    }
  }

  if (!paymentKey) {
    return pendingResult({
      tossOrderId: expectedTossOrderId,
      code: "PAYMENT_KEY_NOT_RESOLVED",
      detail: "Toss payment lookup did not return a payment key.",
    });
  }

  let cancelResponse: Response | null = null;
  let cancelValue: unknown = null;
  try {
    cancelResponse = await fetch(
      `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": params.idempotencyKey,
        },
        body: JSON.stringify({ cancelReason: params.cancelReason || "주문 취소" }),
        cache: "no-store",
      },
    );
    cancelValue = await responseJson(cancelResponse);
    if (cancelResponse.ok) {
      const verified = verifiedCancellation(cancelValue, paymentKey, expectedTossOrderId);
      if (verified) return verified;
    }
  } catch {
    cancelResponse = null;
  }

  const verification = await queryPayment({ basicToken, paymentKey });
  if (verification.ok) {
    const verified = verifiedCancellation(verification.value, paymentKey, expectedTossOrderId);
    if (verified) return verified;
  }

  const cancelError = asRecord(cancelValue);
  const verificationPayment = asRecord(verification.value);
  const status = String(verificationPayment.status || cancelError.status || "").trim();
  const code = String(cancelError.code || "TOSS_CANCEL_RESULT_UNCONFIRMED").trim();
  return pendingResult({
    paymentKey,
    tossOrderId: expectedTossOrderId,
    pgStatus: status,
    code,
    detail: cancelResponse
      ? `Toss cancel HTTP ${cancelResponse.status}; verification status=${status || "unknown"}`
      : `Toss cancel request was unreachable; verification status=${status || "unknown"}`,
  });
}
