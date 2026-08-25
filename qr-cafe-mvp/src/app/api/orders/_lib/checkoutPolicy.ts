import { SupabaseClient } from "@supabase/supabase-js";

export type CheckoutPolicy = {
  isOrderable: boolean;
  isPrepay: boolean;
};

export class CheckoutPolicyError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "CheckoutPolicyError";
    this.code = code;
    this.status = status;
  }
}

async function getStoreCheckoutPolicy(
  supabaseAdmin: SupabaseClient,
  storeId: string,
): Promise<CheckoutPolicy> {
  const { data, error } = await supabaseAdmin.rpc("get_store_checkout_policy", {
    p_store_id: storeId,
  });

  if (error) {
    throw new CheckoutPolicyError(
      "CHECKOUT_POLICY_LOOKUP_FAILED",
      "매장의 주문 가능 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  const row = Array.isArray(data) ? data[0] : null;
  return {
    isOrderable: row?.is_orderable === true,
    isPrepay: row?.is_prepay === true,
  };
}

export async function requireStoreCheckoutMode(params: {
  supabaseAdmin: SupabaseClient;
  storeId: string;
  checkoutType: "prepaid" | "postpaid";
}): Promise<CheckoutPolicy> {
  const policy = await getStoreCheckoutPolicy(
    params.supabaseAdmin,
    params.storeId,
  );

  if (!policy.isOrderable) {
    throw new CheckoutPolicyError(
      "STORE_ORDERING_UNAVAILABLE",
      "현재 이 매장은 신규 주문을 받을 수 없습니다.",
      409,
    );
  }

  if (params.checkoutType === "prepaid" && !policy.isPrepay) {
    throw new CheckoutPolicyError(
      "PREPAID_CHECKOUT_NOT_AVAILABLE",
      "현재 이 매장에서는 온라인 선결제를 이용할 수 없습니다.",
      409,
    );
  }

  if (params.checkoutType === "postpaid" && policy.isPrepay) {
    throw new CheckoutPolicyError(
      "PREPAID_CHECKOUT_REQUIRED",
      "이 매장은 온라인 선결제로만 주문할 수 있습니다.",
      409,
    );
  }

  return policy;
}
