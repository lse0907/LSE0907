"use client";

import type { ReactNode } from "react";
import type { ViewerAccess } from "@/app/lib/viewerAccess";
import { CustomerBrand } from "./CustomerBrand";
import { CustomerIcon, type CustomerIconName } from "./CustomerIcon";

type Workspace = {
  key: string;
  label: string;
  description: string;
  badge: string;
  href: string;
  icon: CustomerIconName;
  tone: string;
};

export function NeutralPwaHome({
  access,
  authLoading,
  scanner,
  onScan,
  onNavigate,
  onLogout,
}: {
  access: ViewerAccess | null;
  authLoading: boolean;
  scanner: ReactNode;
  onScan: () => void;
  onNavigate: (href: string) => void;
  onLogout: () => void;
}) {
  const workspaces: Workspace[] = access ? [
    access.canUseCustomer ? { key: "customer", label: "내 주문·혜택", description: "주문 · 포인트 · 쿠폰", badge: "MY RION", href: "/me", icon: "user", tone: "customer" } : null,
    access.canUseAdmin ? { key: "admin", label: "매장 관리", description: "매장 · 메뉴 · 매출", badge: "ADMIN", href: "/admin", icon: "store", tone: "admin" } : null,
    access.canUseStaff ? { key: "staff", label: "주문 운영", description: "주문 확인 · 처리", badge: "STAFF", href: "/staff", icon: "orders", tone: "staff" } : null,
    access.canUseOps ? { key: "ops", label: "플랫폼 관리", description: "서비스 · 매장 지원", badge: access.isOpsMaster ? "OPS MASTER" : "OPS", href: "/ops", icon: "platform", tone: "ops" } : null,
  ].filter((item): item is Workspace => item !== null) : [];

  return (
    <main className="neutralHome">
      <section className="launcher" aria-label="Rion Order 시작">
        <div className="brandHero">
          <span className="officialWatermark" aria-hidden="true" />
          <div className="brandContent">
            <CustomerBrand inverse />
            <p className="powerEyebrow"><PowerIcon /> ORDER ON</p>
            <h1>주문을 켜다.</h1>
            <p className="heroDescription">QR로 바로 주문하세요.</p>
          </div>
        </div>

        <div className="launcherContent">
          <button className="qrAction" type="button" onClick={onScan}>
            <span className="qrIcon"><CustomerIcon name="qr" size={24} /></span>
            <span className="qrCopy"><strong>QR 주문 시작</strong><small>매장 QR을 스캔하세요.</small></span>
            <span className="arrow" aria-hidden="true"><CustomerIcon name="chevronRight" size={18} /></span>
          </button>
          {scanner}

          {authLoading ? (
            <div className="workspaceSkeleton" aria-label="계정 권한 확인 중" aria-busy="true"><span /><span /></div>
          ) : access ? (
            <section className="workspaceSection" aria-labelledby="workspace-title">
              <div className="workspaceHeading">
                <div><p>MY WORKSPACE</p><h2 id="workspace-title">이용할 화면을 선택하세요.</h2></div>
                <span className="accountIdentity">{getViewerLabel(access)}</span>
              </div>
              {workspaces.length ? (
                <div className={`workspaceGrid count${workspaces.length}`}>
                  {workspaces.map((workspace) => (
                    <button key={workspace.key} type="button" className={`workspaceCard ${workspace.tone}`} onClick={() => onNavigate(workspace.href)}>
                      <span className="workspaceIcon"><CustomerIcon name={workspace.icon} size={21} /></span>
                      <span className="workspaceText"><small>{workspace.badge}</small><strong>{workspace.label}</strong><em>{workspace.description}</em></span>
                      <span className="cardArrow" aria-hidden="true"><CustomerIcon name="chevronRight" size={16} /></span>
                    </button>
                  ))}
                </div>
              ) : <p className="workspaceEmpty">사용 가능한 공간을 확인하지 못했어요. 고객 지원이 필요하면 계정 정보를 확인해 주세요.</p>}
              <button className="logoutAction" type="button" onClick={onLogout}><CustomerIcon name="logout" size={16} /> 로그아웃</button>
            </section>
          ) : (
            <section className="accountPrompt" aria-label="Rion 계정">
              <div><strong>Rion 계정으로 계속 이용하세요.</strong><p>로그인하고 이용 내역을 이어가세요.</p></div>
              <div><button type="button" onClick={() => onNavigate("/login")}>로그인</button><button type="button" className="secondary" onClick={() => onNavigate("/signup")}>회원가입</button></div>
            </section>
          )}
        </div>
      </section>
      <style jsx>{`
        .neutralHome { min-height: 100dvh; display: grid; place-items: center; padding: max(22px, env(safe-area-inset-top)) 18px max(22px, env(safe-area-inset-bottom)); color: #172033; background: radial-gradient(circle at 8% 0%, rgba(70,125,210,.1), transparent 32%), radial-gradient(circle at 94% 86%, rgba(15,31,61,.07), transparent 30%), #f4f7fb; }
        .launcher { width: min(1040px, 100%); display: grid; grid-template-columns: minmax(300px,.9fr) minmax(420px,1.1fr); overflow: hidden; border: 1px solid #dce3ed; border-radius: 30px; background: #fff; box-shadow: 0 28px 80px rgba(15,31,61,.14); }
        .brandHero { position: relative; min-height: 570px; overflow: hidden; display: flex; padding: clamp(32px,5vw,58px); color: #fff; background: radial-gradient(circle at 15% 10%, rgba(72,132,225,.48), transparent 34%), linear-gradient(150deg,#102b58,#0c1b35 57%,#071326); isolation: isolate; }
        .officialWatermark { position: absolute; z-index: -1; width: min(560px,130%); aspect-ratio: 1; right: -38%; bottom: -11%; background: url('/brand/rion-symbol-watermark-white.svg') center/contain no-repeat; opacity: .05; pointer-events: none; }
        .brandContent { align-self: center; position: relative; z-index: 1; }
        .powerEyebrow { margin: 52px 0 11px; display: flex; align-items: center; gap: 7px; color: #a9c8fb; font-size: 11px; font-weight: 850; letter-spacing: .18em; }
        .powerEyebrow :global(svg) { width: 18px; height: 18px; }
        h1 { margin: 0; font-size: clamp(36px,5vw,55px); line-height: 1.06; letter-spacing: -.055em; }
        .heroDescription { margin: 15px 0 0; color: rgba(255,255,255,.75); font-size: 15px; font-weight: 650; }
        .launcherContent { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 24px; padding: clamp(25px,4.5vw,50px); }
        .qrAction { width: 100%; min-height: 86px; display: grid; grid-template-columns: 48px minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 15px 17px; border: 1px solid #cbd8e9; border-radius: 19px; background: linear-gradient(135deg,#f8fbff,#edf4ff); color: #0f1f3d; text-align: left; box-shadow: 0 12px 30px rgba(31,77,139,.1); cursor: pointer; transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
        .qrAction:hover { transform: translateY(-2px); border-color: #7fa4d7; box-shadow: 0 16px 34px rgba(31,77,139,.15); }
        .qrIcon { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 15px; background: #0f1f3d; color: #fff; }
        .qrCopy { min-width: 0; display: grid; gap: 5px; }
        .qrCopy strong { font-size: 17px; }
        .qrCopy small { color: #627089; font-size: 12px; font-weight: 650; }
        .arrow,.cardArrow { display: grid; place-items: center; transition: color .18s ease, transform .18s ease; }
        .arrow { color: #0f1f3d; }
        .cardArrow { color: rgba(71,85,105,.78); }
        .qrAction:hover .arrow,.workspaceCard:hover .cardArrow { transform: translateX(2px); }
        .workspaceSection { display: grid; gap: 15px; }
        .workspaceHeading { display: flex; align-items: end; justify-content: space-between; gap: 14px; }
        .workspaceHeading p { margin: 0 0 5px; color: #54729c; font-size: 10px; font-weight: 900; letter-spacing: .14em; }
        .workspaceHeading h2 { margin: 0; font-size: 20px; letter-spacing: -.035em; }
        .accountIdentity { max-width: 190px; overflow: hidden; color: #667085; font-size: 11px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
        .workspaceGrid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
        .workspaceGrid.count1 { grid-template-columns: 1fr; }
        .workspaceGrid.count3 .workspaceCard:last-child { grid-column: 1/-1; }
        .workspaceCard { min-width: 0; min-height: 112px; display: grid; grid-template-columns: 38px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 14px; border: 1px solid #dce3ed; border-radius: 17px; background: #fff; color: #172033; text-align: left; cursor: pointer; transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
        .workspaceCard:hover { transform: translateY(-2px); border-color: #9bb5d9; box-shadow: 0 12px 25px rgba(15,31,61,.08); }
        .workspaceIcon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; background: #edf4ff; color: #315fba; }
        .workspaceCard.admin .workspaceIcon { background: #e9eef8; color: #173e73; }
        .workspaceCard.staff .workspaceIcon { background: #eef2f6; color: #42546e; }
        .workspaceCard.ops .workspaceIcon { background: #e8ebf0; color: #18263d; }
        .workspaceText { min-width: 0; display: grid; gap: 3px; font-style: normal; }
        .workspaceText small { color: #6b7b93; font-size: 9px; font-weight: 900; letter-spacing: .1em; }
        .workspaceText strong { font-size: 15px; }
        .workspaceText em { overflow: hidden; color: #6b7280; font-size: 11px; font-style: normal; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
        .workspaceEmpty { margin: 0; padding: 14px; border-radius: 14px; background: #f7f9fc; color: #667085; font-size: 12px; line-height: 1.6; }
        .logoutAction { min-height: 44px; justify-self: end; display: flex; align-items: center; gap: 6px; padding: 7px 0 7px 12px; border: 0; background: transparent; color: #6b7280; font-size: 11px; font-weight: 750; cursor: pointer; }
        .accountPrompt { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-top: 20px; border-top: 1px solid #e4e8ef; }
        .accountPrompt strong { font-size: 14px; }
        .accountPrompt p { margin: 5px 0 0; color: #6b7280; font-size: 11px; line-height: 1.5; }
        .accountPrompt > div:last-child { display: flex; gap: 7px; flex-shrink: 0; }
        .accountPrompt button { min-height: 44px; padding: 0 13px; border: 1px solid #0f1f3d; border-radius: 10px; background: #0f1f3d; color: #fff; font-weight: 800; cursor: pointer; }
        .accountPrompt button.secondary { border-color: #d2dae6; background: #fff; color: #334155; }
        .workspaceSkeleton { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .workspaceSkeleton span { min-height: 100px; border-radius: 17px; background: linear-gradient(90deg,#f2f5f9,#e9eef5,#f2f5f9); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
        @keyframes shimmer { to { background-position: -200% 0; } }
        @media(max-width:900px) { .neutralHome{place-items:start center}.launcher{grid-template-columns:1fr}.brandHero{min-height:290px;padding:34px 30px}.brandContent{align-self:center}.powerEyebrow{margin-top:35px}.officialWatermark{width:390px;right:-110px;bottom:-95px}.launcherContent{padding:28px}.accountPrompt{align-items:flex-start;flex-direction:column}.accountPrompt>div:last-child{width:100%}.accountPrompt button{flex:1} }
        @media(max-width:480px) { .neutralHome{padding:0;background:#fff}.launcher{border:0;border-radius:0;box-shadow:none}.brandHero{min-height:255px;padding:max(28px,env(safe-area-inset-top)) 22px 28px}.powerEyebrow{margin-top:30px}h1{font-size:38px}.officialWatermark{width:370px;right:-115px;bottom:-90px}.launcherContent{padding:22px 16px max(22px,env(safe-area-inset-bottom));gap:21px}.qrAction{min-height:80px;padding:13px}.workspaceHeading{align-items:start;flex-direction:column;gap:5px}.workspaceGrid{grid-template-columns:1fr}.workspaceGrid.count3 .workspaceCard:last-child{grid-column:auto}.workspaceCard{min-height:91px}.workspaceText em{white-space:normal}.accountIdentity{max-width:100%} }
        @media(prefers-reduced-motion:reduce) { .qrAction,.workspaceCard,.arrow,.cardArrow{transition:none}.workspaceSkeleton span{animation:none} }
      `}</style>
    </main>
  );
}

function getViewerLabel(access: ViewerAccess) {
  if (access.displayName) return access.displayName;
  if (access.isSharedStoreAccount) {
    if (access.storeRoles.includes("manager")) return "매니저 공용 계정";
    return "직원 공용 계정";
  }
  if (access.canUseOps) return access.isOpsMaster ? "플랫폼 마스터" : "플랫폼 운영자";
  if (access.canUseAdmin) return "매장 관리자";
  return "Rion 사용자";
}

function PowerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 3v8"/><path d="M7.1 5.9a8 8 0 1 0 9.8 0"/></svg>;
}
