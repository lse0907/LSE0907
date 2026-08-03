// src/app/done/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  CustomerTrustFooter,
  StoreIdentity,
} from "@/app/_components/CustomerBrand";
import { useStoreProfile } from "@/app/lib/storeProfile";
import {
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
  resolveStoreId,
} from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
type OrderStatus =
  | "new"
  | "checked"
  | "making"
  | "ready_for_packing"
  | "completed"
  | "cancelled";

type DbOrderRow = {
  id: string;
  created_at?: string | null;
  order_date?: string | null;
  display_no?: string | null;
  mode?: string | null;
  table_no?: string | null;
  buzzer_no?: string | null;
  request_note?: string | null;
  total_count?: number | null;
  total_price?: number | null;
  status?: string | null;
  store_id?: string | null;
};

type OrderView = {
  id: string;
  createdAt: number;
  orderDate: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  requestNote: string;
  totalCount: number;
  totalPrice: number;
  status: OrderStatus;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

const DONE_STATUS_COPY: Record<OrderStatus, { title: string; desc: string }> = {
  new: { title: "주문이 접수됐어요", desc: "주문번호를 확인해 주세요." },
  checked: {
    title: "매장이 확인했어요",
    desc: "상태 화면에서 진행 상황을 볼 수 있어요.",
  },
  making: {
    title: "메뉴를 준비 중이에요",
    desc: "상태 화면에서 진행 상황을 볼 수 있어요.",
  },
  ready_for_packing: {
    title: "준비가 완료됐어요",
    desc: "픽업/수령해 주세요.",
  },
  completed: { title: "수령 완료", desc: "이용해 주셔서 감사합니다." },
  cancelled: {
    title: "주문이 취소됐어요",
    desc: "필요하면 다시 주문해 주세요.",
  },
};

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function normalizeMode(v: unknown): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}

function normalizeStatus(v: unknown): OrderStatus {
  const s = String(v || "").trim();
  if (
    s === "checked" ||
    s === "making" ||
    s === "ready_for_packing" ||
    s === "completed" ||
    s === "cancelled"
  )
    return s;
  if (s === "ready") return "ready_for_packing";
  if (s === "done") return "completed";
  if (s === "canceled") return "cancelled";
  return "new";
}

function toOrderView(row: DbOrderRow): OrderView {
  const createdAtMs = row.created_at ? Date.parse(row.created_at) : Date.now();
  return {
    id: String(row.id),
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    orderDate: String(row.order_date || ""),
    displayNo: String(row.display_no || ""),
    mode: normalizeMode(row.mode),
    table: row.table_no ? String(row.table_no) : undefined,
    buzzerNo: row.buzzer_no ? String(row.buzzer_no) : undefined,
    requestNote: String(row.request_note || ""),
    totalCount: Math.max(0, Number(row.total_count ?? 0) || 0),
    totalPrice: Math.max(0, Number(row.total_price ?? 0) || 0),
    status: normalizeStatus(row.status),
  };
}

function DonePageInner() {
  const sp = useSearchParams();

  const orderIdFromQuery = useMemo(
    () => (sp.get("orderId") || "").trim(),
    [sp],
  );
  const accessTokenFromQuery = useMemo(
    () => (sp.get("accessToken") || "").trim(),
    [sp],
  );
  const storeFromQuery = useMemo(() => (sp.get("store") || "").trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const storeIdForLinks = useMemo(() => {
    if (storeFromQuery) return resolveStoreId(storeFromQuery);
    try {
      return resolveStoreId(
        (localStorage.getItem(LS_LAST_STORE_ID_KEY) || "").trim(),
      );
    } catch {
      return resolveStoreId("");
    }
  }, [storeFromQuery]);

  const accessTokenForLinks = useMemo(() => {
    if (accessTokenFromQuery) return accessTokenFromQuery;
    try {
      return (
        localStorage.getItem(lsLastOrderTokenKey(storeIdForLinks)) || ""
      ).trim();
    } catch {
      return "";
    }
  }, [accessTokenFromQuery, storeIdForLinks]);

  const homeHref = useMemo(() => {
    if (!storeIdForLinks) return "/";
    return `/?store=${encodeURIComponent(storeIdForLinks)}`;
  }, [storeIdForLinks]);
  const { profile: storeProfile } = useStoreProfile(storeIdForLinks);

  const globalPageStyle = (
    <style jsx global>{`
      :root {
        color-scheme: light;
      }
      body {
        background: #f6f7f9;
        color: #111827;
      }
    `}</style>
  );

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErrMsg("");

      // 1) storeId 결정: URL 우선 -> lastStoreId -> env
      const fallbackStoreId = (
        localStorage.getItem(LS_LAST_STORE_ID_KEY) || ""
      ).trim();
      const storeId = resolveStoreId(storeFromQuery || fallbackStoreId);

      // 2) orderId 결정
      const fallbackOrderId = (
        localStorage.getItem(lsLastOrderIdKey(storeId)) || ""
      ).trim();
      const fallbackAccessToken = (
        localStorage.getItem(lsLastOrderTokenKey(storeId)) || ""
      ).trim();
      const orderId = orderIdFromQuery || fallbackOrderId;
      const accessToken = accessTokenFromQuery || fallbackAccessToken;

      if (!orderId || !accessToken) {
        setOrder(null);
        setLoading(false);
        return;
      }

      // 3) DB 조회 (store 검증)
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,total_price,status,store_id",
        )
        .eq("id", orderId)
        .eq("store_id", storeId)
        .eq("access_token", accessToken)
        .maybeSingle();

      if (error) {
        console.error("[done] fetch order error:", error.message);
        setErrMsg(error.message);
        setOrder(null);
        setLoading(false);
        return;
      }

      if (!data) {
        setOrder(null);
        setLoading(false);
        return;
      }

      setOrder(toOrderView(data as DbOrderRow));
      setLoading(false);
    };

    run();
  }, [orderIdFromQuery, storeFromQuery, accessTokenFromQuery]);

  const cancelOrder = async () => {
    if (!order || cancelling) return;
    try {
      setCancelling(true);
      setErrMsg("");
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: "customer",
          storeId: storeIdForLinks,
          orderId: order.id,
          accessToken: accessTokenForLinks,
          reason: "고객 앱 주문 취소",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok)
        throw new Error(String(json?.message || "주문 취소 실패"));
      window.location.href = `/status?store=${encodeURIComponent(storeIdForLinks)}&orderId=${encodeURIComponent(order.id)}&accessToken=${encodeURIComponent(accessTokenForLinks)}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg || "취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <>
        {globalPageStyle}
        <main
          style={{
            padding: 24,
            maxWidth: 520,
            margin: "0 auto",
            color: "#111827",
          }}
        >
          <StoreIdentity
            name={storeProfile.storeName}
            logo={storeProfile.logoImage}
            compact
          />
          <h1 style={{ fontSize: 22, fontWeight: 900, marginTop: 24 }}>
            주문 접수 완료
          </h1>
          <p style={{ marginTop: 10, color: "#6b7280", fontWeight: 800 }}>
            주문 정보를 불러오는 중...
          </p>
        </main>
      </>
    );
  }

  if (!order) {
    return (
      <>
        {globalPageStyle}
        <main
          style={{
            padding: 24,
            maxWidth: 520,
            margin: "0 auto",
            color: "#111827",
          }}
        >
          <StoreIdentity
            name={storeProfile.storeName}
            logo={storeProfile.logoImage}
            compact
          />
          <h1 style={{ fontSize: 22, fontWeight: 900, marginTop: 24 }}>
            주문 접수 완료
          </h1>

          <p style={{ marginTop: 10, fontWeight: 850 }}>
            주문 정보를 찾을 수 없어요. {errMsg ? `(오류: ${errMsg})` : ""}
          </p>

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <Link
              href="/"
              style={{
                flex: 1,
                textAlign: "center",
                padding: 12,
                borderRadius: 10,
                border: "1px solid #ccc",
                textDecoration: "none",
                fontWeight: 900,
                color: "#111827",
                WebkitTextFillColor: "currentColor",
              }}
            >
              홈으로
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {globalPageStyle}
      <main
        style={{
          padding: 24,
          maxWidth: 520,
          margin: "0 auto",
          color: "#111827",
        }}
      >
        <StoreIdentity
          name={storeProfile.storeName}
          logo={storeProfile.logoImage}
          compact
        />
        <h1
          style={{
            fontSize: 28,
            fontWeight: 900,
            margin: "24px 0 0",
            color: "#0f1f3d",
          }}
        >
          {DONE_STATUS_COPY[order.status].title}
        </h1>
        <p style={{ margin: "8px 0 0", color: "#4b5563", fontWeight: 850 }}>
          {DONE_STATUS_COPY[order.status].desc}
        </p>

        <div style={{ marginTop: 10, color: "#444" }}>
          {order.mode === "dine-in" ? (
            <p style={{ margin: 0, fontWeight: 850 }}>
              매장 이용
              {order.table ? (
                <>
                  {" · "}테이블 <b>{order.table}</b>
                </>
              ) : null}
            </p>
          ) : (
            <p style={{ margin: 0, fontWeight: 850 }}>포장 주문</p>
          )}

          {order.status === "cancelled" ? (
            <p style={{ marginTop: 8, color: "#b45309", fontWeight: 950 }}>
              * 이 주문은 취소되었습니다.
            </p>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: 14, opacity: 0.7, fontWeight: 800 }}>
              주문번호
            </div>
            <div style={{ fontSize: 48, fontWeight: 950, marginTop: 6 }}>
              {order.displayNo}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 6,
              fontWeight: 850,
              color: "#111827",
            }}
          >
            <div>
              총 수량: <b>{order.totalCount}</b>
            </div>
            <div>
              총 금액: <b>{fmt(order.totalPrice)}원</b>
            </div>
          </div>

          <div
            style={{
              marginTop: 6,
              lineHeight: 1.5,
              fontWeight: 850,
              color: "#374151",
            }}
          >
            {order.status === "completed"
              ? "수령 처리가 완료되었습니다."
              : order.status === "cancelled"
                ? "취소된 주문입니다."
                : "상태 화면에서 준비 완료 알림을 확인할 수 있어요."}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <Link
            href={`/status?store=${encodeURIComponent(storeIdForLinks)}&orderId=${encodeURIComponent(
              order.id,
            )}&accessToken=${encodeURIComponent(accessTokenForLinks)}`}
            style={{
              flex: 1,
              textAlign: "center",
              padding: 12,
              borderRadius: 10,
              background: "#0f1f3d",
              color: "white",
              textDecoration: "none",
              fontWeight: 900,
            }}
          >
            주문 상태 보기
          </Link>

          <Link
            href={homeHref}
            style={{
              flex: 1,
              textAlign: "center",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ccc",
              textDecoration: "none",
              fontWeight: 900,
              color: "#111827",
              WebkitTextFillColor: "currentColor",
            }}
          >
            홈으로
          </Link>
        </div>
        {order.status === "new" ? (
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={cancelling}
            style={{
              marginTop: 10,
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontWeight: 900,
            }}
          >
            {cancelling ? "취소 처리 중..." : "주문 취소"}
          </button>
        ) : (
          <p style={{ marginTop: 10, color: "#6b7280", fontWeight: 800 }}>
            매장 확인 후에는 앱에서 직접 취소할 수 없어요.
          </p>
        )}

        {errMsg ? (
          <p style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900 }}>
            {errMsg}
          </p>
        ) : null}

        <CustomerTrustFooter />

        {showCancelConfirm ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,.45)",
              display: "grid",
              placeItems: "center",
              padding: 16,
              zIndex: 50,
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                background: "#fff",
                borderRadius: 18,
                padding: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>
                주문을 취소할까요?
              </h2>
              <p
                style={{
                  margin: "10px 0 0",
                  color: "#374151",
                  fontWeight: 800,
                }}
              >
                매장 확인 전까지만 취소할 수 있어요.
              </p>
              <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={cancelling}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    fontWeight: 950,
                  }}
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={cancelOrder}
                  disabled={cancelling}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #111827",
                    background: "#111827",
                    color: "#fff",
                    fontWeight: 950,
                  }}
                >
                  {cancelling ? "처리 중..." : "취소하기"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
export default function DonePagePage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <DonePageInner />
    </Suspense>
  );
}
