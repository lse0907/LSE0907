"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type RequestRow = {
  id: string;
  request_type: string;
  status: string;
  requested_at: string;
  decision_summary?: string | null;
};

type WithdrawalRow = {
  id: string;
  status: string;
  recovery_until: string;
  blocker_codes: string[];
  can_cancel: boolean;
  requested_at: string;
};

type PrivacyCenterResponse = {
  ok: boolean;
  message?: string;
  audience: "customer" | "owner";
  phonePresent: boolean;
  marketingConsent: boolean | null;
  center: {
    lifecycle: { status: string; recovery_until?: string | null } | null;
    withdrawal: WithdrawalRow | null;
    requests: RequestRow[];
  };
};

const requestLabels: Record<string, string> = {
  access: "개인정보 열람",
  correction: "개인정보 정정",
  deletion: "개인정보 삭제",
  restriction: "개인정보 처리정지",
  marketing_withdrawal: "마케팅 수신 철회",
  phone_deletion: "선택 전화번호 삭제",
  withdrawal: "회원 탈퇴",
};

const statusLabels: Record<string, string> = {
  received: "접수",
  identity_verification_required: "본인확인 필요",
  in_review: "검토 중",
  approved: "승인",
  partially_completed: "일부 처리",
  completed: "완료",
  rejected: "처리 제한",
  canceled: "취소",
  recovery_pending: "7일 복구 대기",
  review_required: "운영 검토 필요",
  processing: "처리 중",
  retention_hold: "보존자료 분리 중",
  failed: "재처리 필요",
};

const blockerLabels: Record<string, string> = {
  OPEN_CUSTOMER_ORDER: "진행 중 주문 또는 결제",
  PENDING_CUSTOMER_REFUND: "처리 중 환불",
  ACTIVE_STORE_OWNERSHIP: "운영 중인 매장 소유권",
  PENDING_BILLING_SETTLEMENT: "처리 중인 구독 결제·환불",
  STORAGE_OBJECT_REVIEW: "계정 소유 파일 확인",
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AccountPrivacyContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<PrivacyCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [requestType, setRequestType] = useState("access");
  const [detail, setDetail] = useState("");

  const backHref = useMemo(() => {
    if (searchParams.get("from") === "admin") {
      const store = String(searchParams.get("store") || "");
      return store ? `/admin?store=${encodeURIComponent(store)}` : "/admin";
    }
    return "/me";
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/account/privacy-center", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as PrivacyCenterResponse;
    if (!response.ok || !payload.ok) setError(payload.message || "정보를 불러오지 못했습니다.");
    else setData(payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (action: string, body: Record<string, unknown>, success: string) => {
    setBusy(action);
    setError("");
    setNotice("");
    const response = await fetch("/api/account/privacy-center", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) setError(payload.message || "요청을 처리하지 못했습니다.");
    else {
      setNotice(success);
      setDetail("");
      if (action === "request_withdrawal") {
        await supabase.auth.signOut({ scope: "global" });
        window.location.replace("/login?next=/account/privacy&withdrawal=requested");
        return;
      }
      await load();
    }
    setBusy("");
  };

  const withdrawal = data?.center.withdrawal;
  const recoverable = withdrawal?.can_cancel === true;
  const activeProcessing = Boolean(withdrawal && !["completed", "canceled", "failed"].includes(withdrawal.status));

  return (
    <main className="privacyPage">
      <style jsx>{`
        .privacyPage{max-width:760px;margin:0 auto;padding:24px 16px 64px;color:#172033}.top{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:22px}.top h1{margin:5px 0 8px;font-size:28px}.eyebrow{font-size:12px;font-weight:800;color:#2563eb;letter-spacing:.08em}.sub{margin:0;color:#667085;line-height:1.55}.back{color:#334155;text-decoration:none;border:1px solid #d9e0ea;border-radius:10px;padding:9px 12px;white-space:nowrap}.card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:20px;margin:14px 0;box-shadow:0 12px 30px rgba(15,23,42,.05)}.card h2{font-size:18px;margin:0 0 8px}.card p,.card li{color:#526071;line-height:1.55}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}button,select,textarea{font:inherit}button{border:0;border-radius:10px;padding:10px 14px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer}button.secondary{background:#eef2f7;color:#27364a}button.danger{background:#fff1f2;color:#be123c;border:1px solid #fecdd3}button:disabled{opacity:.55;cursor:not-allowed}select,textarea{width:100%;box-sizing:border-box;border:1px solid #d5dce6;border-radius:10px;padding:10px;margin-top:9px;background:#fff}textarea{min-height:86px;resize:vertical}.notice,.error{padding:12px 14px;border-radius:11px;margin:12px 0}.notice{background:#ecfdf3;color:#166534}.error{background:#fff1f2;color:#be123c}.requestList{list-style:none;padding:0;margin:12px 0 0}.requestList li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #edf1f5}.requestList small{color:#718096}.warning{background:#fff8e7;border:1px solid #fde7a7;border-radius:12px;padding:12px}.legal{font-size:13px;color:#667085}.legal a{color:#2563eb}@media(max-width:560px){.top{display:block}.back{display:inline-block;margin-top:14px}.requestList li{display:block}}
      `}</style>
      <header className="top">
        <div><span className="eyebrow">ACCOUNT & PRIVACY</span><h1>계정·개인정보 관리</h1><p className="sub">정보 삭제, 동의 철회, 권리 요청과 탈퇴 상태를 한곳에서 확인합니다.</p></div>
        <Link className="back" href={backHref}>이전 화면</Link>
      </header>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {loading ? <section className="card"><p>계정 상태를 확인하고 있습니다.</p></section> : null}

      {!loading && data ? <>
        <section className="card">
          <h2>선택 정보와 마케팅 동의</h2>
          {data.audience === "customer" ? <>
            <p>선택 전화번호: <b>{data.phonePresent ? "등록됨" : "등록되지 않음"}</b></p>
            <p>마케팅 수신: <b>{data.marketingConsent ? "동의 상태" : "미동의 또는 철회"}</b></p>
            <div className="actions">
              <button className="secondary" disabled={!data.phonePresent || Boolean(busy)} onClick={() => {
                if (window.confirm("등록된 선택 전화번호를 삭제할까요?")) void act("delete_phone", {}, "선택 전화번호를 삭제했습니다.");
              }}>{busy === "delete_phone" ? "삭제 중" : "전화번호 삭제"}</button>
              <button className="secondary" disabled={!data.marketingConsent || Boolean(busy)} onClick={() => {
                if (window.confirm("리온랩스의 전체 마케팅 수신 동의를 철회할까요? 필수 서비스 알림은 유지됩니다.")) void act("withdraw_marketing", {}, "마케팅 수신 동의를 철회했습니다.");
              }}>{busy === "withdraw_marketing" ? "철회 중" : "마케팅 철회"}</button>
            </div>
          </> : activeProcessing ? <>
            <div className="warning"><b>{statusLabels[withdrawal?.status || ""] || "탈퇴 처리 중"}</b><p>복구 기간이 종료되어 거래·보존자료와 계정 삭제 조건을 확인하고 있습니다.</p>{withdrawal?.blocker_codes?.length ? <ul>{withdrawal.blocker_codes.map((code) => <li key={code}>{blockerLabels[code] || code}</li>)}</ul> : null}</div>
          </> : <>
            <p>사업자 회원의 업무용 연락처는 활성 계약과 매장 운영에 필요한 정보이므로, 삭제 요청 접수 후 매장·계약 상태를 함께 확인합니다.</p>
            <p>마케팅 수신: <b>{data.marketingConsent ? "동의 상태" : "미동의 또는 철회"}</b></p>
            <div className="actions">
              <button className="secondary" disabled={Boolean(busy)} onClick={() => { setRequestType("deletion"); setDetail("사업자 회원 업무용 연락처 삭제 요청"); }}>연락처 삭제 요청 작성</button>
              <button className="secondary" disabled={!data.marketingConsent || Boolean(busy)} onClick={() => {
                if (window.confirm("리온랩스의 전체 마케팅 수신 동의를 철회할까요? 필수 서비스 알림은 유지됩니다.")) void act("withdraw_marketing", {}, "마케팅 수신 동의를 철회했습니다.");
              }}>{busy === "withdraw_marketing" ? "철회 중" : "마케팅 철회"}</button>
            </div>
          </>}
        </section>

        <section className="card">
          <h2>개인정보 권리 요청</h2>
          <p>열람·정정·삭제·처리정지를 요청할 수 있습니다. 거래·법정 보존자료는 적용 근거를 확인한 뒤 분리 처리됩니다.</p>
          <select aria-label="권리 요청 종류" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="access">개인정보 열람</option><option value="correction">개인정보 정정</option><option value="deletion">개인정보 삭제</option><option value="restriction">개인정보 처리정지</option>
          </select>
          <textarea aria-label="요청 내용" maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="확인이 필요한 항목을 적어 주세요. 주민등록번호·결제 비밀번호 등 민감한 정보는 입력하지 마세요." />
          <div className="actions"><button disabled={Boolean(busy)} onClick={() => void act("create_rights_request", { requestType, detail }, "개인정보 권리 요청을 접수했습니다.")}>{busy === "create_rights_request" ? "접수 중" : "요청 접수"}</button></div>
        </section>

        <section className="card">
          <h2>회원 탈퇴</h2>
          {recoverable ? <>
            <div className="warning"><b>탈퇴 복구 대기 중</b><p>{formatDate(withdrawal?.recovery_until)}까지 취소할 수 있습니다.</p>{withdrawal?.blocker_codes?.length ? <ul>{withdrawal.blocker_codes.map((code) => <li key={code}>{blockerLabels[code] || code}</li>)}</ul> : null}</div>
            <div className="actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void act("cancel_withdrawal", {}, "탈퇴 요청을 취소했습니다.")}>{busy === "cancel_withdrawal" ? "복구 중" : "탈퇴 요청 취소"}</button></div>
          </> : <>
            <p>요청 후 7일 동안 복구할 수 있습니다. 그 뒤 진행 주문·환불, 사업자 회원의 매장·구독, 법정 보존자료를 확인하고 불필요한 정보부터 익명화·삭제합니다.</p>
            <div className="warning">탈퇴 요청만으로 계정과 거래기록이 즉시 삭제되지는 않습니다. 자동 Auth 삭제는 안전·보존 검토가 끝난 건만 별도 작업으로 처리합니다.</div>
            <div className="actions"><button className="danger" disabled={Boolean(busy)} onClick={() => {
              if (window.confirm("회원 탈퇴를 요청할까요? 7일 복구 대기 후 정리 절차가 시작됩니다.")) void act("request_withdrawal", {}, "탈퇴 요청을 접수했습니다.");
            }}>{busy === "request_withdrawal" ? "접수 중" : "탈퇴 요청"}</button></div>
          </>}
        </section>

        <section className="card">
          <h2>최근 요청</h2>
          {data.center.requests.length ? <ul className="requestList">{data.center.requests.map((row) => <li key={row.id}><span><b>{requestLabels[row.request_type] || row.request_type}</b><br/><small>{formatDate(row.requested_at)}</small></span><span>{statusLabels[row.status] || row.status}</span></li>)}</ul> : <p>접수된 요청이 없습니다.</p>}
        </section>
        <p className="legal">현재 절차와 문서는 법률 자문 전 운영안입니다. 자세한 내용은 <Link href="/legal/privacy">개인정보 처리방침 검토본</Link>에서 확인할 수 있습니다.</p>
      </> : null}
    </main>
  );
}

export default function AccountPrivacyPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px" }}>계정 정보를 준비하고 있습니다.</main>}>
      <AccountPrivacyContent />
    </Suspense>
  );
}
