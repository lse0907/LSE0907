"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { nextDailySequence, format4, todayKey } from "@/app/lib/orderNumber";
import { supabase } from "@/app/lib/supabaseClient";
import { lsLastOrderIdKey, lsLastOrderTokenKey } from "@/app/lib/storeScope";

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

type PendingPrepay = {
  createdAt: number;
  storeId: string;
  customerUserId?: string | null;
  cartLines: CartLine[];
  mode: "dine-in" | "takeout";
  table: string;
  requestNote: string;
  totalCount: number;
  totalPrice: number;
  usedPoints?: number;
  usedCouponId?: string | null;
};

const PREPAY_PENDING_KEY = "qrCafePrepayPending";
const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

function ConfirmSuccessPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => String(sp.get("store") || "").trim(), [sp]);
  const poid = useMemo(() => String(sp.get("poid") || "").trim(), [sp]);
  const paymentKey = useMemo(() => String(sp.get("paymentKey") || "").trim(), [sp]);
  const orderId = useMemo(() => String(sp.get("orderId") || "").trim(), [sp]);
  const amount = useMemo(() => Number(sp.get("amount") || 0), [sp]);

  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("결제 승인 확인을 준비중입니다.");

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!storeId || !poid || !paymentKey || !orderId || !Number.isFinite(amount) || amount <= 0) {
        setStatus("error");
        setMessage("결제 결과 파라미터가 올바르지 않습니다.");
        return;
      }

      const raw = localStorage.getItem(`${PREPAY_PENDING_KEY}:${poid}`);
      if (!raw) {
        setStatus("error");
        setMessage("임시 주문 데이터가 없습니다. 다시 주문해주세요.");
        return;
      }

      let pending: PendingPrepay;
      try {
        pending = JSON.parse(raw) as PendingPrepay;
      } catch {
        setStatus("error");
        setMessage("임시 주문 데이터 파싱에 실패했습니다.");
        return;
      }

      if (!pending || pending.storeId !== storeId || !Array.isArray(pending.cartLines) || !pending.cartLines.length) {
        setStatus("error");
        setMessage("임시 주문 데이터가 유효하지 않습니다.");
        return;
      }

      try {
        if (mounted) {
          setStatus("working");
          setMessage("토스 결제 승인 확인 중...");
        }

        const confirmRes = await fetch("/api/payments/toss/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentKey, orderId, amount, storeId }),
        });

        const confirmJson = await confirmRes.json();
        if (!confirmRes.ok || !confirmJson?.ok) {
          throw new Error(String(confirmJson?.message || "결제 승인 확인에 실패했습니다."));
        }

        const newOrderId = uuid();
        const accessToken = uuid();
        const createdAtIso = new Date().toISOString();
        const orderDate = todayKey();

        const MAX_TRY = 5;

        for (let attempt = 0; attempt < MAX_TRY; attempt++) {
          const seq = nextDailySequence();
          const displayNo = format4(seq);
          const orderRow: Record<string, unknown> = {
            id: newOrderId,
            access_token: accessToken,
            created_at: createdAtIso,
            order_date: orderDate,
            display_no: displayNo,
            mode: pending.mode,
            table_no: pending.mode === "dine-in" ? pending.table || null : null,
            request_note: pending.requestNote?.trim() || "",
            total_count: pending.totalCount,
            total_price: Math.round(pending.totalPrice),
            status: "new",
            payment_status: "paid",
            store_id: storeId,
          };

          const insertOrder = await supabase.from("orders").insert([orderRow]);
          if (!insertOrder.error) break;

          const msg = insertOrder.error.message || String(insertOrder.error);
          const duplicated = isDuplicateDisplayNoError(msg);
          if (!duplicated || attempt === MAX_TRY - 1) {
            throw new Error(`[orders insert] ${msg}`);
          }
        }

        const orderItemRows: Array<Record<string, unknown>> = pending.cartLines.map((ln) => {
          const orderItemId = uuid();
          (ln as unknown as { __orderItemId?: string }).__orderItemId = orderItemId;
          return {
            id: orderItemId,
            order_id: newOrderId,
            menu_id: ln.menuId,
            name: ln.name,
            price: Math.round(ln.basePrice),
            qty: Math.round(ln.qty),
            store_id: storeId,
          };
        });

        const { error: oiErr } = await supabase.from("order_items").insert(orderItemRows);
        if (oiErr) throw new Error(`[order_items insert] ${oiErr.message}`);

        const optionRows: Array<Record<string, unknown>> = [];
        for (const ln of pending.cartLines) {
          const orderItemId = (ln as unknown as { __orderItemId?: string }).__orderItemId;
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

        if (pending.customerUserId) {
          const { error: loyaltyErr } = await supabase.rpc("apply_loyalty_on_paid_order", {
            p_order_id: newOrderId,
            p_store_id: storeId,
            p_customer_user_id: pending.customerUserId,
            p_order_amount: Math.round(pending.totalPrice),
            p_used_points: Math.max(0, Number(pending.usedPoints || 0)),
            p_used_coupon_id: pending.usedCouponId || null,
            p_idempotency_key: `${newOrderId}:loyalty`,
          });
          if (loyaltyErr) {
            console.warn("[loyalty] apply failed:", loyaltyErr.message);
          }
        }

        localStorage.setItem(lsLastOrderIdKey(storeId), newOrderId);
        localStorage.setItem(lsLastOrderTokenKey(storeId), accessToken);
        localStorage.setItem(LS_LAST_STORE_ID_KEY, storeId);
        localStorage.removeItem(`${PREPAY_PENDING_KEY}:${poid}`);

        if (mounted) {
          setStatus("done");
          setMessage("결제 승인 완료! 주문을 생성했습니다.");
        }

        router.replace(
          `/done?store=${encodeURIComponent(storeId)}&orderId=${encodeURIComponent(newOrderId)}&accessToken=${encodeURIComponent(accessToken)}`
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mounted) {
          setStatus("error");
          setMessage(msg || "결제 처리 중 오류가 발생했습니다.");
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [amount, orderId, paymentKey, poid, router, storeId]);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1 style={{ margin: 0, fontWeight: 950 }}>결제 처리</h1>
      <p style={{ marginTop: 12, color: status === "error" ? "crimson" : "#374151", fontWeight: 800 }}>{message}</p>
      {status === "error" ? (
        <button
          onClick={() => router.push(`/confirm?store=${encodeURIComponent(storeId)}`)}
          style={{ marginTop: 12, padding: 12, borderRadius: 12, fontWeight: 900 }}
        >
          주문 확인 화면으로 돌아가기
        </button>
      ) : null}
    </main>
  );
}
export default function ConfirmSuccessPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <ConfirmSuccessPageInner />
    </Suspense>
  );
}
