import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  createRequestSupabaseClient,
  createSupabaseAdminClient,
  requireStoreRole,
} from "../../../../_lib/storeAuth";
import { recordSecurityEvent } from "../../../members/_lib";

type SearchBody = {
  storeId?: string;
  query?: string;
  tier?: string;
  minPoints?: number;
  minOrders?: number;
  minSpent?: number;
  recentDays?: number | null;
  inactiveDays?: number | null;
  registeredMinDays?: number | null;
  templateId?: string;
  excludeExisting?: boolean;
  limit?: number;
};

type RawTargetRow = {
  customer_user_id?: string | null;
  name?: string | null;
  phone?: string | null;
  point_balance?: number | null;
  tier?: string | null;
  lifetime_spent?: number | null;
  lifetime_orders?: number | null;
  last_order_at?: string | null;
  registered_at?: string | null;
  already_has_coupon?: boolean | null;
};

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function optionalDays(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return boundedInteger(value, 0, 3650, 0);
}

function maskPhone(phone: unknown) {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  return digits.length >= 4 ? `끝자리 ${digits.slice(-4)}` : "전화번호 없음";
}

function maskCustomerName(name: unknown) {
  const value = String(name || "").trim();
  if (!value) return null;
  if (value.length <= 1) return value;
  if (/^[a-zA-Z\s]+$/.test(value)) {
    return `${value[0]}${"*".repeat(Math.min(value.replace(/\s/g, "").length - 1, 3))}`;
  }
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(value.length - 2)}${value[value.length - 1]}`;
}

function isLegacyRpcAuthError(message: string) {
  return message.includes("Authentication required") || message.includes("로그인이 필요합니다");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SearchBody;
    const storeId = String(body.storeId || "").trim();
    const templateId = String(body.templateId || "").trim();
    if (!storeId || !templateId) {
      throw new ApiError(400, "매장과 쿠폰을 확인해주세요.", "CUSTOMER_SEARCH_INPUT_INVALID");
    }

    const tier = ["all", "general", "regular", "vip"].includes(String(body.tier || "all"))
      ? String(body.tier || "all")
      : "all";
    const query = String(body.query || "").trim().slice(0, 100);
    const args = {
      p_store_id: storeId,
      p_query: query,
      p_tier: tier,
      p_min_points: boundedInteger(body.minPoints, 0, 1_000_000_000, 0),
      p_min_orders: boundedInteger(body.minOrders, 0, 1_000_000, 0),
      p_min_spent: boundedInteger(body.minSpent, 0, 2_000_000_000, 0),
      p_recent_days: optionalDays(body.recentDays),
      p_inactive_days: optionalDays(body.inactiveDays),
      p_registered_min_days: optionalDays(body.registeredMinDays),
      p_template_id: templateId,
      p_exclude_existing: body.excludeExisting !== false,
      p_limit: boundedInteger(body.limit, 1, 200, 100),
    };

    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await requireStoreRole({ req, supabaseAdmin, storeId, allowedRoles: ["owner"] });

    let result = await supabaseAdmin.rpc("admin_search_coupon_targets", args);
    // Safe rollout compatibility: before the hardening migration, the legacy
    // function requires auth.uid(). The route still enforces Owner first and
    // keeps the unmasked result on the server during this temporary fallback.
    if (result.error && isLegacyRpcAuthError(result.error.message)) {
      result = await createRequestSupabaseClient(req).rpc("admin_search_coupon_targets", args);
    }
    if (result.error) {
      throw new ApiError(400, `대상 고객 검색 실패: ${result.error.message}`, "CUSTOMER_SEARCH_FAILED");
    }

    const customers = ((Array.isArray(result.data) ? result.data : []) as RawTargetRow[])
      .filter((row) => Boolean(row.customer_user_id))
      .map((row) => ({
        customer_user_id: String(row.customer_user_id),
        nameMasked: maskCustomerName(row.name),
        phoneMasked: maskPhone(row.phone),
        point_balance: Number(row.point_balance || 0),
        tier: ["general", "regular", "vip"].includes(String(row.tier)) ? String(row.tier) : "general",
        lifetime_spent: Number(row.lifetime_spent || 0),
        lifetime_orders: Number(row.lifetime_orders || 0),
        last_order_at: row.last_order_at || null,
        registered_at: row.registered_at || null,
        already_has_coupon: Boolean(row.already_has_coupon),
      }));

    await recordSecurityEvent(supabaseAdmin, {
      storeId,
      userId: actor.userId,
      eventType: "customer_target_search",
      metadata: {
        templateId,
        resultCount: customers.length,
        hasQuery: Boolean(query),
        tierFiltered: tier !== "all",
        pointsFiltered: args.p_min_points > 0,
        ordersFiltered: args.p_min_orders > 0,
        spentFiltered: args.p_min_spent > 0,
        recentFiltered: args.p_recent_days !== null,
        inactiveFiltered: args.p_inactive_days !== null,
        registeredFiltered: args.p_registered_min_days !== null,
        excludeExisting: args.p_exclude_existing,
      },
    });

    return NextResponse.json({ ok: true, customers });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
