// src/app/confirm/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextDailySequence, format4, todayKey } from "../lib/orderNumber";
import { supabase } from "@/app/lib/supabaseClient";
import {
  getStoreIdFromSearchParams,
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
  lsOrdersKey,
} from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done" | "canceled";
type PaymentStatus = "not_required" | "pending" | "paid";

type SelectedOptionItem = {
  id: string;
  name: string;
  priceDelta: number;
};

type SelectedGroup = {
  groupId: string;
  groupName: string;
  required: boolean;
  min: number;
  max: number;
  items: SelectedOptionItem[];
};

type CartLine = {
  lineId: string;
  menuId: string;
  name: string;
  basePrice: number;
  qty: number;
  image?: string;
  options: SelectedGroup[];
  optionTotal: number;
};

type OrderRecord = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;

  items: Array<{
    id: string;
    name: string;
    price: number;
    qty: number;
    options?: SelectedGroup[];
    optionTotal?: number;
    lineTotal?: number;
  }>;

  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

function parseCart(cartParam: string | null): CartLine[] {
  if (!cartParam) return [];
  try {
    const decoded = decodeURIComponent(cartParam);
    const parsed = JSON.parse(decoded);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((x) => x && typeof x === "object")
      .map((x: any) => ({
        lineId: String(x.lineId || uuid()),
        menuId: String(x.menuId || x.id || ""),
        name: String(x.name || ""),
        basePrice: Number(x.basePrice ?? x.price ?? 0),
        qty: Math.max(0, Number(x.qty ?? 0)),
        image: typeof x.image === "string" ? x.image : "",
        options: Array.isArray(x.options) ? x.options : [],
        optionTotal: Number(x.optionTotal ?? 0),
      }))
      .filter((x) => x.menuId && x.qty > 0);
  } catch {
    return [];
  }
}

function loadOrders(storeId: string): OrderRecord[] {
  try {
    const raw = localStorage.getItem(lsOrdersKey(storeId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveOrders(storeId: string, list: OrderRecord[]) {
  localStorage.setItem(lsOrdersKey(storeId), JSON.stringify(list));
}

function isDuplicateDisplayNoError(msg: string) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("duplicate key value violates unique constraint") ||
    m.includes("orders_display_no_unique") ||
    m.includes("orders_store_date_display_no_unique") ||
    m.includes("unique constraint") ||
    m.includes("23505")
  );
}

export default function ConfirmPage() {
  const router = useRouter();
  const sp = useSearchParams();

  // ✅ 멀티매장 핵심: URL(store) > env fallback
  const storeId = useMemo(() => getStoreIdFromSearchParams(sp), [sp]);

  const tableFromMenu = (sp.get("table") || "").trim();
  const isTableQr = !!tableFromMenu;

  const cartLines = useMemo(() => parseCart(sp.get("cart")), [sp]);

  const totalCount = useMemo(
    () => cartLines.reduce((s, x) => s + (x.qty || 0), 0),
    [cartLines]
  );

  const totalPrice = useMemo(
    () =>
      cartLines.reduce(
        (s, x) => s + (x.basePrice + x.optionTotal) * (x.qty || 0),
        0
      ),
    [cartLines]
  );

  const [mode, setMode] = useState<OrderMode>(isTableQr ? "dine-in" : "takeout");
  const [tableInput, setTableInput] = useState<string>(tableFromMenu);

  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isPrepayStore, setIsPrepayStore] = useState(false);
  const [prepayLoading, setPrepayLoading] = useState(true);

  const effectiveMode: OrderMode = isTableQr ? "dine-in" : mode;

  const effectiveTable =
    effectiveMode === "dine-in"
      ? isTableQr
        ? tableFromMenu
        : tableInput.trim()
        ? tableInput.trim()
        : ""
      : "";

  const canSubmit = totalCount > 0 && !submitting && !prepayLoading;

  const fetchPrepayAddonActive = async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from("store_addons")
        .select("prepay_addon_status")
        .eq("store_id", storeId)
        .maybeSingle();

      if (error) return false;
      return String(data?.prepay_addon_status || "inactive") === "active";
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      const active = await fetchPrepayAddonActive();
      if (!mounted) return;
      setIsPrepayStore(active);
      setPrepayLoading(false);
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const resolvePaymentStatus = async (): Promise<PaymentStatus> => {
    const active = await fetchPrepayAddonActive();
    return active ? "paid" : "not_required";
  };

  // NOTE: helper name intentionally unique to avoid duplicate-declaration merge regressions.
  const insertOrderRowWithPaymentFallback = async (row: Record<string, unknown>) => {
    const first = await supabase.from("orders").insert([row]);
    if (!first.error) return first;

    const msg = String(first.error.message || "").toLowerCase();
    const missingPaymentColumn =
      msg.includes("payment_status") && (msg.includes("column") || msg.includes("schema cache"));

    if (!missingPaymentColumn) return first;

    const fallbackRow = { ...row } as Record<string, unknown>;
    delete fallbackRow.payment_status;
    return supabase.from("orders").insert([fallbackRow]);
  };

  const onSubmit = async () => {
    if (!canSubmit) return;

    try {
      setSubmitting(true);

      const orderId = uuid();
      const accessToken = uuid();
      const createdAtIso = new Date().toISOString();
      const orderDate = todayKey();

      let finalDisplayNo = "";
      const MAX_TRY = 5;
      const paymentStatus = await resolvePaymentStatus();

      if (paymentStatus === "paid") {
        const ok = window.confirm("결제 시뮬레이션을 완료 처리하고 주문을 접수할까요?");
        if (!ok) {
          setSubmitting(false);
          return;
        }
      }

      for (let attempt = 0; attempt < MAX_TRY; attempt++) {
        const seq = nextDailySequence();
        const displayNo = format4(seq);
        finalDisplayNo = displayNo;

        const orderRow: any = {
          id: orderId,
          access_token: accessToken,
          created_at: createdAtIso,
          order_date: orderDate,
          display_no: displayNo,
          mode: effectiveMode,
          table_no:
            effectiveMode === "dine-in" ? (effectiveTable || null) : null,
          request_note: requestNote.trim() || "",
          total_count: totalCount,
          total_price: Math.round(totalPrice),
          status: "new",
          payment_status: paymentStatus,
          store_id: storeId,
        };

        const { error: oErr } = await insertOrderRowWithPaymentFallback(orderRow);

        if (!oErr) break;

        const msg = oErr.message || String(oErr);
        const duplicated = isDuplicateDisplayNoError(msg);

        if (!duplicated || attempt === MAX_TRY - 1) {
          throw new Error(`[orders insert] ${msg}`);
        }
      }

      // order_items
      const orderItemRows: any[] = cartLines.map((ln) => {
        const orderItemId = uuid();
        (ln as any).__orderItemId = orderItemId;

        return {
          id: orderItemId,
          order_id: orderId,
          menu_id: ln.menuId,
          name: ln.name,
          price: Math.round(ln.basePrice),
          qty: Math.round(ln.qty),
          store_id: storeId,
        };
      });

      const { error: oiErr } = await supabase.from("order_items").insert(orderItemRows);
      if (oiErr) throw new Error(`[order_items insert] ${oiErr.message}`);

      // order_item_options
      const optionRows: any[] = [];
      for (const ln of cartLines) {
        const orderItemId = (ln as any).__orderItemId;
        const groups = Array.isArray(ln.options) ? ln.options : [];

        for (const g of groups) {
          const items = Array.isArray(g.items) ? g.items : [];
          for (const it of items) {
            optionRows.push({
              id: uuid(),
              order_item_id: orderItemId,
              group_id: g.groupId,
              option_id: it.id,
              name: it.name,
              price_delta: Math.round(Number(it.priceDelta || 0)),
              store_id: storeId,
            });
          }
        }
      }

      if (optionRows.length) {
        const { error: oioErr } = await supabase.from("order_item_options").insert(optionRows);
        if (oioErr) throw new Error(`[order_item_options insert] ${oioErr.message}`);
      }

      // 로컬 저장(임시 유지)
      const order: OrderRecord = {
        id: orderId,
        createdAt: Date.now(),
        orderDate,
        displayNo: finalDisplayNo,
        mode: effectiveMode,
        table:
          effectiveMode === "dine-in" ? (effectiveTable || undefined) : undefined,
        requestNote: requestNote.trim(),
        items: cartLines.map((ln) => {
          const unit = ln.basePrice + ln.optionTotal;
          return {
            id: ln.menuId,
            name: ln.name,
            price: ln.basePrice,
            qty: ln.qty,
            options: ln.options,
            optionTotal: ln.optionTotal,
            lineTotal: unit * ln.qty,
          };
        }),
        totalCount,
        totalPrice,
        status: "new",
        paymentStatus,
      };

      const list = loadOrders(storeId);
      list.unshift(order);
      saveOrders(storeId, list);

      // ✅ 핵심: lastOrderId + lastStoreId 함께 저장
      localStorage.setItem(lsLastOrderIdKey(storeId), orderId);
      localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
      localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);

      router.push(
        `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(
          orderId
        )}&accessToken=${encodeURIComponent(accessToken)}`
      );
    } catch (e: any) {
      console.error(e);
      alert(String(e?.message || e));
      setSubmitting(false);
    }
  };

  const goMenu = () => {
    const base = `/menu?store=${encodeURIComponent(storeId)}`;
    if (isTableQr) router.push(`${base}&table=${encodeURIComponent(tableFromMenu)}`);
    else router.push(base);
  };

  const modeBtnStyle = (active: boolean, disabled: boolean) => ({
    padding: 12,
    flex: 1,
    borderRadius: 12,
    border: active ? "2px solid #111" : "1px solid #ddd",
    background: "white",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 900,
    opacity: disabled ? 0.55 : 1,
  });

  const dineInDisabled = false;
  const takeoutDisabled = isTableQr;

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontWeight: 950 }}>주문 확인</h1>

      <div style={{ marginTop: 8, color: "#444", fontWeight: 800 }}>
        {isTableQr ? (
          <p style={{ margin: 0 }}>
            테이블 QR로 접속 · 테이블 <b>{tableFromMenu}</b> · <b>매장 이용</b>
          </p>
        ) : (
          <p style={{ margin: 0 }}>카운터 QR로 접속</p>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ margin: 0, fontWeight: 950 }}>주문 내역</h2>

        {cartLines.length === 0 ? (
          <p style={{ color: "crimson", fontWeight: 900, marginTop: 10 }}>
            장바구니 데이터가 없습니다. 메뉴에서 다시 담아주세요.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {cartLines.map((ln) => {
              const unit = ln.basePrice + ln.optionTotal;
              const optText =
                ln.options
                  .map((g) => {
                    if (!g.items?.length) return null;
                    return `${g.groupName}: ${g.items.map((x) => x.name).join(", ")}`;
                  })
                  .filter(Boolean)
                  .join(" / ") || "";

              return (
                <div
                  key={ln.lineId}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 14,
                    padding: 12,
                    background: "white",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 950 }}>
                      {ln.name} · {ln.qty}개
                    </div>
                    <div style={{ fontWeight: 950 }}>{fmt(unit * ln.qty)}원</div>
                  </div>

                  <div style={{ color: "#6b7280", fontWeight: 850, fontSize: 13 }}>
                    기본 {fmt(ln.basePrice)}원
                    {ln.optionTotal ? ` + 옵션 ${fmt(ln.optionTotal)}원` : ""}
                    {"  "}· 1개당 {fmt(unit)}원
                  </div>

                  {optText ? (
                    <div style={{ color: "#111827", fontWeight: 850, fontSize: 13 }}>
                      옵션: {optText}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, borderTop: "1px solid #eee", paddingTop: 14 }}>
        <div style={{ fontWeight: 900 }}>
          총 수량: <b>{totalCount}</b>
        </div>
        <div style={{ marginTop: 6, fontWeight: 900 }}>
          총 금액: <b>{fmt(totalPrice)}원</b>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontWeight: 950 }}>요청사항 (주문 전체 1개)</h2>
        <textarea
          value={requestNote}
          onChange={(e) => setRequestNote(e.target.value)}
          placeholder="예) 얼음 적게 / 덜 달게 (가능한 경우에만 반영됩니다)"
          style={{
            width: "100%",
            minHeight: 90,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            marginTop: 10,
          }}
        />
        <p style={{ marginTop: 8, color: "#666", fontWeight: 800 }}>
          * 요청사항은 참고용이며, 매장 상황에 따라 반영되지 않을 수 있습니다.
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <h2 style={{ margin: 0, fontWeight: 950 }}>이용 방식 선택</h2>

        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <button
            onClick={() => {
              if (isTableQr) return;
              setMode("dine-in");
            }}
            disabled={isTableQr}
            style={modeBtnStyle(effectiveMode === "dine-in", dineInDisabled)}
          >
            매장 이용
          </button>

          <button
            onClick={() => {
              if (isTableQr) return;
              setMode("takeout");
            }}
            disabled={isTableQr}
            style={modeBtnStyle(effectiveMode === "takeout", takeoutDisabled)}
          >
            포장
          </button>
        </div>

        {effectiveMode === "dine-in" && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", color: "#444", fontWeight: 900 }}>
              테이블 번호 {isTableQr ? "(고정)" : "(선택)"}
              <input
                value={isTableQr ? tableFromMenu : tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                placeholder="예: 3"
                disabled={isTableQr}
                readOnly={isTableQr}
                style={{
                  display: "block",
                  marginTop: 8,
                  padding: 10,
                  width: 200,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: isTableQr ? "#f3f4f6" : "white",
                  color: "#111",
                  fontWeight: 900,
                  opacity: isTableQr ? 0.9 : 1,
                  cursor: isTableQr ? "not-allowed" : "text",
                }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
        <button onClick={goMenu} style={{ padding: 12, flex: 1, fontWeight: 900 }}>
          메뉴로 돌아가기
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            padding: 12,
            flex: 1,
            opacity: canSubmit ? 1 : 0.5,
            fontWeight: 900,
          }}
        >
          {submitting ? "저장 중..." : isPrepayStore ? "결제하기" : "주문 접수"}
        </button>
      </div>

      <p style={{ marginTop: 8, color: "#6b7280", fontWeight: 800, fontSize: 13 }}>
        {prepayLoading
          ? "매장 결제 옵션 확인 중..."
          : isPrepayStore
          ? "결제 완료 후 주문이 접수됩니다."
          : "결제는 매장에서 진행됩니다."}
      </p>
    </main>
  );
}
