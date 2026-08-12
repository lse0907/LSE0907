import { CustomerIcon } from "./CustomerIcon";

const steps = ["주문 접수", "주문 확인", "준비 중", "준비 완료"];

export function CustomerOrderProgress({
  activeIndex,
}: {
  activeIndex: number;
}) {
  return (
    <ol className="orderProgress" aria-label="주문 진행 단계">
      {steps.map((label, index) => {
        const complete = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li
            key={label}
            className={`${complete ? "complete" : ""} ${active ? "active" : ""}`.trim()}
            aria-current={active ? "step" : undefined}
          >
            <span className="marker" aria-hidden="true">
              {complete ? <CustomerIcon name="check" size={15} /> : index + 1}
            </span>
            <span className="label">{label}</span>
          </li>
        );
      })}
      <style jsx>{`
        .orderProgress { display:grid; grid-template-columns:repeat(4,1fr); margin:22px 0 0; padding:0; list-style:none; }
        li { position:relative; display:grid; justify-items:center; gap:8px; color:#8a94a5; font-size:12px; font-weight:600; text-align:center; }
        li:not(:last-child)::after { content:""; position:absolute; top:14px; left:calc(50% + 18px); right:calc(-50% + 18px); height:2px; background:#dfe4eb; }
        li.complete:not(:last-child)::after { background:#0f1f3d; }
        .marker { position:relative; z-index:1; width:30px; height:30px; display:grid; place-items:center; border:1px solid #dfe4eb; border-radius:50%; background:#fff; color:#7b8798; font-weight:700; }
        .complete .marker { border-color:#0f1f3d; background:#0f1f3d; color:#fff; }
        .active { color:#1d4ed8; font-weight:750; }
        .active .marker { border:2px solid #2563eb; color:#1d4ed8; box-shadow:0 0 0 5px #eef4ff; }
        @media (max-width:360px) { .label { font-size:11px; } }
      `}</style>
    </ol>
  );
}
