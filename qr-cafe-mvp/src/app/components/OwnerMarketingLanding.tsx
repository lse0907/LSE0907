"use client";

import Image from "next/image";
import RionBrand from "@/app/components/RionBrand";

const steps = [
  { number: "01", title: "손님은 QR로 주문", description: "QR을 찍고 메뉴와 옵션을 선택합니다.", image: "/marketing/rion-order-flow-customer-v2.png", alt: "고객이 휴대폰으로 메뉴를 선택하는 AI 연출 이미지" },
  { number: "02", title: "매장은 화면으로 접수", description: "선택한 메뉴와 옵션을 확인하고 준비합니다.", image: "/marketing/rion-order-flow-staff-v3.png", alt: "직원이 주문 접수 화면을 확인하는 AI 연출 이미지" },
  { number: "03", title: "준비한 메뉴를 전달", description: "주문 확인부터 전달까지 한 흐름으로.", image: "/marketing/rion-order-popup-qr-v1.png", alt: "직원이 준비한 음료를 손님에게 전달하는 연출 이미지" },
];

export default function OwnerMarketingLanding() {
  return (
    <main className="recruitmentLanding">
      <header className="recruitmentHeader">
        <RionBrand compact landing />
        <nav aria-label="랜딩 페이지 이동"><a href="#benefit">이용 혜택</a><a href="#start">시작 조건</a><a href="#flow">QR 주문 흐름</a></nav>
        <a className="headerCta" href="/beta-apply">사전 이용 문의하기 <span aria-hidden="true">→</span></a>
      </header>

      <section id="benefit" className="recruitmentHero" aria-labelledby="recruitment-title">
        <p className="eyebrow">RION ORDER · 정식 출시 전</p>
        <h1 id="recruitment-title">사전 무료 이용<br /><span>매장 모집</span></h1>
        <p className="heroLead">우리 매장에서 먼저 사용해보세요.<br />손님은 QR로 주문하고, 매장은 화면으로 접수합니다.</p>
        <div className="heroBenefits" aria-label="선정 매장 혜택">
          <article><span>정식 출시 전까지 이용료</span><strong>무료</strong></article>
          <article><span>정식 출시 후 구독료</span><strong>평생 <em>40%</em> 할인</strong></article>
        </div>
        <p className="benefitScope">선정된 사장님별 참여 매장 1곳에 적용 · 온라인 선결제의 결제대행사(PG) 비용 별도</p>
        <p className="noHomework"><strong>후기·보고서 제출 없이,</strong><br className="mobileBreak" /> 불편할 때만 문의해 주세요.</p>
        <a className="applyCta" href="/beta-apply">사전 이용 문의하기 <span aria-hidden="true">→</span></a>
        <p className="noCharge">도입을 결정하지 않으셔도 괜찮습니다. 문의만으로 가입·결제되지 않습니다.</p>
      </section>

      <section id="start" className="startSection" aria-labelledby="start-title">
        <div className="sectionHeading"><h2 id="start-title">기존 기기로, 부담 없이 시작</h2></div>
        <div className="startCards">
          <article><h3>전용 기기 구매·설치 없이</h3><p>인터넷에 연결된 기존 휴대폰·태블릿·PC로, 메뉴와 QR을 설정한 뒤 시작하세요.</p></article>
          <article><h3>리온오더 별도 주문 수수료 없음</h3><p>주문 건별로 리온오더에 내는 수수료는 없습니다.</p></article>
          <article><h3>후기·보고서 제출 없이</h3><p>문제나 불편한 점이 있을 때 온라인으로 문의해 주세요.</p></article>
        </div>
        <div className="pgNote"><strong>온라인 선결제 선택 시 결제대행사(PG) 연결</strong><p>기본 QR 주문은 별도 결제대행사(PG) 가입 없이 기존 POS·카드 단말기로 결제합니다. 온라인 선결제를 이용하려면 토스페이먼츠 가입·연결이 필요합니다.</p><p>결제대행사 계약 비용과 결제대행사 결제수수료는 매장 부담이며, 리온오더가 받는 비용이 아닙니다.</p></div>
      </section>

      <section id="flow" className="flowSection" aria-labelledby="flow-title">
        <div className="sectionHeading"><h2 id="flow-title">QR 주문, 이렇게 이어집니다.</h2></div>
        <div className="flowCards">
          {steps.map((step) => <article key={step.number}>
            <div className={`flowPhoto${step.number === "02" ? " staffPhoto" : ""}`}><Image src={step.image} alt={step.alt} fill sizes="(max-width: 760px) calc(100vw - 40px), 33vw" /></div>
            <div className="flowCaption"><span>{step.number}</span><h3>{step.title}</h3><p>{step.description}</p></div>
          </article>)}
        </div>
        <p className="sceneDisclosure">화면 자료를 활용한 연출 이미지입니다. 세부 표시는 실제 화면과 다를 수 있습니다.</p>
      </section>

      <section id="faq" className="faqSection" aria-labelledby="faq-title">
        <div className="sectionHeading"><h2 id="faq-title">문의 전 확인하세요.</h2></div>
        <div className="faqList">
          <details><summary>문의하면 어떻게 안내받나요?<span aria-hidden="true">+</span></summary><p>남겨주신 연락처로 문자 또는 이메일을 통해 상담하고, 이용을 원하시면 가입과 시작 절차를 안내합니다. 문의만으로 가입이나 결제가 진행되지 않습니다.</p></details>
          <details><summary>이용을 시작하려면 무엇을 준비하나요?<span aria-hidden="true">+</span></summary><p>인터넷에 연결된 주문 접수용 기기를 준비하고, 초기 설정 마법사를 따라 매장 정보와 메뉴를 등록하세요. QR 안내판을 준비하고 테스트 주문을 확인한 뒤 운영합니다. 방문 설치는 제공하지 않으며, 설정 중 궁금한 점은 온라인 문의로 안내합니다.</p></details>
          <details><summary>무료 기간과 출시 후 구독료는 어떻게 되나요?<span aria-hidden="true">+</span></summary><p>선정 매장은 정식 출시 전까지 기본 구독과 선택한 선결제 옵션의 서비스 이용료가 무료입니다. 온라인 선결제의 결제대행사(PG) 계약 비용과 결제대행사 결제수수료는 무료 혜택에서 제외되며, 리온오더가 받는 비용이 아닙니다. 혜택은 선정된 사장님별 참여 매장 1곳에 적용됩니다.</p><p>정식 출시 후 구독료 평생 40% 할인 기준: 기본 주문 월 <strong>8,940원</strong> (정가 14,900원), 기본 구독과 온라인 선결제 옵션 월 <strong>11,940원</strong> (정가 19,900원).</p></details>
        </div>
      </section>

      <section id="apply" className="applySection" aria-labelledby="apply-title">
        <h2 id="apply-title">우리 매장에서 먼저 써보세요.</h2>
        <a className="applyCta lightCta" href="/beta-apply">사전 이용 문의하기 <span aria-hidden="true">→</span></a>
        <small>문자·이메일로 상담 후 가입 안내 · 문의만으로 결제되지 않습니다.</small>
      </section>
      <footer>© RION Labs. Realize Innovation ON</footer>

      <style>{`
        .recruitmentLanding{--navy:#10264b;--blue:#285fd4;--muted:#53647d;--line:#dce5f2;color:var(--navy);background:#f5f7fb;min-height:100vh;font-family:Arial,sans-serif;word-break:keep-all}
        .recruitmentLanding *{box-sizing:border-box}
        .recruitmentHeader{max-width:1180px;margin:auto;padding:16px 28px;display:flex;align-items:center;gap:24px;background:#fff;border-bottom:1px solid var(--line)}
        .recruitmentHeader nav{display:flex;gap:22px;margin-left:auto}.recruitmentHeader nav a{color:var(--muted);text-decoration:none;font-size:13px;font-weight:700}
        .headerCta{margin-left:auto;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border-radius:10px;background:var(--blue);color:#fff;text-decoration:none;font-size:13px;font-weight:800;white-space:nowrap}
        .recruitmentHero{max-width:980px;margin:auto;padding:56px 28px 48px;text-align:center}.eyebrow{margin:0 0 12px;font-size:13px;font-weight:800;color:var(--blue);letter-spacing:.04em}
        .recruitmentHero h1{margin:0;font-size:54px;line-height:1.15;letter-spacing:-.06em}.recruitmentHero h1 span{color:var(--blue)}.heroLead{margin:18px 0 24px;font-size:17px;line-height:1.7;color:var(--muted)}
        .heroBenefits{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:720px;margin:auto;text-align:left}.heroBenefits article{padding:22px 26px;border:1px solid #bcd1ee;border-radius:18px;background:#fff;box-shadow:0 6px 20px rgba(16,38,75,.04)}
        .heroBenefits article:last-child{background:var(--navy);border-color:var(--navy);color:#fff}.heroBenefits article>span{font-size:14px;font-weight:700}.heroBenefits strong{display:block;margin:9px 0 7px;font-size:34px;letter-spacing:-.05em;line-height:1.15}
        .heroBenefits article:first-child strong{color:var(--blue)}.heroBenefits em{font-style:normal;color:#9de1c6}.heroBenefits p{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}.heroBenefits article:last-child p{color:#d2def0}
        .benefitScope{margin:12px 0 0;font-size:12px;color:var(--muted);line-height:1.6}.noHomework{margin:24px 0 18px;font-size:17px;line-height:1.7}.noHomework strong{color:var(--blue)}.mobileBreak{display:none}
        .applyCta{min-height:56px;min-width:270px;display:inline-flex;align-items:center;justify-content:center;gap:24px;padding:13px 24px;border:1px solid #1e4fb7;border-radius:12px;background:var(--blue);color:#fff;font-size:17px;font-weight:800;text-decoration:none;box-shadow:0 8px 20px rgba(30,83,190,.2)}
        .applyCta span{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.16);font-size:20px;line-height:1}.noCharge{margin:12px 0 0;font-size:12px;color:var(--muted);line-height:1.6}
        .startSection,.flowSection,.faqSection{max-width:1124px;margin:auto;padding:40px 28px}.sectionHeading{margin-bottom:24px}.sectionHeading h2{margin:0;font-size:32px;line-height:1.3;letter-spacing:-.05em}
        .startCards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.startCards article{padding:22px;border:1px solid var(--line);border-radius:16px;background:#fff}.conditionLabel{display:inline-block;color:#285d58;background:#edf7f3;border-radius:7px;padding:6px 9px;font-size:12px;font-weight:800;line-height:1.5}
        .startCards h3{margin:14px 0 8px;font-size:19px;letter-spacing:-.04em}.startCards p,.pgNote p{margin:0;font-size:14px;color:var(--muted);line-height:1.65}.pgNote{margin-top:16px;padding:18px 22px;border-left:3px solid #90aacd;border-radius:0 12px 12px 0;background:#edf1f7}.pgNote strong{display:block;margin-bottom:5px;font-size:14px}
        .flowCards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.flowCards article{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:#fff}.flowPhoto{position:relative;aspect-ratio:4/3;background:#e7ebf2}.flowPhoto img{object-fit:cover}.staffPhoto img{object-fit:contain}
        .flowCaption{padding:20px}.flowCaption>span{font-size:12px;font-weight:800;color:var(--blue)}.flowCaption h3{margin:8px 0;font-size:19px;letter-spacing:-.04em}.flowCaption p{margin:0;font-size:14px;line-height:1.6;color:var(--muted)}.sceneDisclosure{margin:12px 0 0;font-size:12px;line-height:1.5;color:#738199}
        .faqSection{padding-bottom:48px}.faqList{display:grid;gap:10px}.faqList details{padding:18px 22px;border:1px solid var(--line);border-radius:12px;background:#fff}.faqList summary{display:flex;align-items:center;justify-content:space-between;gap:14px;cursor:pointer;font-size:15px;font-weight:700;list-style:none;min-height:28px}.faqList summary::-webkit-details-marker{display:none}.faqList summary span{color:var(--blue);font-size:23px;font-weight:400}.faqList details[open] summary span{transform:rotate(45deg)}.faqList p{margin:12px 0 0;color:var(--muted);font-size:14px;line-height:1.7}
        .applySection{max-width:1068px;margin:0 auto 40px;padding:38px 28px;text-align:center;border-radius:22px;background:var(--navy);color:#fff}.applySection h2{margin:0;font-size:29px;line-height:1.3;letter-spacing:-.05em}.applySection p{margin:12px 0 22px;color:#d2def0;font-size:15px;line-height:1.6}.lightCta{background:#fff;color:var(--navy);border-color:#fff;box-shadow:none}.lightCta span{background:#edf4ff}.applySection small{display:block;margin-top:13px;font-size:12px;color:#d2def0;line-height:1.6}
        .recruitmentLanding footer{padding:22px;text-align:center;background:#fff;color:#738199;font-size:12px}.headerCta,.applyCta{transition:background .16s ease,transform .16s ease,box-shadow .16s ease}@media(hover:hover){.headerCta:hover,.applyCta:hover{background:#1e4fb7;transform:translateY(-2px)}.lightCta:hover{background:#edf4ff}}.headerCta:active,.applyCta:active{transform:translateY(1px)}.recruitmentLanding a:focus-visible,.faqList summary:focus-visible{outline:3px solid #60a5fa;outline-offset:4px}
        #benefit,#start,#flow,#faq,#apply{scroll-margin-top:20px}
        .applySection h2{margin-bottom:20px}
        .pgNote p+p{margin-top:6px}
        @media(max-width:760px){.recruitmentHeader{padding:10px 18px;gap:12px}.recruitmentHeader nav{display:none}.headerCta{font-size:12px;padding:9px 12px;gap:6px}.recruitmentHero{padding:32px 20px}.recruitmentHero h1{font-size:38px}.heroLead{font-size:15px;margin:16px 0 20px}.heroBenefits{gap:10px}.heroBenefits article{padding:16px 13px}.heroBenefits article>span{font-size:12px}.heroBenefits strong{font-size:26px}.heroBenefits p{font-size:12px}.noHomework{font-size:16px;margin:20px 0 16px}.mobileBreak{display:block}.applyCta{width:100%;max-width:360px;min-width:0}.startSection,.flowSection,.faqSection{padding:30px 20px}.sectionHeading{margin-bottom:20px}.sectionHeading h2{font-size:27px}.startCards,.flowCards{grid-template-columns:1fr;gap:12px}.startCards article{padding:18px}.startCards h3{margin-top:10px;font-size:18px}.pgNote{padding:16px}.flowPhoto{aspect-ratio:16/9}.flowCaption{padding:16px 18px}.flowCaption h3{font-size:18px}.faqList details{padding:15px 18px}.applySection{margin:8px 20px 28px;padding:30px 22px}.applySection h2{font-size:25px}}
        @media(max-width:360px){.recruitmentHero h1{font-size:33px}.heroBenefits strong{font-size:22px}.heroBenefits article{padding:14px 11px}.heroLead{font-size:14px}.eyebrow{font-size:12px}}
        @media(max-width:760px){
          .recruitmentHero{padding:24px 20px}.heroLead{margin:12px 0 16px}.heroBenefits article{padding:14px 13px}.noHomework{margin:16px 0 14px}
          .startSection,.flowSection,.faqSection{padding:22px 20px}.sectionHeading{margin-bottom:14px}.sectionHeading h2{font-size:23px}
          .startCards{gap:0;border:1px solid var(--line);border-radius:14px;background:#fff;overflow:hidden}.startCards article{padding:14px 16px;border:0;border-bottom:1px solid var(--line);border-radius:0}.startCards article:last-child{border-bottom:0}.startCards h3{margin:0 0 5px;font-size:16px}.startCards p{font-size:14px}.pgNote{margin-top:10px;padding:12px 14px}.pgNote strong{font-size:13px}.pgNote p{font-size:13px}
          .flowCards{gap:10px}.flowCards article{display:grid;grid-template-columns:96px minmax(0,1fr);align-items:stretch}.flowPhoto{aspect-ratio:auto;min-height:118px}.flowCaption{padding:12px}.flowCaption>span{font-size:11px}.flowCaption h3{margin:5px 0;font-size:16px}.flowCaption p{font-size:13px;line-height:1.5}.sceneDisclosure{font-size:11px}
          .faqList{gap:8px}.faqList details{padding:10px 14px}.faqList summary{font-size:14px;min-height:34px}.applySection{padding:24px 20px;margin:8px 20px 20px}.applySection h2{font-size:23px;margin-bottom:16px}.recruitmentLanding footer{padding:16px}
        }
        @media(prefers-reduced-motion:reduce){.headerCta,.applyCta{transition:none;transform:none}}
      `}</style>
    </main>
  );
}
