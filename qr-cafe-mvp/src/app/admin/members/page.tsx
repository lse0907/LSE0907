/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";

type TabKey = "accounts" | "pins" | "devices" | "logs";
type ApiSection = { rows: any[]; error?: string };
type Summary = { members: ApiSection; pins: ApiSection; devices: ApiSection; events: ApiSection };

type AccountModal = { role: "staff" | "manager"; loginId: string; password: string; displayName: string } | null;
type PinActionModal = { action: "create" | "reset"; pinId?: string; displayName: string; pinRole: "staff" | "manager"; pin: string; pinConfirm: string } | null;
type DeviceNameModal = { deviceId: string; deviceName: string } | null;

const tabs: { key: TabKey; label: string }[] = [
  { key: "accounts", label: "공용 계정" },
  { key: "pins", label: "직원 PIN" },
  { key: "devices", label: "승인 기기" },
  { key: "logs", label: "보안 로그" },
];

function roleLabel(role: string) {
  if (role === "owner") return "대표자";
  if (role === "manager") return "매니저";
  if (role === "staff") return "직원";
  return role || "권한 없음";
}

function statusLabel(status: string) {
  if (status === "pending") return "승인대기";
  if (status === "approved") return "승인됨";
  if (status === "rejected") return "거절됨";
  if (status === "disabled") return "차단됨";
  return status || "상태 없음";
}

function eventLabel(type: string) {
  const map: Record<string, string> = {
    pin_requested: "PIN 등록 요청",
    pin_created: "PIN 직접 생성",
    pin_approve: "PIN 승인",
    pin_reject: "PIN 거절",
    pin_disable: "PIN 잠금",
    pin_enable: "PIN 잠금 해제",
    pin_changeRole: "PIN 권한 변경",
    pin_reset: "PIN 재설정",
    pin_verified: "PIN 확인 성공",
    pin_failed: "PIN 확인 실패",
    device_requested: "기기 승인 요청",
    owner_device_recorded: "대표자 기기 기록",
    device_approve: "기기 승인",
    device_disable: "기기 차단",
    shared_account_created: "공용 계정 생성",
  };
  return map[type] || type;
}

function MembersPageInner() {
  const sp = useSearchParams();
  const storeId = useMemo(() => String(sp.get("store") || getCurrentStoreId() || "").trim(), [sp]);
  const [tab, setTab] = useState<TabKey>("accounts");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountModal, setAccountModal] = useState<AccountModal>(null);
  const [pinModal, setPinModal] = useState<PinActionModal>(null);
  const [deviceNameModal, setDeviceNameModal] = useState<DeviceNameModal>(null);

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/members?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "직원/권한 정보를 불러오지 못했습니다.");
      setSummary(json);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const mutate = async (url: string, body: Record<string, unknown>) => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "요청 처리 실패");
      setAccountModal(null);
      setPinModal(null);
      setDeviceNameModal(null);
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const pins = summary?.pins.rows || [];
  const pendingPins = pins.filter((p) => String(p.approval_status || "approved") === "pending");
  const activePins = pins.filter((p) => String(p.approval_status || "approved") !== "pending");
  const devices = summary?.devices.rows || [];
  const pendingDevices = devices.filter((d) => d.status === "pending");
  const approvedDevices = devices.filter((d) => d.status === "approved");
  const sharedAccounts = (summary?.members.rows || []).filter((m) => m.role === "staff" || m.role === "manager");
  const staffAccount = sharedAccounts.find((m) => m.role === "staff");
  const managerAccount = sharedAccounts.find((m) => m.role === "manager");

  const submitAccount = () => {
    if (!accountModal) return;
    if (!accountModal.loginId.trim() || accountModal.password.length < 8) {
      setMsg("로그인 ID와 8자 이상 비밀번호를 입력해주세요.");
      return;
    }
    mutate("/api/admin/members/accounts", { storeId, ...accountModal });
  };

  const submitPinModal = () => {
    if (!pinModal) return;
    if (!pinModal.displayName.trim() || !/^\d{4,8}$/.test(pinModal.pin)) {
      setMsg("이름과 4~8자리 숫자 PIN을 입력해주세요.");
      return;
    }
    if (pinModal.pin !== pinModal.pinConfirm) {
      setMsg("PIN 확인이 일치하지 않습니다.");
      return;
    }
    mutate("/api/admin/members/pins", { storeId, action: pinModal.action, pinId: pinModal.pinId, displayName: pinModal.displayName, pinRole: pinModal.pinRole, pin: pinModal.pin });
  };

  const submitDeviceName = () => {
    if (!deviceNameModal) return;
    const deviceName = deviceNameModal.deviceName.trim();
    if (!deviceName) {
      setMsg("기기 이름을 입력해주세요.");
      return;
    }
    mutate("/api/admin/members/devices", { storeId, deviceId: deviceNameModal.deviceId, action: "rename", deviceName });
  };

  return (
    <main className="wrap">
      <style jsx global>{css}</style>
      <AdminPageHeader title="직원/권한 관리" description="공용 계정, 직원 PIN, 승인 기기와 보안 기록을 관리합니다." storeId={storeId} eyebrow="TEAM & SECURITY" />

      {!storeId ? <div className="alert">먼저 관리자 홈에서 매장을 선택해주세요.</div> : null}
      {msg ? <div className="alert">{msg}</div> : null}

      <section className="statsGrid">
        <Stat label="승인대기 PIN" value={pendingPins.length} />
        <Stat label="사용중 PIN" value={activePins.filter((p) => p.is_active).length} />
        <Stat label="승인대기 기기" value={pendingDevices.length} />
        <Stat label="승인된 기기" value={approvedDevices.length} />
      </section>

      <section className="card">
        <div className="tabs">
          {tabs.map((t) => <button key={t.key} className={`tab ${tab === t.key ? "tabOn" : ""}`.trim()} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
        {loading ? <div className="loading">처리 중...</div> : null}

        {tab === "accounts" ? (
          <div className="panel">
            <div className="panelHead">
              <div><h2>공용 계정</h2><p className="muted compactCopy">직원 화면 로그인 계정입니다. 역할별 1개를 권장합니다.</p></div>
              <div className="actions">
                {!staffAccount ? <button className="btn" onClick={() => setAccountModal({ role: "staff", loginId: `${storeId.slice(0, 8).toLowerCase()}-staff`, password: "", displayName: "직원 공용 계정" })}>직원 계정 만들기</button> : <span className="doneBadge">직원 완료</span>}
                {!managerAccount ? <button className="btn dark" onClick={() => setAccountModal({ role: "manager", loginId: `${storeId.slice(0, 8).toLowerCase()}-manager`, password: "", displayName: "매니저 공용 계정" })}>매니저 계정 만들기</button> : <span className="doneBadge darkBadge">매니저 완료</span>}
              </div>
            </div>
            {(summary?.members.rows || []).map((m) => <Row key={m.id || `${m.user_id}-${m.role}`} title={`${m.display_name || roleLabel(m.role) + " 계정"}`} desc={accountDesc(m)} meta={m.created_at} />)}
            {summary?.members.rows?.length === 0 ? <Empty text="아직 공용 계정이 없습니다." /> : null}
            {summary?.members.error ? <p className="warn">store_members 조회 경고: {summary.members.error}</p> : null}
          </div>
        ) : null}

        {tab === "pins" ? (
          <div className="panel">
            <div className="panelHead"><div><h2>직원 PIN</h2><p className="muted">PIN 번호는 저장 후 다시 표시하지 않습니다. 필요하면 재설정하세요.</p></div><button className="btn dark pinAddBtn" onClick={() => setPinModal({ action: "create", displayName: "", pinRole: "staff", pin: "", pinConfirm: "" })}>직접 PIN 추가</button></div>
            {pendingPins.length ? <h3 className="subTitle">승인대기</h3> : null}
            {pendingPins.length ? <ScrollList>{pendingPins.map((p) => <Row key={p.id} title={`${p.display_name} · ${roleLabel(p.pin_role)}`} desc={p.contact_hint ? `메모: ${p.contact_hint}` : "등록 승인을 요청했습니다."} meta={p.requested_at || p.created_at} actions={<><button className="btn dark" onClick={() => mutate("/api/admin/members/pins", { storeId, action: "approve", pinId: p.id, pinRole: p.pin_role })}>승인</button><button className="btn" onClick={() => mutate("/api/admin/members/pins", { storeId, action: "reject", pinId: p.id })}>거절</button></>} />)}</ScrollList> : null}
            <h3 className="subTitle">등록된 PIN</h3>
            {activePins.length ? <ScrollList>{activePins.map((p) => <PinRow key={p.id} pin={p} onRoleChange={(pinRole) => mutate("/api/admin/members/pins", { storeId, action: "changeRole", pinId: p.id, pinRole })} onReset={() => setPinModal({ action: "reset", pinId: p.id, displayName: p.display_name, pinRole: p.pin_role, pin: "", pinConfirm: "" })} onToggle={() => mutate("/api/admin/members/pins", { storeId, action: p.is_active ? "disable" : "enable", pinId: p.id })} />)}</ScrollList> : null}
            {pins.length === 0 ? <Empty text="등록된 PIN이 없습니다." /> : null}
            {summary?.pins.error ? <p className="warn">PIN 테이블 SQL 적용 필요: {summary.pins.error}</p> : null}
          </div>
        ) : null}

        {tab === "devices" ? (
          <div className="panel">
            <h2>승인 기기</h2>
            {(summary?.devices.rows || []).length ? <ScrollList>{(summary?.devices.rows || []).map((d) => <Row key={d.id} title={`${d.device_name || "기기"} · ${statusLabel(d.status)}`} desc={deviceDesc(d)} meta={d.last_seen_at || d.created_at} actions={<><button className="btn" onClick={() => setDeviceNameModal({ deviceId: d.id, deviceName: d.device_name || "" })}>이름 변경</button><button className="btn dark" onClick={() => mutate("/api/admin/members/devices", { storeId, deviceId: d.id, action: "approve", deviceName: d.device_name })}>승인</button><button className="btn" onClick={() => mutate("/api/admin/members/devices", { storeId, deviceId: d.id, action: "disable" })}>차단</button></>} />)}</ScrollList> : null}
            {summary?.devices.rows?.length === 0 ? <Empty text="등록된 기기가 없습니다." /> : null}
            {summary?.devices.error ? <p className="warn">기기 테이블 SQL 적용 필요: {summary.devices.error}</p> : null}
          </div>
        ) : null}

        {tab === "logs" ? (
          <div className="panel">
            <h2>보안 로그</h2>
            {(summary?.events.rows || []).length ? <ScrollList className="logScroll">{(summary?.events.rows || []).slice(0, 50).map((e) => <LogRow key={e.id} title={eventLabel(e.event_type)} desc={humanMeta(e.metadata)} meta={e.created_at} />)}</ScrollList> : null}
            {summary?.events.rows?.length === 0 ? <Empty text="아직 보안 로그가 없습니다." /> : null}
            {summary?.events.error ? <p className="warn">로그 테이블 SQL 적용 필요: {summary.events.error}</p> : null}
          </div>
        ) : null}
      </section>

      {accountModal ? <Modal title={`${roleLabel(accountModal.role)} 공용 계정 만들기`} onClose={() => setAccountModal(null)} onSubmit={submitAccount} submitText="계정 만들기"><label>로그인 ID<input value={accountModal.loginId} onChange={(e) => setAccountModal({ ...accountModal, loginId: e.target.value })} /></label><label>표시 이름<input value={accountModal.displayName} onChange={(e) => setAccountModal({ ...accountModal, displayName: e.target.value })} /></label><label>비밀번호<input type="password" value={accountModal.password} onChange={(e) => setAccountModal({ ...accountModal, password: e.target.value })} placeholder="8자 이상" /></label><p className="hint">실제 Supabase Auth에는 내부 이메일이 자동 생성되고, 화면에는 로그인 ID 중심으로 안내됩니다.</p></Modal> : null}
      {pinModal ? <Modal title={pinModal.action === "reset" ? "PIN 재설정" : "PIN 직접 추가"} onClose={() => setPinModal(null)} onSubmit={submitPinModal} submitText={pinModal.action === "reset" ? "재설정" : "추가"}><label>이름<input value={pinModal.displayName} disabled={pinModal.action === "reset"} onChange={(e) => setPinModal({ ...pinModal, displayName: e.target.value })} /></label><label>권한<select value={pinModal.pinRole} onChange={(e) => setPinModal({ ...pinModal, pinRole: e.target.value === "manager" ? "manager" : "staff" })}><option value="staff">직원</option><option value="manager">매니저</option></select></label><label>새 PIN<input type="password" inputMode="numeric" value={pinModal.pin} onChange={(e) => setPinModal({ ...pinModal, pin: e.target.value })} placeholder="4~8자리 숫자" /></label><label>PIN 확인<input type="password" inputMode="numeric" value={pinModal.pinConfirm} onChange={(e) => setPinModal({ ...pinModal, pinConfirm: e.target.value })} /></label></Modal> : null}
      {deviceNameModal ? <Modal title="기기 이름 변경" onClose={() => setDeviceNameModal(null)} onSubmit={submitDeviceName} submitText="저장"><label>기기 이름<input value={deviceNameModal.deviceName} onChange={(e) => setDeviceNameModal({ ...deviceNameModal, deviceName: e.target.value })} placeholder="예: 카운터 PC" /></label><p className="hint">매장에서 구분하기 쉬운 이름을 입력하세요.</p></Modal> : null}
    </main>
  );
}

function accountDesc(member: any) {
  const loginId = String(member.login_id || "").trim();
  const fallback = member.role === "owner" ? "대표자 계정" : `${roleLabel(String(member.role || ""))} 권한`;
  const parts = [loginId ? `로그인 ID: ${loginId}` : fallback, `권한: ${roleLabel(String(member.role || ""))}`, member.is_shared_store_account ? "공용 계정" : "개인/대표자 계정"].filter(Boolean);
  return parts.join(" · ");
}

function humanMeta(metadata: any) {
  if (!metadata || typeof metadata !== "object") return "상세 정보 없음";
  const parts = [metadata.displayName ? `대상 ${metadata.displayName}` : "", metadata.pinRole ? roleLabel(String(metadata.pinRole)) : "", metadata.requiredRole ? `필요 ${roleLabel(String(metadata.requiredRole))}` : ""].filter(Boolean);
  return parts.join(" · ") || "상세 기록";
}
function deviceDesc(device: any) {
  const type = String(device.device_type || "web");
  const browser = String(device.browser || "").split(" ").slice(0, 4).join(" ");
  return [type, browser || "기기 정보 없음"].join(" · ");
}
function shortDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const mm = date.getMonth() + 1;
  const dd = date.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}.${dd} ${hh}:${mi}`;
}
function Stat({ label, value }: { label: string; value: number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Row({ title, desc, meta, actions }: { title: string; desc: string; meta?: string; actions?: React.ReactNode }) { return <div className="rowCard"><div><strong>{title}</strong><p>{desc}</p>{meta ? <small>{shortDate(meta)}</small> : null}</div><div className="rowActions">{actions}</div></div>; }
function PinRow({ pin, onRoleChange, onReset, onToggle }: { pin: any; onRoleChange: (pinRole: string) => void; onReset: () => void; onToggle: () => void }) { return <div className="pinRow"><div className="pinText"><strong>{pin.display_name} · {roleLabel(pin.pin_role)} · {statusLabel(pin.approval_status || "approved")}</strong><span>{pin.is_active ? "사용 가능" : "잠금됨"}{pin.last_used_at || pin.created_at ? ` · ${shortDate(pin.last_used_at || pin.created_at)}` : ""}</span></div><div className="rowActions"><select className="miniSelect" value={pin.pin_role} onChange={(e) => onRoleChange(e.target.value)}><option value="staff">직원</option><option value="manager">매니저</option></select><button className="btn" onClick={onReset}>재설정</button><button className="btn" onClick={onToggle}>{pin.is_active ? "잠금" : "해제"}</button></div></div>; }
function LogRow({ title, desc, meta }: { title: string; desc: string; meta?: string }) { return <div className="logRow"><strong>{title}</strong>{desc ? <span>· {desc}</span> : null}{meta ? <time>· {shortDate(meta)}</time> : null}</div>; }
function ScrollList({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <div className={`listScroll ${className}`.trim()}>{children}</div>; }
function Modal({ title, children, onClose, onSubmit, submitText }: { title: string; children: React.ReactNode; onClose: () => void; onSubmit: () => void; submitText: string }) { return <div className="modalBackdrop" role="dialog" aria-modal="true"><div className="modal"><h2>{title}</h2><div className="modalBody">{children}</div><div className="modalActions"><button className="btn" onClick={onClose}>닫기</button><button className="btn dark" onClick={onSubmit}>{submitText}</button></div></div></div>; }

const css = `
:root { color-scheme: light; }
body { background: #f6f7f9; color: #111827; }
button, input, select, textarea { color: #111827; background: #ffffff; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 24px; }
.topbar { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
.eyebrow { margin: 0 0 6px; color: #2563eb; font-weight: 900; }
h1 { margin: 0; font-size: 30px; letter-spacing: -0.03em; } h2 { margin: 0; font-size: 20px; } .muted, .hint { color: #6b7280; } .hint { font-size: 13px; }
.statsGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
.stat, .card { background: #ffffff; color: #111827; border: 1px solid #e5e7eb; border-radius: 18px; padding: 16px; box-shadow: 0 10px 28px rgba(15,23,42,.04); }
.stat span { color: #6b7280; font-weight: 800; } .stat strong { display: block; margin-top: 6px; font-size: 28px; } .homeBtn { min-width: 116px; } .compactCopy { max-width: 520px; line-height: 1.45; } .doneBadge { display: inline-flex; align-items: center; min-height: 28px; border: 1px solid #d1fae5; background: #ecfdf5; color: #047857; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 900; white-space: nowrap; } .darkBadge { border-color: #dbeafe; background: #eff6ff; color: #1d4ed8; }
.alert { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 14px; padding: 12px; margin-bottom: 12px; color: #9a3412; font-weight: 800; }
.loading, .empty { border: 1px dashed #d1d5db; border-radius: 14px; padding: 14px; color: #6b7280; background: #f9fafb; }
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.tab, .btn { border: 1px solid #d1d5db; background: #ffffff; color: #111827; border-radius: 12px; padding: 10px 12px; font-weight: 900; cursor: pointer; }
.tabOn, .dark { background: #111827; color: #ffffff; border-color: #111827; }
.panel { display: grid; gap: 12px; } .panelHead { display: flex; justify-content: space-between; gap: 10px; align-items: center; } .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.subTitle { margin: 8px 0 0; font-size: 15px; color: #374151; }
.listScroll { display: grid; gap: 8px; max-height: min(620px, calc(100vh - 360px)); overflow-y: auto; padding: 0 4px 2px 0; scrollbar-width: thin; }
.logScroll { max-height: min(680px, calc(100vh - 320px)); }
.rowCard, .pinRow { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #e5e7eb; border-radius: 14px; padding: 10px 12px; background: #ffffff; color: #111827; }
.rowCard p { margin: 3px 0; color: #4b5563; word-break: break-word; } .rowCard small { color: #6b7280; } .rowActions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; } .pinText { display: grid; gap: 4px; min-width: 0; } .pinText strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .pinText span { color: #4b5563; font-size: 13px; font-weight: 800; } .logRow { display: flex; align-items: center; gap: 4px; min-width: 0; border: 1px solid #e5e7eb; border-radius: 12px; padding: 9px 12px; background: #fff; color: #111827; line-height: 1.25; } .logRow strong { flex: 0 0 auto; font-size: 14px; } .logRow span { min-width: 0; color: #4b5563; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .logRow time { flex: 0 0 auto; color: #6b7280; font-size: 12px; white-space: nowrap; }
.warn { color: #b45309; font-weight: 800; } .miniSelect { border: 1px solid #d1d5db; border-radius: 10px; padding: 8px; font-weight: 800; }
.modalBackdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 16px; background: rgba(15,23,42,.48); }
.modal { width: min(460px, 100%); display: grid; gap: 14px; background: #fff; color: #111827; border-radius: 20px; border: 1px solid #e5e7eb; box-shadow: 0 24px 80px rgba(15,23,42,.25); padding: 18px; }
.modalBody { display: grid; gap: 10px; } label { display: grid; gap: 6px; color: #374151; font-weight: 900; } input, select { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; font-weight: 800; } input:disabled { background: #f3f4f6; color: #6b7280; }
.modalActions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
@media (max-width: 1024px) { .listScroll { max-height: 500px; } .logScroll { max-height: 560px; } }
@media (max-width: 720px) { .wrap { padding: 12px; } .tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; margin-bottom:10px; } .panelHead, .rowCard, .pinRow { display: grid; grid-template-columns: 1fr; } .pinAddBtn { width: auto; min-width: 96px; min-height: 32px; padding: 6px 10px; border-radius: 10px; font-size: 12px; justify-self: end; } .statsGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .stat { padding: 10px 12px; border-radius: 14px; } .stat span { font-size: 12px; } .stat strong { margin-top: 2px; font-size: 20px; } .listScroll { max-height: 360px; } .logScroll { max-height: 420px; } .actions, .rowActions { width: 100%; justify-content: flex-start; } .btn, .tab { min-height: 40px; padding: 8px 5px; font-size:11px; } .doneBadge { min-height: 26px; padding: 4px 8px; } .logRow { flex-wrap: wrap; row-gap: 2px; } .logRow strong, .logRow span, .logRow time { font-size: 12px; } .pinText strong { white-space: normal; } }
@media (max-width: 720px) and (max-height: 740px) { .listScroll { max-height: 300px; } .logScroll { max-height: 340px; } }
`;

export default function MembersPage() {
  return <Suspense fallback={<main className="wrap">직원/권한 관리 로딩 중...</main>}><MembersPageInner /></Suspense>;
}
