export type CustomerOrderRow = {
  id: string;
  created_at?: string | null;
  order_date?: string | null;
  display_no?: string | null;
  mode?: string | null;
  table_no?: string | null;
  buzzer_no?: string | null;
  request_note?: string | null;
  total_count?: number | null;
  refunded_count?: number | null;
  total_price?: number | null;
  adjusted_total_price?: number | null;
  refunded_amount?: number | null;
  status?: string | null;
  payment_status?: string | null;
  earned_points?: number | null;
  effective_earned_points?: number | null;
  points_rate_snapshot?: number | null;
  store_id?: string | null;
};

type CustomerOrderResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
  order?: CustomerOrderRow;
};

export async function fetchCustomerOrder(params: {
  storeId: string;
  orderId: string;
  accessToken: string;
}) {
  const response = await fetch("/api/orders/customer-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });

  const json = (await response.json().catch(() => null)) as CustomerOrderResponse | null;
  if (!response.ok || !json?.ok || !json.order) {
    const error = new Error(
      String(json?.message || "주문 정보를 불러오지 못했습니다."),
    ) as Error & { code?: string; status?: number };
    error.code = String(json?.code || "ORDER_LOOKUP_FAILED");
    error.status = response.status;
    throw error;
  }

  return json.order;
}
