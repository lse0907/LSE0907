// src/app/status/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { lsLastOrderIdKey, lsLastOrderTokenKey, resolveStoreId } from "@/app/lib/storeScope";

type OrderMode = "dine-in" | "takeout";
type OrderStatus = "new" | "checked" | "making" | "ready_for_packing" | "completed" | "cancelled";

type DbOrderRow = {
  id: string;
  display_no?: string | null;
  mode?: string | null;
  table_no?: string | null;
  buzzer_no?: string | null;
  status?: string | null;
  store_id?: string | null;
};

type OrderView = {
  id: string;
  displayNo: string;
  mode: OrderMode;
  table?: string;
  buzzerNo?: string;
  status: OrderStatus;
};

const LS_LAST_STORE_ID_KEY = "qrCafeLastStoreId";

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "접수됨",
  checked: "주문확인",
  making: "제조중",
  ready_for_packing: "준비완료",
  completed: "완료",
  cancelled: "취소",
};

function normalizeMode(v: any): OrderMode {
  return v === "takeout" ? "takeout" : "dine-in";
}

function normalizeStatus(v: any): OrderStatus {
  const s = String(v || "").trim();
  if (s === "checked" || s === "making" || s === "ready_for_packing" || s === "completed" || s === "cancelled") return s;
  if (s === "ready") return "ready_for_packing";
  if (s === "done") return "completed";
  if (s === "canceled") return "cancelled";
  return "new";
}

function toOrderView(row: DbOrderRow): OrderView {
  return {
    id: String(row.id),
    displayNo: String(row.display_no || ""),
    mode: normalizeMode(row.mode),
    table: row.table_no ? String(row.table_no) : undefined,
    buzzerNo: row.buzzer_no ? String(row.buzzer_no) : undefined,
    status: normalizeStatus(row.status),
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

  const readyShownRef = useRef<Record<string, boolean>>({});
  const lastStatusRef = useRef<Record<string, OrderStatus | undefined>>({});

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
    setLastOrderId((localStorage.getItem(lsLastOrderIdKey(storeId)) || "").trim());
    setLastOrderToken((localStorage.getItem(lsLastOrderTokenKey(storeId)) || "").trim());
  }, [storeId]);

  const orderId = useMemo(() => {
    return orderIdFromQuery || lastOrderId || "";
  }, [orderIdFromQuery, lastOrderId]);

  const accessToken = useMemo(() => {
    return accessTokenFromQuery || lastOrderToken || "";
  }, [accessTokenFromQuery, lastOrderToken]);

  const clearLastOrder = () => {
    try {
      localStorage.removeItem(lsLastOrderIdKey(storeId));
      localStorage.removeItem(lsLastOrderTokenKey(storeId));
      localStorage.removeItem(LS_LAST_STORE_ID_KEY);
    } catch {}
    setLastOrderId("");
    setLastStoreId("");
    setLastOrderToken("");
    setOrder(null);
  };

  const fetchOrder = async (id: string) => {
    setErrMsg("");
    if (!accessToken) {
      setErrMsg("주문 확인용 토큰이 없습니다. 주문 완료 화면에서 다시 진입해주세요.");
      setOrder(null);
      return;
    }

    const { data, error } = await supabase
      .from("orders")
      .select("id,display_no,mode,table_no,buzzer_no,status,store_id")
      .eq("id", id)
      .eq("store_id", storeId)
      .eq("access_token", accessToken)
      .maybeSingle();

    if (error) {
      console.error("[status] fetch order error:", error.message);
      setErrMsg(error.message);
      setOrder(null);
      return;
    }

    if (!data) {
      setOrder(null);
      return;
    }

    const view = toOrderView(data as DbOrderRow);

    if (view.status === "completed" || view.status === "cancelled") {
      clearLastOrder();
      return;
    }

    setOrder(view);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      if (!orderId) {
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
    if (!orderId || !accessToken) return;

    const t = window.setInterval(() => {
      fetchOrder(orderId);
    }, 1200);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, storeId, accessToken]);

  useEffect(() => {
    if (!order) return;
    if (order.status === "completed" || order.status === "cancelled") {
      clearLastOrder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status]);

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

  const visibleOrder =
    order && order.status !== "completed" && order.status !== "cancelled" ? order : null;

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>

      <style jsx>{`
        .wrap {
          padding: 24px;
          max-width: 520px;
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
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 900;
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
          padding: 16px;
          border: 1px solid var(--line);
          border-radius: var(--radius);
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .label {
          font-size: 14px;
          color: var(--muted);
          font-weight: 800;
        }
        .bigNo {
          font-size: 48px;
          font-weight: 900;
          margin-top: 6px;
          line-height: 1;
        }
        .meta {
          margin-top: 10px;
          color: #444;
          font-weight: 800;
        }
        .statusRow {
          margin-top: 8px;
          font-weight: 850;
        }
        .hint {
          margin-top: 12px;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.45;
          font-weight: 800;
          word-break: keep-all;
        }
        .err {
          margin-top: 10px;
          color: #b91c1c;
          font-weight: 900;
          font-size: 13px;
        }
        .dim {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.45);
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
          border-radius: 18px;
          padding: 16px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        }
        .popupTitle {
          margin: 0;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .popupDesc {
          margin: 10px 0 0 0;
          color: #374151;
          font-weight: 800;
          line-height: 1.5;
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
          font-weight: 950;
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
      `}</style>

      <h1 className="h1">주문 상태</h1>

      <div className="topRow">
        <button className="btn" onClick={onRefresh} disabled={!orderId || loading}>
          새로고침
        </button>

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
            진행 중인 주문이 없어요.
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
                  매장 이용{visibleOrder.table ? ` · 테이블 ${visibleOrder.table}` : ""}
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

            <div className="hint">
              * 준비 완료 시 팝업과 음성으로 알려드려요. (기기/브라우저 설정에 따라 음성은 제한될 수 있어요)
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              * 진동벨은 직원이 지급한 경우에만 표시됩니다.
            </div>
          </div>

          {errMsg ? <div className="err">오류: {errMsg}</div> : null}
        </>
      )}

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
            <h2 className="popupTitle">준비가 완료되었습니다 ✅</h2>
            <p className="popupDesc">
              주문하신 메뉴가 준비되었어요.
              <br />
              직원 안내에 따라 픽업/수령해 주세요.
            </p>

            <div className="popupBtnRow">
              <button className="popupBtn popupBtnPrimary" onClick={closePopup}>
                닫기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function StatusPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <StatusPageInner />
    </Suspense>
  );
}
