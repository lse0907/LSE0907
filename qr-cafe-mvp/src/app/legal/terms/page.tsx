import LegalPolicyPage from "@/app/legal/_components/LegalPolicyPage";

export const dynamic = "force-dynamic";

export default async function TermsPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const params = await searchParams;
  const isOwner = params.audience === "owner";

  return (
    <LegalPolicyPage
      title={isOwner ? "점주 이용정책 안내" : "고객 이용정책 안내"}
      description={isOwner ? "Rion Order 매장 운영용 B2B SaaS 가입·이용의 기본 원칙입니다." : "Rion Order 고객 계정과 주문·매장 혜택 이용의 기본 원칙입니다."}
    >
      <section><h2>1. 서비스의 역할</h2><p>Rion Order는 매장의 주문 접수와 운영을 돕는 서비스입니다. 음식·상품의 판매와 제공 주체는 각 매장이며, 온라인 선결제 기능을 사용하는 경우 결제 화면의 판매자·처리 정보를 별도로 안내합니다.</p></section>
      <section><h2>2. 가입 자격</h2>{isOwner ? <p>점주 계정은 만 19세 이상인 사업자 대표자 또는 사업자로부터 가입·계약 권한을 위임받은 담당자만 만들 수 있습니다.</p> : <p>고객 계정은 만 14세 이상인 이용자만 만들 수 있습니다.</p>}</section>
      {isOwner ? (
        <><section><h2>3. 점주의 자격과 책임</h2><ul><li>점주는 사업자 대표자 또는 적법하게 권한을 위임받은 담당자여야 합니다.</li><li>매장·메뉴·가격·품절·알레르기·영업정보를 정확하게 관리합니다.</li><li>주문 수락·이행, 음식·상품의 품질, 현장 응대와 매장 귀책 취소·환불은 매장이 담당합니다.</li><li>직원·기기·매장 권한을 안전하게 관리하고 무단 사용이나 보안사고를 즉시 알립니다.</li></ul></section><section><h2>4. 구독과 유료 기능</h2><p>Rion Order는 매장 단위의 기간형 선불 B2B SaaS이며 자동결제나 카드 빌링키 저장을 기본으로 하지 않습니다. 기본 구독, 온라인 선결제 옵션, 할인·추천 혜택, 취소·환불의 상세 조건은 <a href="/legal/subscription-billing">구독·결제·취소·환불 정책</a>과 각 결제 화면에서 확인합니다.</p></section><section><h2>5. 고객 거래와 개인정보</h2><p>음식·상품 판매자와 고객 결제대금의 수령·정산 주체는 해당 매장입니다. 리온랩스는 주문·결제 상태를 연결하는 플랫폼 제공자이며, 매장이 고객정보를 이용하는 범위와 리온랩스의 처리 역할은 정식 개인정보 문서 및 필요한 별도 특약에서 구분합니다.</p></section></>
      ) : (
        <><section><h2>3. 비회원 주문과 회원 혜택</h2><p>회원가입 없이도 매장이 제공하는 QR 주문을 이용할 수 있습니다. 회원가입을 하면 주문내역, 즐겨찾기와 매장별 포인트·쿠폰 등 회원 기능을 이용할 수 있으며, 가입을 주문 완료의 필수조건으로 만들지 않습니다.</p></section><section><h2>4. 주문 이용과 거래 주체</h2><p>음식·상품 판매자, 주문 이행과 매장 귀책 취소·환불의 주체는 해당 매장입니다. 온라인 선결제 시 고객 결제대금도 해당 매장과 매장이 계약한 PG가 처리하며, 리온랩스는 주문·결제 상태를 기술적으로 연결합니다.</p></section><section><h2>5. 매장별 혜택</h2><p>포인트와 쿠폰은 매장별로 운영되고 다른 매장이나 현금으로 이전되지 않습니다. 발급·사용·환불·서비스 중지 시 처리 기준은 <a href="/legal/customer-benefits">주문·포인트·쿠폰 운영정책</a>에서 확인합니다.</p></section></>
      )}
      <section><h2>{isOwner ? "6" : "6"}. 계정 변경·탈퇴</h2><p>비밀번호와 연락처 변경에는 필요한 본인확인 절차를 적용합니다. 탈퇴 시 진행 중 주문·결제·취소·환불을 먼저 정리하고, 서비스 데이터와 법령상 보존이 필요한 기록을 구분합니다. 구체적인 셀프서비스 절차는 P1-3B에서 제공합니다.</p></section>
      <section><h2>7. 변경과 재확인</h2><p>일반 변경은 원칙적으로 시행 7일 전, 이용자에게 불리하거나 계약의 핵심에 영향을 주는 변경은 내부 운영기준상 원칙적으로 30일 전에 안내합니다. 법령상 더 긴 기간이나 별도 절차가 필요한 경우 그 기준을 우선하며, 필요한 경우 새 문서 버전으로 재동의를 받습니다.</p></section>
    </LegalPolicyPage>
  );
}
