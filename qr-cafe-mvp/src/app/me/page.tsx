import { Suspense } from "react";
import { MeDashboard } from "./MeDashboard";

export default function MePage() {
  return (
    <Suspense
      fallback={
        <main
          aria-busy="true"
          aria-label="내 주문과 혜택을 불러오는 중"
          style={{ maxWidth: 760, margin: "0 auto", padding: "20px 16px" }}
        >
          <div
            style={{
              minHeight: 220,
              borderRadius: 20,
              background: "#fff",
              border: "1px solid #dfe4eb",
            }}
          />
        </main>
      }
    >
      <MeDashboard />
    </Suspense>
  );
}
