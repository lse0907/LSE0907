"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type StoreBillingRow = {
  store_id: string;
  store_name: string | null;
  base_plan_status: string | null;
  paid_until: string | null;
  addon_status: string | null;
  addon_paid_until: string | null;
  monthly_revenue: number;
};

type StoreBaseRow = { store_id: string; store_name: string | null };
type BillingBaseRow = { store_id: string; base_plan_status: string | null; paid_until: string | null };
type AddonBaseRow = { store_id: string; prepay_addon_status: string | null; addon_paid_until: string | null };
type PaymentBaseRow = { store_id: string; amount_krw: number | null };
type SupportTicketRow = {
  id: number;
  store_id: string;
  category: string;
  priority: string;
  status: string;
  title: string;
  body: string | null;
  ops_note: string | null;
  created_at: string;
  updated_at: string;
};

export default function OpsPage() {
  const router = useRouter();
  const [isOps, setIsOps] = useState<boolean | null>(null);
  const [rows, setRows] = useState<StoreBillingRow[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [pgForm, setPgForm] = useState({ mid: "", clientKey: "", secretKey: "" });
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [ticketMsg, setTicketMsg] = useState("");

  const loadOps = useCallback(async () => {
    setLoading(true);
    setMsg("");
    const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;

    const [storesRes, billRes, addonRes, payRes] = await Promise.all([
      supabase.from("stores").select("store_id, store_name").order("store_name", { ascending: true }),
      supabase.from("store_billing").select("store_id, base_plan_status, paid_until"),
      supabase.from("store_addons").select("store_id, prepay_addon_status, addon_paid_until"),
      supabase.from("billing_payments").select("store_id, amount_krw, paid_at, status").gte("paid_at", monthStart).eq("status", "paid"),
    ]);

    if (storesRes.error || billRes.error || addonRes.error || payRes.error) {
      setMsg("OPS 데이터 로딩 실패: 권한/테이블 상태를 확인해 주세요.");
      setLoading(false);
      return;
    }

    const billRows = (billRes.data || []) as BillingBaseRow[];
    const addonRows = (addonRes.data || []) as AddonBaseRow[];
    const paymentRows = (payRes.data || []) as PaymentBaseRow[];
    const storeRows = (storesRes.data || []) as StoreBaseRow[];

    const billMap = new Map(billRows.map((x) => [x.store_id, x]));
    const addonMap = new Map(addonRows.map((x) => [x.store_id, x]));
    const revMap = new Map<string, number>();
    for (const p of paymentRows) {
      const sid = String(p.store_id || "");
      const prev = revMap.get(sid) || 0;
      revMap.set(sid, prev + Math.max(0, Number(p.amount_krw || 0)));
    }

    const next: StoreBillingRow[] = storeRows.map((s) => ({
      store_id: String(s.store_id),
      store_name: s.store_name || null,
      base_plan_status: billMap.get(s.store_id)?.base_plan_status || "inactive",
      paid_until: billMap.get(s.store_id)?.paid_until || null,
      addon_status: addonMap.get(s.store_id)?.prepay_addon_status || "inactive",
      addon_paid_until: addonMap.get(s.store_id)?.addon_paid_until || null,
      monthly_revenue: revMap.get(String(s.store_id)) || 0,
    }));

    setRows(next);
    setSelectedStoreId((prev) => prev || next[0]?.store_id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const roleFromApp = String(data?.user?.app_metadata?.role || "");
      const roleFromUser = String(data?.user?.user_metadata?.role || "");
      const allowed = roleFromApp === "ops" || roleFromUser === "ops";
      setIsOps(allowed);
      if (!allowed) {
        setLoading(false);
        setMsg("OPS 권한(role=ops)이 필요합니다.");
      }
    })();
  }, []);

  useEffect(() => {
    if (isOps !== true) return;
    const timer = setTimeout(() => {
      void loadOps();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOps, loadOps]);

  useEffect(() => {
    if (isOps !== true) return;
    (async () => {
      const { data, error } = await supabase
        .from("platform_pg_config")
        .select("mid, client_key")
        .eq("id", 1)
        .maybeSingle();
      if (error) return;
      setPgForm({
        mid: String(data?.mid || ""),
        clientKey: String(data?.client_key || ""),
        secretKey: "",
      });
    })();
  }, [isOps]);

  useEffect(() => {
    if (isOps !== true) return;
    (async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("id, store_id, category, priority, status, title, body, ops_note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        setTicketMsg(`티켓 로드 실패: ${error.message}`);
        return;
      }
      setTickets((data || []) as SupportTicketRow[]);
    })();
  }, [isOps]);

  if (isOps === false) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>OPS 관리자 콘솔</h1>
        <p style={{ color: "#6b7280" }}>접근 권한이 없습니다. 관리자에게 OPS role 부여를 요청해 주세요.</p>
        <button onClick={() => router.push("/admin")} style={{ border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", padding: "8px 12px", cursor: "pointer" }}>
          admin으로 돌아가기
        </button>
      </main>
    );
  }

  const savePg = async () => {
    const payload: {
      id: number;
      mid: string;
      client_key: string;
      secret_key?: string;
      updated_at: string;
    } = {
      id: 1,
      mid: pgForm.mid.trim(),
      client_key: pgForm.clientKey.trim(),
      updated_at: new Date().toISOString(),
    };
    if (pgForm.secretKey.trim()) payload.secret_key = pgForm.secretKey.trim();
    const { error } = await supabase.from("platform_pg_config").upsert(payload, { onConflict: "id" });
    setMsg(error ? `PG 저장 실패: ${error.message}` : "PG 저장 완료");
    if (!error) setPgForm((prev) => ({ ...prev, secretKey: "" }));
  };

  const updateTicket = async (ticketId: number, patch: Partial<Pick<SupportTicketRow, "status" | "ops_note">>) => {
    setTicketMsg("");
    const payload: { status?: string; ops_note?: string; resolved_at?: string | null } = {
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.ops_note != null ? { ops_note: patch.ops_note } : {}),
    };
    if (patch.status === "resolved" || patch.status === "closed") {
      payload.resolved_at = new Date().toISOString();
    }
    const { error } = await supabase.from("support_tickets").update(payload).eq("id", ticketId);
    if (error) {
      setTicketMsg(`티켓 업데이트 실패: ${error.message}`);
      return;
    }
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? {
              ...t,
              ...(patch.status != null ? { status: patch.status } : {}),
              ...(patch.ops_note != null ? { ops_note: patch.ops_note } : {}),
              updated_at: new Date().toISOString(),
            }
          : t
      )
    );
    setTicketMsg("티켓 업데이트 완료");
  };

  const fmt = (iso: string) => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return iso;
    return new Date(t).toLocaleString("ko-KR", { hour12: false });
  };

  return (
    <main className="wrap">
      <style jsx>{`
        .wrap { max-width: 1280px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
        .top { display:flex; justify-content:space-between; align-items:center; }
        .h1 { margin:0; font-size: 30px; font-weight: 900; }
        .card { border:1px solid #e5e7eb; border-radius: 14px; background:#fff; padding:16px; }
        .grid { display:grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
        .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .btn { border:1px solid #d1d5db; padding:8px 12px; border-radius:10px; background:#fff; font-weight:800; cursor:pointer; }
        .btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
        table { width:100%; border-collapse: collapse; font-size: 14px; }
        th, td { border-bottom:1px solid #eef2f7; padding:10px; text-align:left; }
        tr.sel { background:#eef6ff; }
        .input { width:100%; border:1px solid #d1d5db; border-radius:10px; padding:10px; }
        .muted { color:#6b7280; font-size:13px; margin:0; }
        @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
      `}</style>

      <header className="top">
        <h1 className="h1">OPS 관리자 콘솔</h1>
        <div className="row">
          <button className="btn" onClick={loadOps}>새로고침</button>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <strong>총 매장:</strong> <span>{rows.length}개</span>
          <strong>월 구독 매출:</strong> <span>{rows.reduce((a, c) => a + c.monthly_revenue, 0).toLocaleString()}원</span>
          <strong>활성 구독:</strong> <span>{rows.filter((r) => r.base_plan_status === "active").length}개</span>
        </div>
        {msg ? <p className="muted">{msg}</p> : null}
      </section>

      <section className="grid">
        <article className="card">
          <h2>매장 가입/구독 현황</h2>
          {loading ? (
            <p className="muted">로딩 중...</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>매장</th>
                  <th>기본구독</th>
                  <th>남은기간</th>
                  <th>옵션</th>
                  <th>월 구독매출</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.store_id} className={r.store_id === selectedStoreId ? "sel" : ""} onClick={() => setSelectedStoreId(r.store_id)}>
                    <td>{r.store_name || r.store_id}</td>
                    <td>{r.base_plan_status || "inactive"}</td>
                    <td>{r.paid_until ? new Date(r.paid_until).toLocaleDateString("ko-KR") : "-"}</td>
                    <td>{r.addon_status || "inactive"}</td>
                    <td>{r.monthly_revenue.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="card">
          <h2>플랫폼 PG 연결 (단일 MID)</h2>
          <p className="muted">점주 구독 결제는 플랫폼 사업자 PG(공통 MID) 기준으로 처리합니다.</p>
          <div className="row"><input className="input" placeholder="MID" value={pgForm.mid} onChange={(e) => setPgForm((p) => ({ ...p, mid: e.target.value }))} /></div>
          <div className="row"><input className="input" placeholder="Client Key" value={pgForm.clientKey} onChange={(e) => setPgForm((p) => ({ ...p, clientKey: e.target.value }))} /></div>
          <div className="row"><input className="input" type="password" placeholder="Secret Key (변경 시에만 입력)" value={pgForm.secretKey} onChange={(e) => setPgForm((p) => ({ ...p, secretKey: e.target.value }))} /></div>
          <div className="row">
            <button className="btn primary" onClick={savePg}>PG 저장</button>
            <button className="btn" onClick={() => selectedStoreId && router.push(`/admin/billing/pay?store=${encodeURIComponent(selectedStoreId)}`)} disabled={!selectedStoreId}>
              결제/구독 테스트로 이동
            </button>
          </div>
          <hr />
          <h3>문의/장애 관리</h3>
          {ticketMsg ? <p className="muted">{ticketMsg}</p> : null}
          {tickets.length === 0 ? <p className="muted">등록된 티켓이 없습니다.</p> : null}
          <div style={{ display: "grid", gap: 8 }}>
            {tickets.slice(0, 8).map((t) => (
              <div key={t.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>#{t.id} [{t.store_id}] {t.title}</div>
                <div className="muted">{t.category} · {t.priority} · 등록 {fmt(t.created_at)}</div>
                {t.body ? <div style={{ fontSize: 13 }}>{t.body}</div> : null}
                <input
                  className="input"
                  placeholder="OPS 답변/처리 메모"
                  defaultValue={t.ops_note || ""}
                  onBlur={(e) => {
                    const note = e.target.value.trim();
                    if (note === String(t.ops_note || "")) return;
                    void updateTicket(t.id, { ops_note: note || null });
                  }}
                />
                <div className="row">
                  <span className="muted">상태: {t.status}</span>
                  <button className="btn" onClick={() => void updateTicket(t.id, { status: "open" })}>open</button>
                  <button className="btn" onClick={() => void updateTicket(t.id, { status: "in_progress" })}>in_progress</button>
                  <button className="btn" onClick={() => void updateTicket(t.id, { status: "resolved" })}>resolved</button>
                  <button className="btn" onClick={() => void updateTicket(t.id, { status: "closed" })}>closed</button>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
