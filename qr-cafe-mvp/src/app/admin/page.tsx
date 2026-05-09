// src/app/admin/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId, clearCurrentStoreId } from "@/app/lib/currentStore";

type StoreRow = {
  store_id: string;
  store_name: string | null;
  setup_completed?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MemberRow = {
  store_id: string;
  role: string | null;
};

type StoreBillingSummary = {
  basePlanStatus: string;
  paidUntil: string | null;
  lastPaidAt: string | null;
};

const FREE_TRIAL_DAYS = 30;

function calcRemainingDays(createdAt?: string | null) {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const diffMs = Date.now() - created;
  const usedDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, FREE_TRIAL_DAYS - usedDays);
}

function AdminPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [booting, setBooting] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);

  const [selectedStoreId, setSelectedStoreIdState] = useState<string | null>(() => getCurrentStoreId());
  const [msg, setMsg] = useState<string>("");
  const [activeSection, setActiveSection] = useState<"store" | "ops" | "stats" | "support" | null>("stats");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState("");
  const [statsSummary, setStatsSummary] = useState({ daily: 0, weekly: 0, monthly: 0 });
  const [billingByStore, setBillingByStore] = useState<Record<string, StoreBillingSummary>>({});
  const [setupBannerDismissedByStore, setSetupBannerDismissedByStore] = useState<Record<string, boolean>>({});

  const selectedStore = useMemo(() => {
    if (!selectedStoreId) return null;
    return stores.find((s) => s.store_id === selectedStoreId) || null;
  }, [stores, selectedStoreId]);

  const selectedRole = useMemo(() => {
    if (!selectedStoreId) return null;
    return members.find((m) => m.store_id === selectedStoreId)?.role || null;
  }, [members, selectedStoreId]);

  const setSelectedStoreId = (storeId: string) => {
    setSelectedStoreIdState(storeId);
    setCurrentStoreId(storeId);
  };

  const ymd = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const startOfWeekMon = (d: Date) => {
    const day = d.getDay(); // 0=일
    const diff = day === 0 ? -6 : 1 - day;
    const out = new Date(d);
    out.setDate(d.getDate() + diff);
    return out;
  };

  const endOfWeekMon = (d: Date) => {
    const start = startOfWeekMon(d);
    const out = new Date(start);
    out.setDate(start.getDate() + 6);
    return out;
  };

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const loadMyStores = async (uid: string) => {
    const memRes = await supabase
      .from("store_members")
      .select("store_id, role")
      .eq("user_id", uid)
      .order("id", { ascending: true });

    if (memRes.error) throw memRes.error;

    const memRows = (memRes.data || []) as MemberRow[];
    setMembers(memRows);

    const ids = memRows.map((m) => m.store_id).filter(Boolean);
    if (!ids.length) {
      setStores([]);
      setBillingByStore({});
      setStoresLoaded(true);
      return;
    }

    const [storeRes, billingRes, paymentRes] = await Promise.all([
      supabase.from("stores").select("store_id, store_name, setup_completed, created_at, updated_at").in("store_id", ids),
      supabase.from("store_billing").select("store_id, base_plan_status, paid_until").in("store_id", ids),
      supabase.from("billing_payments").select("store_id, paid_at, status").in("store_id", ids).eq("status", "paid").order("paid_at", { ascending: false }),
    ]);

    if (storeRes.error) throw storeRes.error;
    if (billingRes.error) throw billingRes.error;
    if (paymentRes.error) throw paymentRes.error;

    const list = (storeRes.data || []) as StoreRow[];
    list.sort((a, b) => String(a.store_name || "").localeCompare(String(b.store_name || "")));

    const nextBilling: Record<string, StoreBillingSummary> = {};
    for (const row of billingRes.data || []) {
      const storeId = String((row as { store_id: string }).store_id || "");
      if (!storeId) continue;
      nextBilling[storeId] = {
        basePlanStatus: String((row as { base_plan_status?: string | null }).base_plan_status || "inactive"),
        paidUntil: String((row as { paid_until?: string | null }).paid_until || "").trim() || null,
        lastPaidAt: null,
      };
    }

    for (const row of paymentRes.data || []) {
      const storeId = String((row as { store_id: string }).store_id || "");
      if (!storeId) continue;
      if (nextBilling[storeId]?.lastPaidAt) continue;
      const paidAt = String((row as { paid_at?: string | null }).paid_at || "").trim() || null;
      nextBilling[storeId] = {
        basePlanStatus: nextBilling[storeId]?.basePlanStatus || "inactive",
        paidUntil: nextBilling[storeId]?.paidUntil || null,
        lastPaidAt: paidAt,
      };
    }

    setStores(list);
    setBillingByStore(nextBilling);
    setStoresLoaded(true);
  };

  const calcPaidRemainingDays = (paidUntil: string | null | undefined) => {
    const raw = String(paidUntil || "").trim();
    if (!raw) return null;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24)));
  };

  const fetchStatsSummaryForStore = async (storeId: string) => {
    const today = new Date();
    const todayKey = ymd(today);
    const weekStart = ymd(startOfWeekMon(today));
    const weekEnd = ymd(endOfWeekMon(today));
    const month = monthKey(today);
    const monthStart = `${month}-01`;
    const rangeStart = [monthStart, weekStart].sort()[0];
    const rangeEnd = [todayKey, weekEnd].sort().slice(-1)[0];

    setStatsLoading(true);
    setStatsErr("");
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("order_date,total_price,status,store_id")
        .eq("store_id", storeId)
        .gte("order_date", rangeStart)
        .lte("order_date", rangeEnd)
        .neq("status", "cancelled");

      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const sum = (list: any[]) => list.reduce((acc, cur) => acc + Math.max(0, Number(cur?.total_price || 0)), 0);

      const daily = sum(rows.filter((r) => String(r?.order_date || "") === todayKey));
      const weekly = sum(rows.filter((r) => String(r?.order_date || "") >= weekStart && String(r?.order_date || "") <= weekEnd));
      const monthly = sum(rows.filter((r) => String(r?.order_date || "").startsWith(month)));

      setStatsSummary({ daily, weekly, monthly });
    } catch (e: any) {
      console.error("[admin] stats summary error:", e?.message || e);
      setStatsErr(String(e?.message || e));
      setStatsSummary({ daily: 0, weekly: 0, monthly: 0 });
    } finally {
      setStatsLoading(false);
    }
  };

  const promoteLegacyConfiguredStore = async (storeId: string) => {
    const [catRes, menuRes, groupRes, itemRes] = await Promise.all([
      supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("store_id", storeId),
      supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("store_id", storeId),
      supabase.from("option_groups").select("id", { count: "exact", head: true }).eq("store_id", storeId),
      supabase.from("option_items").select("id", { count: "exact", head: true }).eq("store_id", storeId),
    ]);
    if (catRes.error || menuRes.error || groupRes.error || itemRes.error) return false;
    const hasSetupData = [catRes.count, menuRes.count, groupRes.count, itemRes.count].some((c) => Number(c || 0) > 0);
    if (!hasSetupData) return false;
    const { error } = await supabase
      .from("stores")
      .update({
        setup_completed: true,
        setup_last_step: 4,
        setup_completed_at: new Date().toISOString(),
      })
      .eq("store_id", storeId);
    if (error) return false;
    setStores((prev) => prev.map((s) => (s.store_id === storeId ? { ...s, setup_completed: true } : s)));
    return true;
  };

  useEffect(() => {
    (async () => {
      setBooting(true);
      setMsg("");

      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setBooting(false);
        router.replace("/login");
        return;
      }

      const u = data.user;
      if (!u) {
        setBooting(false);
        router.replace("/login");
        return;
      }

      setUserId(u.id);

      try {
        await loadMyStores(u.id);

        const saved = getCurrentStoreId();
        const fromQuery = (sp.get("store") || "").trim();
        const preferred = fromQuery || saved;
        if (preferred) {
          setSelectedStoreId(preferred);
        }
      } catch (e: any) {
        console.error("[admin] load stores error:", e?.message || e);
        setMsg(`매장 목록 로드 실패: ${String(e?.message || e)}`);
        setStoresLoaded(true);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  useEffect(() => {
    if (!storesLoaded) return;
    if (!stores.length) {
      setSelectedStoreIdState(null);
      clearCurrentStoreId();
      return;
    }
    if (selectedStoreId && stores.some((s) => s.store_id === selectedStoreId)) {
      return;
    }
    setSelectedStoreIdState(null);
    clearCurrentStoreId();
  }, [stores, selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) {
      setStatsSummary({ daily: 0, weekly: 0, monthly: 0 });
      return;
    }
    fetchStatsSummaryForStore(selectedStoreId);
  }, [selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) return;
    const key = `setup_banner_dismissed_${selectedStoreId}`;
    const dismissed = sessionStorage.getItem(key) === "1";
    setSetupBannerDismissedByStore((prev) => ({ ...prev, [selectedStoreId]: dismissed }));
  }, [selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) return;
    const store = stores.find((s) => s.store_id === selectedStoreId);
    if (!store || store.setup_completed !== false) return;
    promoteLegacyConfiguredStore(selectedStoreId);
  }, [selectedStoreId, stores]);

  const go = (path: string) => {
    if (!selectedStoreId) {
      setMsg("먼저 매장을 선택하거나 생성해주세요.");
      return;
    }
    router.push(`${path}?store=${encodeURIComponent(selectedStoreId)}`);
  };

  const goPublic = (path: string) => {
    if (!selectedStoreId) {
      setMsg("먼저 매장을 선택하거나 생성해주세요.");
      return;
    }
    router.push(`${path}?store=${encodeURIComponent(selectedStoreId)}`);
  };

  const goCreate = () => {
    router.push("/admin/store/create");
  };
  const goSetup = () => {
    if (!selectedStoreId) {
      setMsg("먼저 매장을 선택하거나 생성해주세요.");
      return;
    }
    router.push(`/admin/setup?store=${encodeURIComponent(selectedStoreId)}`);
  };
  const selectedStoreIncomplete = !!selectedStoreId && stores.some((s) => s.store_id === selectedStoreId && s.setup_completed === false);
  const showSetupBanner = selectedStoreIncomplete && !setupBannerDismissedByStore[selectedStoreId || ""];
  const dismissSetupBanner = () => {
    if (!selectedStoreId) return;
    const key = `setup_banner_dismissed_${selectedStoreId}`;
    sessionStorage.setItem(key, "1");
    setSetupBannerDismissedByStore((prev) => ({ ...prev, [selectedStoreId]: true }));
  };

  if (booting) {
    return (
      <main className="wrap">
        <style jsx global>{baseCss}</style>
        <div className="card">
          <h1 className="h1">관리자</h1>
          <p className="muted">로딩 중...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <style jsx global>{baseCss}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">관리자</h1>
          
        </div>

        <div className="topActions">
          <button className="btn" onClick={goSetup} disabled={!selectedStoreId}>
            초기 설정
          </button>
          <button className="btn" onClick={() => goPublic("/menu")} disabled={!selectedStoreId}>
            고객화면
          </button>
          <button className="btn" onClick={() => goPublic("/staff")} disabled={!selectedStoreId}>
            직원화면
          </button>
          <a className="btn" href="/logout">
            로그아웃
          </a>
        </div>
      </header>

      {msg ? <div className="alert">{msg}</div> : null}
      {showSetupBanner ? (
        <div className="setupBanner" role="status" aria-live="polite">
          <div>
            <strong>이 매장은 초기 설정이 완료되지 않았습니다.</strong>
            <div className="muted">메뉴/옵션/카테고리 설정을 계속 진행해 주세요.</div>
          </div>
          <div className="setupBannerActions">
            <button className="btn btnPrimary btnSmall" onClick={goSetup}>
              초기 설정 계속하기
            </button>
            <button className="btn btnSmall" onClick={dismissSetupBanner}>
              나중에 하기
            </button>
          </div>
        </div>
      ) : null}

      <div className="adminLayout">
        <section className="card listCard">
          <div className="cardHead">
            <h2 className="cardTitle">매장 리스트</h2>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill">{stores.length}개</span>
              <button className="btn" onClick={goCreate}>
                {stores.length > 0 ? "매장 추가" : "매장 만들기"}
              </button>
            </div>
          </div>

          <p className="muted">매장을 선택해 주세요.</p>

          {stores.length === 0 ? (
            <div className="emptyBox">
              <p className="muted">매장이 없습니다. 먼저 매장을 만들어주세요.</p>
            </div>
          ) : (
            <>
              {!selectedStoreId ? <div className="muted">선택된 매장이 없습니다.</div> : null}
              <div className="storeList">
                {stores.map((s) => {
                  const on = s.store_id === selectedStoreId;
                  const role = members.find((m) => m.store_id === s.store_id)?.role || "-";
                  const remaining = calcRemainingDays(s.created_at);
                  const billing = billingByStore[s.store_id];
                  const paidRemaining = calcPaidRemainingDays(billing?.paidUntil || null);
                  const remainingText = (days: number | null) => (days == null ? "-" : `${days}일`);
                  const subscriptionStatus = billing?.basePlanStatus === "active" ? "유료" : "무료";
                  const remainingPeriod =
                    billing?.basePlanStatus === "active" ? remainingText(paidRemaining) : remainingText(remaining);
                  return (
                    <div key={s.store_id} className={`storeRow ${on ? "storeRowOn" : ""}`} onClick={() => setSelectedStoreId(s.store_id)} role="button" tabIndex={0} onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedStoreId(s.store_id);
                      }
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="storeName">
                          {s.store_name || "(이름 없음)"} <span className="muted">· {s.store_id}</span>
                        </div>
                        <div className="muted">권한: {role}</div>
                        <div className="muted">구독 상태: {subscriptionStatus}</div>
                        <div className="muted">남은 기간: {remainingPeriod}</div>
                      </div>
                      <div className="storeActions" onClick={(e) => e.stopPropagation()}>
                        {on ? <div className="pill pillOn">선택됨</div> : null}
                        {on && selectedStoreIncomplete ? (
                          <button className="btn btnPrimary btnSmall" onClick={goSetup}>
                            초기설정
                          </button>
                        ) : null}
                        {on && !selectedStoreIncomplete ? (
                          <button className="btn btnPrimary btnSmall" onClick={() => router.push(`/admin/billing/pay?store=${encodeURIComponent(s.store_id)}`)}>
                            구독결제
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                남은사용기간이 만료 되면 기능 사용이 제한 됩니다.<br />
                만료 전에 결재를 진행해 주세요.
              </p>
            </>
          )}
        </section>

        {/* ===== 관리자 메뉴 ===== */}
        <section className="card menuCard">
        <div className="tabMeta">
          <span className="pill">
            {selectedStore ? `${selectedStore.store_name || selectedStore.store_id}` : "매장 미선택"}
            {selectedRole ? ` · ${selectedRole}` : ""}
          </span>
        </div>

        <div className="btnGroup">
          <button
            className={`cardBtn ${activeSection === "store" ? "cardBtnOn" : ""}`}
            onClick={() => setActiveSection((prev) => (prev === "store" ? null : "store"))}
            disabled={!selectedStoreId}
          >
            <div className="cardBtnTitle">매장설정</div>
          </button>

          <button
            className={`cardBtn ${activeSection === "ops" ? "cardBtnOn" : ""}`}
            onClick={() => setActiveSection((prev) => (prev === "ops" ? null : "ops"))}
            disabled={!selectedStoreId}
          >
            <div className="cardBtnTitle">메뉴설정</div>
          </button>

          <button
            className={`cardBtn ${activeSection === "stats" ? "cardBtnOn" : ""}`}
            onClick={() => setActiveSection((prev) => (prev === "stats" ? null : "stats"))}
            disabled={!selectedStoreId}
          >
            <div className="cardBtnTitle">매출통계</div>
          </button>

          <button
            className={`cardBtn ${activeSection === "support" ? "cardBtnOn" : ""}`}
            onClick={() => setActiveSection((prev) => (prev === "support" ? null : "support"))}
            disabled={!selectedStoreId}
          >
            <div className="cardBtnTitle">지원센터</div>
          </button>
        </div>

        {activeSection === "store" ? (
          <div className="subPanel">
            <button className="subBtn" onClick={() => go("/admin/store")}>
              매장정보
            </button>
            <button className="subBtn" onClick={() => go("/admin/billing")}>
              PG 설정(선결재)
            </button>
            <button className="subBtn" onClick={() => go("/admin/qr")}>
              매장 QR 생성
            </button>
            <button className="subBtn" onClick={() => go("/admin/loyalty")}>
              포인트/쿠폰 설정
            </button>
          </div>
        ) : null}

        {activeSection === "ops" ? (
          <div className="subPanel">
            <button className="subBtn" onClick={() => go("/admin/categories")}>
              카테고리 관리
            </button>
            <button className="subBtn" onClick={() => go("/admin/options")}>
              옵션관리
            </button>
            <button className="subBtn" onClick={() => go("/admin/menu")}>
              메뉴관리
            </button>
            <button className="subBtn" onClick={() => go("/admin/import")}>
              일괄 데이터 업로드(선택)
            </button>
          </div>
        ) : null}

        {activeSection === "stats" ? (
          <div className="subPanel">
            <div className="statsSummary">
              <div className="statsRow">
                <span className="statsLabel">일간 매출</span>
                <span className="statsValue">{statsLoading ? "로딩중..." : `${statsSummary.daily.toLocaleString()}원`}</span>
              </div>
              <div className="statsRow">
                <span className="statsLabel">주간 매출</span>
                <span className="statsValue">{statsLoading ? "로딩중..." : `${statsSummary.weekly.toLocaleString()}원`}</span>
              </div>
              <div className="statsRow">
                <span className="statsLabel">월간 매출</span>
                <span className="statsValue">{statsLoading ? "로딩중..." : `${statsSummary.monthly.toLocaleString()}원`}</span>
              </div>
              {statsErr ? <div className="hint">요약 로딩 실패: {statsErr}</div> : null}
            </div>
            <button className="subBtn subBtnPrimary" onClick={() => go("/admin/stats")}>
              자세히보기
            </button>
          </div>
        ) : null}

        {activeSection === "support" ? (
          <div className="subPanel">
            <button className="subBtn subBtnPrimary" onClick={() => go("/admin/support")}>
              문의하기
            </button>
          </div>
        ) : null}

        {!selectedStoreId ? (
          <div className="alert" style={{ marginTop: 12 }}>
            매장을 선택해야 버튼이 활성화됩니다.
          </div>
        ) : null}
        </section>
      </div>
    </main>
  );
}

const baseCss = `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --card: #ffffff;
  --text: #111827;
  --muted: #6b7280;
  --line: #e5e7eb;
  --brand: #111827;
  --radius: 16px;
}
body {
  background: var(--bg);
  color: var(--text);
}
.wrap{
  max-width: 920px;
  margin: 0 auto;
  padding: 14px;
  display: grid;
  gap: 12px;
}
.adminLayout{
  display:grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap:12px;
  align-items:start;
}
.topbar{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;
}
.topActions{
  display:flex;
  gap:5px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
.topActions .btn{
  padding:9px 10px;
  border-radius:10px;
  font-size:13px;
}
.h1{
  margin:0;
  font-size:28px;
  font-weight:950;
  letter-spacing:-0.02em;
}
.desc{
  margin:6px 0 0 0;
  color:var(--muted);
  font-size:12px;
  font-weight:800;
  line-height:1.4;
  word-break:keep-all;
}
.muted{
  color:var(--muted);
  font-weight:800;
  font-size:12px;
}
.card{
  background:var(--card);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:14px;
  box-shadow:0 1px 0 rgba(0,0,0,0.03);
}
.row{
  display:flex;
  align-items:center;
}
.cardHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.cardTitle{
  margin:0;
  font-size:16px;
  font-weight:950;
}
.pill{
  font-size:12px;
  font-weight:900;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--line);
  background:#f9fafb;
  color:#6b7280;
  white-space:nowrap;
}
.alert{
  border:1px solid #fecaca;
  background:#fef2f2;
  color:#991b1b;
  border-radius:14px;
  padding:10px 12px;
  font-weight:900;
}
.setupBanner{
  margin-top:10px;
  border:1px solid #fde68a;
  background:#fffbeb;
  color:#92400e;
  border-radius:14px;
  padding:12px;
  display:flex;
  justify-content:space-between;
  gap:12px;
}
.setupBannerActions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.emptyBox{
  margin-top:12px;
  display:grid;
  gap:10px;
  align-items:start;
}
.tabMeta{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  margin-top:12px;
  flex-wrap:wrap;
}
.hint{
  color:var(--muted);
  font-size:12px;
  font-weight:800;
  line-height:1.35;
}
.btnRow{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  margin-top:12px;
}
.createBtnRow{
  justify-content:flex-end;
}
.btn{
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  -webkit-text-fill-color: currentColor;
  padding:10px 14px;
  border-radius:12px;
  cursor:pointer;
  font-weight:950;
  font-size:14px;
  line-height:1.2;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  text-decoration:none;
}
.btnGroup{
  display:grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap:6px;
  margin-top:12px;
}
.btnPrimary{
  background:var(--brand);
  color:#fff;
  border-color:var(--brand);
}
.btnSmall{
  padding:8px 11px;
  font-size:13px;
  border-radius:10px;
}
.btn:disabled, .btnPrimary:disabled{
  opacity:.5;
  cursor:not-allowed;
}
.storeList{
  display:grid;
  gap:10px;
  margin-top:12px;
  max-height: min(58vh, 560px);
  overflow-y: auto;
  padding-right:4px;
}
.storeRow{
  text-align:left;
  border:1px solid var(--line);
  background:#fff;
  border-radius:14px;
  padding:12px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
}
.storeRowOn{
  border:2px solid var(--brand);
  background:#eef4ff;
}
.storeRow:focus-visible{
  outline:2px solid #93c5fd;
  outline-offset:2px;
}
.storeActions{
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:8px;
}
.pillOn{
  background:#dbeafe;
  border-color:#bfdbfe;
  color:#1d4ed8;
}
.storeName{
  font-weight:950;
  font-size:14px;
}
.cardBtn{
  text-align:center;
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  -webkit-text-fill-color: currentColor;
  border-radius:12px;
  padding:9px 6px;
  cursor:pointer;
}
.cardBtn:disabled{
  opacity:.5;
  cursor:not-allowed;
}
.cardBtnOn{
  background:var(--brand);
  color:#fff;
  border-color:var(--brand);
}
.cardBtnOn .cardBtnDesc{
  color:#f3f4f6;
}
.cardBtnTitle{
  margin:0;
  font-size:14px;
  font-weight:950;
  line-height:1.1;
  white-space:nowrap;
}
.subPanel{
  margin-top:12px;
  display:grid;
  gap:8px;
}
.subBtn{
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  -webkit-text-fill-color: currentColor;
  padding:12px 14px;
  border-radius:12px;
  cursor:pointer;
  font-weight:900;
  text-align:left;
}
.subBtnPrimary{
  background:var(--brand);
  border-color:var(--brand);
  color:#fff;
}
.subBtnDisabled{
  opacity:.6;
  cursor:not-allowed;
}
.statsSummary{
  border:1px solid var(--line);
  border-radius:12px;
  padding:12px;
  background:#f9fafb;
  display:grid;
  gap:8px;
}
.statsRow{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-weight:900;
}
.statsLabel{
  color:var(--muted);
  font-size:12px;
}
.statsValue{
  font-size:14px;
}
.stickyCard{
  position:sticky;
  top:10px;
  z-index:5;
}
@media (max-width: 640px){
  .adminLayout{
    grid-template-columns: 1fr;
  }
  .wrap{ padding:12px; }
  .topbar{ align-items:center; }
  .topActions{
    flex-wrap:nowrap;
    gap:4px;
  }
  .topActions .btn{
    padding:8px 8px;
    font-size:12px;
    white-space:nowrap;
  }
  .cardBtnTitle{ font-size:12px; }
  .btnGroup{
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap:4px;
  }
  .storeList{
    max-height: min(42vh, 360px);
  }
  .setupBanner{
    display:grid;
    gap:10px;
  }
}
`;
export default function AdminPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminPageInner />
    </Suspense>
  );
}
