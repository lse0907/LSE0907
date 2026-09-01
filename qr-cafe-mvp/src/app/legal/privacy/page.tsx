import LegalPolicyPage from "@/app/legal/_components/LegalPolicyPage";

export const dynamic = "force-dynamic";

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const params = await searchParams;
  const isOwner = params.audience === "owner";
  const isSignupNotice = params.audience === "owner" || params.audience === "customer";

  return (
    <LegalPolicyPage title={isSignupNotice ? `${isOwner ? "점주" : "고객"} 가입 개인정보 처리 안내` : "개인정보 처리방침 검토본"} description="가입·서비스 이용 과정에서 처리하는 정보와 이용자의 선택권을 설명합니다.">
      <section><h2>1. 가입 시 처리하는 정보</h2>{isSignupNotice ? (isOwner ? <ul><li>이메일과 인증정보</li><li>가입자 이름과 업무용 전화번호</li><li>만 19세 및 사업자 대표자·위임 담당자 확인</li><li>문서 종류·버전과 확인·동의 이력</li><li>추천코드는 선택사항이며 입력한 경우 연결 이력을 처리합니다.</li><li>개인 거주지 주소와 개인 상세주소는 수집하지 않습니다.</li></ul> : <ul><li>이메일과 인증정보</li><li>이름 또는 닉네임</li><li>만 14세 이상 확인</li><li>문서 종류·버전과 확인·동의 이력</li><li>전화번호는 선택사항이며 미입력으로 가입할 수 있습니다.</li></ul>) : <ul><li>고객: 계정정보, 선택 전화번호, 주문·혜택 이용기록</li><li>점주: 계정정보, 사업자·매장정보, 구독·결제·운영기록</li><li>비회원: 주문 처리에 필요한 주문정보와 필요한 경우 주문별 연락처</li><li>직원·매니저: 업무용 식별정보와 권한·감사기록</li></ul>}</section>
      <section><h2>2. 처리 목적</h2><p>계정 생성·인증, 주문 및 매장 운영 기능 제공, 고객지원, 보안과 부정 이용 방지, 서비스 계약 이행을 위해 필요한 범위에서 처리합니다. 선택 마케팅 정보는 별도 동의한 경우에만 사용합니다.</p></section>
      <section><h2>3. 전화번호와 주문 연락처</h2><p>고객 프로필 전화번호 등록은 선택이며 마케팅 동의와 분리합니다. 주문 수행에 연락처가 필요한 경우 주문별로 처리하고, 별도 선택과 인증 없이 회원 프로필이나 광고 발송 대상으로 자동 전환하지 않습니다.</p></section>
      <section><h2>4. 보유와 파기</h2><p>계정 이용 중 필요한 정보와 법령상 보존이 필요한 거래 기록을 구분합니다. 탈퇴 또는 처리 목적 달성 후에는 적용 가능한 보존 근거를 확인해 삭제·분리보관하며, 구체적인 항목별 기간은 법률 검토 후 정식 처리방침에 반영합니다. 구독 종료 후 매장 설정 복구를 위한 90일 운영기준도 개인정보 보유근거와 별도로 검토합니다.</p></section>
      <section><h2>5. 이용자의 권리</h2><p>이용자는 자신의 개인정보 열람·정정·삭제·처리정지와 동의 철회를 요청할 수 있습니다. 요청 접수 경로와 본인 확인 절차는 정식 개인정보 처리방침 및 계정 화면에 공개하며, 가입보다 어렵지 않게 제공합니다.</p></section>
      <section><h2>6. 외부 서비스와 안전조치</h2><p>인증, 호스팅, 결제 등 실제 사용하는 외부 처리업체와 처리 위치·항목은 계약과 설정을 확인해 정식 처리방침에 공개합니다. 접근권한 제한, 전송구간 보호, 매장 간 격리, 중요작업 재인증과 감사기록 등 필요한 안전조치를 적용합니다.</p></section>
      <section><h2>7. 아직 확정하지 않는 사항</h2><p>처리 목적·항목별 법적 근거와 보유기간, 리온랩스와 매장의 개인정보 처리 관계, 위탁·제3자 제공·국외 처리 여부와 공식 고충처리 연락처는 실제 계약과 운영 설정을 확인한 뒤 법률 검토를 거쳐 최종 문서에 반영합니다.</p></section>
    </LegalPolicyPage>
  );
}
