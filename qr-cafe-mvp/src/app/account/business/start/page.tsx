"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import RionBrand from "@/app/components/RionBrand";
import { supabase } from "@/app/lib/supabaseClient";

type Verification = {
  status: string;
  submitted_at?: string | null;
  review_note?: string | null;
  business_entities?: { legal_name?: string; business_number?: string; verification_status?: string } | null;
};

const STATUS: Record<string, { label: string; description: string }> = {
  submitted: { label: "OPS 검토 중", description: "제출한 사업자 정보와 신청 권한을 확인하고 있습니다." },
  changes_requested: { label: "자료 보완 필요", description: "보완 사유를 확인하고 신청서를 다시 제출해 주세요." },
  approved: { label: "사업자 인증 완료", description: "인증된 사업체로 첫 매장을 만들 수 있습니다." },
  rejected: { label: "인증 요청 확인 필요", description: "거절 사유를 확인하거나 지원센터에 문의해 주세요." },
};

function BusinessStartContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const localPreview = process.env.NODE_ENV !== "production" && searchParams.get("preview") === "1";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [message, setMessage] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [legalName, setLegalName] = useState("");
  const [representativeName, setRepresentativeName] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessType, setBusinessType] = useState("sole_proprietor");
  const [applicantRole, setApplicantRole] = useState("representative");
  const [businessDocument, setBusinessDocument] = useState<File | null>(null);
  const [delegationDocument, setDelegationDocument] = useState<File | null>(null);

  const load = async () => {
    const response = await fetch("/api/account/business-verification", { cache: "no-store" });
    if (response.status === 401) {
      router.replace(`/login?next=${encodeURIComponent("/account/business/start")}`);
      return;
    }
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; verification?: Verification | null };
    if (!response.ok || !payload.ok) setMessage(payload.message || "인증 상태를 불러오지 못했습니다.");
    else setVerification(payload.verification || null);
    setLoading(false);
  };

  useEffect(() => {
    if (localPreview) {
      const timer = window.setTimeout(() => setLoading(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [localPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = verification ? STATUS[verification.status] : null;
  const canEdit = !verification || ["changes_requested", "rejected"].includes(verification.status);
  const progress = useMemo(() => applicantRole === "authorized_manager" ? "대표자 위임 자료까지 함께 제출합니다." : "대표자 본인 신청으로 진행합니다.", [applicantRole]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessDocument) return setMessage("사업자등록증을 첨부해 주세요.");
    if (applicantRole === "authorized_manager" && !delegationDocument) return setMessage("위임 확인자료를 첨부해 주세요.");
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      Object.entries({ businessNumber, legalName, representativeName, openingDate, registeredAddress, businessPhone, businessType, applicantRole }).forEach(([key, value]) => form.set(key, value));
      form.set("businessDocument", businessDocument);
      if (delegationDocument) form.set("delegationDocument", delegationDocument);
      const response = await fetch("/api/account/business-verification", { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message || "인증 신청을 제출하지 못했습니다.");
      await load();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "인증 신청을 제출하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => { await supabase.auth.signOut(); router.replace("/login"); };

  return (
    <main className="businessStart">
      <div className="pageShell">
        <header className="brandHeader"><RionBrand product auth /><div><Link href="/">서비스 선택</Link><button type="button" onClick={() => void signOut()}>로그아웃</button></div></header>
        <section className="intro">
          <span>BUSINESS ONBOARDING</span>
          <h1>사업자 인증 신청</h1>
          <p>사업자 정보를 한 번 인증하면 같은 사업체로 여러 매장을 운영할 수 있습니다.</p>
          <ol><li className="active"><b>01</b> 정보 제출</li><li className={verification ? "active" : ""}><b>02</b> OPS 검토</li><li className={verification?.status === "approved" ? "active" : ""}><b>03</b> 매장 시작</li></ol>
        </section>

        {message ? <p className="message" role="alert">{message}</p> : null}
        {loading ? <section className="panel">사업자 인증 상태를 확인하고 있습니다.</section> : state && !canEdit ? (
          <section className={`statusPanel ${verification?.status || ""}`}>
            <span>현재 상태</span><h2>{state.label}</h2><p>{state.description}</p>
            {verification?.business_entities?.legal_name ? <div className="entitySummary"><b>{verification.business_entities.legal_name}</b><small>{verification.business_entities.business_number}</small></div> : null}
            {verification?.review_note ? <div className="reviewNote"><b>OPS 안내</b><p>{verification.review_note}</p></div> : null}
            {verification?.status === "approved" ? <Link className="primaryLink" href="/admin/store/create">첫 매장 만들기</Link> : null}
          </section>
        ) : (
          <form className="application" onSubmit={submit}>
            {verification?.review_note ? <div className="reviewNote"><b>보완 요청</b><p>{verification.review_note}</p></div> : null}
            <section className="panel"><div className="panelTitle"><span>STEP 1</span><div><h2>사업자 기본정보</h2><p>사업자등록증과 동일하게 입력해 주세요.</p></div></div>
              <div className="formGrid"><label>사업자등록번호<input value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} inputMode="numeric" required placeholder="숫자 10자리" /></label><label>사업자 유형<select value={businessType} onChange={(e) => setBusinessType(e.target.value)}><option value="sole_proprietor">개인사업자</option><option value="corporation">법인사업자</option><option value="other">기타</option></select></label><label>상호 또는 법인명<input value={legalName} onChange={(e) => setLegalName(e.target.value)} required /></label><label>대표자명<input value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} required /></label><label>개업일<input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required /></label><label className="wide">사업자 주소<input value={registeredAddress} onChange={(e) => setRegisteredAddress(e.target.value)} required /></label></div>
            </section>
            <section className="panel"><div className="panelTitle"><span>STEP 2</span><div><h2>신청 권한과 연락처</h2><p>초기 운영에서는 OPS가 업무용 연락처와 권한을 함께 확인합니다.</p></div></div>
              <div className="roleChoice"><label><input type="radio" name="role" value="representative" checked={applicantRole === "representative"} onChange={(e) => setApplicantRole(e.target.value)} /><span><b>대표자 본인</b><small>사업자등록증 대표자와 신청자가 같습니다.</small></span></label><label><input type="radio" name="role" value="authorized_manager" checked={applicantRole === "authorized_manager"} onChange={(e) => setApplicantRole(e.target.value)} /><span><b>위임받은 담당자</b><small>대표자의 위임 확인자료를 함께 제출합니다.</small></span></label></div>
              <label className="fullLabel">업무용 휴대전화<input value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} inputMode="tel" required placeholder="010-0000-0000" /><small>{progress}</small></label>
            </section>
            <section className="panel"><div className="panelTitle"><span>STEP 3</span><div><h2>인증자료 제출</h2><p>파일은 비공개 저장소에 보관되고 승인된 OPS만 확인합니다.</p></div></div>
              <div className="uploadGrid"><label>사업자등록증 <em>필수</em><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setBusinessDocument(e.target.files?.[0] || null)} required /><small>{businessDocument?.name || "PDF·JPG·PNG·WEBP / 최대 10MB"}</small></label>{applicantRole === "authorized_manager" ? <label>위임 확인자료 <em>필수</em><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setDelegationDocument(e.target.files?.[0] || null)} required /><small>{delegationDocument?.name || "대표자 위임 확인자료"}</small></label> : null}</div>
              <div className="privacyNote"><b>민감정보 제출 금지</b><p>주민등록번호나 신분증 사본은 제출하지 마세요. 문서에 주민등록번호가 있다면 뒷자리를 가린 뒤 첨부해 주세요.</p></div>
            </section>
            <div className="submitBar"><div><b>OPS 검토 후 매장 생성이 활성화됩니다.</b><small>작성한 정보는 제출 전 다시 확인해 주세요.</small></div><button type="submit" disabled={busy}>{busy ? "안전하게 제출 중..." : verification ? "보완자료 다시 제출" : "사업자 인증 신청"}</button></div>
          </form>
        )}
      </div>
      <style jsx>{`
        .businessStart{min-height:100dvh;background:radial-gradient(circle at 8% 0%,rgba(57,110,188,.11),transparent 32rem),#f3f6fa;color:#172033}.pageShell{width:min(980px,100%);margin:0 auto;padding:24px 18px 80px}.brandHeader{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.brandHeader>div{display:flex;align-items:center;gap:8px}.brandHeader :global(a),.brandHeader button{min-height:40px;padding:0 12px;border:1px solid #d8e1ec;border-radius:11px;background:#fff;color:#334b6a;font-size:11px;font-weight:850;text-decoration:none}.intro{overflow:hidden;padding:30px;border-radius:25px;background:linear-gradient(145deg,#102b58,#0a1930);color:#fff;box-shadow:0 24px 55px rgba(15,31,61,.18)}.intro>span{color:#a9c8fb;font-size:10px;font-weight:950;letter-spacing:.16em}.intro h1{margin:8px 0;font-size:32px;letter-spacing:-.045em}.intro p{margin:0;color:rgba(255,255,255,.72);line-height:1.65}.intro ol{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:25px 0 0;padding:0;list-style:none}.intro li{padding:12px;border:1px solid rgba(255,255,255,.14);border-radius:13px;color:rgba(255,255,255,.5);font-size:12px;font-weight:800}.intro li.active{background:rgba(255,255,255,.1);color:#fff}.intro li b{margin-right:8px;color:#8fb9f5}.panel,.statusPanel{margin-top:16px;padding:24px;border:1px solid #dce4ef;border-radius:20px;background:#fff;box-shadow:0 14px 34px rgba(15,35,66,.055)}.panelTitle{display:flex;gap:13px;margin-bottom:20px}.panelTitle>span{height:max-content;padding:5px 7px;border-radius:7px;background:#eaf2fd;color:#245797;font-size:9px;font-weight:950}.panelTitle h2{margin:0;font-size:18px}.panelTitle p{margin:5px 0 0;color:#69778a;font-size:12px}.formGrid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.formGrid label,.fullLabel{display:grid;gap:7px;color:#34445a;font-size:12px;font-weight:850}.formGrid .wide{grid-column:1/-1}input,select{width:100%;box-sizing:border-box;min-height:46px;padding:0 12px;border:1px solid #d4dce7;border-radius:11px;background:#fff;color:#172033;font:inherit;outline:none}input:focus,select:focus{border-color:#5685c7;box-shadow:0 0 0 3px rgba(37,99,235,.1)}.roleChoice{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}.roleChoice label{display:flex;gap:10px;padding:14px;border:1px solid #dce4ef;border-radius:14px;cursor:pointer}.roleChoice input{width:18px;min-height:18px;accent-color:#173e73}.roleChoice span{display:grid;gap:4px}.roleChoice small,.fullLabel small{color:#718096;font-weight:650}.uploadGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.uploadGrid label{display:grid;gap:8px;padding:16px;border:1px dashed #b9c8da;border-radius:14px;background:#f8fafc;color:#34445a;font-size:12px;font-weight:850}.uploadGrid input{padding:10px;background:#fff}.uploadGrid em{color:#a31337;font-size:10px;font-style:normal}.uploadGrid small{color:#718096;font-weight:650}.privacyNote,.reviewNote{margin-top:15px;padding:13px 15px;border-radius:13px;background:#fff8e7;border:1px solid #f2d793}.privacyNote p,.reviewNote p{margin:5px 0 0;color:#6c5b35;font-size:12px;line-height:1.6}.submitBar{position:sticky;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:16px;padding:16px 18px;border:1px solid #d5dfeb;border-radius:17px;background:rgba(255,255,255,.95);box-shadow:0 18px 45px rgba(15,31,61,.16);backdrop-filter:blur(12px)}.submitBar div{display:grid;gap:4px}.submitBar small{color:#718096}.submitBar button,.primaryLink{min-height:48px;padding:0 20px;border:0;border-radius:12px;background:linear-gradient(135deg,#102342,#1c477d);color:#fff;font-weight:900;text-decoration:none;display:inline-grid;place-items:center}.message{padding:13px 15px;border-radius:12px;background:#fff1f2;color:#a31337}.statusPanel>span{color:#2b63ad;font-size:10px;font-weight:950;letter-spacing:.12em}.statusPanel h2{margin:7px 0;font-size:25px}.statusPanel>p{color:#667085}.entitySummary{display:grid;gap:4px;margin:18px 0;padding:14px;border-radius:13px;background:#f5f8fc}.entitySummary small{color:#667085}.primaryLink{width:max-content;margin-top:16px}.reviewNote{margin:0 0 16px}@media(max-width:640px){.pageShell{padding:16px 12px 55px}.intro{padding:24px 20px}.intro h1{font-size:27px}.intro ol{grid-template-columns:1fr}.formGrid,.roleChoice,.uploadGrid{grid-template-columns:1fr}.formGrid .wide{grid-column:auto}.panel{padding:18px}.submitBar{align-items:stretch;flex-direction:column}.submitBar button{width:100%}.brandHeader>div button{display:none}}
      `}</style>
    </main>
  );
}

export default function BusinessStartPage() {
  return <Suspense fallback={<main style={{ padding: 32 }}>사업자 인증 화면을 준비하고 있습니다.</main>}><BusinessStartContent /></Suspense>;
}
