"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import RionBrand from "@/app/components/RionBrand";
import { BETA_INQUIRY_CONSENT_TITLE, BETA_INQUIRY_CONSENT_VERSION } from "@/app/lib/betaInquiryConsent";

type Round = { id: number; status: "draft" | "open" | "closed"; public_message: string } | null;
type FormState = { storeName: string; businessType: string; contactMethod: "email" | "phone"; contactEmail: string; contactPhone: string; note: string; privacyConsent: boolean; website: string };
const blank: FormState = { storeName: "", businessType: "", contactMethod: "phone", contactEmail: "", contactPhone: "", note: "", privacyConsent: false, website: "" };

export default function BetaApplicationForm() {
  const [round, setRound] = useState<Round>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [retryCount, setRetryCount] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [localPreview, setLocalPreview] = useState(false);
  const submitting = useRef(false);
  const [form, setForm] = useState(blank);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (process.env.NODE_ENV === "development" && new URLSearchParams(window.location.search).get("localPreview") === "1") {
      setLocalPreview(true);
      setRound({ id: 0, status: "open", public_message: "" });
      setLoadState("ready");
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    void (async () => {
      try {
        const response = await fetch("/api/beta-recruitment", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("접수 정보 조회 실패");
        const payload = await response.json();
        if (!payload || !Object.prototype.hasOwnProperty.call(payload, "round")) throw new Error("접수 정보 형식 오류");
        if (payload.round && (!Number.isInteger(payload.round.id) || !["draft", "open", "closed"].includes(payload.round.status))) throw new Error("접수 정보 형식 오류");
        if (!controller.signal.aborted) { setRound(payload.round || null); setLoadState("ready"); }
      } catch {
        if (!controller.signal.aborted) { setRound(null); setLoadState("error"); }
      }
    })();
    return () => controller.abort();
  }, [retryCount]);
  const closed = loadState === "ready" && (!round || round.status !== "open");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || submitted || loadState !== "ready" || closed) return;
    if (localPreview) { setSubmitted(true); return; }
    submitting.current = true; setMessage(""); setSaving(true);
    try {
      const response = await fetch("/api/beta-applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, intakeType: "inquiry", contactEmail: form.contactMethod === "email" ? form.contactEmail : "", contactPhone: form.contactMethod === "phone" ? form.contactPhone : "", recruitmentRoundId: round?.id, privacyConsentVersion: BETA_INQUIRY_CONSENT_VERSION }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(String(result?.message || "문의를 저장하지 못했습니다."));
      setSubmitted(true); setForm(blank);
    } catch (error) { setMessage(error instanceof Error ? error.message : "문의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { submitting.current = false; setSaving(false); }
  }

  return (
    <main className="inquiryPage">
      <header><RionBrand compact /><Link href="/owner">서비스 소개</Link></header>
      <section className="inquiryContent">
        <p className="eyebrow">RION ORDER · 사전 이용</p>
        <h1>우리 매장 이용,<br />편하게 문의해 주세요.</h1>
        <p className="lead">아직 도입을 결정하지 않으셔도 괜찮습니다.<br />남겨주신 연락처로 문자 또는 이메일을 통해 이용 방법과 혜택을 안내드립니다.</p>
        {localPreview ? <p className="notice">로컬 미리보기입니다. 문의는 저장되지 않고 실제 연락도 발송되지 않습니다.</p> : null}
        {round?.public_message && !localPreview ? <details className="roundMessage"><summary>현재 접수 안내</summary><p>{round.public_message}</p></details> : null}
        {submitted ? <div className="success" role="status" tabIndex={-1} ref={(node) => node?.focus()}>
          <h2>{localPreview ? "문의 완료 화면 미리보기" : "문의를 접수했습니다."}</h2>
          <p>남겨주신 연락처로 문자 또는 이메일을 통해 사전 이용을 안내드리겠습니다.</p>
          <p>문의만으로 가입이나 결제가 진행되지 않습니다.</p>
          <Link href="/owner">서비스 소개로 돌아가기</Link>
        </div> : loadState === "loading" ? <p className="notice" role="status">접수 정보를 확인하고 있습니다.</p>
          : loadState === "error" ? <div className="notice error" role="alert"><p>접수 정보를 불러오지 못했습니다.</p><button type="button" onClick={() => setRetryCount((count) => count + 1)}>다시 시도</button></div>
          : closed ? <div className="notice"><h2>현재 사전 이용 문의 접수가 종료되었습니다.</h2><p>다음 접수는 서비스 소개와 공지 채널을 통해 안내드립니다.</p><Link href="/owner">서비스 소개로 돌아가기</Link></div>
          : <form onSubmit={submit}>
            {message ? <p className="notice error" role="alert">{message}</p> : null}
            <fieldset disabled={saving}>
              <legend>사전 이용 문의</legend>
              <div className="two">
                <label>매장명<input required minLength={2} maxLength={80} value={form.storeName} onChange={(e) => update("storeName", e.target.value)} placeholder="예: 리온 카페" autoComplete="organization" /></label>
                <label>업종<select required value={form.businessType} onChange={(e) => update("businessType", e.target.value)}><option value="">선택해 주세요</option><option value="cafe">카페</option><option value="restaurant">식당</option><option value="bar">술집</option><option value="food_truck">푸드트럭</option><option value="popup">팝업스토어</option><option value="other">기타</option></select></label>
              </div>
              <fieldset className="contactChoice"><legend>답변받을 방법</legend><label><input type="radio" name="contactMethod" checked={form.contactMethod === "phone"} onChange={() => update("contactMethod", "phone")} />문자</label><label><input type="radio" name="contactMethod" checked={form.contactMethod === "email"} onChange={() => update("contactMethod", "email")} />이메일</label></fieldset>
              {form.contactMethod === "email"
                ? <label>답변받을 이메일<input required type="email" maxLength={254} autoComplete="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} placeholder="example@email.com" /></label>
                : <label>문자 수신 휴대폰 번호<input required type="tel" inputMode="tel" maxLength={30} pattern="0[0-9 -]{8,29}" autoComplete="tel" value={form.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} placeholder="010-0000-0000" /></label>}
              <label>궁금한 내용 <span>선택</span><textarea maxLength={1000} value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="우리 매장에서도 사용할 수 있나요? 궁금한 점을 편하게 남겨 주세요." /></label>
            </fieldset>
            <label className="consent"><input required type="checkbox" checked={form.privacyConsent} onChange={(e) => update("privacyConsent", e.target.checked)} disabled={saving} /><span><b>{BETA_INQUIRY_CONSENT_TITLE} (필수)</b><small>문의 답변과 요청하신 사전 이용 상담에만 사용합니다. <Link href="/legal/prelaunch-inquiry-privacy" target="_blank" rel="noreferrer">전문 보기</Link></small></span></label>
            <label className="honeypot" aria-hidden="true">웹사이트<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => update("website", e.target.value)} /></label>
            <button className="submitButton" disabled={saving || loadState !== "ready" || closed} type="submit">{saving ? "문의 접수 중…" : localPreview ? "문의 남기기 · 미리보기" : "문의 남기기"}</button>
            <p className="footnote">문의만으로 가입이나 결제가 진행되지 않습니다.</p>
          </form>}
      </section>
      <style jsx>{`
        .inquiryPage{min-height:100vh;background:#f5f7fb;color:#10264b;font-family:Arial,sans-serif;word-break:keep-all}.inquiryPage *{box-sizing:border-box}
        header{max-width:1040px;margin:auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #dce5f2}header :global(a){color:#526581;font-size:13px;text-decoration:none;font-weight:700}
        .inquiryContent{width:min(100% - 40px,640px);margin:auto;padding:40px 0 50px}.eyebrow{margin:0 0 12px;color:#285fd4;font-size:12px;font-weight:800}h1{margin:0;font-size:36px;line-height:1.3;letter-spacing:-.05em}.lead{margin:16px 0 24px;color:#53647d;font-size:15px;line-height:1.7}
        form{display:grid;gap:14px}fieldset{margin:0;padding:18px 20px 20px;border:1px solid #dce5f2;border-radius:14px;background:#fff;min-width:0}legend{padding:0 5px;font-size:15px;font-weight:800}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        label{display:grid;gap:7px;margin-top:12px;font-size:14px;font-weight:700}label>span{font-size:12px;color:#64758f}input,select,textarea{width:100%;padding:12px;border:1px solid #cbd8e8;border-radius:9px;background:#fff;color:#10264b;font:inherit;font-size:16px;font-weight:400;min-height:46px}textarea{min-height:86px;resize:vertical}
        .contactChoice{display:flex;gap:10px;margin-top:18px;padding:0;border:0}.contactChoice legend{padding:0;font-size:14px}.contactChoice label{display:flex;align-items:center;gap:8px;min-height:44px;margin-top:8px;padding:8px 14px;border:1px solid #cbd8e8;border-radius:9px;cursor:pointer}.contactChoice input,.consent input{width:18px;height:18px;min-height:0;margin:0;accent-color:#285fd4}
        .consent{display:flex;align-items:flex-start;gap:10px;margin:0;padding:14px;border-radius:12px;background:#edf4ff}.consent>span{flex:1;color:#10264b}.consent small{display:block;margin-top:6px;color:#53647d;font-size:12px;line-height:1.6}.consent :global(a){color:#225ebc}
        .submitButton{min-height:56px;border:0;border-radius:12px;background:#285fd4;color:#fff;font-size:17px;font-weight:800;cursor:pointer}.submitButton:disabled{opacity:.6;cursor:default}.footnote{margin:0;text-align:center;color:#64758f;font-size:12px;line-height:1.6}
        .notice,.success{padding:18px;border:1px solid #cfe0fb;border-radius:12px;background:#edf4ff;font-size:14px;line-height:1.7}.notice h2,.success h2{font-size:21px;margin:0}.notice p,.success p{margin:8px 0}.notice button{min-height:44px;padding:0 16px}.success{background:#effbf4;border-color:#bde6d0}.success :global(a){color:#225ebc}.error{background:#fff4f4;border-color:#efc5c5;color:#9b2525}.roundMessage{margin:0 0 18px;color:#53647d;font-size:13px;line-height:1.6}.roundMessage summary{min-height:44px;cursor:pointer;font-weight:700}.roundMessage p{margin:0}
        .honeypot{position:absolute;left:-9999px;opacity:0}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #92b5ef;outline-offset:3px}
        @media(max-width:600px){header{padding:12px 18px}.inquiryContent{width:calc(100% - 32px);padding:28px 0 40px}h1{font-size:29px}.lead{font-size:14px}.two{grid-template-columns:1fr}fieldset{padding:14px 16px 16px}}
      `}</style>
    </main>
  );
}
