"use client";

import { CustomerIcon } from "../_components/CustomerIcon";
import { CustomerSheet } from "../_components/CustomerSheet";
import {
  type CustomerOrder,
  formatOrderDate,
  formatWon,
  orderStatusLabel,
  orderStatusTone,
} from "./meUtils";

export function RecentOrderCard({
  order,
  onOpen,
}: {
  order: CustomerOrder;
  onOpen: () => void;
}) {
  return (
    <>
      <div className="sectionHeading">
        <div>
          <p className="sectionLabel">RECENT ORDER</p>
          <h2>최근 주문</h2>
        </div>
      </div>
      <button type="button" className="recentOrderCard" onClick={onOpen}>
        <span className="quickIcon">
          <CustomerIcon name="orders" />
        </span>
        <span className="quickCopy">
          <strong title={order.store.name}>{order.store.name}</strong>
          <small>
            {formatOrderDate(order.created_at)} · 주문 {order.display_no || "-"}
          </small>
          <small>
            {Number(order.total_count || 0)}개 ·{" "}
            {formatWon(Number(order.total_price || 0))}
            {Number(order.earned_points || 0) > 0
              ? ` · +${Number(order.earned_points).toLocaleString()}P`
              : ""}
          </small>
        </span>
        <span className={`statusBadge ${orderStatusTone(order.status)}`}>
          {orderStatusLabel(order.status)}
        </span>
        <span className="recentOrderLink">주문 상세 보기</span>
      </button>
    </>
  );
}

export function OrderHistorySheet({
  orders,
  loading,
  error,
  onRetry,
  onClose,
  onSelect,
  onStartQr,
}: {
  orders: CustomerOrder[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onSelect: (order: CustomerOrder) => void;
  onStartQr: () => void;
}) {
  return (
    <CustomerSheet title="주문 내역" onClose={onClose}>
      <div className="sheetList">
        {loading ? (
          <p role="status">불러오는 중...</p>
        ) : error ? (
          <div className="sheetCard" role="alert">
            <h3>주문 정보를 불러오지 못했어요.</h3>
            <p>잠시 후 다시 시도해 주세요.</p>
            <button type="button" className="sheetAction" onClick={onRetry}>
              다시 불러오기
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="sheetCard">
            <h3>아직 주문 내역이 없어요</h3>
            <p>QR을 스캔해 첫 주문을 시작해 보세요.</p>
            <button type="button" className="sheetAction" onClick={onStartQr}>
              QR 주문
            </button>
          </div>
        ) : (
          orders.map((order) => (
            <button
              type="button"
              className="sheetCard sheetOrderButton"
              key={order.id}
              onClick={() => onSelect(order)}
            >
              <span className="sheetCardHead">
                <strong>{order.store.name}</strong>
                <span
                  className={`statusBadge ${orderStatusTone(order.status)}`}
                >
                  {orderStatusLabel(order.status)}
                </span>
              </span>
              <span>
                {formatOrderDate(order.created_at)} · 주문{" "}
                {order.display_no || "-"}
              </span>
              <span>
                {Number(order.total_count || 0)}개 ·{" "}
                {formatWon(Number(order.total_price || 0))}
                {Number(order.earned_points || 0) > 0
                  ? ` · +${Number(order.earned_points).toLocaleString()}P`
                  : ""}
              </span>
            </button>
          ))
        )}
      </div>
    </CustomerSheet>
  );
}

export function OrderDetailSheet({
  order,
  onClose,
}: {
  order: CustomerOrder;
  onClose: () => void;
}) {
  return (
    <CustomerSheet title="주문 상세" onClose={onClose}>
      <article className="sheetCard orderDetailCard">
        <div className="sheetCardHead">
          <h3>{order.store.name}</h3>
          <span className={`statusBadge ${orderStatusTone(order.status)}`}>
            {orderStatusLabel(order.status)}
          </span>
        </div>
        <p>{formatOrderDate(order.created_at)}</p>
        <dl className="orderDetailList">
          <div>
            <dt>주문번호</dt>
            <dd>{order.display_no || "-"}</dd>
          </div>
          <div>
            <dt>주문 수량</dt>
            <dd>{Number(order.total_count || 0)}개</dd>
          </div>
          <div>
            <dt>결제 금액</dt>
            <dd>{formatWon(Number(order.total_price || 0))}</dd>
          </div>
          <div>
            <dt>적립 포인트</dt>
            <dd>{Number(order.earned_points || 0).toLocaleString()}P</dd>
          </div>
        </dl>
      </article>
    </CustomerSheet>
  );
}
