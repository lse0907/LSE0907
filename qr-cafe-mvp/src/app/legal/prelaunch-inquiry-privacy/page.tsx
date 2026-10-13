import LegalPolicyPage from "@/app/legal/_components/LegalPolicyPage";
import { BETA_INQUIRY_CONSENT_TITLE, BETA_INQUIRY_CONSENT_VERSION } from "@/app/lib/betaInquiryConsent";

export default function PrelaunchInquiryPrivacyPage() {
  return <LegalPolicyPage title={BETA_INQUIRY_CONSENT_TITLE} description="사전 이용 문의에 답변하고, 요청하신 이용 상담과 가입 절차를 안내하기 위한 정보만 처리합니다." documentVersion={BETA_INQUIRY_CONSENT_VERSION} isDraft={false}>
    <section><h2>1. 수집하는 정보</h2><p>필수: 매장명, 업종, 선택한 답변 방법의 이메일 또는 휴대폰 번호. 선택: 직접 작성한 문의 내용. 동의 문서 버전과 동의 시각도 기록합니다.</p></section>
    <section><h2>2. 이용 목적</h2><p>문의 답변, 요청하신 사전 이용 상담, 이용 혜택·설정 방법·가입 절차 안내에 사용합니다. 문의만으로 가입·결제가 진행되지 않으며, 별도의 광고·마케팅 연락에는 사용하지 않습니다.</p></section>
    <section><h2>3. 보유 기간</h2><p>이용으로 이어지지 않은 문의 정보는 상담 종료 또는 모집 종료 후 90일간 보관한 뒤 삭제합니다. 사전 이용을 시작한 매장의 접수 정보는 사전 이용 종료 또는 참여 철회 후 90일간 보관한 뒤 삭제합니다. 법령상 별도 보관 의무가 있는 정보는 해당 기간 동안 보관할 수 있습니다.</p></section>
    <section><h2>4. 동의 거부와 불이익</h2><p>동의를 거부할 수 있으나, 답변에 필요한 최소 정보이므로 동의하지 않으면 문의를 접수할 수 없습니다.</p></section>
    <section><h2>5. 문의와 동의 철회</h2><p>열람·정정·삭제 또는 동의 철회는 <a href="mailto:support@rionlabs.co.kr">support@rionlabs.co.kr</a>로 요청할 수 있습니다. 접수 시 입력한 매장명과 연락처를 함께 알려 주세요.</p></section>
    <section><h2>6. 문서 정보</h2><p>문서 버전: {BETA_INQUIRY_CONSENT_VERSION} · 시행일: 2026년 10월 13일</p></section>
  </LegalPolicyPage>;
}
