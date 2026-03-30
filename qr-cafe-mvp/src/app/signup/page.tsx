"use client";

import Link from "next/link";

export default function SignupChooserPage() {
  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>회원가입</h1>
      <p style={{ color: "#6b7280", marginTop: 8, fontWeight: 700, lineHeight: 1.5 }}>
        가입 유형을 선택해주세요. 일반 고객은 포인트/쿠폰 혜택을 받을 수 있고,
        점주(사장님)는 매장 관리 기능을 사용할 수 있습니다.
      </p>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        <Link href="/signup-customer" style={primaryBtnStyle}>
          고객 회원가입
        </Link>
        <Link href="/signup-owner" style={secondaryBtnStyle}>
          점주 회원가입
        </Link>
      </div>

      <div style={{ marginTop: 14 }}>
        <Link href="/login" style={{ fontWeight: 900 }}>
          로그인
        </Link>
      </div>
    </main>
  );
}

const primaryBtnStyle: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
  fontWeight: 900,
  textDecoration: "none",
};

const secondaryBtnStyle: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  padding: 12,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  textDecoration: "none",
};
