import LegalPolicyPage from "@/app/legal/_components/LegalPolicyPage";

export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ audience?: string }> }) {
  const params = await searchParams;
  const audience = params.audience === "owner" ? "점주" : params.audience === "customer" ? "고객" : "회원";

  return (
    <LegalPolicyPage title={`${audience} 마케팅 정보 수신 안내`} description="리온랩스가 보내는 혜택·이벤트 안내를 위한 선택 동의입니다.">
      <section><h2>1. 선택 동의</h2><p>마케팅 정보 수신은 선택사항입니다. 동의하지 않거나 나중에 철회해도 회원가입과 기본 서비스 이용에 불이익이 없습니다.</p></section>
      <section><h2>2. 발송 주체와 필수 알림 분리</h2><p>이 동의의 발송 주체는 리온랩스입니다. 매장이 자체적으로 보내는 광고는 매장별 별도 동의로 관리해야 합니다. 주문상태, 보안, 결제·환불과 약관 변경처럼 서비스 이용에 필요한 알림은 광고성 정보와 구분합니다.</p></section>
      <section><h2>3. 안내 내용과 채널</h2><p>Rion Order의 혜택, 이벤트, 프로모션과 서비스 소식을 이메일·문자·앱 알림 등 이용자가 제공하거나 활성화한 채널로 안내할 수 있습니다. 실제 발송 기능 도입 전에는 채널별 동의를 분리하고, 야간 광고 발송은 내부 기준에 따라 차단합니다.</p></section>
      <section><h2>4. 철회와 기록</h2><p>이용자는 언제든 수신 동의를 철회할 수 있습니다. 동의·거부·철회 시각, 발송 주체와 적용 문서 버전을 이력으로 관리하며, 철회 이후에는 법령상 필요한 경우를 제외하고 새 마케팅 발송 대상에서 제외합니다.</p></section>
    </LegalPolicyPage>
  );
}
