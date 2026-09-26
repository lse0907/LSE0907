"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import RionBrand from "@/app/components/RionBrand";

const storeTypes = [
  ["카페", "피크 시간 주문과 옵션 확인을 더 간단하게", "/marketing/rion-order-cafe-qr-hero-v1.png", "카페에서 QR 주문을 사용하는 모습"],
  ["식당·주점", "테이블 주문부터 전달까지 한 흐름으로", "/marketing/rion-order-restaurant-qr-v1.png", "식당 테이블 QR 주문 모습"],
  ["푸드트럭", "현장 주문과 대기 흐름을 깔끔하게", "/marketing/rion-order-foodtruck-v1.png", "푸드트럭에서 주문을 전달하는 모습"],
  ["팝업스토어", "짧은 운영 시간에도 주문을 한 흐름으로", "/marketing/rion-order-popup-qr-v1.png", "팝업 카페에서 주문을 전달하는 모습"],
];

const faqs = [
  ["정말 정식 출시 전까지 무료인가요?", "선정된 매장 1곳은 정식 출시 전까지 기본 구독과 선택한 선결제 옵션을 무료로 이용합니다. 신청만으로 결제되거나 자동 과금되지 않습니다."],
  ["새 태블릿이나 키오스크를 구매해야 하나요?", "아니요. 매장에서 사용하던 태블릿·휴대폰·PC·노트북의 브라우저로 시작할 수 있습니다. 별도 장비 구매·임대·방문 설치는 필요하지 않습니다."],
  ["온라인 선결제는 꼭 사용해야 하나요?", "아니요. 온라인 선결제는 선택 기능입니다. 이용할 경우 고객의 온라인 결제를 받기 위해 결제대행사(PG) 연결이 필요하며, 결제대금은 PG가 매장으로 직접 정산합니다."],
];

export default function OwnerMarketingLanding() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);

  const playVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.currentTime = 0;
    try {
      await video.play();
      setVideoPlaying(true);
    } catch {
      setVideoPlaying(false);
    }
  };

  return (
    <main className="landing">
      <header className="landingHeader">
        <RionBrand compact landing />
        <nav aria-label="랜딩 페이지 이동">
          <a href="#flow">주문 흐름</a>
          <a href="#benefit">베타 혜택</a>
          <a href="#faq">자주 묻는 질문</a>
        </nav>
        <a className="headerCta" href="#apply">베타 참여</a>
      </header>

      <section className="heroSection">
        <div className="heroCopy">
          <p className="eyebrow">RION ORDER · STORE OPERATIONS</p>
          <h1>바쁜 시간,<br />주문받는 일부터 줄이세요.</h1>
          <p className="heroLead">고객은 QR로 직접 주문하고,<br />매장은 주문 확인과 제조에 집중합니다.</p>
          <div className="heroActions">
            <a className="primaryButton" href="#apply">베타 테스터 신청하기 <span aria-hidden>→</span></a>
            <a className="quietLink" href="#flow">어떻게 작동하나요</a>
          </div>
          <p className="microCopy">선정 매장은 정식 출시 전까지 무료 · 신청만으로 자동 결제되지 않음</p>
        </div>
        <div className="heroVisual" aria-label="리온오더 QR 주문 사용 장면">
          <Image src="/marketing/rion-order-cafe-qr-hero-v1.png" alt="카페에서 고객이 QR 주문 카드를 스캔하는 모습" fill priority sizes="(max-width: 760px) 100vw, 48vw" />
          <div className="photoOverlay" />
          <div className="phoneMockup" aria-hidden="true">
            <span className="mockupTop"><i /> 주문 진행 상황</span>
            <b>리온 카페</b>
            <p>아메리카노 × 1 <strong>준비 중</strong></p>
            <p className="muted">카페라떼 × 1 <strong>주문 확인</strong></p>
            <div className="mockupProgress"><i /><i /><i className="on" /></div>
          </div>
          <div className="qrChip">QR 주문<br /><strong>바로 접수</strong></div>
        </div>
      </section>

      <section id="video" className="videoPreview" aria-labelledby="video-preview-title">
        <div className="videoPoster">
          <video
            ref={videoRef}
            aria-label="고객 주문부터 매장 접수와 준비까지 이어지는 리온오더 주문 흐름 영상"
            controls={videoPlaying}
            playsInline
            preload="metadata"
            poster="/marketing/rion-order-cafe-qr-hero-v1.png"
            onEnded={() => setVideoPlaying(false)}
          >
            <source src="/marketing/rion-order-flow.mp4" type="video/mp4" />
          </video>
          {!videoPlaying ? <button className="videoPlayButton" type="button" onClick={() => void playVideo()} aria-label="리온오더 주문 흐름 영상 재생"><span aria-hidden="true">▶</span><b>영상 보기</b><small>18초</small></button> : null}
        </div>
        <div className="videoCopy">
          <p className="eyebrow">RION ORDER FLOW</p>
          <h2 id="video-preview-title">18초로 보는<br />매장 주문 흐름.</h2>
          <p>고객의 주문은 매장으로 바로 이어지고, 직원은 확인 후 준비에 집중합니다.</p>
          <small>카페·식당·푸드트럭·팝업까지, 익숙한 기기로 바로 시작할 수 있습니다.</small>
        </div>
      </section>

      <section id="flow" className="visualFlow">
        <div className="sectionIntro">
          <p className="eyebrow">ORDER FLOW</p>
          <h2>한 번 보면 이해되는<br />매장 주문 흐름.</h2>
          <p>주문은 고객이 직접 확인하고, 매장은 바로 접수합니다.</p>
        </div>
        <div className="storyGrid">
          <article className="storyCard storyTall">
            <Image src="/marketing/rion-order-restaurant-qr-v1.png" alt="식당 테이블에서 고객이 QR 주문을 하는 모습" fill sizes="(max-width: 760px) 100vw, 66vw" />
            <div><span>01</span><b>테이블에서 바로 주문</b><p>메뉴와 옵션을 고객이 직접 확인합니다.</p></div>
          </article>
          <article className="storyCard actualScreen">
            <Image src="/marketing/rion-order-customer-menu.png" alt="리온 카페 고객 메뉴 실제 화면" fill sizes="(max-width: 760px) 100vw, 33vw" />
            <div><span>02 · 실제 화면</span><b>메뉴와 옵션을 한눈에</b></div>
          </article>
          <article className="storyCard">
            <Image src="/marketing/rion-order-popup-qr-v1.png" alt="팝업 카페에서 QR 주문과 음료 전달이 이뤄지는 모습" fill sizes="(max-width: 760px) 100vw, 33vw" />
            <div><span>03</span><b>준비·전달까지 한 흐름</b><p>카페부터 팝업까지 활용합니다.</p></div>
          </article>
        </div>
      </section>

      <section className="insightSection">
        <div className="insightPanel">
          <p className="eyebrow">OPERATION INSIGHT</p>
          <h2>주문이 쌓일수록,<br />운영은 더 선명해집니다.</h2>
          <div className="chart" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          <div className="chartCaption"><span>주문·매출 통계</span><span>인기 메뉴·시간대</span></div>
        </div>
        <div className="insightText">
          <strong>매장 흐름을 한곳에서 확인</strong>
          <p>일·주·월 주문 흐름과 인기 메뉴를 확인하고, 충분한 기록이 쌓이면 AI 브리핑으로 확인할 포인트를 정리합니다.</p>
          <small>AI는 메뉴·가격·주문을 자동으로 바꾸지 않습니다.</small>
        </div>
      </section>

      <section className="storeTypes">
        <p className="eyebrow">FOR EVERY STORE</p>
        <h2>주문을 받는 모든 매장을<br />더 간단하게.</h2>
        <div>{storeTypes.map(([title, text, src, alt]) => <article key={title}><div className="storePhoto"><Image src={src} alt={alt} fill sizes="(max-width: 760px) 50vw, 25vw" /></div><b>{title}</b><span>{text}</span></article>)}</div>
      </section>

      <section id="benefit" className="benefitSection">
        <div className="benefitLead">
          <p className="eyebrow">RION ORDER BETA</p>
          <h2>첫 번째 매장 운영을<br />함께 만들어 주세요.</h2>
          <p>실제 매장에서 사용해 보고, 더 나은 주문 경험을 함께 검증할 매장을 찾습니다.</p>
          <div className="deviceNote"><b>새 장비 없이 바로 시작</b><span>기존 태블릿·휴대폰·PC·노트북 브라우저로 이용</span></div>
        </div>
        <div className="benefitContent">
          <div className="benefitMetrics">
            <article><em>선정 베타 혜택</em><strong>무료</strong><span>정식 출시 전까지</span></article>
            <article><em>정식 출시 후</em><strong>40%</strong><span>구독 할인 유지</span></article>
            <article><em>별도 장비</em><strong>없음</strong><span>기존 기기로 시작</span></article>
          </div>
          <div className="costBox">
            <div><b>정식 출시 후 월 구독료</b><span>베타 40% 할인 기준</span></div>
            <div className="costOptions">
              <p><span>기본 주문</span><strong><del>14,900원</del> 8,940원</strong><small>기존 POS·카드 단말기 결제</small></p>
              <p><span>온라인 선결제</span><strong><del>19,900원</del> 11,940원</strong><small>기본 구독 + 선결제 옵션</small></p>
            </div>
            <details>
              <summary>온라인 선결제와 PG 비용 안내 <span aria-hidden>⌄</span></summary>
              <p>온라인 선결제는 선택 기능이며 결제대행사(PG) 연결이 필요합니다. PG 비용은 리온오더가 부과하는 비용이 아니라 온라인 결제를 받기 위해 PG와 별도 계약할 때 발생합니다.</p>
              <p>비교용 월 환산 예시: 첫해 약 27,500원 · 2년 차부터 약 9,200원 + 결제 매출의 약 3.4%. 실제 조건은 계약·결제수단에 따라 달라집니다.</p>
            </details>
          </div>
        </div>
      </section>

      <section id="faq" className="faqSection">
        <div><p className="eyebrow">FAQ</p><h2>시작 전에<br />궁금한 점.</h2></div>
        <div className="faqList">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden>⌄</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section id="apply" className="applySection">
        <p className="eyebrow">BETA APPLICATION</p>
        <h2>우리 매장에서도<br />바로 써보고 싶다면.</h2>
        <p>신청 내용을 확인한 뒤 선정 결과와 시작 일정을 개별 안내합니다.</p>
        <div><a className="primaryButton light" href="/beta-apply">베타 참여 신청하기 <span aria-hidden>→</span></a><a className="quietLink lightLink" href="#faq">먼저 궁금한 점 확인하기</a></div>
        <small>신청만으로 결제되거나 자동 과금되지 않습니다.</small>
      </section>

      <footer>© RION Labs. Realize Innovation ON</footer>

      <style>{`
        .videoPreview{max-width:980px;margin:0 auto;padding:0 28px 56px;display:grid;grid-template-columns:.58fr 1.42fr;gap:50px;align-items:center}.videoPoster{position:relative;width:min(100%,320px);aspect-ratio:9/16;justify-self:center;overflow:hidden;border-radius:22px;background:#0d264c;box-shadow:0 18px 38px rgba(16,38,75,.18)}.videoPoster video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.videoPlayButton{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;border:0;background:linear-gradient(180deg,rgba(9,26,54,.08),rgba(9,26,54,.62));color:#fff;cursor:pointer;font:inherit;font-weight:900}.videoPlayButton>span{width:62px;height:62px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.75);border-radius:50%;background:rgba(16,38,75,.7);font-size:22px;padding-left:3px}.videoPlayButton small{font-size:11px;font-weight:800;opacity:.82}.videoCopy h2{font-size:34px;line-height:1.16}.videoCopy>p:not(.eyebrow){margin:16px 0 0;color:#62718a;font-size:16px;font-weight:600;line-height:1.72}.videoCopy small{display:block;margin-top:14px;color:#8997aa;font-size:12px}.landing{--navy:#10264b;--blue:#285fd4;--blueSoft:#edf4ff;--line:#dce5f2;min-height:100vh;background:#f5f7fb;color:#10264b;font-family:Arial,sans-serif}.landingHeader{height:72px;max-width:1180px;margin:auto;padding:0 28px;display:flex;align-items:center;gap:34px;background:#fff;border-bottom:1px solid #e1e8f1}.landingHeader nav{display:flex;gap:24px;margin-left:auto}.landingHeader a{color:#526581;text-decoration:none;font-size:13px;font-weight:800}.headerCta{display:inline-flex;min-height:36px;padding:0 13px;align-items:center;border:1px solid #cfdcf0;border-radius:9px;color:var(--blue)!important}.heroSection{max-width:1124px;min-height:540px;margin:auto;padding:72px 28px;display:grid;grid-template-columns:1.02fr .98fr;align-items:center;gap:52px}.eyebrow{margin:0 0 12px;color:#2763cf;font-size:11px;font-weight:900;letter-spacing:.14em}.heroCopy h1,.landing h2{margin:0;letter-spacing:-.065em}.heroCopy h1{font-size:57px;line-height:1.08}.heroLead{margin:22px 0 0;color:#53647d;font-size:18px;font-weight:600;line-height:1.7}.heroActions{display:flex;align-items:center;gap:21px;margin:31px 0 14px}.primaryButton{min-height:50px;padding:0 19px;display:inline-flex;align-items:center;justify-content:center;gap:11px;border-radius:12px;background:var(--blue);box-shadow:0 10px 22px rgba(30,83,190,.2);color:#fff!important;font-size:14px!important;font-weight:900!important;text-decoration:none}.primaryButton span{font-size:20px;line-height:0}.quietLink{color:#244b87;text-decoration:none;font-size:14px;font-weight:900}.microCopy{margin:0;color:#738199;font-size:12px}.heroVisual{position:relative;min-height:375px;overflow:hidden;border-radius:28px;background:var(--navy)}.heroVisual img{object-fit:cover}.photoOverlay{position:absolute;inset:0;background:linear-gradient(90deg,rgba(232,242,255,.04),rgba(13,35,72,.26))}.phoneMockup{position:absolute;z-index:1;left:50%;top:50%;width:265px;min-height:330px;box-sizing:border-box;padding:18px;transform:translate(-50%,-50%) rotate(3deg);border:8px solid var(--navy);border-radius:31px;background:#fff;box-shadow:0 24px 48px rgba(20,47,91,.3)}.mockupTop{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800}.mockupTop i{width:7px;height:7px;border-radius:50%;background:#1fa86d}.phoneMockup>b{display:block;margin:26px 0 14px;font-size:20px}.phoneMockup p{margin:8px 0 0;padding:12px;border-radius:11px;background:#edf4ff;font-size:13px;font-weight:800}.phoneMockup p strong{display:block;margin-top:5px;color:#2863ca}.phoneMockup p.muted{background:#f5f7fa;color:#75849a}.phoneMockup p.muted strong{color:#75849a}.mockupProgress{display:flex;gap:7px;margin-top:25px}.mockupProgress i{height:7px;flex:1;border-radius:99px;background:#d9e2ef}.mockupProgress .on{background:#2863ca}.qrChip{position:absolute;z-index:2;right:24px;top:52px;padding:14px 17px;border-radius:13px;background:var(--navy);box-shadow:0 10px 20px rgba(16,38,75,.3);color:#fff;font-size:13px;line-height:1.45}.qrChip strong{font-size:16px}.visualFlow{padding:82px max(28px,calc((100% - 1124px)/2));background:#fff;border-top:1px solid #e2e9f2}.sectionIntro{display:grid;grid-template-columns:1fr .75fr;column-gap:70px;align-items:end}.sectionIntro h2,.insightSection h2,.storeTypes h2,.benefitLead h2,.faqSection h2{font-size:36px;line-height:1.16}.sectionIntro>p:last-child{margin:0;color:#63718a;line-height:1.7;font-size:16px;font-weight:600}.storyGrid{display:grid;grid-template-columns:1.25fr .78fr;grid-template-rows:270px 270px;gap:16px;margin-top:40px}.storyCard{position:relative;overflow:hidden;border-radius:22px;background:var(--navy)}.storyCard img{object-fit:cover}.storyCard:after{position:absolute;inset:0;content:"";background:linear-gradient(0deg,rgba(9,26,54,.82),transparent 60%)}.storyCard>div{position:absolute;z-index:1;left:24px;right:24px;bottom:20px;color:#fff}.storyCard span{display:block;margin-bottom:7px;color:#aed0ff;font-size:11px;font-weight:900;letter-spacing:.12em}.storyCard b{font-size:20px;letter-spacing:-.04em}.storyCard p{margin:7px 0 0;color:#dce9fc;font-size:13px}.storyTall{grid-row:span 2}.actualScreen img{object-position:50% 20%}.actualScreen b{font-size:17px}.insightSection{max-width:1124px;margin:0 auto;padding:72px 28px;display:grid;grid-template-columns:1.15fr .85fr;gap:18px}.insightPanel{padding:38px;border-radius:24px;background:var(--navy);color:#fff}.insightPanel .eyebrow{color:#91bbff}.insightPanel h2{font-size:32px}.chart{height:150px;margin:36px 0 12px;display:flex;gap:12px;align-items:end;border-bottom:1px solid rgba(255,255,255,.3)}.chart i{flex:1;border-radius:7px 7px 0 0;background:linear-gradient(#80b1ff,#3d78df)}.chart i:nth-child(1){height:43%}.chart i:nth-child(2){height:68%}.chart i:nth-child(3){height:53%}.chart i:nth-child(4){height:86%}.chart i:nth-child(5){height:74%}.chart i:nth-child(6){height:96%}.chartCaption{display:flex;justify-content:space-between;color:#b9cbe8;font-size:12px;font-weight:700}.insightText{display:grid;align-content:center;gap:15px;padding:37px;border:1px solid var(--line);border-radius:24px;background:#fff}.insightText strong{font-size:21px;letter-spacing:-.04em}.insightText p{margin:0;color:#62718a;font-size:15px;line-height:1.75;font-weight:600}.insightText small{color:#8997aa;line-height:1.55}.storeTypes{max-width:1124px;margin:0 auto;padding:8px 28px 76px;text-align:center}.storeTypes h2{font-size:34px}.storeTypes>div{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:32px;text-align:left}.storeTypes article{display:grid;gap:9px;padding:10px 10px 16px;border:1px solid var(--line);border-radius:16px;background:#fff}.storePhoto{position:relative;min-height:158px;overflow:hidden;border-radius:11px;background:#dfe8f5}.storePhoto img{object-fit:cover}.storeTypes b{padding:0 5px;font-size:17px}.storeTypes span{padding:0 5px;color:#6d7b90;font-size:13px;line-height:1.55}.benefitSection{max-width:1068px;margin:6px auto 70px;padding:52px 56px;display:grid;grid-template-columns:.78fr 1.22fr;gap:46px;border-radius:28px;background:#164184;color:#fff}.benefitSection .eyebrow{color:#a7c9ff}.benefitLead h2{font-size:35px}.benefitLead>p:not(.eyebrow){margin:15px 0 0;color:#cde0ff;line-height:1.65}.deviceNote{display:grid;gap:5px;margin-top:24px;padding:15px;border-left:2px solid #a7c9ff;border-radius:0 12px 12px 0;background:rgba(255,255,255,.1)}.deviceNote b{font-size:13px}.deviceNote span{color:#cfe0ff;font-size:12px;line-height:1.5}.benefitContent{display:grid;gap:12px}.benefitMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.benefitMetrics article{display:grid;gap:4px;padding:14px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:rgba(255,255,255,.1)}.benefitMetrics em{font-size:10px;color:#cfe0ff;font-style:normal;font-weight:900}.benefitMetrics strong{font-size:28px;line-height:1}.benefitMetrics span{font-size:12px;color:#e5efff}.costBox{padding:16px;border:1px solid rgba(255,255,255,.22);border-radius:16px;background:rgba(10,32,70,.32)}.costBox>div:first-child{display:flex;justify-content:space-between;gap:12px;font-size:13px}.costBox>div:first-child span{font-size:11px;color:#cfe0ff}.costOptions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.costOptions p{display:grid;gap:4px;margin:0;padding:12px;border-radius:11px;background:rgba(255,255,255,.1)}.costOptions span,.costOptions small{color:#c9daf5;font-size:11px}.costOptions strong{font-size:18px;letter-spacing:-.04em}.costOptions del{color:#a9c0e4;font-size:11px}.costBox details{margin-top:13px;border-top:1px solid rgba(255,255,255,.2);padding-top:12px}.costBox summary,.faqList summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;font-weight:900;list-style:none}.costBox summary::-webkit-details-marker,.faqList summary::-webkit-details-marker{display:none}.costBox summary{font-size:12px}.costBox details p{margin:10px 0 0;color:#cfe0ff;font-size:11px;line-height:1.55}.faqSection{max-width:1068px;margin:0 auto 70px;padding:0 28px;display:grid;grid-template-columns:.65fr 1.35fr;gap:66px}.faqList{display:grid;gap:9px}.faqList details{padding:18px 19px;border:1px solid var(--line);border-radius:14px;background:#fff}.faqList summary{font-size:15px}.faqList summary span{color:var(--blue)}.faqList p{margin:13px 0 0;color:#64738b;font-size:14px;line-height:1.65}.applySection{max-width:1124px;margin:0 auto 58px;padding:65px 28px;text-align:center;border-radius:28px;background:var(--navy);color:#fff}.applySection .eyebrow{color:#9bc3ff}.applySection h2{font-size:40px;line-height:1.15}.applySection>p:not(.eyebrow){margin:15px auto 0;color:#cbdcf7;line-height:1.65}.applySection>div{display:flex;justify-content:center;align-items:center;gap:22px;margin:29px 0 13px}.primaryButton.light{background:#fff;color:#194889!important;box-shadow:none}.lightLink{color:#d4e3fb}.applySection small{color:#aebfdb;font-size:12px}footer{padding:25px;text-align:center;background:#fff;color:#8a98aa;font-size:12px}@media(min-width:761px){.videoPreview{max-width:1040px;grid-template-columns:360px minmax(0,1fr);gap:56px}.videoPoster{width:360px}}@media(max-width:760px){.landingHeader{height:60px;padding:0 18px}.landingHeader nav{display:none}.headerCta{margin-left:auto}.heroSection{min-height:0;padding:52px 20px;grid-template-columns:1fr;gap:32px}.heroCopy h1{font-size:40px}.heroLead{font-size:16px}.heroActions{display:grid;gap:14px}.primaryButton{width:100%;box-sizing:border-box}.quietLink{text-align:center}.heroVisual{min-height:330px}.phoneMockup{width:244px;transform:translate(-50%,-50%)}.qrChip{right:14px;top:36px}.visualFlow{padding:58px 20px}.sectionIntro,.insightSection,.benefitSection,.faqSection{grid-template-columns:1fr;gap:26px}.sectionIntro h2,.insightSection h2,.storeTypes h2,.benefitLead h2,.faqSection h2{font-size:29px}.storyGrid{grid-template-columns:1fr;grid-template-rows:290px 250px 290px}.storyTall{grid-row:auto}.insightSection{padding:54px 20px}.insightPanel,.insightText{padding:28px}.storeTypes{padding:6px 20px 55px}.storeTypes>div{grid-template-columns:repeat(2,1fr);gap:10px}.storeTypes article{padding:8px 8px 13px}.storePhoto{min-height:130px}.storeTypes b{font-size:15px}.storeTypes span{font-size:12px}.benefitSection{margin:0 20px 55px;padding:35px 25px}.benefitMetrics{grid-template-columns:repeat(3,1fr)}.benefitMetrics article{padding:11px}.benefitMetrics strong{font-size:23px}.benefitMetrics em{font-size:9px}.benefitMetrics span{font-size:10px}.costOptions{grid-template-columns:1fr}.faqSection{padding:0 20px;margin-bottom:55px}.applySection{margin:0 20px 40px;padding:54px 24px}.applySection h2{font-size:33px}.applySection>div{display:grid;gap:15px}.lightLink{font-size:13px}.microCopy{line-height:1.5}.storyCard>div{left:20px;right:20px}.videoPreview{padding:0 20px 46px;grid-template-columns:1fr;gap:24px}.videoPoster{width:min(100%,360px)}}
      `}</style>
    </main>
  );
}
