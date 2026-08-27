import { SupabaseClient } from "@supabase/supabase-js";

export type OrderMode = "dine-in" | "takeout";
export type PaymentStatus = "not_required" | "pending" | "paid";

type SelectedOptionItemInput = {
  id?: unknown;
  qty?: unknown;
};

type SelectedGroupInput = {
  groupId?: unknown;
  items?: unknown;
};

type CartLineInput = {
  menuId?: unknown;
  id?: unknown;
  qty?: unknown;
  options?: unknown;
};

type MenuRow = {
  id: string;
  name: string | null;
  price: number | null;
  is_sold_out?: boolean | null;
  option_group_ids?: string[] | null;
};

type OptionGroupRow = {
  id: string;
  name: string | null;
  required?: boolean | null;
  min?: number | null;
  max?: number | null;
};

type OptionItemRow = {
  id: string;
  group_id: string | null;
  name: string | null;
  price_delta?: number | null;
};

type MenuOptionPriceRow = {
  menu_id: string | null;
  option_item_id: string | null;
  price_delta?: number | null;
};

type CouponTemplateRow = {
  name?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  min_order_amount?: number | null;
  max_discount_amount?: number | null;
};

type CouponRow = {
  id: string;
  status?: string | null;
  expires_at?: string | null;
  coupon_name_snapshot?: string | null;
  discount_type_snapshot?: string | null;
  discount_value_snapshot?: number | null;
  min_order_amount_snapshot?: number | null;
  max_discount_amount_snapshot?: number | null;
  template?: CouponTemplateRow | CouponTemplateRow[] | null;
};

export type ValidatedCartLine = {
  lineId: string;
  menuId: string;
  name: string;
  basePrice: number;
  qty: number;
  options: Array<{
    groupId: string;
    groupName: string;
    required: boolean;
    min: number;
    max: number;
    items: Array<{
      id: string;
      name: string;
      priceDelta: number;
      qty: number;
    }>;
  }>;
  optionTotal: number;
  lineTotal: number;
};

export type ValidatedOrder = {
  cartLines: ValidatedCartLine[];
  totalCount: number;
  totalPrice: number;
  usedPoints: number;
  usedCouponId: string | null;
  couponDiscount: number;
  effectiveDiscount: number;
  payableAmount: number;
};

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toId(v: unknown) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function toInt(v: unknown, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeCartLines(raw: unknown): Array<{ menuId: string; qty: number; options: Array<{ groupId: string; items: Array<{ id: string; qty: number }> }> }> {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((row): row is CartLineInput => !!row && typeof row === "object")
    .map((row) => {
      const menuId = toId(row.menuId || row.id);
      const qty = Math.max(0, toInt(row.qty, 0));
      const groups = Array.isArray(row.options) ? row.options : [];
      const options = groups
        .filter((group): group is SelectedGroupInput => !!group && typeof group === "object")
        .map((group) => {
          const itemsRaw = Array.isArray(group.items) ? group.items : [];
          const items = itemsRaw
            .filter((item): item is SelectedOptionItemInput => !!item && typeof item === "object")
            .map((item) => ({ id: toId(item.id), qty: Math.max(0, toInt(item.qty, 1)) }))
            .filter((item) => item.id && item.qty > 0);
          return { groupId: toId(group.groupId), items };
        })
        .filter((group) => group.groupId);
      return { menuId, qty, options };
    })
    .filter((row) => row.menuId && row.qty > 0);
}

function normalizeOptionGroupIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => toId(v)).filter(Boolean);
}

function couponTemplate(row: CouponRow): CouponTemplateRow | null {
  const joined = Array.isArray(row.template) ? row.template[0] || null : row.template || null;
  if (joined) return joined;
  if (!row.discount_type_snapshot || row.discount_value_snapshot == null || row.min_order_amount_snapshot == null) return null;
  return {
    name: row.coupon_name_snapshot || "발급 쿠폰",
    discount_type: row.discount_type_snapshot,
    discount_value: row.discount_value_snapshot,
    min_order_amount: row.min_order_amount_snapshot,
    max_discount_amount: row.max_discount_amount_snapshot ?? null,
  };
}

function calculateCouponDiscount(tpl: CouponTemplateRow | null, orderAmount: number) {
  if (!tpl) return 0;
  const minOrderAmount = Math.max(0, toInt(tpl.min_order_amount, 0));
  if (orderAmount < minOrderAmount) return 0;

  const value = Math.max(0, Number(tpl.discount_value || 0));
  if (tpl.discount_type === "fixed_amount") return Math.min(orderAmount, Math.floor(value));
  if (tpl.discount_type === "percent") {
    const raw = Math.floor((orderAmount * value) / 100);
    const cap = tpl.max_discount_amount == null ? raw : Math.max(0, toInt(tpl.max_discount_amount, 0));
    return Math.min(orderAmount, Math.min(raw, cap));
  }
  return 0;
}

export async function validateOrderPayload(params: {
  supabaseAdmin: SupabaseClient;
  storeId: string;
  cartLines: unknown;
  customerUserId?: string | null;
  usedPoints?: unknown;
  usedCouponId?: unknown;
}) {
  const storeId = toId(params.storeId);
  if (!storeId) throw new Error("매장 정보가 없습니다.");

  const inputLines = normalizeCartLines(params.cartLines);
  if (!inputLines.length) throw new Error("장바구니가 비어 있습니다.");
  if (inputLines.length > 80) throw new Error("한 번에 주문할 수 있는 메뉴 종류가 너무 많습니다.");

  const menuIds = Array.from(new Set(inputLines.map((line) => line.menuId)));
  const { data: menuData, error: menuErr } = await params.supabaseAdmin
    .from("menu_items")
    .select("id,name,price,is_sold_out,option_group_ids")
    .eq("store_id", storeId)
    .in("id", menuIds);
  if (menuErr) throw new Error(`메뉴 검증 실패: ${menuErr.message}`);

  const menuMap = new Map((Array.isArray(menuData) ? (menuData as MenuRow[]) : []).map((row) => [String(row.id), row]));
  for (const id of menuIds) {
    if (!menuMap.has(id)) throw new Error("현재 판매 중이 아닌 메뉴가 포함되어 있습니다.");
  }

  for (const menu of menuMap.values()) {
    if (menu.is_sold_out) throw new Error(`품절 메뉴가 포함되어 있습니다: ${menu.name || menu.id}`);
  }

  const groupIds = Array.from(
    new Set(
      Array.from(menuMap.values())
        .flatMap((menu) => normalizeOptionGroupIds(menu.option_group_ids))
        .filter(Boolean)
    )
  );

  const selectedOptionIds = Array.from(
    new Set(inputLines.flatMap((line) => line.options.flatMap((group) => group.items.map((item) => item.id))))
  );

  const [groupRes, itemRes, priceRes] = await Promise.all([
    groupIds.length
      ? params.supabaseAdmin.from("option_groups").select("id,name,required,min,max").eq("store_id", storeId).in("id", groupIds)
      : Promise.resolve({ data: [], error: null }),
    selectedOptionIds.length
      ? params.supabaseAdmin.from("option_items").select("id,group_id,name,price_delta").eq("store_id", storeId).in("id", selectedOptionIds)
      : Promise.resolve({ data: [], error: null }),
    selectedOptionIds.length
      ? params.supabaseAdmin
          .from("menu_option_prices")
          .select("menu_id,option_item_id,price_delta")
          .eq("store_id", storeId)
          .in("menu_id", menuIds)
          .in("option_item_id", selectedOptionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (groupRes.error) throw new Error(`옵션 그룹 검증 실패: ${groupRes.error.message}`);
  if (itemRes.error) throw new Error(`옵션 항목 검증 실패: ${itemRes.error.message}`);
  if (priceRes.error) throw new Error(`옵션 가격 검증 실패: ${priceRes.error.message}`);

  const groupMap = new Map((Array.isArray(groupRes.data) ? (groupRes.data as OptionGroupRow[]) : []).map((row) => [String(row.id), row]));
  const itemMap = new Map((Array.isArray(itemRes.data) ? (itemRes.data as OptionItemRow[]) : []).map((row) => [String(row.id), row]));
  const priceMap = new Map<string, number>();
  for (const row of Array.isArray(priceRes.data) ? (priceRes.data as MenuOptionPriceRow[]) : []) {
    const menuId = toId(row.menu_id);
    const optionId = toId(row.option_item_id);
    if (menuId && optionId) priceMap.set(`${menuId}:${optionId}`, Math.round(Number(row.price_delta ?? 0)));
  }

  const validatedLines: ValidatedCartLine[] = inputLines.map((line) => {
    const menu = menuMap.get(line.menuId)!;
    const menuGroupIds = normalizeOptionGroupIds(menu.option_group_ids);
    const selectedByGroup = new Map(line.options.map((group) => [group.groupId, group]));
    const groups = [] as ValidatedCartLine["options"];
    let optionTotal = 0;

    for (const groupId of menuGroupIds) {
      const group = groupMap.get(groupId);
      if (!group) continue;

      const selected = selectedByGroup.get(groupId);
      const selectedItems = selected?.items || [];
      const selectedQty = selectedItems.reduce((sum, item) => sum + Math.max(0, Number(item.qty || 0)), 0);
      const requiredMin = group.required ? 1 : 0;
      const min = Math.max(requiredMin, Math.max(0, toInt(group.min, 0)));
      const max = Math.max(min, toInt(group.max, min));

      if (selectedQty < min) throw new Error(`“${group.name || "옵션"}” 옵션은 최소 ${min}개 선택이 필요합니다.`);
      if (selectedQty > max) throw new Error(`“${group.name || "옵션"}” 옵션은 최대 ${max}개까지 선택 가능합니다.`);

      const items = selectedItems.map((selectedItem) => {
        const item = itemMap.get(selectedItem.id);
        if (!item || String(item.group_id || "") !== groupId) {
          throw new Error("현재 메뉴에 사용할 수 없는 옵션이 포함되어 있습니다.");
        }
        const priceDelta = priceMap.get(`${line.menuId}:${selectedItem.id}`) ?? Math.round(Number(item.price_delta ?? 0));
        const qty = Math.max(1, toInt(selectedItem.qty, 1));
        optionTotal += priceDelta * qty;
        return {
          id: String(item.id),
          name: String(item.name || "옵션"),
          priceDelta,
          qty,
        };
      });

      if (items.length) {
        groups.push({
          groupId,
          groupName: String(group.name || "옵션"),
          required: !!group.required,
          min,
          max,
          items,
        });
      }
    }

    const unexpected = line.options.find((group) => !menuGroupIds.includes(group.groupId) && group.items.length > 0);
    if (unexpected) throw new Error("현재 메뉴에 연결되지 않은 옵션이 포함되어 있습니다.");

    const basePrice = Math.max(0, Math.round(Number(menu.price ?? 0)));
    const qty = Math.max(1, toInt(line.qty, 1));
    return {
      lineId: uuid(),
      menuId: String(menu.id),
      name: String(menu.name || "메뉴"),
      basePrice,
      qty,
      options: groups,
      optionTotal,
      lineTotal: (basePrice + optionTotal) * qty,
    };
  });

  const totalCount = validatedLines.reduce((sum, line) => sum + line.qty, 0);
  const totalPrice = validatedLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const customerUserId = toId(params.customerUserId);
  const requestedCouponId = toId(params.usedCouponId);
  let couponDiscount = 0;
  let usedCouponId: string | null = null;

  if (customerUserId && requestedCouponId) {
    const { data, error } = await params.supabaseAdmin
      .from("customer_coupons")
      .select(
        "id,status,expires_at,coupon_name_snapshot,discount_type_snapshot,discount_value_snapshot,min_order_amount_snapshot,max_discount_amount_snapshot,template:store_coupon_templates(name,discount_type,discount_value,min_order_amount,max_discount_amount)"
      )
      .eq("id", requestedCouponId)
      .eq("store_id", storeId)
      .eq("customer_user_id", customerUserId)
      .maybeSingle();
    if (error) throw new Error(`쿠폰 검증 실패: ${error.message}`);
    const coupon = data as CouponRow | null;
    const expiresAtMs = coupon?.expires_at ? new Date(coupon.expires_at).getTime() : null;
    const usable = coupon && coupon.status === "issued" && (!expiresAtMs || expiresAtMs >= Date.now());
    if (usable) {
      couponDiscount = calculateCouponDiscount(couponTemplate(coupon), totalPrice);
      if (couponDiscount > 0) usedCouponId = coupon.id;
    }
  }

  let usedPoints = 0;
  if (customerUserId && !usedCouponId) {
    const requestedPoints = Math.max(0, toInt(params.usedPoints, 0));
    if (requestedPoints > 0) {
      const [walletRes, settingsRes] = await Promise.all([
        params.supabaseAdmin
          .from("customer_point_summaries")
          .select("point_balance")
          .eq("store_id", storeId)
          .eq("customer_user_id", customerUserId)
          .maybeSingle(),
        params.supabaseAdmin
          .from("store_loyalty_settings")
          .select("max_redeem_pct,min_redeem_points")
          .eq("store_id", storeId)
          .maybeSingle(),
      ]);
      if (walletRes.error) throw new Error(`포인트 검증 실패: ${walletRes.error.message}`);
      if (settingsRes.error) throw new Error(`포인트 정책 검증 실패: ${settingsRes.error.message}`);
      const balance = Math.max(0, toInt((walletRes.data as { point_balance?: number } | null)?.point_balance, 0));
      const maxPct = Math.min(100, Math.max(0, Number((settingsRes.data as { max_redeem_pct?: number } | null)?.max_redeem_pct ?? 30)));
      const minRedeem = Math.max(0, toInt((settingsRes.data as { min_redeem_points?: number } | null)?.min_redeem_points, 100));
      const byPolicy = Math.floor((totalPrice * maxPct) / 100);
      usedPoints = requestedPoints < minRedeem ? 0 : Math.min(requestedPoints, balance, byPolicy, totalPrice);
    }
  }

  const effectiveDiscount = usedCouponId ? couponDiscount : usedPoints;
  const payableAmount = Math.max(0, Math.round(totalPrice) - effectiveDiscount);

  return {
    cartLines: validatedLines,
    totalCount,
    totalPrice: Math.round(totalPrice),
    usedPoints,
    usedCouponId,
    couponDiscount,
    effectiveDiscount,
    payableAmount,
  } satisfies ValidatedOrder;
}
