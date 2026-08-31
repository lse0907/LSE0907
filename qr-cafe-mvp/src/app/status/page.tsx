// src/app/status/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  fetchCustomerOrder,
  type CustomerOrderRow,
} from "@/app/lib/customerOrder";
import {
  CustomerTrustFooter,
  StoreCustomerHeader,
} from "@/app/_components/StoreCustomerBrand";
import { CustomerIcon } from "@/app/_components/CustomerIcon";
import { CustomerOrderProgress } from "@/app/_components/CustomerOrderProgress";
import {
  lsLastOrderIdKey,
  lsLastOrderTokenKey,
  persistLastOrderAccess,
  removeAccessTokenFromCurrentUrl,
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
type PaymentStatus = "not_required" | "pending" | "paid" | "cancel_pending" | "refunded" | "failed" | "partial_refund_pending" | "partially_refunded";

type DbOrderRow = CustomerOrderRow;

type OrderView = {
  id: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  earnedPoints: number;
  pointsRate: number;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "접수됨",
  checked: "주문확인",
  making: "제조중",
  ready_for_packing: "준비완료",
  completed: "수령완료",
  cancelled: "취소됨",
};

const STATUS_COPY: Record<OrderStatus, { title: string; desc: string }> = {
  new: { title: "주문이 접수됐어요", desc: "매장 확인을 기다리고 있어요." },
  checked: { title: "매장이 확인했어요", desc: "곧 제조가 시작됩니다." },
  making: { title: "메뉴를 준비 중이에요", desc: "잠시만 기다려 주세요." },
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

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  not_required: "현장결제",
  pending: "결제 확인 중",
  paid: "결제 완료",
  cancel_pending: "결제 취소 처리 중",
  refunded: "결제 취소 완료",
  partial_refund_pending: "부분 환불 처리 중",
  partially_refunded: "부분 환불 완료",
  failed: "결제 확인 필요",
};

const ORDER_STEPS: Array<{ status: OrderStatus; label: string }> = [
  { status: "new", label: "접수" },
  { status: "making", label: "제조" },
  { status: "ready_for_packing", label: "준비" },
  { status: "completed", label: "수령" },
];

function progressIndex(status: OrderStatus) {
  if (status === "cancelled") return 0;
  if (status === "checked") return 1;
  const found = ORDER_STEPS.findIndex((step) => step.status === status);
  return Math.max(0, found);
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

function normalizePaymentStatus(v: unknown): PaymentStatus {
  const status = String(v || "").trim();
  if (status === "pending" || status === "paid" || status === "cancel_pending" || status === "refunded" || status === "failed" || status === "partial_refund_pending" || status === "partially_refunded") return status;
  return "not_required";
}

function toOrderView(row: DbOrderRow): OrderView {
  return {
    id: String(row.id),
    displayNo: String(row.display_no || ""),
    mode: normalizeMode(row.mode),
    table: row.table_no ? String(row.table_no) : undefined,
    buzzerNo: row.buzzer_no ? String(row.buzzer_no) : undefined,
    status: normalizeStatus(row.status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    earnedPoints: Math.max(0, Number(row.earned_points ?? 0) || 0),
    pointsRate: Math.max(0, Number(row.points_rate_snapshot ?? 0) || 0),
  };
}

function speakReadyOnce() {
  try {
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    const u = new SpeechSynthesisUtterance("주문하신 메뉴가 준비되었습니다.");
    u.lang = "ko-KR";
    u.rate = 1.0;
    u.pitch = 1.0;

    try {
      synth.cancel();
    } catch {}

    synth.speak(u);
  } catch {}
}

function StatusPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const orderIdFromQuery = (sp.get("orderId") || "").trim();
  const accessTokenFromQuery = (sp.get("accessToken") || "").trim();
  const storeFromQuery = (sp.get("store") || "").trim();

  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastStoreId, setLastStoreId] = useState<string>("");
  const [lastOrderToken, setLastOrderToken] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderView | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");

  const [showReadyPopup, setShowReadyPopup] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const readyShownRef = useRef<Record<string, boolean>>({});
  const lastStatusRef = useRef<Record<string, OrderStatus | undefined>>({});
  const orderFetchInFlightRef = useRef(false);

  useEffect(() => {
    setLastStoreId((localStorage.getItem(LS_LAST_STORE_ID_KEY) || "").trim());
  }, []);

  const storeId = useMemo(() => {
    return resolveStoreId(storeFromQuery || lastStoreId);
  }, [storeFromQuery, lastStoreId]);
  const homeStoreId = useMemo(() => {
    return (storeFromQuery || lastStoreId || "").trim();
  }, [storeFromQuery, lastStoreId]);
  const homeHref = useMemo(() => {
    if (!homeStoreId) return "/";
    return `/?store=${encodeURIComponent(homeStoreId)}`;
  }, [homeStoreId]);

  useEffect(() => {
    if (!storeId) return;
    setLastOrderId(
      (localStorage.getItem(lsLastOrderIdKey(storeId)) || "").trim(),
    );
    setLastOrderToken(
      (localStorage.getItem(lsLastOrderTokenKey(storeId)) || "").trim(),
    );
  }, [storeId]);

  const orderId = useMemo(() => {
    return orderIdFromQuery || lastOrderId || "";
  }, [orderIdFromQuery, lastOrderId]);

  const accessToken = useMemo(() => {
    return accessTokenFromQuery || lastOrderToken || "";
  }, [accessTokenFromQuery, lastOrderToken]);

  useEffect(() => {
    if (!storeId || !orderId || !accessTokenFromQuery) return;
    persistLastOrderAccess({
      storeId,
      orderId,
      accessToken: accessTokenFromQuery,
    });
    removeAccessTokenFromCurrentUrl();
  }, [accessTokenFromQuery, orderId, storeId]);

  const clearStoredOrder = async () => {
    try {
      if (storeId) {
        localStorage.removeItem(lsLastOrderIdKey(storeId));
        localStorage.removeItem(lsLastOrderTokenKey(storeId));
      }
      localStorage.removeItem(LS_LAST_STORE_ID_KEY);
    } catch {}
    setLastOrderId("");
    setLastStoreId("");
    setLastOrderToken("");
    setOrder(null);
    const { data } = await supabase.auth.getUser();
    router.replace(data.user ? "/me" : "/");
  };

  const fetchOrder = async (id: string) => {
    setErrMsg("");
    if (!storeId) {
      setOrder(null);
      return;
    }
    if (!accessToken) {
      setErrMsg(
        "주문 확인용 토큰이 없습니다. 주문 완료 화면에서 다시 진입해주세요.",
      );
      setOrder(null);
      return;
    }
    if (orderFetchInFlightRef.current) return;

    orderFetchInFlightRef.current = true;
    try {
      const data = await fetchCustomerOrder({
        storeId,
        orderId: id,
        accessToken,
      });
      setOrder(toOrderView(data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "주문 정보를 불러오지 못했습니다.";
      console.error("[status] fetch order error:", message);
      setErrMsg(message);
      setOrder(null);
    } finally {
      orderFetchInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      if (!storeId || !orderId) {
        setOrder(null);
        setLoading(false);
        return;
      }
      if (!accessToken) {
        setOrder(null);
        setLoading(false);
        return;
      }
      await fetchOrder(orderId);
      setLoading(false);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, storeId, accessToken]);

  useEffect(() => {
    if (!storeId || !orderId || !accessToken) return;
    if (order?.status === "completed" || (order?.status === "cancelled" && order.paymentStatus !== "cancel_pending")) return;

    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void fetchOrder(orderId);
    }, 3000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void fetchOrder(orderId);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, storeId, accessToken, order?.status]);

  useEffect(() => {
    if (!order) return;

    const prev = lastStatusRef.current[order.id];
    const cur = order.status;

    lastStatusRef.current[order.id] = cur;

    if (readyShownRef.current[order.id]) return;
    if (cur === "cancelled" || cur === "completed") return;
    if (!prev) return;

    if (prev !== "ready_for_packing" && cur === "ready_for_packing") {
      readyShownRef.current[order.id] = true;
      setShowReadyPopup(true);
      speakReadyOnce();
    }
  }, [order]);

  const closePopup = () => setShowReadyPopup(false);

  const onRefresh = async () => {
    if (!orderId || !accessToken) return;
    setLoading(true);
    await fetchOrder(orderId);
    setLoading(false);
  };

  const onCancelOrder = async () => {
    if (!visibleOrder || !storeId || !accessToken || cancelling) return;

    try {
      setCancelling(true);
      setErrMsg("");
      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: "customer",
          storeId,
          orderId: visibleOrder.id,
          accessToken,
          reason: "고객 앱 주문 취소",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "주문 취소에 실패했습니다."));
      }
      setShowCancelConfirm(false);
      await onRefresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg || "취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  };

  const visibleOrder = order;
  const statusCopy = visibleOrder ? STATUS_COPY[visibleOrder.status] : null;
  const activeStepIndex = visibleOrder ? progressIndex(visibleOrder.status) : 0;

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
          --bg: #f3f5f8;
          --card: #ffffff;
          --text: #14213a;
          --muted: #667085;
          --line: #dfe4eb;
          --brand: #0f1f3d;
          --radius: 22px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          min-height: 100dvh;
          padding: 24px 16px 0;
          max-width: 680px;
          margin: 0 auto;
        }
        .h1 {
          font-size: 22px;
          font-weight: 900;
          margin: 0;
        }
        .topRow {
          margin-top: 12px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        }
        .btn {
          min-height: 44px;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 700;
          gap: 7px;
          cursor: pointer;
          text-decoration: none;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .card {
          margin-top: 16px;
          padding: 22px;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background: #fff;
          box-shadow: var(--customer-shadow);
        }
        .label {
          font-size: 14px;
          color: var(--muted);
          font-weight: 600;
        }
        .bigNo {
          font-size: clamp(48px, 13vw, 64px);
          font-weight: 900;
          margin-top: 8px;
          line-height: 1;
          letter-spacing: -0.035em;
        }
        .meta {
          margin-top: 10px;
          color: #526071;
          font-weight: 600;
        }
        .statusRow {
          margin-top: 8px;
          font-weight: 600;
        }
        .stateTitle {
          margin-top: 14px;
          font-size: clamp(24px, 6vw, 28px);
          font-weight: 850;
          letter-spacing: -0.035em;
        }
        .stateDesc {
          margin-top: 4px;
          color: #4b5563;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.65;
        }
        .hint {
          margin-top: 12px;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
          font-weight: 500;
          word-break: keep-all;
        }
        .err {
          margin-top: 10px;
          color: #b91c1c;
          font-weight: 650;
          font-size: 13px;
        }
        .dim {
          position: fixed;
          inset: 0;
          background: rgba(15, 31, 61, 0.52);
          display: grid;
          place-items: center;
          padding: 16px;
          z-index: 50;
        }
        .popup {
          width: 100%;
          max-width: 420px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 22px;
          padding: 22px;
          box-shadow: var(--customer-shadow-strong);
        }
        .popupTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .popupDesc {
          margin: 10px 0 0 0;
          color: #374151;
          font-weight: 500;
          line-height: 1.6;
        }
        .popupBtnRow {
          margin-top: 14px;
          display: flex;
          gap: 10px;
        }
        .popupBtn {
          flex: 1;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 750;
          cursor: pointer;
          text-decoration: none;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .popupBtnPrimary {
          background: var(--brand);
          border-color: var(--brand);
          color: #fff;
        }
        .autoUpdate { display:flex; align-items:center; gap:7px; margin-top:18px; color:var(--muted); font-size:13px; font-weight:500; }
        .earnedPoints { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; padding:12px 14px; border:1px solid #cfe0ff; border-radius:13px; background:#eef5ff; color:#174a9c; font-size:13px; font-weight:700; }
        .earnedPoints strong { font-size:16px; }
        .statusActions { margin-top:16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        @media (max-width: 520px) {
          .wrap { padding-top: 16px; }
          .card { padding: 18px; }
          .topRow .btn { flex: 1; }
        }
      `}</style>

      <StoreCustomerHeader
        storeId={storeId}
        title="주문 진행 상황"
        description="매장 상태가 자동으로 업데이트됩니다. 이 화면에서 준비 완료를 확인해 주세요."
        context={
          visibleOrder
            ? `${visibleOrder.mode === "dine-in" ? (visibleOrder.table ? `테이블 ${visibleOrder.table}` : "매장 이용") : "포장 주문"} · 주문 ${visibleOrder.displayNo}`
            : "실시간 주문 조회"
        }
      />

      <div className="topRow" style={{ marginTop: 14 }}>
        <button
          className="btn"
          onClick={onRefresh}
          disabled={!orderId || loading}
        >
          <CustomerIcon name="refresh" size={17} /> 새로고침
        </button>

        {visibleOrder?.status === "new" ? (
          <button
            className="btn"
            onClick={() => setShowCancelConfirm(true)}
            disabled={cancelling}
          >
            {cancelling ? "취소 처리 중..." : "주문 취소"}
          </button>
        ) : null}

        <Link className="btn" href={homeHref}>
          홈으로
        </Link>
      </div>

      {!orderId ? (
        <p className="hint" style={{ marginTop: 16 }}>
          진행 중인 주문이 없어요. 메뉴에서 주문 후 다시 확인해 주세요.
        </p>
      ) : loading ? (
        <p className="hint" style={{ marginTop: 16 }}>
          주문 정보를 불러오는 중...
        </p>
      ) : !visibleOrder ? (
        <>
          <p className="hint" style={{ marginTop: 16 }}>
            확인할 주문이 없어요.
          </p>
          {errMsg ? <div className="err">오류: {errMsg}</div> : null}
        </>
      ) : (
        <>
          <div className="card">
            <div className="label">주문번호</div>
            <div className="bigNo">{visibleOrder.displayNo}</div>

            <div className="meta">
              {visibleOrder.mode === "dine-in" ? (
                <span>
                  매장 이용
                  {visibleOrder.table ? ` · 테이블 ${visibleOrder.table}` : ""}
                </span>
              ) : (
                <span>포장</span>
              )}
            </div>

            <div className="statusRow">
              상태: <b>{STATUS_LABEL[visibleOrder.status]}</b>
              {visibleOrder.buzzerNo ? (
                <>
                  {" · "}벨 <b>{visibleOrder.buzzerNo}</b>
                </>
              ) : null}
            </div>

            <div className="statusRow">
              결제: <b>{PAYMENT_LABEL[visibleOrder.paymentStatus]}</b>
            </div>

            {statusCopy ? (
              <>
                <div className="stateTitle">{statusCopy.title}</div>
                <div className="stateDesc">{statusCopy.desc}</div>
              </>
            ) : null}

            {visibleOrder.status === "cancelled" ? (
              <div className="hint">
                {visibleOrder.paymentStatus === "cancel_pending"
                  ? "주문은 취소되었고 결제 취소를 확인하고 있습니다."
                  : visibleOrder.paymentStatus === "refunded"
                    ? "주문과 결제 취소가 완료되었습니다."
                    : visibleOrder.paymentStatus === "failed"
                      ? "주문은 취소되었으며 결제상태 확인이 필요합니다."
                      : "취소된 주문입니다."}
              </div>
            ) : (
              <CustomerOrderProgress activeIndex={activeStepIndex} />
            )}

            {visibleOrder.status === "completed" && visibleOrder.earnedPoints > 0 ? (
              <div className="earnedPoints">
                <span>포인트 적립 완료{visibleOrder.pointsRate > 0 ? ` · ${visibleOrder.pointsRate}%` : ""}</span>
                <strong>{visibleOrder.earnedPoints.toLocaleString()}P</strong>
              </div>
            ) : null}

            <div className="autoUpdate">
              <CustomerIcon name="clock" size={16} /> 상태를 자동으로 확인하고 있어요.
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              준비가 완료되면 화면에 알림을 표시해 드려요.
            </div>
            {visibleOrder.buzzerNo ? (
              <div className="hint" style={{ marginTop: 6 }}>
                진동벨은 직원이 지급한 경우에만 표시됩니다.
              </div>
            ) : null}
            <div className="statusActions">
              {visibleOrder.status === "new" ? (
                <button
                  className="btn"
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={cancelling}
                >
                  {cancelling ? "취소 처리 중..." : "주문 취소"}
                </button>
              ) : visibleOrder.status === "completed" ||
                visibleOrder.status === "cancelled" ? (
                <button className="btn" onClick={() => void clearStoredOrder()}>
                  주문 종료
                </button>
              ) : (
                <span className="hint" style={{ marginTop: 0 }}>
                  매장 확인 후에는 앱에서 직접 취소할 수 없어요.
                </span>
              )}
            </div>
          </div>

          {errMsg ? <div className="err">오류: {errMsg}</div> : null}
        </>
      )}

      {showCancelConfirm && visibleOrder ? (
        <div className="dim" role="dialog" aria-modal="true">
          <div className="popup">
            <h2 className="popupTitle">주문을 취소할까요?</h2>
            <p className="popupDesc">매장 확인 전까지만 취소할 수 있어요.</p>
            {errMsg ? <div className="err">{errMsg}</div> : null}
            <div className="popupBtnRow">
              <button
                className="popupBtn"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
              >
                닫기
              </button>
              <button
                className="popupBtn popupBtnPrimary"
                onClick={onCancelOrder}
                disabled={cancelling}
              >
                {cancelling ? "처리 중..." : "취소하기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showReadyPopup ? (
        <div
          className="dim"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePopup();
          }}
        >
          <div className="popup">
            <h2 className="popupTitle">준비 완료</h2>
            <p className="popupDesc">준비된 상품을 수령해 주세요.</p>

            <div className="popupBtnRow">
              <button className="popupBtn popupBtnPrimary" onClick={closePopup}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <CustomerTrustFooter />
    </main>
  );
}
export default function StatusPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <StatusPageInner />
    </Suspense>
  );
}
