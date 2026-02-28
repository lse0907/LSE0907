// src/app/done/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { lsLastOrderIdKey, lsLastOrderTokenKey, resolveStoreId } from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "making" | "ready" | "done" | "canceled";

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

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function normalizeMode(v: any): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}

function normalizeStatus(v: any): OrderStatus {
  const s = String(v || "").trim();
  if (s === "making" || s === "ready" || s === "done" || s === "canceled") return s;
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

  const orderIdFromQuery = useMemo(() => (sp.get("orderId") || "").trim(), [sp]);
  const accessTokenFromQuery = useMemo(() => (sp.get("accessToken") || "").trim(), [sp]);
  const storeFromQuery = useMemo(() => (sp.get("store") || "").trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

  const storeIdForLinks = useMemo(() => {
    if (storeFromQuery) return resolveStoreId(storeFromQuery);
    try {
      return resolveStoreId((localStorage.getItem(LS_LAST_STORE_ID_KEY) || "").trim());
    } catch {
      return resolveStoreId("");
    }
  }, [storeFromQuery]);

  const accessTokenForLinks = useMemo(() => {
    if (accessTokenFromQuery) return accessTokenFromQuery;
    try {
      return (localStorage.getItem(lsLastOrderTokenKey(storeIdForLinks)) || "").trim();
    } catch {
      return "";
    }
  }, [accessTokenFromQuery, storeIdForLinks]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErrMsg("");

      // 1) storeId 결정: URL 우선 -> lastStoreId -> env
      const fallbackStoreId = (localStorage.getItem(LS_LAST_STORE_ID_KEY) || "").trim();
      const storeId = resolveStoreId(storeFromQuery || fallbackStoreId);

      // 2) orderId 결정
      const fallbackOrderId = (localStorage.getItem(lsLastOrderIdKey(storeId)) || "").trim();
      const fallbackAccessToken = (localStorage.getItem(lsLastOrderTokenKey(storeId)) || "").trim();
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
          "id,created_at,order_date,display_no,mode,table_no,buzzer_no,request_note,total_count,total_price,status,store_id"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIdFromQuery, storeFromQuery, accessTokenFromQuery]);

  if (loading) {
    return (
      <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>주문 접수 완료</h1>
        <p style={{ marginTop: 10, color: "#6b7280", fontWeight: 800 }}>
          주문 정보를 불러오는 중...
        </p>
      </main>
    );
  }

  if (!order) {
    return (
      <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900 }}>주문 접수 완료</h1>

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
            }}
          >
            홈으로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>주문 접수 완료</h1>

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

        {order.status === "canceled" ? (
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
          <div style={{ fontSize: 14, opacity: 0.7, fontWeight: 800 }}>주문번호</div>
          <div style={{ fontSize: 48, fontWeight: 950, marginTop: 6 }}>
            {order.displayNo}
          </div>
        </div>

        <div style={{ display: "grid", gap: 6, fontWeight: 850, color: "#111827" }}>
          <div>
            총 수량: <b>{order.totalCount}</b>
          </div>
          <div>
            총 금액: <b>{fmt(order.totalPrice)}원</b>
          </div>
        </div>

        <div style={{ marginTop: 6, lineHeight: 1.5, fontWeight: 850, color: "#374151" }}>
          이 주문번호는 자동 저장됩니다. <br />
          페이지를 나갔다가 다시 들어와도 <b>메뉴 화면 상단</b>에서 상태를 다시 볼 수 있어요.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <Link
          href={`/status?store=${encodeURIComponent(storeIdForLinks)}&orderId=${encodeURIComponent(
            order.id
          )}&accessToken=${encodeURIComponent(accessTokenForLinks)}`}
          style={{
            flex: 1,
            textAlign: "center",
            padding: 12,
            borderRadius: 10,
            background: "black",
            color: "white",
            textDecoration: "none",
            fontWeight: 900,
          }}
        >
          주문 상태 보기
        </Link>

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
          }}
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
export default function DonePagePage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <DonePageInner />
    </Suspense>
  );
}