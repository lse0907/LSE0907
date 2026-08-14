// src/app/done/page.tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  CustomerTrustFooter,
  StoreIdentity,
} from "@/app/_components/StoreCustomerBrand";
import { CustomerIcon } from "@/app/_components/CustomerIcon";
import { CustomerOrderProgress } from "@/app/_components/CustomerOrderProgress";
import { CustomerLoadingState } from "@/app/_components/CustomerLoadingState";
import { PwaInstallGuide } from "@/app/_components/PwaInstallGuide";
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

function DoneStyles() {
  return <style jsx global>{`
    .donePage { min-height:100dvh; padding:24px 16px 0; color:var(--customer-ink); }
    .doneShell { width:100%; max-width:620px; margin:0 auto; }
    .heroCopy { margin-top:30px; text-align:center; }
    .statusIcon { width:64px; height:64px; margin:0 auto; display:grid; place-items:center; border-radius:20px; background:#eaf2ff; color:var(--rion-navy); box-shadow:0 12px 28px rgba(15,31,61,.12); }
    .statusIcon.warning,.dialogIcon { background:#fff1f2; color:var(--customer-error); }
    .eyebrow { margin:20px 0 0; color:#315fba; font-size:11px; font-weight:800; letter-spacing:.13em; }
    h1 { margin:8px 0 0; color:var(--rion-navy); font-size:clamp(28px,7vw,36px); font-weight:850; line-height:1.15; letter-spacing:-.04em; }
    .description { margin:10px auto 0; max-width:440px; color:var(--customer-muted); font-size:15px; font-weight:500; line-height:1.65; word-break:keep-all; }
    .modeBadge { display:inline-flex; margin-top:16px; min-height:30px; align-items:center; padding:5px 11px; border-radius:999px; background:#e9eef6; color:#30415f; font-size:12px; font-weight:700; }
    .orderCard { margin-top:24px; padding:24px; border:1px solid var(--customer-line); border-radius:22px; background:#fff; box-shadow:var(--customer-shadow); }
    .orderCard.cancelled { border-color:#fecdd3; }
    .orderLabel { margin:0; color:var(--customer-muted); font-size:13px; font-weight:600; }
    .orderNumber { display:block; margin-top:5px; color:var(--rion-navy); font-size:clamp(48px,14vw,64px); font-weight:900; line-height:1; letter-spacing:-.04em; }
    .orderFacts { display:grid; grid-template-columns:1fr 1fr; margin:22px 0 0; padding:16px 0; border-top:1px solid var(--customer-line); border-bottom:1px solid var(--customer-line); }
    .orderFacts div { display:grid; gap:5px; padding:0 14px; }
    .orderFacts div:first-child { padding-left:0; border-right:1px solid var(--customer-line); }
    dt { color:var(--customer-muted); font-size:13px; font-weight:500; } dd { margin:0; color:var(--customer-ink); font-size:17px; font-weight:750; }
    .nextGuide { margin:20px 0 0; padding:13px 14px; border-radius:14px; background:#f4f7fb; color:#526071; font-size:14px; font-weight:500; line-height:1.6; }
    .actions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:16px; }
    .primaryAction,.secondaryAction { min-height:52px; display:flex; align-items:center; justify-content:center; padding:0 16px; border-radius:14px; font-size:15px; font-weight:750; text-align:center; }
    .primaryAction { border:1px solid var(--rion-navy); background:var(--rion-navy); color:#fff; box-shadow:0 10px 24px rgba(15,31,61,.2); }
    .secondaryAction { border:1px solid var(--customer-line); background:#fff; color:var(--customer-ink); }
    .cancelAction { width:100%; min-height:46px; margin-top:10px; border:0; background:transparent; color:#9f1239; font-size:14px; font-weight:650; }
    .cancelHint { margin:12px 0 0; color:var(--customer-muted); font-size:13px; font-weight:500; line-height:1.55; text-align:center; }
    .errorMessage { margin:12px 0 0; padding:12px 14px; border-radius:13px; background:#fff1f2; color:#9f1239; font-size:13px; font-weight:600; line-height:1.55; }
    .emptyState { padding-top:4px; } .emptyState .statusIcon { margin-top:40px; } .emptyState .secondaryAction { margin-top:24px; }
    .dialogBackdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:16px; background:rgba(15,31,61,.52); }
    .dialog { width:min(420px,100%); padding:24px; border:1px solid var(--customer-line); border-radius:22px; background:#fff; box-shadow:var(--customer-shadow-strong); }
    .dialogIcon { width:48px; height:48px; display:grid; place-items:center; border-radius:15px; }
    .dialog h2 { margin:18px 0 0; color:var(--rion-navy); font-size:21px; font-weight:800; letter-spacing:-.025em; }
    .dialog p { margin:9px 0 0; color:var(--customer-muted); font-size:14px; font-weight:500; line-height:1.6; }
    .dialogActions { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:22px; }
    .dialogActions button { min-height:48px; border:1px solid var(--customer-line); border-radius:13px; background:#fff; color:var(--customer-ink); font-weight:750; }
    .dialogActions .dangerAction { border-color:#be123c; background:#be123c; color:#fff; }
    @media(max-width:420px) { .donePage{padding-top:16px}.orderCard{padding:19px}.actions{grid-template-columns:1fr}.primaryAction{order:-1} }
  `}</style>;
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
    if (!storeIdForLinks) return "";
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

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErrMsg("");

      // 1) storeId 결정: URL 우선 -> 마지막 주문 매장
      const fallbackStoreId = (
        localStorage.getItem(LS_LAST_STORE_ID_KEY) || ""
      ).trim();
      const storeId = resolveStoreId(storeFromQuery || fallbackStoreId);

      if (!storeId) {
        setOrder(null);
        setLoading(false);
        return;
      }

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
      <CustomerLoadingState
        title="주문 정보를 확인하고 있어요"
        description="접수된 주문을 안전하게 불러오고 있어요."
      />
    );
  }

  if (!order) {
    return (
      <main className="donePage customer-page">
        <section className="doneShell emptyState">
          <StoreIdentity storeId={storeIdForLinks} compact />
          <span className="statusIcon warning" aria-hidden="true">
            <CustomerIcon name="warning" size={28} />
          </span>
          <p className="eyebrow">ORDER NOT FOUND</p>
          <h1>주문 정보를 찾을 수 없어요</h1>
          <p className="description">
            주문을 진행한 기기에서 주문 링크를 다시 확인해 주세요.
          </p>
          {errMsg ? <p className="errorMessage">{errMsg}</p> : null}
          <Link className="secondaryAction" href={homeHref}>{storeIdForLinks ? "매장 홈으로" : "QR 스캔하기"}</Link>
          <CustomerTrustFooter />
        </section>
        <DoneStyles />
      </main>
    );
  }

  const isCancelled = order.status === "cancelled";
  const progress = order.status === "new" ? 0 : order.status === "checked" ? 1 : order.status === "making" ? 2 : 3;

  return (
    <main className="donePage customer-page">
      <section className="doneShell">
        <StoreIdentity storeId={storeIdForLinks} compact />
        <div className="heroCopy">
          <span className={`statusIcon ${isCancelled ? "warning" : ""}`} aria-hidden="true">
            <CustomerIcon name={isCancelled ? "warning" : "check"} size={30} />
          </span>
          <p className="eyebrow">{isCancelled ? "ORDER CANCELLED" : "ORDER COMPLETE"}</p>
          <h1>{DONE_STATUS_COPY[order.status].title}</h1>
          <p className="description">{DONE_STATUS_COPY[order.status].desc}</p>
          <span className="modeBadge">
            {order.mode === "dine-in"
              ? order.table ? `매장 이용 · 테이블 ${order.table}` : "매장 이용"
              : "포장 주문"}
          </span>
        </div>

        <article className={`orderCard ${isCancelled ? "cancelled" : ""}`}>
          <p className="orderLabel">주문번호</p>
          <strong className="orderNumber">{order.displayNo}</strong>
          <dl className="orderFacts">
            <div><dt>총 수량</dt><dd>{order.totalCount}개</dd></div>
            <div><dt>총 금액</dt><dd>{fmt(order.totalPrice)}원</dd></div>
          </dl>
          {!isCancelled ? <CustomerOrderProgress activeIndex={progress} /> : null}
          <p className="nextGuide">
            {order.status === "completed"
              ? "수령 처리가 완료되었어요. 이용해 주셔서 감사합니다."
              : isCancelled
                ? "취소된 주문이에요. 필요한 메뉴는 다시 주문해 주세요."
                : "주문 상태 화면에서 준비 과정을 실시간으로 확인할 수 있어요."}
          </p>
        </article>

        <div className="actions">
          {!isCancelled ? (
            <Link className="primaryAction" href={`/status?store=${encodeURIComponent(storeIdForLinks)}&orderId=${encodeURIComponent(order.id)}&accessToken=${encodeURIComponent(accessTokenForLinks)}`}>
              주문 상태 보기
            </Link>
          ) : null}
          <Link className="secondaryAction" href={homeHref}>매장 홈으로</Link>
        </div>

        {order.status === "new" ? (
          <button className="cancelAction" onClick={() => setShowCancelConfirm(true)} disabled={cancelling}>
            {cancelling ? "취소 처리 중이에요" : "주문 취소하기"}
          </button>
        ) : !isCancelled ? (
          <p className="cancelHint">매장이 확인한 주문은 화면에서 직접 취소할 수 없어요.</p>
        ) : null}
        {errMsg ? <p className="errorMessage">{errMsg}</p> : null}
        {!isCancelled ? <PwaInstallGuide audience="customer" /> : null}

        {showCancelConfirm ? (
          <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowCancelConfirm(false)}>
            <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
              <span className="dialogIcon" aria-hidden="true"><CustomerIcon name="warning" size={24} /></span>
              <h2 id="cancel-title">주문을 취소할까요?</h2>
              <p>매장에서 확인하기 전까지만 주문을 취소할 수 있어요.</p>
              <div className="dialogActions">
                <button onClick={() => setShowCancelConfirm(false)} disabled={cancelling}>돌아가기</button>
                <button className="dangerAction" onClick={cancelOrder} disabled={cancelling}>
                  {cancelling ? "처리 중이에요" : "취소하기"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
        <CustomerTrustFooter />
      </section>
      <DoneStyles />
    </main>
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
