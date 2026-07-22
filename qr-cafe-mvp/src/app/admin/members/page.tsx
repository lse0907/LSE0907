/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";

type TabKey = "accounts" | "pins" | "devices" | "logs";

type ApiSection = { rows: any[]; error?: string };
type Summary = { members: ApiSection; pins: ApiSection; devices: ApiSection; events: ApiSection };

const tabs: { key: TabKey; label: string }[] = [
  { key: "accounts", label: "계정" },
  { key: "pins", label: "PIN" },
  { key: "devices", label: "기기" },
  { key: "logs", label: "로그" },
];

function MembersPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = useMemo(() => String(sp.get("store") || getCurrentStoreId() || "").trim(), [sp]);
  const [tab, setTab] = useState<TabKey>("accounts");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

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

  const createAccount = async (role: "staff" | "manager") => {
    const email = window.prompt(`${role === "manager" ? "매니저" : "직원"} 공용 계정 이메일을 입력해주세요.`)?.trim();
    if (!email) return;
    const password = window.prompt("8자 이상 비밀번호를 입력해주세요.") || "";
    if (password.length < 8) {
      setMsg("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    const displayName = window.prompt("계정 표시 이름을 입력해주세요.", role === "manager" ? "매니저 공용 계정" : "직원 공용 계정") || "";
    await mutate("/api/admin/members/accounts", { storeId, role, email, password, displayName });
  };

  const createPin = async () => {
    const displayName = window.prompt("직원/매니저 이름을 입력해주세요.")?.trim();
    if (!displayName) return;
    const pinRole = window.confirm("매니저 PIN으로 만들까요?\n확인: 매니저 / 취소: 직원") ? "manager" : "staff";
    const pin = window.prompt("4~8자리 숫자 PIN을 입력해주세요.") || "";
    await mutate("/api/admin/members/pins", { storeId, action: "create", displayName, pinRole, pin });
  };

  const mutate = async (url: string, body: Record<string, unknown>) => {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "요청 처리 실패");
      await load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="wrap">
      <style jsx global>{css}</style>
      <header className="topbar">
        <div>
          <h1>직원/권한 관리</h1>
          <p className="muted">직원·매니저 공용 계정, PIN, 승인 기기, 보안 로그를 관리합니다.</p>
        </div>
        <button className="btn" onClick={() => router.push(`/admin?store=${encodeURIComponent(storeId)}`)}>← 관리자 홈</button>
      </header>

      {!storeId ? <div className="alert">먼저 관리자 홈에서 매장을 선택해주세요.</div> : null}
      {msg ? <div className="alert">{msg}</div> : null}
      {loading ? <div className="card muted">처리 중...</div> : null}

      <section className="card">
        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`tab ${tab === t.key ? "tabOn" : ""}`.trim()} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>

        {tab === "accounts" ? (
          <div className="panel">
            <div className="panelHead"><h2>공용 계정</h2><div className="actions"><button className="btn" onClick={() => createAccount("staff")}>직원 계정 만들기</button><button className="btn dark" onClick={() => createAccount("manager")}>매니저 계정 만들기</button></div></div>
            <p className="muted">계정은 Supabase Auth 사용자로 생성되고 store_members role에 연결됩니다.</p>
            {(summary?.members.rows || []).map((m) => <Row key={m.id || `${m.user_id}-${m.role}`} title={m.role || "role 없음"} desc={`user_id: ${m.user_id || "-"}`} meta={m.created_at} />)}
            {summary?.members.error ? <p className="warn">store_members 조회 경고: {summary.members.error}</p> : null}
          </div>
        ) : null}

        {tab === "pins" ? (
          <div className="panel">
            <div className="panelHead"><h2>직원/매니저 PIN</h2><button className="btn dark" onClick={createPin}>PIN 추가</button></div>
            {(summary?.pins.rows || []).map((p) => <Row key={p.id} title={`${p.display_name} · ${p.pin_role}`} desc={p.is_active ? "활성" : "잠금됨"} meta={p.last_used_at || p.created_at} actions={<button className="btn" onClick={() => mutate("/api/admin/members/pins", { storeId, action: p.is_active ? "disable" : "enable", pinId: p.id })}>{p.is_active ? "잠금" : "잠금 해제"}</button>} />)}
            {summary?.pins.error ? <p className="warn">PIN 테이블 SQL 적용 필요: {summary.pins.error}</p> : null}
          </div>
        ) : null}

        {tab === "devices" ? (
          <div className="panel">
            <h2>등록 기기</h2>
            {(summary?.devices.rows || []).map((d) => <Row key={d.id} title={`${d.device_name || "기기"} · ${d.status}`} desc={`${d.browser || ""} ${d.os || ""}`.trim() || "기기 정보 없음"} meta={d.last_seen_at || d.created_at} actions={<><button className="btn" onClick={() => mutate("/api/admin/members/devices", { storeId, deviceId: d.id, action: "approve", deviceName: d.device_name })}>승인</button><button className="btn" onClick={() => mutate("/api/admin/members/devices", { storeId, deviceId: d.id, action: "disable" })}>차단</button></>} />)}
            {summary?.devices.error ? <p className="warn">기기 테이블 SQL 적용 필요: {summary.devices.error}</p> : null}
          </div>
        ) : null}

        {tab === "logs" ? (
          <div className="panel">
            <h2>로그</h2>
            {(summary?.events.rows || []).slice(0, 50).map((e) => <Row key={e.id} title={e.event_type} desc={JSON.stringify(e.metadata || {})} meta={e.created_at} />)}
            {summary?.events.error ? <p className="warn">로그 테이블 SQL 적용 필요: {summary.events.error}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Row({ title, desc, meta, actions }: { title: string; desc: string; meta?: string; actions?: React.ReactNode }) {
  return <div className="rowCard"><div><strong>{title}</strong><p>{desc}</p>{meta ? <small>{new Date(meta).toLocaleString()}</small> : null}</div><div className="rowActions">{actions}</div></div>;
}

const css = `
body{background:#f6f7f9;color:#111827}.wrap{max-width:980px;margin:0 auto;padding:22px}.topbar{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:16px}.muted{color:#6b7280}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:16px}.alert{background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:12px;margin-bottom:12px;color:#9a3412;font-weight:800}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.tab,.btn{border:1px solid #d1d5db;background:#fff;border-radius:12px;padding:10px 12px;font-weight:900;cursor:pointer}.tabOn,.dark{background:#111827;color:#fff;border-color:#111827}.panel{display:grid;gap:12px}.panelHead{display:flex;justify-content:space-between;gap:10px;align-items:center}.actions{display:flex;gap:8px;flex-wrap:wrap}.rowCard{display:flex;justify-content:space-between;gap:12px;border:1px solid #e5e7eb;border-radius:14px;padding:12px}.rowCard p{margin:5px 0;color:#4b5563;word-break:break-all}.rowCard small{color:#6b7280}.rowActions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.warn{color:#b45309;font-weight:800}@media(max-width:720px){.topbar,.panelHead,.rowCard{display:grid}.actions,.rowActions{width:100%}.btn,.tab{min-height:44px}}`;

export default function MembersPage() {
  return <Suspense fallback={<main className="wrap">직원/권한 관리 로딩 중...</main>}><MembersPageInner /></Suspense>;
}
