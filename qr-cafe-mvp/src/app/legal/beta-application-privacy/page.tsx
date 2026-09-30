import LegalPolicyPage from "@/app/legal/_components/LegalPolicyPage";
import { BETA_APPLICATION_CONSENT_TITLE, BETA_APPLICATION_CONSENT_VERSION } from "@/app/lib/betaApplicationConsent";

export const dynamic = "force-dynamic";

export default function BetaApplicationPrivacyPage() {
  return (
    <LegalPolicyPage
      title={BETA_APPLICATION_CONSENT_TITLE}
      description="리온오더 베타 테스터 신청을 검토하고, 선정 결과와 운영 안내를 드리기 위해 필요한 정보를 처리합니다."
      documentVersion={BETA_APPLICATION_CONSENT_VERSION}
      isDraft={false}
    >
      <section>
        <h2>1. 수집하는 정보</h2>
        <ul>
          <li>매장명, 업종, 매장 운영 방식, 매장 지역</li>
          <li>연락받을 분의 이름과 선택한 안내 수단의 이메일 또는 휴대폰 번호</li>
          <li>참여 가능 시점, 피드백 참여 의사, 신청서에 직접 작성한 내용</li>
        </ul>
      </section>
      <section>
        <h2>2. 이용 목적</h2>
        <p>베타 테스터 선정 검토, 선정·미선정 결과 안내, 베타 시작을 위한 온라인 설정 안내와 운영 지원에만 사용합니다. 광고·마케팅 목적의 연락에는 사용하지 않습니다.</p>
      </section>
      <section>
        <h2>3. 보유 기간</h2>
        <p>미선정 신청 정보는 결과 안내 또는 모집 종료 후 90일간 보관한 뒤 삭제합니다. 선정된 매장의 신청 정보는 베타 운영 종료 또는 참여 철회 후 90일간 보관한 뒤 삭제합니다. 법령상 별도 보관 의무가 있는 정보는 해당 기간 동안 보관할 수 있습니다.</p>
      </section>
      <section>
        <h2>4. 동의 거부와 불이익</h2>
        <p>동의를 거부할 수 있으나, 베타 테스터 신청과 선정 결과 안내에 필요한 최소 정보이므로 동의하지 않으면 신청할 수 없습니다.</p>
      </section>
      <section>
        <h2>5. 동의 기록과 문의</h2>
        <p>신청 시 이 문서의 버전과 동의 시각을 함께 기록합니다. 동의 철회, 열람·정정·삭제 요청은 <a href="mailto:support@rionlabs.co.kr">support@rionlabs.co.kr</a>로 접수할 수 있습니다. 문의에는 신청 시 입력한 매장명과 연락받을 분의 이름을 함께 알려 주세요.</p>
      </section>
      <section>
        <h2>6. 문서 정보</h2>
        <p>문서 버전: {BETA_APPLICATION_CONSENT_VERSION} · 시행일: 2026년 9월 30일</p>
      </section>
    </LegalPolicyPage>
  );
}
