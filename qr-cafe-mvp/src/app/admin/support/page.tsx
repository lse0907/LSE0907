"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type TicketRow = {
  id: number;
  category: string;
  priority: string;
  status: string;
  title: string;
  body: string | null;
  ops_note: string | null;
  created_at: string;
  updated_at: string;
};

function AdminSupportInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const storeId = useMemo(() => {
    const q = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    return q || saved;
  }, [sp]);

  const [storeName, setStoreName] = useState("-");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [category, setCategory] = useState("inquiry");
  const [priority, setPriority] = useState("normal");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const loadTickets = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const [{ data: storeData }, { data, error }] = await Promise.all([
      supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle(),
      supabase.from("support_tickets").select("id, category, priority, status, title, body, ops_note, created_at, updated_at").eq("store_id", storeId).order("created_at", { ascending: false }),
    ]);

    if (error) {
      setMsg(`티켓 조회 실패: ${error.message}`);
      setLoading(false);
      return;
    }

    setStoreName(String(storeData?.store_name || storeId));
    setTickets((data || []) as TicketRow[]);
    setLoading(false);
  }, [storeId]);

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, storeId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadTickets();
    }, 0);
    return () => clearTimeout(t);
  }, [loadTickets]);

  const onCreate = async () => {
    setMsg("");
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setMsg("제목을 입력해 주세요.");
      return;
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      setMsg("로그인 사용자 확인 실패. 다시 로그인해 주세요.");
      return;
    }

    const { error } = await supabase.from("support_tickets").insert({
      store_id: storeId,
      requester_user_id: userData.user.id,
      category,
      priority,
      title: trimmedTitle,
      body: body.trim() || null,
      status: "open",
    });

    if (error) {
      setMsg(`티켓 등록 실패: ${error.message}`);
      return;
    }

    setTitle("");
    setBody("");
    setMsg("티켓 등록 완료");
    await loadTickets();
  };

  const fmt = (iso: string) => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return iso;
    return new Date(t).toLocaleString("ko-KR", { hour12: false });
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
        }

        body {
          background: #f6f7f9;
          color: #111827;
        }
      `}</style>
      <style jsx>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 16px; display: grid; gap: 12px; color:#111827; }
        .top { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .h1 { margin: 0; font-size: 22px; font-weight: 900; }
        .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:14px; display:grid; gap:10px; }
        .row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
        .btn { border:1px solid #d1d5db; background:#fff; color:#111827; -webkit-text-fill-color: currentColor; border-radius:10px; padding:9px 12px; font-weight:800; cursor:pointer; }
        .btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
        .input, .textarea, .select { width:100%; border:1px solid #d1d5db; border-radius:10px; padding:10px; font-size:14px; }
        .textarea { min-height:90px; resize: vertical; }
        .muted { color:#4b5563; margin:0; font-size:13px; }
        .ticket { border:1px solid #e5e7eb; border-radius:12px; padding:10px; display:grid; gap:6px; background:#fff; }
        .pill { display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; border:1px solid #e5e7eb; }
      `}</style>

      <header className="top">
        <h1 className="h1">지원센터</h1>
        <div className="row">
          <button className="btn" onClick={() => router.back()}>뒤로가기</button>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <span className="pill">store: {storeName}</span>
          <span className="pill">id: {storeId}</span>
        </div>
        <p className="muted">불편사항/문의/오류를 등록하면 OPS에서 처리 상태를 갱신합니다.</p>

        <div className="row">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="inquiry">문의</option>
            <option value="bug">오류</option>
            <option value="improvement">개선요청</option>
            <option value="billing">결제/구독</option>
            <option value="etc">기타</option>
          </select>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">낮음</option>
            <option value="normal">보통</option>
            <option value="high">높음</option>
            <option value="urgent">긴급</option>
          </select>
        </div>

        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
        <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="내용" />
        <div className="row">
          <button className="btn primary" onClick={onCreate}>등록</button>
          {msg ? <span className="muted">{msg}</span> : null}
        </div>
      </section>

      <section className="card">
        <h2 style={{ margin: 0, fontSize: 16 }}>내 매장 티켓 목록</h2>
        {loading ? <p className="muted">로딩 중...</p> : null}
        {!loading && tickets.length === 0 ? <p className="muted">등록된 티켓이 없습니다.</p> : null}
        {tickets.map((t) => (
          <article key={t.id} className="ticket">
            <div className="row">
              <b>#{t.id} {t.title}</b>
              <span className="pill">{t.status}</span>
              <span className="pill">{t.category}</span>
              <span className="pill">{t.priority}</span>
            </div>
            {t.body ? <p style={{ margin: 0 }}>{t.body}</p> : null}
            {t.ops_note ? <p className="muted">OPS 답변: {t.ops_note}</p> : <p className="muted">OPS 답변 대기 중</p>}
            <p className="muted">등록: {fmt(t.created_at)} / 수정: {fmt(t.updated_at)}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

export default function AdminSupportPage() {
  return (
    <Suspense fallback={<main className="wrap"><p className="muted">로딩 중...</p></main>}>
      <AdminSupportInner />
    </Suspense>
  );
}
