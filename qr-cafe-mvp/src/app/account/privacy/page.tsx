"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import RionBrand from "@/app/components/RionBrand";
import { supabase } from "@/app/lib/supabaseClient";

type RequestRow = {
  id: string;
  request_type: string;
  status: string;
  requested_at: string;
  decision_summary?: string | null;
  profile_access_granted?: boolean;
  responded_at?: string | null;
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
  roles: { audience: "customer" | "owner"; status: string }[];
  phonePresent: boolean;
  marketingConsent: boolean | null;
  accessProfile?: { name: string | null; phone: string | null } | null;
  center: {
    lifecycle: { status: string; recovery_until?: string | null } | null;
    withdrawal: WithdrawalRow | null;
    requests: RequestRow[];
  };
};

type Confirmation = {
  action: "delete_phone" | "withdraw_marketing" | "request_withdrawal";
  title: string;
  description: string;
  confirmLabel: string;
  success: string;
  tone?: "danger";
  points?: string[];
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
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedAudience, setSelectedAudience] = useState<"customer" | "owner">("customer");
  const [withdrawalScope, setWithdrawalScope] = useState<"customer" | "owner" | "all" | null>(null);
  const joinedRoles = data?.roles.filter((role) => role.status !== "withdrawn") ?? [];
  const hasMultipleServices = joinedRoles.length > 1;
  const serviceLabel = data?.audience === "owner" ? "사업자 서비스" : "고객 서비스";
  const otherServiceLabel = data?.audience === "owner" ? "고객 서비스" : "사업자 서비스";
  const withdrawalChecks = withdrawalScope === "all"
    ? "진행 주문·환불과 매장 소유권·구독 상태를 확인합니다."
    : data?.audience === "owner"
      ? "운영 중인 매장 소유권과 구독·결제·환불 상태를 확인합니다."
      : "진행 중인 주문과 결제·환불 상태를 확인합니다.";

  const backHref = useMemo(() => {
    if (searchParams.get("from") === "admin") {
      const store = String(searchParams.get("store") || "");
      return store ? `/admin?store=${encodeURIComponent(store)}` : "/admin";
    }
    if (searchParams.get("from") === "account") {
      const store = String(searchParams.get("store") || "");
      return store ? `/account?from=admin&store=${encodeURIComponent(store)}` : "/account";
    }
    return "/me";
  }, [searchParams]);
  const backLabel = searchParams.get("from") === "admin" ? "매장 관리" : "내 계정";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (searchParams.get("preview") === "1" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      const previewRole = searchParams.get("services");
      const previewRoles: PrivacyCenterResponse["roles"] = previewRole === "customer" || previewRole === "owner"
        ? [{ audience: previewRole, status: "active" }]
        : [{ audience: "customer", status: "active" }, { audience: "owner", status: "active" }];
      const preview: PrivacyCenterResponse = {
        ok: true,
        audience: previewRoles.some((role) => role.audience === selectedAudience) ? selectedAudience : previewRoles[0].audience,
        roles: previewRoles,
        phonePresent: true,
        marketingConsent: false,
        center: { lifecycle: { status: "active" }, withdrawal: null, requests: [] },
      };
      if (searchParams.get("requests") === "result") {
        preview.accessProfile = { name: "미리보기 회원", phone: "010-0000-0000" };
        preview.center.requests = [{ id: "preview-access", request_type: "access", status: "partially_completed", requested_at: "2026-09-03T01:00:00Z", responded_at: "2026-09-03T02:00:00Z", profile_access_granted: true, decision_summary: "계정 기본정보 열람을 제공했습니다.\n운영자 안내: 이름·등록 연락처를 확인할 수 있습니다. 추가 요청한 거래자료는 검토 중입니다." }];
      }
      setData(preview);
      setWithdrawalScope(null);
      setLoading(false);
      return;
    }
    const response = await fetch(`/api/account/privacy-center?audience=${selectedAudience}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as PrivacyCenterResponse;
    if (!response.ok || !payload.ok) setError(payload.message || "정보를 불러오지 못했습니다.");
    else {
      setData(payload);
      setSelectedAudience(payload.audience);
      setWithdrawalScope(null);
    }
    setLoading(false);
  }, [searchParams, selectedAudience]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!confirmation) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmation(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmation]);

  const act = async (action: string, body: Record<string, unknown>, success: string) => {
    setBusy(action);
    setError("");
    setNotice("");
    const response = await fetch("/api/account/privacy-center", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, audience: data?.audience, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) setError(payload.message || "요청을 처리하지 못했습니다.");
    else {
      setNotice(success);
      setDetail("");
      const requestedScope = String(body.audience || data?.audience || "customer");
      const activeRoleCount = data?.roles.filter((role) => role.status !== "withdrawn").length || 0;
      if (action === "request_withdrawal" && (requestedScope === "all" || activeRoleCount <= 1)) {
        await supabase.auth.signOut({ scope: "global" });
        window.location.replace("/login?next=/account/privacy&withdrawal=requested");
        return;
      }
      await load();
    }
    setBusy("");
  };

  const openConfirmation = (action: Confirmation["action"]) => {
    if (action === "delete_phone") {
      setConfirmation({
        action,
        title: "선택 전화번호를 삭제할까요?",
        description: "계정에 선택적으로 등록한 전화번호만 삭제합니다.",
        confirmLabel: "전화번호 삭제",
        success: "선택 전화번호를 삭제했습니다.",
        points: ["주문별 연락처와 법정 보존자료는 별도 기준에 따라 처리됩니다.", "삭제 후 필요하면 계정 화면에서 다시 등록할 수 있습니다."],
      });
      return;
    }
    if (action === "withdraw_marketing") {
      setConfirmation({
        action,
        title: "마케팅 수신 동의를 철회할까요?",
        description: "리온랩스가 보내는 혜택·광고성 정보 수신을 중단합니다.",
        confirmLabel: "마케팅 철회",
        success: "마케팅 수신 동의를 철회했습니다.",
        points: ["주문·결제·보안과 같은 필수 서비스 알림은 유지됩니다.", "철회 후에도 서비스 이용에는 제한이 없습니다."],
      });
      return;
    }
    if (!withdrawalScope || (withdrawalScope !== "all" && withdrawalScope !== data?.audience)) return;
    const businessMember = withdrawalScope === "owner" || withdrawalScope === "all";
    const entireAccount = withdrawalScope === "all" || !hasMultipleServices;
    const scopeLabel = withdrawalScope === "all" ? "계정 전체" : serviceLabel;
    setConfirmation({
      action,
      title: `${scopeLabel} 탈퇴를 요청할까요?`,
      description: entireAccount
        ? "계정 전체 탈퇴로 진행됩니다. 7일 복구 기간과 검토가 끝나면 로그인 계정도 삭제됩니다."
        : `${scopeLabel}만 탈퇴합니다. ${otherServiceLabel}와 로그인 계정은 유지되며, 7일 안에 요청을 취소할 수 있습니다.`,
      confirmLabel: `${scopeLabel} 탈퇴 요청`,
      success: "탈퇴 요청을 접수했습니다.",
      tone: "danger",
      points: withdrawalScope === "all"
        ? ["고객 서비스의 진행 주문과 결제·환불을 확인합니다.", "사업자 서비스의 매장 소유권과 구독·결제·환불을 확인합니다.", "법정 보존자료는 계정 정보와 분리해 필요한 기간만 보관합니다."]
        : businessMember
        ? ["운영 중인 매장 소유권과 구독·결제 상태를 확인합니다.", "처리가 필요한 매장이 있으면 이전 또는 폐업 절차를 안내합니다.", "법정 보존자료는 계정 정보와 분리해 필요한 기간만 보관합니다."]
        : ["진행 주문과 처리 중인 환불이 있는지 확인합니다.", "7일 안에는 탈퇴 요청을 취소하고 계정을 복구할 수 있습니다.", "법정 보존자료는 계정 정보와 분리해 필요한 기간만 보관합니다."],
    });
  };

  const confirmCurrentAction = async () => {
    if (!confirmation || (confirmation.action === "request_withdrawal" && (!withdrawalScope || (withdrawalScope !== "all" && withdrawalScope !== data?.audience)))) return;
    const current = confirmation;
    setConfirmation(null);
    await act(current.action, current.action === "request_withdrawal" ? { audience: withdrawalScope } : {}, current.success);
  };

  const withdrawal = data?.center.withdrawal;
  const recoverable = withdrawal?.can_cancel === true;
  const activeProcessing = Boolean(withdrawal && !["completed", "canceled", "failed"].includes(withdrawal.status));

  return (
    <div className="privacySurface">
    <main className="privacyPage">
      <style jsx>{`
        .privacySurface{min-height:100dvh;background:radial-gradient(circle at 8% 0%,rgba(37,99,235,.12),transparent 32rem),#f2f5fa}.privacyPage{max-width:840px;margin:0 auto;padding:26px 18px 70px;color:#172033}.brandBar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;padding:0 4px}.centerLabel{padding:6px 9px;border-radius:999px;background:#e8f0fc;color:#315b9d;font-size:10px;font-weight:900;letter-spacing:.08em}.hero{position:relative;overflow:hidden;margin-bottom:18px;padding:27px 28px;border:1px solid #dce4ef;border-radius:22px;background:#fff;box-shadow:0 18px 46px rgba(15,35,66,.07)}.hero:after{content:"";position:absolute;right:-52px;bottom:-78px;width:220px;aspect-ratio:1;background:url("/brand/rion-symbol-watermark-white.svg") center/contain no-repeat;filter:invert(16%) sepia(24%) saturate(1750%) hue-rotate(177deg);opacity:.035;pointer-events:none}.top{position:relative;z-index:1;display:flex;justify-content:space-between;gap:20px;align-items:start}.top h1{margin:6px 0 8px;font-size:30px;letter-spacing:-.04em}.eyebrow{font-size:10px;font-weight:950;color:#2b63ad;letter-spacing:.15em}.sub{max-width:570px;margin:0;color:#667085;font-weight:650;line-height:1.65}.back{display:inline-flex;align-items:center;justify-content:center;min-width:max-content;color:#173e73;text-decoration:none;border:1px solid #cfd9e7;border-radius:11px;padding:9px 12px;background:#fff;font-size:12px;font-weight:850;white-space:nowrap}.card{background:#fff;border:1px solid #dce4ef;border-radius:20px;padding:22px;margin:14px 0;box-shadow:0 14px 34px rgba(15,35,66,.055)}.card h2{font-size:18px;margin:0 0 8px;letter-spacing:-.025em}.card p,.card li{color:#526071;line-height:1.65}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}button,select,textarea{font:inherit}button{border:0;border-radius:11px;padding:10px 15px;background:linear-gradient(135deg,#102342,#1c477d);color:#fff;font-weight:850;cursor:pointer;box-shadow:0 7px 16px rgba(15,35,66,.12)}button.secondary{background:#eef3f8;color:#273d5a;box-shadow:none}button.danger{background:#fff1f2;color:#a31337;border:1px solid #fecdd3;box-shadow:none}button:disabled{opacity:.55;cursor:not-allowed}select,textarea{width:100%;box-sizing:border-box;border:1px solid #d5dce6;border-radius:11px;padding:11px 12px;margin-top:9px;background:#fff;color:#172033;outline:none}select:focus,textarea:focus{border-color:#5685c7;box-shadow:0 0 0 3px rgba(37,99,235,.1)}textarea{min-height:92px;resize:vertical}.notice,.error{padding:13px 15px;border-radius:12px;margin:12px 0}.notice{background:#ecfdf3;color:#166534}.error{background:#fff1f2;color:#be123c}.loadingCard{display:flex;align-items:center;gap:10px}.loadingDot{width:10px;height:10px;border-radius:50%;background:#2b63ad;box-shadow:0 0 0 6px #e8f0fc;animation:pulse 1.2s ease-in-out infinite}.requestList{list-style:none;padding:0;margin:12px 0 0}.requestList li{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #edf1f5}.requestList small{color:#718096}.warning{background:#fff8e7;border:1px solid #f2d793;border-radius:13px;padding:13px}.withdrawalSteps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;list-style:none;padding:0;margin:16px 0}.withdrawalSteps li{position:relative;padding:12px;border:1px solid #e0e7f0;border-radius:12px;background:#f8fafc;color:#334b6a;font-size:11px;font-weight:800}.withdrawalSteps b{display:block;margin-bottom:4px;color:#1f4f8d;font-size:10px}.legal{font-size:12px;color:#667085}.legal a{color:#1d4f91;font-weight:850}.modalBackdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgba(8,18,35,.58);backdrop-filter:blur(5px)}.confirmModal{width:min(460px,100%);overflow:hidden;border:1px solid #d9e3ef;border-radius:22px;background:#fff;box-shadow:0 30px 90px rgba(3,13,29,.28)}.modalAccent{height:6px;background:linear-gradient(90deg,#102342,#2863ad)}.confirmModal.danger .modalAccent{background:linear-gradient(90deg,#7f1d32,#d1455d)}.modalBody{padding:24px}.modalEyebrow{margin:0 0 7px;color:#2b63ad;font-size:10px;font-weight:950;letter-spacing:.14em}.modalBody h2{margin:0;font-size:23px;letter-spacing:-.035em}.modalDescription{margin:9px 0 0;color:#59687d;line-height:1.6}.modalPoints{margin:17px 0 0;padding:14px 14px 14px 31px;border-radius:13px;background:#f5f8fc;color:#495a70;font-size:12px;line-height:1.65}.modalActions{display:flex;justify-content:flex-end;gap:9px;padding:16px 20px;border-top:1px solid #e7edf4;background:#fafcff}.modalActions button{box-shadow:none}.modalActions .cancel{background:#eef3f8;color:#273d5a}.modalActions .confirmDanger{background:#a31337}@keyframes pulse{50%{opacity:.45;transform:scale(.86)}}@media(max-width:560px){.privacyPage{padding:18px 12px 52px}.brandBar{padding:0 6px}.centerLabel{display:none}.hero{padding:21px 18px}.top{display:grid}.top h1{font-size:26px}.back{width:max-content;margin-top:4px}.card{padding:18px}.withdrawalSteps{grid-template-columns:1fr}.withdrawalSteps li{display:flex;align-items:center;gap:8px}.withdrawalSteps b{margin:0}.requestList li{display:block}.modalBody{padding:21px}.modalActions{display:grid;grid-template-columns:1fr 1fr}.modalActions button{width:100%}}@media(prefers-reduced-motion:reduce){.loadingDot{animation:none}}
       `}</style>
       <style jsx>{`
         :global(.topBack){display:inline-flex;align-items:center;min-height:40px;padding:0 12px;border:1px solid #d8e1ec;border-radius:11px;background:#fff;color:#334b6a;font-size:11px;font-weight:850;text-decoration:none}
         .serviceCard{margin:14px 0;padding:18px 20px;border-radius:18px;background:linear-gradient(135deg,#102b58,#173e73);color:#fff;box-shadow:0 14px 32px rgba(16,43,88,.18)}
         .serviceHead{display:flex;justify-content:space-between;gap:16px;align-items:center}.serviceHead h2{margin:3px 0 0;font-size:17px}.serviceHead small{color:#bcd1ed}.serviceHead p{max-width:620px;margin:7px 0 0;color:#d5e3f6;font-size:12px;font-weight:650;line-height:1.55}
         .roleTabs{display:flex;gap:8px;margin-top:15px}.roleTab{flex:1;display:flex;justify-content:space-between;align-items:center;padding:12px 13px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);box-shadow:none}.roleTab.active{border-color:#fff;background:#fff;color:#173e73}.roleTab small{font-size:9px;opacity:.78}
         .scopePicker{display:grid;gap:8px;margin:15px 0}.scopeOption{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:13px 14px;border:1px solid #dce4ef;background:#f8fafc;color:#263b58;box-shadow:none;text-align:left}.scopeOption.active{border-color:#527caf;background:#edf5ff;color:#173e73}.scopeOption span{display:grid;gap:3px}.scopeOption small{color:#718096;font-weight:650}.scopeOption b:last-child{font-size:15px}
         @media(max-width:560px){:global(.topBack){min-height:38px}.serviceHead{align-items:flex-start}.serviceHead>small{display:none}.roleTabs{display:grid}.scopeOption{align-items:flex-start}}
       `}</style>
       <style jsx>{`
         .privacyPage{max-width:980px;box-sizing:border-box;padding:24px 18px 56px}.hero{padding:24px 26px;margin-bottom:16px}.serviceCard{padding:16px 20px;margin:16px 0}.roleTabs{margin-top:12px}.card{padding:24px;margin:16px 0}.card h2{font-size:18px}.sectionIntro{font-size:13px;margin:6px 0 20px;line-height:1.65}
         .settingsGrid{display:grid;grid-template-columns:minmax(0,35fr) minmax(0,65fr);gap:16px;margin:16px 0}.settingsGrid>.card{margin:0;min-width:0}.settingRow{padding:18px 0;border-top:1px solid #e7edf4}.settingRow:last-child{padding-bottom:0}.settingTitle{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.settingTitle>b{font-size:13px}.statusBadge{padding:4px 8px;border-radius:7px;font-size:11px;font-weight:800;white-space:nowrap;background:#edf1f6;color:#64748b}.statusBadge.registered{background:#eaf2fd;color:#245797}.settingRow .settingHint{font-size:12px;margin:0 0 12px;line-height:1.65;color:#667085}.settingRow button{font-size:12px}
         .fieldLabel{display:block;margin:16px 0 7px;color:#34445a;font-size:12px;font-weight:850}.fieldLabel span{color:#78869a;font-weight:600}select,textarea{margin-top:0;min-height:46px;border-color:#d4dce7;border-radius:11px;padding:12px;font-size:13px}textarea{min-height:108px}.formHint{font-size:11px;margin:7px 0 0;color:#718096}.requestCard .actions{justify-content:flex-end;margin-top:16px}button{min-height:42px}.roleTab{min-height:46px}button:focus-visible,:global(.topBack):focus-visible{outline:3px solid #80a9dc;outline-offset:3px}
         .withdrawalCard{border-top:3px solid #d4deec}.scopePicker{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}.singleScope{grid-template-columns:1fr}.scopeOption{align-items:flex-start;padding:17px 15px;min-height:108px;background:#f9fbfd}.scopeOption span{gap:9px}.scopeOption span>b{font-size:13px;line-height:1.45}.scopeOption small{font-size:12px;line-height:1.6}.scopeOption>b{color:#647e9f}.scopeOption.active{border-color:#4776ad;box-shadow:0 0 0 1px #4776ad;background:#edf5ff}.withdrawalSteps{gap:0;border-top:1px solid #e6edf4;border-bottom:1px solid #e6edf4;padding:14px 0;margin:22px 0}.withdrawalSteps li{display:flex;align-items:center;gap:10px;border:0;border-radius:0;background:transparent;font-size:12px;padding:4px 12px}.withdrawalSteps li+li{border-left:1px solid #dce4ef}.withdrawalSteps b{display:grid;place-items:center;flex-shrink:0;width:26px;height:26px;border-radius:8px;background:#edf3fa;margin:0;font-size:10px}.withdrawalFooter{display:flex;justify-content:space-between;align-items:center;gap:28px}.withdrawalFooter>p{max-width:550px;margin:0;font-size:12px;line-height:1.75}.withdrawalFooter>div{display:grid;justify-items:end;gap:10px;flex-shrink:0}.withdrawalFooter small{font-size:11px;color:#718096}.withdrawalFooter button{min-width:120px}.emptyHistory{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:17px 24px}.emptyHistory h2{font-size:15px;margin:0}.emptyHistory p{font-size:12px;margin:0}.legal{line-height:1.65}
         .scopePicker{grid-template-columns:repeat(2,minmax(0,1fr))}.scopePicker.singleScope{grid-template-columns:1fr}.requestInfo{min-width:0;flex:1}.requestList li>span{flex-shrink:0}.requestDecision{padding:12px 14px;margin-top:12px;background:#f5f8fc;border-radius:11px;font-size:12px}.requestDecision p{margin:7px 0;white-space:pre-wrap;overflow-wrap:anywhere}.profileDisclosure{padding:12px 14px;margin-top:10px;border:1px solid #dce4ef;border-radius:11px;font-size:12px}.profileDisclosure summary{cursor:pointer;color:#245797;font-weight:800}.profileDisclosure dl{display:grid;grid-template-columns:90px 1fr;gap:8px}.profileDisclosure dd{margin:0;overflow-wrap:anywhere}.profileDisclosure p{line-height:1.7}
         @media(max-width:760px){.settingsGrid{grid-template-columns:1fr}.scopePicker{grid-template-columns:1fr}.scopeOption{min-height:0}.withdrawalFooter{align-items:stretch;flex-direction:column;gap:16px}.withdrawalFooter>div{justify-items:stretch}.withdrawalFooter button{width:100%}.withdrawalFooter small{text-align:center}}
         @media(max-width:560px){.privacyPage{padding:18px 12px 40px}.hero{padding:21px 18px}.card{padding:18px}.serviceCard{padding:18px}.brandBar{gap:10px}.withdrawalSteps{grid-template-columns:1fr;gap:12px}.withdrawalSteps li+li{border-left:0}.emptyHistory{align-items:flex-start;flex-direction:column;gap:7px;padding:16px 18px}.requestCard .actions button{width:100%}.settingRow button{width:100%}.withdrawalFooter>p{max-width:none}}
       `}</style>
       <div className="brandBar"><RionBrand product auth /><Link className="topBack" href={backHref}>{backLabel}</Link></div>
      <section className="hero">
        <header className="top">
           <div><span className="eyebrow">PRIVACY &amp; WITHDRAWAL</span><h1>개인정보·탈퇴 관리</h1><p className="sub">개인정보 요청과 동의 상태, 서비스 또는 계정 탈퇴를 관리합니다.</p></div>
        </header>
      </section>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {loading ? <section className="card loadingCard"><span className="loadingDot" aria-hidden="true"/><p>계정 상태를 안전하게 확인하고 있습니다.</p></section> : null}

      {!loading && data ? <>
        <section className="serviceCard">
          <div className="serviceHead"><div><small>서비스별 개인정보 관리</small><h2>개인정보를 관리할 서비스를 선택하세요</h2><p>서비스를 선택하면 해당 서비스의 동의·요청·탈퇴 정보를 확인할 수 있습니다.</p></div></div>
          <div className="roleTabs">{(["customer", "owner"] as const).map((audience) => {
            const role = joinedRoles.find((item) => item.audience === audience);
            const selected = Boolean(role) && data.audience === audience;
            return <button key={audience} disabled={!role || Boolean(busy)} aria-pressed={selected} className={`roleTab ${selected ? "active" : ""}`} onClick={() => {
              if (!role || selected) return;
              setWithdrawalScope(null);
              setConfirmation(null);
              setDetail("");
              setRequestType("access");
              setNotice("");
              setLoading(true);
              setSelectedAudience(audience);
            }}><span>{audience === "customer" ? "고객 서비스" : "사업자 서비스"}</span><small>{!role ? "미이용" : selected ? "✓ 선택됨" : role.status === "active" ? "이용 중" : statusLabels[role.status] || role.status}</small></button>;
          })}</div>
        </section>
        <div className="settingsGrid">
        <section className="card contactCard">
          <h2>연락처·마케팅 설정</h2>
          <p className="sectionIntro">등록 정보와 수신 동의를 확인하세요.</p>
          <div className="settingRow">
            <div className="settingTitle"><b>{data.audience === "customer" ? "선택 전화번호" : "업무용 연락처"}</b><span className={`statusBadge ${data.phonePresent ? "registered" : ""}`}>{data.phonePresent ? "등록됨" : "미등록"}</span></div>
            {data.audience === "customer" ? <button className="secondary" disabled={!data.phonePresent || Boolean(busy)} onClick={() => openConfirmation("delete_phone")}>{busy === "delete_phone" ? "삭제 중" : "전화번호 삭제"}</button> : <><p className="settingHint">매장·계약 상태를 확인한 뒤 삭제 여부를 안내합니다.</p><button className="secondary" disabled={Boolean(busy)} onClick={() => { setRequestType("deletion"); setDetail("사업자 회원 업무용 연락처 삭제 요청"); document.getElementById("privacy-request-detail")?.focus(); }}>삭제 요청 작성</button></>}
          </div>
          <div className="settingRow">
            <div className="settingTitle"><b>마케팅 수신</b><span className={`statusBadge ${data.marketingConsent ? "registered" : ""}`}>{data.marketingConsent ? "동의" : "미동의"}</span></div>
            <p className="settingHint">주문·결제·보안 알림은 별도로 유지됩니다.</p>
            <button className="secondary" disabled={!data.marketingConsent || Boolean(busy)} onClick={() => openConfirmation("withdraw_marketing")}>{busy === "withdraw_marketing" ? "철회 중" : "수신 동의 철회"}</button>
          </div>
        </section>

        <section className="card requestCard">
          <h2>개인정보 요청</h2>
          <p className="sectionIntro">열람·정정·삭제·처리정지가 필요한 항목을 알려주세요.</p>
          <label className="fieldLabel" htmlFor="privacy-request-type">요청 종류</label>
          <select id="privacy-request-type" aria-label="권리 요청 종류" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="access">개인정보 열람</option><option value="correction">개인정보 정정</option><option value="deletion">개인정보 삭제</option><option value="restriction">개인정보 처리정지</option>
          </select>
          <label className="fieldLabel" htmlFor="privacy-request-detail">추가 설명 <span>(선택)</span></label>
          <textarea id="privacy-request-detail" aria-label="요청 내용" maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="확인이 필요한 항목을 적어 주세요." />
          <p className="formHint">주민등록번호·결제 비밀번호 등 민감한 정보는 입력하지 마세요.</p>
          <div className="actions"><button disabled={Boolean(busy)} onClick={() => void act("create_rights_request", { requestType, detail }, "개인정보 권리 요청을 접수했습니다.")}>{busy === "create_rights_request" ? "접수 중" : "요청 접수"}</button></div>
        </section>
        </div>

        <section className="card withdrawalCard">
          <h2>탈퇴 관리</h2>
          {recoverable ? <>
            <div className="warning"><b>탈퇴 복구 대기 중</b><p>{formatDate(withdrawal?.recovery_until)}까지 취소할 수 있습니다.</p>{withdrawal?.blocker_codes?.length ? <ul>{withdrawal.blocker_codes.map((code) => <li key={code}>{blockerLabels[code] || code}</li>)}</ul> : null}</div>
            <div className="actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void act("cancel_withdrawal", {}, "탈퇴 요청을 취소했습니다.")}>{busy === "cancel_withdrawal" ? "복구 중" : "탈퇴 요청 취소"}</button></div>
          </> : <>
            {activeProcessing ? <div className="warning"><b>{statusLabels[withdrawal?.status || ""] || "탈퇴 처리 중"}</b><p>거래·보존자료와 계정 삭제 조건을 확인하고 있습니다.</p>{withdrawal?.blocker_codes?.length ? <ul>{withdrawal.blocker_codes.map((code) => <li key={code}>{blockerLabels[code] || code}</li>)}</ul> : null}</div> : <>
            <p className="sectionIntro">탈퇴할 범위를 직접 선택해 주세요. 요청 후 7일 동안 취소할 수 있습니다.</p>
            {hasMultipleServices ? <div className="scopePicker" aria-label="탈퇴 범위 선택">
              <button aria-pressed={withdrawalScope === data.audience} className={`scopeOption ${withdrawalScope === data.audience ? "active" : ""}`} onClick={() => setWithdrawalScope(data.audience)}><span><b>{serviceLabel}만 탈퇴</b><small>{otherServiceLabel}와 로그인 계정은 유지됩니다.</small></span><b aria-hidden="true">{withdrawalScope === data.audience ? "✓" : "○"}</b></button>
              <button aria-pressed={withdrawalScope === "all"} className={`scopeOption ${withdrawalScope === "all" ? "active" : ""}`} onClick={() => setWithdrawalScope("all")}><span><b>계정 전체 탈퇴</b><small>두 서비스 검토 후 로그인 계정도 삭제됩니다.</small></span><b aria-hidden="true">{withdrawalScope === "all" ? "✓" : "○"}</b></button>
            </div> : <div className="scopePicker singleScope" aria-label="탈퇴 범위 선택"><button aria-pressed={withdrawalScope === data.audience} className={`scopeOption ${withdrawalScope === data.audience ? "active" : ""}`} onClick={() => setWithdrawalScope(data.audience)}><span><b>{serviceLabel} 탈퇴</b><small>유일하게 이용 중인 서비스입니다. 탈퇴 시 계정 전체 탈퇴로 진행되며, 검토 완료 후 로그인 계정도 삭제됩니다.</small></span><b aria-hidden="true">{withdrawalScope === data.audience ? "✓" : "○"}</b></button></div>}
            <ol className="withdrawalSteps" aria-label="탈퇴 처리 단계">
              <li><b>01</b> 탈퇴 요청</li>
              <li><b>02</b> 7일 복구 기간</li>
              <li><b>03</b> 보존·삭제 검토</li>
            </ol>
            <div className="withdrawalFooter"><p>{withdrawalChecks} 법정 보존자료는 분리 보관합니다. {withdrawalScope === "all" || !hasMultipleServices ? "계정 전체 탈퇴는 검토 완료 후 로그인 계정까지 삭제합니다." : `${serviceLabel}만 탈퇴하면 ${otherServiceLabel}와 로그인 계정은 유지됩니다.`}</p><div><small>{withdrawalScope ? "선택한 범위를 다음 단계에서 다시 확인합니다." : "먼저 탈퇴 범위를 선택해 주세요."}</small><button className="danger" disabled={Boolean(busy) || !withdrawalScope} onClick={() => openConfirmation("request_withdrawal")}>{busy === "request_withdrawal" ? "접수 중" : "탈퇴 요청"}</button></div></div>
            </>}
          </>}
        </section>

        <section className={`card historyCard ${data.center.requests.length ? "" : "emptyHistory"}`}>
          <h2>최근 요청 내역</h2>
          {data.center.requests.length ? <ul className="requestList">{data.center.requests.map((row) => <li key={row.id}><div className="requestInfo"><b>{requestLabels[row.request_type] || row.request_type}</b><br/><small>접수 {formatDate(row.requested_at)}</small>{row.decision_summary && <div className="requestDecision"><b>운영자 처리 안내</b><p>{row.decision_summary}</p>{row.responded_at && <small>안내 {formatDate(row.responded_at)}</small>}</div>}{row.profile_access_granted && data.accessProfile && <details className="profileDisclosure"><summary>제공된 계정 기본정보 보기</summary><p>현재 {serviceLabel} 프로필입니다. 주문·결제·증빙자료는 포함하지 않습니다.</p><dl><dt>이름</dt><dd>{data.accessProfile.name || "미등록"}</dd><dt>등록 연락처</dt><dd>{data.accessProfile.phone || "미등록"}</dd></dl></details>}</div><span>{statusLabels[row.status] || row.status}</span></li>)}</ul> : <p>접수된 요청이 없습니다.</p>}
        </section>
        <p className="legal">현재 절차와 문서는 법률 자문 전 운영안입니다. 자세한 내용은 <Link href="/legal/privacy">개인정보 처리방침 검토본</Link>에서 확인할 수 있습니다.</p>
      </> : null}

      {confirmation ? (
        <div className="modalBackdrop">
          <section className={`confirmModal ${confirmation.tone === "danger" ? "danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="privacy-confirm-title">
            <div className="modalAccent" />
            <div className="modalBody">
              <p className="modalEyebrow">RION ACCOUNT CARE</p>
              <h2 id="privacy-confirm-title">{confirmation.title}</h2>
              <p className="modalDescription">{confirmation.description}</p>
              {confirmation.points?.length ? <ul className="modalPoints">{confirmation.points.map((point) => <li key={point}>{point}</li>)}</ul> : null}
            </div>
            <div className="modalActions">
              <button className="cancel" type="button" autoFocus onClick={() => setConfirmation(null)}>취소</button>
              <button className={confirmation.tone === "danger" ? "confirmDanger" : ""} type="button" onClick={() => void confirmCurrentAction()}>{confirmation.confirmLabel}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
    </div>
  );
}

export default function AccountPrivacyPage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 18px" }}><RionBrand product auth /><p style={{ color: "#667085", marginTop: 24 }}>계정 정보를 준비하고 있습니다.</p></main>}>
      <AccountPrivacyContent />
    </Suspense>
  );
}
