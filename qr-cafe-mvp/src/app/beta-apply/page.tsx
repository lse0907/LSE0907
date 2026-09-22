"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import RionBrand from "@/app/components/RionBrand";
import BetaApplicationForm from "@/app/components/BetaApplicationForm";

type FormState = {
  storeName: string; businessType: string; operationType: string; region: string;
  contactName: string; contactMethod: "email" | "phone"; contactEmail: string; contactPhone: string; preferredStart: string;
  feedbackAvailable: boolean; note: string; privacyConsent: boolean; website: string;
};

const initialForm: FormState = { storeName: "", businessType: "", operationType: "", region: "", contactName: "", contactMethod: "email", contactEmail: "", contactPhone: "", preferredStart: "", feedbackAvailable: false, note: "", privacyConsent: false, website: "" };

export default function BetaApplyPage() {
  return <BetaApplicationForm />;
}

// Kept temporarily for comparison while the public intake is being refined.
export function LegacyBetaApplyPage() {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (key: keyof FormState, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      const response = await fetch("/api/beta-applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(String(result?.message || "신청을 저장하지 못했습니다."));
      setMessage("신청이 접수되었습니다. 검토 후 선정 결과와 시작 일정을 개별 안내드립니다.");
      setForm(initialForm);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return <main className="betaApply"><header><RionBrand compact /><Link href="/owner">랜딩으로 돌아가기</Link></header><section><p className="eyebrow">RION ORDER BETA</p><h1>베타 테스터 신청</h1><p className="lead">실제 매장 환경에서 함께 검증할 매장을 찾습니다. 신청 후 선정 결과와 시작 일정을 개별 안내드립니다.</p><div className="benefit"><b>선정 매장 혜택</b><span>정식 출시 전까지 무료 이용 · 출시 후 구독 40% 할인</span></div>{message ? <p className="message" role="alert">{message}</p> : null}<form onSubmit={submit}><fieldset><legend>매장 정보</legend><label>매장명<input required value={form.storeName} onChange={(e) => update("storeName", e.target.value)} placeholder="예: 리온 카페" /></label><div className="two"><label>업종<select required value={form.businessType} onChange={(e) => update("businessType", e.target.value)}><option value="">선택해 주세요</option><option value="cafe">카페</option><option value="restaurant">식당</option><option value="bar">주점</option><option value="food_truck">푸드트럭</option><option value="popup">팝업스토어</option><option value="other">기타</option></select></label><label>운영 형태<select required value={form.operationType} onChange={(e) => update("operationType", e.target.value)}><option value="">선택해 주세요</option><option value="dine_in">매장 식사 중심</option><option value="takeout">포장·픽업 중심</option><option value="both">둘 다 운영</option></select></label></div><label>매장 지역<input required value={form.region} onChange={(e) => update("region", e.target.value)} placeholder="예: 서울 성수동" /></label></fieldset><fieldset><legend>연락 정보</legend><div className="two"><label>연락받을 분<input required value={form.contactName} onChange={(e) => update("contactName", e.target.value)} placeholder="이름" /></label><label>연락처<input required type="tel" inputMode="tel" value={form.contactPhone} onChange={(e) => update("contactPhone", e.target.value)} placeholder="010-0000-0000" /></label></div><label>이메일<input required type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} placeholder="example@email.com" /></label></fieldset><fieldset><legend>시작 희망 시점</legend><div className="choice"><label><input required type="radio" name="start" checked={form.preferredStart === "asap"} onChange={() => update("preferredStart", "asap")} /> 가능한 빨리</label><label><input type="radio" name="start" checked={form.preferredStart === "within_month"} onChange={() => update("preferredStart", "within_month")} /> 한 달 이내</label><label><input type="radio" name="start" checked={form.preferredStart === "later"} onChange={() => update("preferredStart", "later")} /> 일정 협의</label></div><label>미리 알려주실 내용 <span>선택</span><textarea value={form.note} onChange={(e) => update("note", e.target.value)} maxLength={1000} placeholder="현재 주문 방식이나 기대하는 점을 자유롭게 적어 주세요." /></label></fieldset><label className="consent"><input required type="checkbox" checked={form.privacyConsent} onChange={(e) => update("privacyConsent", e.target.checked)} /><span><b>개인정보 수집·이용 안내 확인</b><small>신청 검토 및 선정 결과 안내를 위해 매장·연락 정보를 수집하며, 베타 운영 목적 외로 사용하지 않습니다.</small></span></label><label className="honeypot" aria-hidden="true">웹사이트<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => update("website", e.target.value)} /></label><button disabled={saving} type="submit">{saving ? "신청 접수 중..." : "베타 테스터 신청하기"}</button><p className="footnote">신청만으로 결제되거나 자동 과금되지 않습니다.</p></form></section><style jsx>{`.betaApply{min-height:100vh;background:#f4f7fb;color:#10264b;font-family:Arial,sans-serif}.betaApply header{height:70px;display:flex;align-items:center;justify-content:space-between;max-width:1040px;margin:auto;padding:0 28px;border-bottom:1px solid #dce5f1;background:#fff}.betaApply header :global(a){color:#49627f;text-decoration:none;font-size:13px;font-weight:800}.betaApply section{width:min(100% - 40px,720px);margin:0 auto;padding:68px 0 80px}.eyebrow{margin:0 0 10px;color:#2863cd;font-size:11px;font-weight:900;letter-spacing:.14em}h1{margin:0;font-size:42px;letter-spacing:-.06em}.lead{margin:15px 0 24px;color:#5d6e88;font-size:16px;font-weight:600;line-height:1.7}.benefit,.message{display:grid;gap:5px;margin-bottom:18px;padding:16px 18px;border:1px solid #cfe0fb;border-radius:14px;background:#edf5ff}.benefit b{font-size:14px}.benefit span,.message{color:#315786;font-size:13px;line-height:1.55}.message{border-color:#bde6d0;background:#effbf4;color:#14643b}form{display:grid;gap:16px}fieldset{margin:0;padding:22px;border:1px solid #dbe4f0;border-radius:16px;background:#fff}legend{padding:0 5px;font-size:15px;font-weight:900}label{display:grid;gap:7px;margin-top:13px;font-size:13px;font-weight:800}input,select,textarea{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid #cbd8e8;border-radius:10px;background:#fff;color:#10264b;font:inherit;font-size:14px;font-weight:500}textarea{min-height:104px;resize:vertical}label span{color:#708099;font-size:11px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.choice{display:flex;flex-wrap:wrap;gap:10px}.choice label{display:flex;align-items:center;gap:7px;margin:0;padding:10px 12px;border:1px solid #d6e0ed;border-radius:10px;font-size:13px;font-weight:700}.choice input,.consent input{width:auto}.consent{display:flex;align-items:flex-start;gap:10px;margin:0;padding:16px;border-radius:13px;background:#eef4fc}.consent small{display:block;margin-top:5px;color:#64758f;font-size:12px;font-weight:500;line-height:1.55}.honeypot{position:absolute;left:-9999px;opacity:0}button{min-height:52px;border:0;border-radius:12px;background:#285fd4;color:#fff;font-size:15px;font-weight:900;cursor:pointer}button:disabled{opacity:.6}.footnote{margin:0;text-align:center;color:#75859b;font-size:12px}@media(max-width:600px){.betaApply header{height:60px;padding:0 18px}.betaApply section{width:min(100% - 32px,720px);padding:45px 0 58px}h1{font-size:34px}.two{grid-template-columns:1fr}.choice{display:grid;grid-template-columns:1fr}.choice label{margin:0}}`}</style></main>;
}
