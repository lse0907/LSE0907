"use client";

import { CustomerIcon } from "../_components/CustomerIcon";
import { CustomerSheet } from "../_components/CustomerSheet";
import {
  type CustomerOrder,
  effectiveOrderCount,
  effectiveOrderPoints,
  effectiveOrderPrice,
  formatOrderDate,
  formatWon,
  orderStatusLabel,
  orderStatusTone,
} from "./meUtils";

function canTrackOrder(order: CustomerOrder) {
  return ["new", "checked", "making", "ready_for_packing"].includes(order.status);
}

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
            {effectiveOrderCount(order)}개 ·{" "}
            {formatWon(effectiveOrderPrice(order))}
            {effectiveOrderPoints(order) > 0
              ? ` · +${effectiveOrderPoints(order).toLocaleString()}P`
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
  onOpenStatus,
  onStartQr,
}: {
  orders: CustomerOrder[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onClose: () => void;
  onSelect: (order: CustomerOrder) => void;
  onOpenStatus: (order: CustomerOrder) => void;
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
          orders.map((order) => {
            const canTrack = canTrackOrder(order);
            return <button
              type="button"
              className="sheetCard sheetOrderButton"
              key={order.id}
              onClick={() => canTrack ? onOpenStatus(order) : onSelect(order)}
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
                {effectiveOrderCount(order)}개 ·{" "}
                {formatWon(effectiveOrderPrice(order))}
                {effectiveOrderPoints(order) > 0
                  ? ` · +${effectiveOrderPoints(order).toLocaleString()}P`
                  : ""}
              </span>
              <span className="sheetOrderAction">
                {canTrack ? "진행 상태 보기" : "주문 상세 보기"}
              </span>
            </button>;
          })
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
  const items = Array.isArray(order.items) ? order.items : [];
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
            <dd>{effectiveOrderCount(order)}개</dd>
          </div>
          <div>
            <dt>결제 금액</dt>
            <dd>{formatWon(effectiveOrderPrice(order))}</dd>
          </div>
          <div>
            <dt>적립 포인트</dt>
            <dd>{effectiveOrderPoints(order).toLocaleString()}P</dd>
          </div>
          {Number(order.refunded_amount || 0) > 0 ? (
            <div>
              <dt>부분 환불</dt>
              <dd>{formatWon(Number(order.refunded_amount || 0))}</dd>
            </div>
          ) : null}
        </dl>
        <section className="orderItems" aria-labelledby="order-items-title">
          <div className="orderItemsHead">
            <h4 id="order-items-title">주문 메뉴</h4>
            <span>{items.reduce((total, item) => total + Math.max(0, Number(item.qty || 0) - Number(item.refunded_qty || 0)), 0)}개</span>
          </div>
          {items.length ? (
            <div className="orderItemList">
              {items.map((item) => {
                const quantity = Math.max(0, Number(item.qty || 0) - Number(item.refunded_qty || 0));
                const optionPrice = (item.options || []).reduce((total, option) => total + Math.max(0, Number(option.price_delta || 0)) * Math.max(1, Number(option.qty || 1)), 0);
                return <article className="orderItem" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    {item.options?.length ? <small>옵션: {item.options.map((option) => `${option.name}${Number(option.qty || 1) > 1 ? ` ${option.qty}개` : ""}`).join(" · ")}</small> : null}
                    {Number(item.refunded_qty || 0) > 0 ? <small className="refundItem">{item.refunded_qty}개 환불</small> : null}
                  </div>
                  <div className="orderItemAmount">
                    <strong>{quantity}개</strong>
                    <span>{formatWon((Math.max(0, Number(item.price || 0)) + optionPrice) * quantity)}</span>
                  </div>
                </article>;
              })}
            </div>
          ) : <p className="orderItemsEmpty">이 주문의 메뉴 상세 기록을 불러오지 못했어요.</p>}
        </section>
      </article>
    </CustomerSheet>
  );
}
