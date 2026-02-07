"use client";

export default function OwnerLandingPage() {
  return (
    <main style={pageStyle} className="ownerPage">
      <section style={heroStyle} className="ownerHero">
        <p style={badgeStyle}>사장님 전용</p>
        <h1 style={titleStyle} className="ownerTitle">
          QR 주문 앱으로 주문 시간을 확 줄이세요.
        </h1>
        <p style={subtitleStyle} className="ownerSubtitle">
          매장 운영은 더 쉽게, 주문은 더 빠르게. 30일 무료 체험 후 유료 결제로 전환됩니다.
        </p>
        <div style={ctaRowStyle} className="ownerCtaRow">
          <a href="/signup" style={{ ...ctaStyle, background: "#111827", color: "#fff" }} className="ownerCta">
            30일 무료 체험 시작하기
          </a>
          <a href="/login" style={{ ...ctaStyle, background: "#fff", color: "#111827" }} className="ownerCta">
            이미 계정이 있어요
          </a>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle} className="ownerSectionTitle">
          사장님이 바로 느끼는 핵심 효과
        </h2>
        <div style={cardGridStyle} className="ownerCardGrid">
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>주문 자동화</h3>
            <p style={cardDescStyle}>주문 받는 시간을 줄여 직원의 집중도를 높입니다.</p>
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>인건비 절감</h3>
            <p style={cardDescStyle}>피크타임 주문을 QR로 분산해 부담을 줄입니다.</p>
          </div>
          <div style={cardStyle}>
            <h3 style={cardTitleStyle}>매출 통계</h3>
            <p style={cardDescStyle}>일/주/월 매출을 바로 확인하고 매장별로 비교합니다.</p>
          </div>
        </div>
      </section>

      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle} className="ownerSectionTitle">
          시작 방법은 간단해요
        </h2>
        <ol style={stepListStyle}>
          <li style={stepItemStyle}>회원가입 후 매장 정보를 입력합니다.</li>
          <li style={stepItemStyle}>메뉴와 옵션을 등록합니다.</li>
          <li style={stepItemStyle}>QR을 생성해 테이블에 붙입니다.</li>
          <li style={stepItemStyle}>바로 주문이 들어오기 시작합니다.</li>
        </ol>
      </section>

      <section style={ctaSectionStyle} className="ownerCtaSection">
        <h2 style={sectionTitleStyle} className="ownerSectionTitle">
          지금 바로 시작해 보세요
        </h2>
        <p style={ctaDescStyle}>30일 무료 체험 후 유료 결제로 전환됩니다.</p>
        <a href="/signup" style={{ ...ctaStyle, background: "#111827", color: "#fff" }} className="ownerCta">
          사장님 계정 만들기
        </a>
      </section>

      <style jsx>{`
        @media (max-width: 640px) {
          .ownerPage {
            padding: 24px 16px 48px;
            gap: 28px;
          }

          .ownerHero {
            padding: 24px;
            border-radius: 20px;
          }

          .ownerTitle {
            font-size: 26px;
          }

          .ownerSubtitle {
            font-size: 15px;
          }

          .ownerSectionTitle {
            font-size: 20px;
          }

          .ownerCtaRow {
            flex-direction: column;
            align-items: stretch;
          }

          .ownerCta {
            width: 100%;
          }

          .ownerCardGrid {
            grid-template-columns: 1fr;
          }

          .ownerCtaSection {
            justify-items: stretch;
          }
        }
      `}</style>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: "32px 20px 64px",
  display: "grid",
  gap: 36,
  color: "#111827",
};

const heroStyle: React.CSSProperties = {
  padding: "32px",
  borderRadius: 24,
  background: "#f3f4f6",
  display: "grid",
  gap: 16,
};

const badgeStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "6px 12px",
  borderRadius: 999,
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  fontSize: 13,
};

const titleStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 900,
  margin: 0,
  lineHeight: 1.2,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 16,
  lineHeight: 1.6,
  color: "#4b5563",
  margin: 0,
  fontWeight: 600,
};

const ctaRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
};

const ctaStyle: React.CSSProperties = {
  padding: "12px 18px",
  borderRadius: 12,
  border: "1px solid #111827",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-flex",
  justifyContent: "center",
  alignItems: "center",
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  margin: 0,
};

const cardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 16,
  border: "1px solid #e5e7eb",
  background: "#fff",
  display: "grid",
  gap: 8,
};

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 900,
};

const cardDescStyle: React.CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontWeight: 600,
  lineHeight: 1.5,
};

const stepListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  display: "grid",
  gap: 10,
  color: "#374151",
  fontWeight: 700,
  lineHeight: 1.6,
};

const stepItemStyle: React.CSSProperties = {
  margin: 0,
};

const ctaSectionStyle: React.CSSProperties = {
  padding: "24px",
  borderRadius: 18,
  border: "1px dashed #111827",
  display: "grid",
  gap: 10,
  justifyItems: "start",
};

const ctaDescStyle: React.CSSProperties = {
  margin: 0,
  color: "#4b5563",
  fontWeight: 700,
};
