// src/app/admin/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  getCurrentStoreId,
  setCurrentStoreId,
  clearCurrentStoreId,
} from "@/app/lib/currentStore";

type StoreStatus = "active" | "inactive" | "deleted";

type StoreRow = {
  store_id: string;
  store_name: string | null;
  setup_completed?: boolean | null;
  setup_last_step?: number | null;
  status?: StoreStatus | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StoreStatusFilter = "all" | "active" | "setup" | "inactive";

type MemberRow = {
  store_id: string;
  role: string | null;
};

type StoreBillingSummary = {
  basePlanStatus: string;
  paidUntil: string | null;
  lastPaidAt: string | null;
};

type OrderSummaryRow = {
  order_date?: string | null;
  total_price?: number | string | null;
};

function toErrorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

const FREE_TRIAL_DAYS = 30;

function getStoreLifecycleStatus(store: StoreRow): StoreStatus {
  const raw = String(store.status || "active").trim();
  if (raw === "inactive" || raw === "deleted") return raw;
  return "active";
}

function getStoreDisplayStatus(store: StoreRow): StoreStatusFilter {
  const lifecycleStatus = getStoreLifecycleStatus(store);
  if (lifecycleStatus === "inactive") return "inactive";
  if (store.setup_completed !== true) return "setup";
  return "active";
}

function getStoreStatusLabel(store: StoreRow) {
  const displayStatus = getStoreDisplayStatus(store);
  if (displayStatus === "inactive") return "비활성";
  if (displayStatus === "setup") return "설정중";
  return "운영중";
}

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
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storesLoaded, setStoresLoaded] = useState(false);

  const [selectedStoreId, setSelectedStoreIdState] = useState<string | null>(
    () => getCurrentStoreId(),
  );
  const [msg, setMsg] = useState<string>("");
  const [activeSection, setActiveSection] = useState<
    "store" | "ops" | "support" | null
  >(null);
  const [storeStatusFilter, setStoreStatusFilter] =
    useState<StoreStatusFilter>("all");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsErr, setStatsErr] = useState("");
  const [statsSummary, setStatsSummary] = useState({
    daily: 0,
    weekly: 0,
    monthly: 0,
  });
  const [billingByStore, setBillingByStore] = useState<
    Record<string, StoreBillingSummary>
  >({});
  const [
    hideSetupBannerForCurrentSelection,
    setHideSetupBannerForCurrentSelection,
  ] = useState(false);
  const [selectedStoreCounts, setSelectedStoreCounts] = useState<{
    categories: number;
    options: number;
    menus: number;
  } | null>(null);
  const subPanelRef = useRef<HTMLDivElement | null>(null);
  const didOpenDefaultSectionRef = useRef(false);

  const selectedStore = useMemo(() => {
    if (!selectedStoreId) return null;
    return stores.find((s) => s.store_id === selectedStoreId) || null;
  }, [stores, selectedStoreId]);

  const visibleStores = useMemo(() => {
    return stores
      .filter((store) => getStoreLifecycleStatus(store) !== "deleted")
      .filter(
        (store) =>
          storeStatusFilter === "all" ||
          getStoreDisplayStatus(store) === storeStatusFilter,
      );
  }, [stores, storeStatusFilter]);

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

  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  const loadMyStores = async (uid: string) => {
    const memRes = await supabase
      .from("store_members")
      .select("store_id, role")
      .eq("user_id", uid)
      .order("id", { ascending: true });

    if (memRes.error) throw memRes.error;

    const memRows = (memRes.data || []) as MemberRow[];

    const ids = memRows.map((m) => m.store_id).filter(Boolean);
    if (!ids.length) {
      setStores([]);
      setBillingByStore({});
      setStoresLoaded(true);
      return;
    }

    // `status` may not exist before the lifecycle SQL is applied, so this response can have either shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let storeRes: any = await supabase
      .from("stores")
      .select(
        "store_id, store_name, setup_completed, setup_last_step, status, created_at, updated_at",
      )
      .in("store_id", ids);
    if (storeRes.error && /status/i.test(storeRes.error.message || "")) {
      storeRes = await supabase
        .from("stores")
        .select(
          "store_id, store_name, setup_completed, setup_last_step, created_at, updated_at",
        )
        .in("store_id", ids);
    }

    const [billingRes, paymentRes] = await Promise.all([
      supabase
        .from("store_billing")
        .select("store_id, base_plan_status, paid_until")
        .in("store_id", ids),
      supabase
        .from("billing_payments")
        .select("store_id, paid_at, status")
        .in("store_id", ids)
        .eq("status", "paid")
        .order("paid_at", { ascending: false }),
    ]);

    if (storeRes.error) throw storeRes.error;
    if (billingRes.error) throw billingRes.error;
    if (paymentRes.error) throw paymentRes.error;

    const list = (storeRes.data || []) as StoreRow[];
    list.sort((a, b) =>
      String(a.store_name || "").localeCompare(String(b.store_name || "")),
    );

    const nextBilling: Record<string, StoreBillingSummary> = {};
    for (const row of billingRes.data || []) {
      const storeId = String((row as { store_id: string }).store_id || "");
      if (!storeId) continue;
      nextBilling[storeId] = {
        basePlanStatus: String(
          (row as { base_plan_status?: string | null }).base_plan_status ||
            "inactive",
        ),
        paidUntil:
          String(
            (row as { paid_until?: string | null }).paid_until || "",
          ).trim() || null,
        lastPaidAt: null,
      };
    }

    for (const row of paymentRes.data || []) {
      const storeId = String((row as { store_id: string }).store_id || "");
      if (!storeId) continue;
      if (nextBilling[storeId]?.lastPaidAt) continue;
      const paidAt =
        String((row as { paid_at?: string | null }).paid_at || "").trim() ||
        null;
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

      const rows = (Array.isArray(data) ? data : []) as OrderSummaryRow[];
      const sum = (list: OrderSummaryRow[]) =>
        list.reduce(
          (acc, cur) => acc + Math.max(0, Number(cur.total_price || 0)),
          0,
        );

      const daily = sum(
        rows.filter((r) => String(r?.order_date || "") === todayKey),
      );
      const weekly = sum(
        rows.filter(
          (r) =>
            String(r?.order_date || "") >= weekStart &&
            String(r?.order_date || "") <= weekEnd,
        ),
      );
      const monthly = sum(
        rows.filter((r) => String(r?.order_date || "").startsWith(month)),
      );

      setStatsSummary({ daily, weekly, monthly });
    } catch (e: unknown) {
      const message = toErrorMessage(e);
      console.error("[admin] stats summary error:", message);
      setStatsErr(message);
      setStatsSummary({ daily: 0, weekly: 0, monthly: 0 });
    } finally {
      setStatsLoading(false);
    }
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

      try {
        await loadMyStores(u.id);

        const saved = getCurrentStoreId();
        const fromQuery = (sp.get("store") || "").trim();
        const preferred = fromQuery || saved;
        if (preferred) {
          setSelectedStoreId(preferred);
        }
        if ((sp.get("deleted") || "").trim() === "1") {
          setMsg("매장이 삭제되었습니다.");
        }
      } catch (e: unknown) {
        const message = toErrorMessage(e);
        console.error("[admin] load stores error:", message);
        setMsg(`매장 목록 로드 실패: ${message}`);
        setStoresLoaded(true);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  useEffect(() => {
    if (!storesLoaded) return;
    const selectableStores = stores.filter(
      (store) => getStoreLifecycleStatus(store) !== "deleted",
    );
    if (!selectableStores.length) {
      setSelectedStoreIdState(null);
      clearCurrentStoreId();
      return;
    }
    if (
      selectedStoreId &&
      selectableStores.some((s) => s.store_id === selectedStoreId)
    ) {
      return;
    }
    setSelectedStoreIdState(null);
    clearCurrentStoreId();
  }, [stores, selectedStoreId, storesLoaded]);

  useEffect(() => {
    if (!selectedStoreId) {
      setStatsSummary({ daily: 0, weekly: 0, monthly: 0 });
      setHideSetupBannerForCurrentSelection(false);
      setSelectedStoreCounts(null);
      return;
    }
    fetchStatsSummaryForStore(selectedStoreId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) return;
    setHideSetupBannerForCurrentSelection(false);
  }, [selectedStoreId]);

  useEffect(() => {
    if (didOpenDefaultSectionRef.current || !selectedStoreId) return;
    didOpenDefaultSectionRef.current = true;
    setActiveSection("store");
  }, [selectedStoreId]);

  useEffect(() => {
    if (!activeSection || !subPanelRef.current) return;
    if (!window.matchMedia("(max-width: 720px)").matches) return;
    window.setTimeout(() => {
      subPanelRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 80);
  }, [activeSection]);

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

  const handleSelectStore = (storeId: string) => {
    setSelectedStoreId(storeId);
    setActiveSection("store");
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
  const selectedStoreIncomplete =
    !!selectedStoreId &&
    stores.some(
      (s) => s.store_id === selectedStoreId && s.setup_completed !== true,
    );
  const selectedStoreNeedsSetupByData =
    selectedStoreCounts != null &&
    (selectedStoreCounts.categories < 1 ||
      selectedStoreCounts.options < 1 ||
      selectedStoreCounts.menus < 1);
  const selectedStoreShouldShowSetup =
    selectedStoreIncomplete || selectedStoreNeedsSetupByData;
  const selectedStoreSetupCompleted =
    !!selectedStoreId &&
    stores.some(
      (s) => s.store_id === selectedStoreId && s.setup_completed === true,
    );
  const selectedStoreCompletedSteps = selectedStoreCounts
    ? (selectedStoreCounts.categories > 0 ? 1 : 0) +
      (selectedStoreCounts.options > 0 ? 1 : 0) +
      (selectedStoreCounts.menus > 0 ? 1 : 0) +
      (selectedStoreSetupCompleted ? 1 : 0)
    : 0;
  const showSetupBanner =
    selectedStoreShouldShowSetup && !hideSetupBannerForCurrentSelection;
  const selectedBilling = selectedStoreId
    ? billingByStore[selectedStoreId]
    : null;
  const selectedFreeRemaining = selectedStore
    ? calcRemainingDays(selectedStore.created_at)
    : null;
  const selectedPaidRemaining = calcPaidRemainingDays(
    selectedBilling?.paidUntil || null,
  );
  const selectedSubscriptionStatus =
    selectedBilling?.basePlanStatus === "active" ? "유료" : "무료";
  const selectedRemainingPeriod =
    selectedBilling?.basePlanStatus === "active"
      ? selectedPaidRemaining
      : selectedFreeRemaining;
  const selectedRemainingText =
    selectedRemainingPeriod == null ? "-" : `${selectedRemainingPeriod}일`;
  const dismissSetupBanner = () => {
    setHideSetupBannerForCurrentSelection(true);
  };

  useEffect(() => {
    if (!selectedStoreId) return;
    let mounted = true;
    (async () => {
      const [catRes, optRes, menuRes] = await Promise.all([
        supabase
          .from("menu_categories")
          .select("id", { count: "exact", head: true })
          .eq("store_id", selectedStoreId),
        supabase
          .from("option_groups")
          .select("id", { count: "exact", head: true })
          .eq("store_id", selectedStoreId),
        supabase
          .from("menu_items")
          .select("id", { count: "exact", head: true })
          .eq("store_id", selectedStoreId),
      ]);
      if (!mounted || catRes.error || optRes.error || menuRes.error) return;
      setSelectedStoreCounts({
        categories: Number(catRes.count || 0),
        options: Number(optRes.count || 0),
        menus: Number(menuRes.count || 0),
      });
    })();
    return () => {
      mounted = false;
    };
  }, [selectedStoreId]);

  if (booting) {
    return (
      <main className="wrap">
        <style jsx global>
          {baseCss}
        </style>
        <div className="card">
          <h1 className="h1">관리자</h1>
          <p className="muted">로딩 중...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <style jsx global>
        {baseCss}
      </style>

      <header className="topbar">
        <div>
          <h1 className="h1">관리자</h1>
        </div>

        <div className="topActions">
          <button
            className="btn"
            onClick={() => goPublic("/menu")}
            disabled={!selectedStoreId}
          >
            고객화면 보기
          </button>
          <button
            className="btn"
            onClick={() => goPublic("/staff")}
            disabled={!selectedStoreId}
          >
            직원화면 보기
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
            <strong>운영 전 필수 설정을 마무리해 주세요.</strong>
            <div className="muted">
              남은 단계를 완료하면 주문 운영을 시작할 수 있습니다.
            </div>
            {selectedStoreCounts ? (
              <div className="muted">
                현재 진행 단계: {selectedStoreCompletedSteps}/4
              </div>
            ) : null}
          </div>
          <div className="setupBannerActions">
            <button className="btn btnSetup btnSmall" onClick={goSetup}>
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
              <span className="pill">{visibleStores.length}개</span>
              <button className="btn" onClick={goCreate}>
                {stores.length > 0 ? "매장 추가" : "매장 만들기"}
              </button>
            </div>
          </div>

          <p className="muted">매장을 선택해 주세요.</p>
          {stores.length > 0 ? (
            <div
              className="storeFilterRow"
              role="tablist"
              aria-label="매장 상태 필터"
            >
              {[
                { key: "all", label: "전체" },
                { key: "active", label: "운영중" },
                { key: "setup", label: "설정중" },
                { key: "inactive", label: "비활성" },
              ].map((filter) => (
                <button
                  key={filter.key}
                  className={`filterChip ${storeStatusFilter === filter.key ? "filterChipOn" : ""}`.trim()}
                  type="button"
                  onClick={() =>
                    setStoreStatusFilter(filter.key as StoreStatusFilter)
                  }
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}

          {stores.length === 0 ? (
            <div className="emptyBox">
              <p className="muted">
                매장이 없습니다. 먼저 매장을 만들어주세요.
              </p>
            </div>
          ) : (
            <>
              {!selectedStoreId ? (
                <div className="muted">선택된 매장이 없습니다.</div>
              ) : null}
              {/* 2차 관리자 홈 보완: 선택 카드 높이를 안정적으로 유지하기 위해 선택 뱃지와 액션 버튼을 한 줄 영역에 묶습니다. */}
              <div className="storeList">
                {visibleStores.length === 0 ? (
                  <div className="emptyBox">
                    <p className="muted">선택한 상태의 매장이 없습니다.</p>
                  </div>
                ) : null}
                {visibleStores.map((s) => {
                  const on = s.store_id === selectedStoreId;
                  const remaining = calcRemainingDays(s.created_at);
                  const billing = billingByStore[s.store_id];
                  const paidRemaining = calcPaidRemainingDays(
                    billing?.paidUntil || null,
                  );
                  const remainingText = (days: number | null) =>
                    days == null ? "-" : `${days}일`;
                  const subscriptionStatus =
                    billing?.basePlanStatus === "active" ? "유료" : "무료";
                  const remainingPeriod =
                    billing?.basePlanStatus === "active"
                      ? remainingText(paidRemaining)
                      : remainingText(remaining);
                  const displayStatus = getStoreDisplayStatus(s);
                  const statusLabel = getStoreStatusLabel(s);
                  return (
                    <div
                      key={s.store_id}
                      className={`storeRow ${on ? "storeRowOn" : ""} ${displayStatus === "inactive" ? "storeRowInactive" : ""}`.trim()}
                      onClick={() => handleSelectStore(s.store_id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectStore(s.store_id);
                        }
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="storeNameLine">
                          <div className="storeName">
                            {s.store_name || "(이름 없음)"}
                          </div>
                          <span
                            className={`storeStatusBadge storeStatus${displayStatus[0].toUpperCase()}${displayStatus.slice(1)}`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <div className="muted">
                          {subscriptionStatus} · {remainingPeriod} 남음
                        </div>
                      </div>
                      <div
                        className="storeActions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {on ? <div className="pill pillOn">선택</div> : null}
                        {on && selectedStoreShouldShowSetup ? (
                          <button
                            className="btn btnSetup btnSmall"
                            onClick={goSetup}
                          >
                            초기설정
                          </button>
                        ) : null}
                        {on && !selectedStoreShouldShowSetup ? (
                          <button
                            className="btn btnBilling btnSmall"
                            onClick={() =>
                              router.push(
                                `/admin/billing/pay?store=${encodeURIComponent(s.store_id)}`,
                              )
                            }
                          >
                            구독결제
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                남은사용기간이 만료 되면 기능 사용이 제한 됩니다.
                <br />
                만료 전에 결제를 진행해 주세요.
              </p>
            </>
          )}
        </section>

        {/* ===== 관리자 메뉴 ===== */}
        <section className="card menuCard">
          {selectedStoreId ? (
            /* 2차 관리자 홈 보완: 별도 현재 매장 박스 대신 매장 현황 카드 안에서 선택 매장을 함께 표시합니다. */
            <div className="dashboardGrid" aria-label="관리자 홈 요약">
              <section className="overviewCard overviewCardSelected">
                <div className="overviewHead">
                  <h2 className="overviewTitle">매장 현황</h2>
                  <button
                    className="btn btnSmall"
                    onClick={() => go("/admin/stats")}
                  >
                    매출보기
                  </button>
                </div>
                <div className="overviewStoreLine">
                  <span className="currentStorePill">
                    {selectedStore
                      ? selectedStore.store_name || selectedStore.store_id
                      : "매장 미선택"}
                  </span>
                  {selectedStore ? (
                    <span
                      className={`storeStatusBadge storeStatus${getStoreDisplayStatus(selectedStore)[0].toUpperCase()}${getStoreDisplayStatus(selectedStore).slice(1)}`}
                    >
                      {getStoreStatusLabel(selectedStore)}
                    </span>
                  ) : null}
                </div>
                <div className="statsSummary statsSummaryCompact">
                  <div className="statsRow">
                    <span className="statsLabel">일간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.daily.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow">
                    <span className="statsLabel">주간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.weekly.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow">
                    <span className="statsLabel">월간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.monthly.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow">
                    <span className="statsLabel">구독 상태</span>
                    <span className="statsValue">
                      {selectedSubscriptionStatus} · {selectedRemainingText}
                    </span>
                  </div>
                  {statsErr ? (
                    <div className="hint">요약 로딩 실패: {statsErr}</div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          <div className="btnGroup">
            <button
              className={`cardBtn ${activeSection === "store" ? "cardBtnOn" : ""}`}
              onClick={() =>
                setActiveSection((prev) => (prev === "store" ? null : "store"))
              }
              disabled={!selectedStoreId}
            >
              <div className="cardBtnTitle">매장설정</div>
            </button>

            <button
              className={`cardBtn ${activeSection === "ops" ? "cardBtnOn" : ""}`}
              onClick={() =>
                setActiveSection((prev) => (prev === "ops" ? null : "ops"))
              }
              disabled={!selectedStoreId}
            >
              <div className="cardBtnTitle">메뉴설정</div>
            </button>

            <button
              className={`cardBtn ${activeSection === "support" ? "cardBtnOn" : ""}`}
              onClick={() =>
                setActiveSection((prev) =>
                  prev === "support" ? null : "support",
                )
              }
              disabled={!selectedStoreId}
            >
              <div className="cardBtnTitle">지원센터</div>
            </button>
          </div>

          {activeSection === "store" ? (
            <div className="subPanel" ref={subPanelRef}>
              <button className="subBtn" onClick={() => go("/admin/store")}>
                매장정보
              </button>
              <button className="subBtn" onClick={() => go("/admin/billing")}>
                결제 설정
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
            <div className="subPanel" ref={subPanelRef}>
              <button
                className="subBtn"
                onClick={() => go("/admin/categories")}
              >
                카테고리 관리
              </button>
              <button className="subBtn" onClick={() => go("/admin/options")}>
                옵션관리
              </button>
              <button className="subBtn" onClick={() => go("/admin/menu")}>
                메뉴관리
              </button>
              <button
                className="subBtn"
                onClick={() => go("/admin/menu/option-connect")}
              >
                옵션 연결 확인
              </button>
              <button className="subBtn" onClick={() => go("/admin/import")}>
                일괄 데이터 업로드
              </button>
            </div>
          ) : null}

          {activeSection === "support" ? (
            <div className="subPanel" ref={subPanelRef}>
              <button className="subBtn" onClick={() => go("/admin/support")}>
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
  width:100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 22px;
  display: grid;
  gap: 16px;
}
.adminLayout{
  display:grid;
  grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
  gap:16px;
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
  gap:8px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
.topActions .btn{
  padding:10px 12px;
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
  padding:16px;
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
.currentStorePill{
  min-width:0;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  border-radius:999px;
  border:1px solid #bfdbfe;
  background:#dbeafe;
  color:#1d4ed8;
  padding:7px 12px;
  font-size:13px;
  font-weight:950;
}
.dashboardGrid{
  display:grid;
  gap:10px;
  margin-top:12px;
}
.overviewCard{
  border:1px solid var(--line);
  background:#fff;
  border-radius:14px;
  padding:12px;
}
.overviewCardSelected{
  border-color:#bfdbfe;
  background:#eef4ff;
}
.overviewHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
}
.overviewStoreLine{
  display:flex;
  align-items:center;
  gap:6px;
  margin-top:8px;
  flex-wrap:wrap;
}
.overviewTitle{
  margin:0;
  font-size:16px;
  font-weight:950;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap:6px;
  margin-top:12px;
}
.btnPrimary{
  background:var(--brand);
  color:#fff;
  border-color:var(--brand);
}
.btnSetup{
  background:#eff6ff;
  color:#1d4ed8;
  border-color:#93c5fd;
}
.btnBilling{
  background:#1f2937;
  color:#fff;
  border-color:#1f2937;
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
.storeFilterRow{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  margin-top:10px;
}
.filterChip{
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  border-radius:999px;
  padding:7px 10px;
  font-size:12px;
  font-weight:950;
  cursor:pointer;
}
.filterChipOn{
  border-color:#111827;
  background:#111827;
  color:#fff;
}
.storeList{
  display:grid;
  gap:10px;
  margin-top:12px;
  max-height: min(62vh, 620px);
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
.storeRowInactive{
  background:#f8fafc;
}
.storeRow:focus-visible{
  outline:2px solid #93c5fd;
  outline-offset:2px;
}
.storeActions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
  flex-wrap:wrap;
}
.pillOn{
  background:#dbeafe;
  border-color:#bfdbfe;
  color:#1d4ed8;
}
.storeNameLine{
  min-width:0;
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.storeName{
  font-weight:950;
  font-size:14px;
}
.storeStatusBadge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  border-radius:999px;
  padding:3px 7px;
  font-size:11px;
  font-weight:950;
  border:1px solid #bfdbfe;
  background:#eff6ff;
  color:#1d4ed8;
}
.storeStatusSetup{
  border-color:#fed7aa;
  background:#fff7ed;
  color:#c2410c;
}
.storeStatusInactive{
  border-color:#cbd5e1;
  background:#f1f5f9;
  color:#475569;
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
  border:1px solid var(--line);
  background:#f9fafb;
  border-radius:14px;
  padding:10px;
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
.statsSummaryCompact{
  margin-top:10px;
  border:0;
  padding:0;
  background:transparent;
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
@media (max-width: 960px){
  .wrap{
    max-width: 760px;
    padding:18px;
  }
  .adminLayout{
    grid-template-columns: 1fr;
  }
  .storeList{
    max-height: min(46vh, 420px);
  }
  .menuCard{
    order:2;
  }
  .listCard{
    order:1;
  }
  .topbar{
    align-items:center;
  }
  .setupBanner{
    align-items:flex-start;
  }
}
@media (max-width: 640px){
  .adminLayout{
    grid-template-columns: 1fr;
  }
  .wrap{
    max-width: 100%;
    padding:12px;
    gap:12px;
  }
  .topbar{
    display:grid;
    align-items:start;
  }
  .topActions{
    display:grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap:6px;
    justify-content:stretch;
  }
  .topActions .btn{
    width:100%;
    padding:10px 8px;
    font-size:12px;
    white-space:nowrap;
  }
  .topActions .btn[href="/logout"]{
    grid-column:1 / -1;
  }
  .card{
    padding:14px;
    border-radius:14px;
  }
  .setupBannerActions{
    width:100%;
  }
  .setupBannerActions .btn{
    flex:1 1 140px;
  }
  .storeRow{
    display:grid;
  }
  .storeActions{
    justify-content:flex-start;
  }
  .cardBtnTitle{ font-size:12px; }
  .btnGroup{
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap:4px;
  }
  .cardBtn{
    padding:8px 4px;
  }
  .storeFilterRow{
  display:flex;
  gap:6px;
  flex-wrap:wrap;
  margin-top:10px;
}
.filterChip{
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  border-radius:999px;
  padding:7px 10px;
  font-size:12px;
  font-weight:950;
  cursor:pointer;
}
.filterChipOn{
  border-color:#111827;
  background:#111827;
  color:#fff;
}
.storeList{
    max-height: min(42vh, 360px);
  }
  .setupBanner{
    display:grid;
    gap:10px;
  }
}
@media (max-width: 360px){
  .btnGroup{
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <AdminPageInner />
    </Suspense>
  );
}
