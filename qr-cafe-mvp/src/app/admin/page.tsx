// src/app/admin/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import RionBrand from "@/app/components/RionBrand";
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

type StoreAddonSummary = {
  prepayAddonStatus: string;
  addonPaidUntil: string | null;
};

type OrderSummaryRow = {
  order_date?: string | null;
  total_price?: number | string | null;
};

type AdminIconName =
  | "plus"
  | "sales"
  | "store"
  | "menu"
  | "support"
  | "category"
  | "options"
  | "link"
  | "members"
  | "qr"
  | "loyalty"
  | "payment"
  | "daily"
  | "weekly"
  | "monthly"
  | "subscription"
  | "logout";

function AdminIcon({ name, size = 18 }: { name: AdminIconName; size?: number }) {
  const paths: Record<AdminIconName, ReactNode> = {
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    sales: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /><path d="M15 8h4v4" /></>,
    store: <><path d="M4 10v10h16V10" /><path d="M3 10 5 4h14l2 6" /><path d="M8 20v-6h8v6" /><path d="M3 10a3 3 0 0 0 5 2 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 5-2" /></>,
    menu: <><path d="M5 4h14v16H5z" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>,
    support: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .8-1 1.7" /><path d="M12 17h.01" /></>,
    category: <><path d="M4 6h6l2 2h8v10H4z" /><path d="M4 10h16" /></>,
    options: <><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></>,
    link: <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="7" r="3" /><circle cx="18" cy="17" r="3" /><path d="m8.7 10.7 6.5-2.4" /><path d="m8.7 13.3 6.5 2.4" /></>,
    members: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="18" cy="9" r="2" /><path d="M16 15.5a4 4 0 0 1 5 3.9" /></>,
    qr: <><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h2v2h-2z" /><path d="M18 14h2v6h-6v-2" /></>,
    loyalty: <><path d="M20 12v8H4v-8" /><path d="M2 8h20v4H2z" /><path d="M12 8v12" /><path d="M12 8H7.5A2.5 2.5 0 1 1 10 5.5Z" /><path d="M12 8h4.5A2.5 2.5 0 1 0 14 5.5Z" /></>,
    payment: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></>,
    daily: <><path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-7" /><path d="m4 6 6-3 6 4 4-3" /></>,
    weekly: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M3 10h18" /><path d="m8 15 2 2 5-5" /></>,
    monthly: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M3 10h18" /><path d="M7 14h2" /><path d="M11 14h2" /><path d="M15 14h2" /><path d="M7 18h2" /><path d="M11 18h2" /></>,
    subscription: <><path d="M12 3 4 7v5c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V7Z" /><path d="m9 12 2 2 4-4" /></>,
    logout: <><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" /><path d="m15 8 4 4-4 4M9 12h10" /></>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}

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

function hasActivePrepayAddon(addon?: StoreAddonSummary | null) {
  if (!addon) return false;
  const paidUntilMs = addon.addonPaidUntil
    ? new Date(addon.addonPaidUntil).getTime()
    : NaN;
  return (
    addon.prepayAddonStatus === "active" ||
    (Number.isFinite(paidUntilMs) && paidUntilMs > Date.now())
  );
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
  const [mobileStorePickerOpen, setMobileStorePickerOpen] = useState(false);
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
  const [addonByStore, setAddonByStore] = useState<
    Record<string, StoreAddonSummary>
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

    const [billingRes, addonRes, paymentRes] = await Promise.all([
      supabase
        .from("store_billing")
        .select("store_id, base_plan_status, paid_until")
        .in("store_id", ids),
      supabase
        .from("store_addons")
        .select("store_id, prepay_addon_status, addon_paid_until")
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
    if (addonRes.error) throw addonRes.error;
    if (paymentRes.error) throw paymentRes.error;

    const list = (storeRes.data || []) as StoreRow[];
    list.sort((a, b) =>
      String(a.store_name || "").localeCompare(String(b.store_name || "")),
    );

    const nextBilling: Record<string, StoreBillingSummary> = {};
    const nextAddons: Record<string, StoreAddonSummary> = {};
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

    for (const row of addonRes.data || []) {
      const storeId = String((row as { store_id: string }).store_id || "");
      if (!storeId) continue;
      nextAddons[storeId] = {
        prepayAddonStatus: String(
          (row as { prepay_addon_status?: string | null })
            .prepay_addon_status || "inactive",
        ),
        addonPaidUntil:
          String(
            (row as { addon_paid_until?: string | null }).addon_paid_until ||
              "",
          ).trim() || null,
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
    setAddonByStore(nextAddons);
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
    setMobileStorePickerOpen(false);
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
  const selectedAddon = selectedStoreId ? addonByStore[selectedStoreId] : null;
  const canOpenOnlinePaymentSettings = hasActivePrepayAddon(selectedAddon);
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
        <div className="loadingCard" role="status" aria-live="polite">
          <RionBrand product admin />
          <span className="loadingSpinner" aria-hidden="true" />
          <div>
            <h1 className="loadingTitle">매장 관리 공간을 준비하고 있어요</h1>
            <p className="muted">
              매장과 운영 정보를 안전하게 불러오는 중입니다.
            </p>
          </div>
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
        <div className="brandArea">
          <RionBrand product admin />
          <span className="adminBadge">STORE ADMIN</span>
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
          <a className="btn" href="/logout" aria-label="로그아웃">
            <AdminIcon name="logout" size={16} />
            <span>로그아웃</span>
          </a>
        </div>
      </header>

      <section className="welcomeHero" aria-labelledby="admin-home-title">
        <div className="welcomeCopy">
          <span className="eyebrow">RION ORDER WORKSPACE</span>
          <h1 className="h1" id="admin-home-title">
            매장 운영의 모든 순간을
            <br className="desktopBreak" /> 한곳에서 관리하세요.
          </h1>
          <strong className="mobileWelcome">
            오늘도 매장 운영을 시작해 볼까요?
          </strong>
          <p className="desc">
            오늘의 매출부터 메뉴와 QR 설정까지, 필요한 업무를 빠르게 시작할 수
            있습니다.
          </p>
        </div>
        <div className="heroStore" aria-label="현재 선택 매장">
          <span className="heroStoreLabel">현재 관리 매장</span>
          <strong>
            {selectedStore
              ? selectedStore.store_name || selectedStore.store_id
              : "매장을 선택해 주세요"}
          </strong>
          {selectedStore ? (
            <span
              className={`heroStatus heroStatus${getStoreDisplayStatus(selectedStore)[0].toUpperCase()}${getStoreDisplayStatus(selectedStore).slice(1)}`}
            >
              <i aria-hidden="true" /> {getStoreStatusLabel(selectedStore)}
            </span>
          ) : (
            <span className="heroStatus heroStatusNeutral">
              <i aria-hidden="true" /> 선택 대기
            </span>
          )}
        </div>
      </section>

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
            <button className="btn btnSetup btnSmall setupBannerPrimary" onClick={goSetup}>
              초기 설정 계속하기
            </button>
            <button className="btn btnSmall setupBannerSecondary" onClick={dismissSetupBanner}>
              나중에 하기
            </button>
          </div>
        </div>
      ) : null}

      <div className="adminLayout">
        <section
          className={`card listCard ${mobileStorePickerOpen ? "storePickerOpen" : "storePickerClosed"}`}
        >
          <div className="cardHead">
            <div>
              <span className="sectionLabel">MY STORES</span>
              <h2 className="cardTitle">내 매장</h2>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="pill">{visibleStores.length}개</span>
              <button className="btn" onClick={goCreate}>
                <AdminIcon name="plus" size={15} />
                {stores.length > 0 ? "매장 추가" : "매장 만들기"}
              </button>
            </div>
          </div>

          <p className="muted sectionDesc">
            관리할 매장을 선택하면 오른쪽의 운영 도구가 활성화됩니다.
          </p>
          {stores.length > 0 ? (
            <button
              className="mobileStoreToggle"
              type="button"
              aria-expanded={mobileStorePickerOpen}
              aria-controls="admin-store-picker"
              onClick={() => setMobileStorePickerOpen((open) => !open)}
            >
              <span>
                <small>현재 관리 매장</small>
                <strong>
                  {selectedStore
                    ? selectedStore.store_name || selectedStore.store_id
                    : "매장을 선택해 주세요"}
                </strong>
              </span>
              <span className="mobileStoreToggleAction">
                {mobileStorePickerOpen ? "닫기" : "매장 변경"}
              </span>
            </button>
          ) : null}
          <div id="admin-store-picker" className="storePickerDetails">
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
                            className="btn btnSetup btnSmall storeActionButton"
                            onClick={goSetup}
                          >
                            초기설정
                          </button>
                        ) : null}
                        {on && !selectedStoreShouldShowSetup ? (
                          <button
                            className="btn btnBilling btnSmall storeActionButton"
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
          </div>
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
                    <AdminIcon name="sales" size={15} />
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
                <div
                  className="statsSummary statsSummaryCompact"
                  aria-label="매장 핵심 지표"
                >
                  <div className="statsRow statsDaily">
                    <span className="statsIcon" aria-hidden="true">
                      <AdminIcon name="daily" size={14} />
                    </span>
                    <span className="statsLabel">일간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.daily.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow statsWeekly">
                    <span className="statsIcon" aria-hidden="true">
                      <AdminIcon name="weekly" size={14} />
                    </span>
                    <span className="statsLabel">주간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.weekly.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow statsMonthly">
                    <span className="statsIcon" aria-hidden="true">
                      <AdminIcon name="monthly" size={14} />
                    </span>
                    <span className="statsLabel">월간 매출</span>
                    <span className="statsValue">
                      {statsLoading
                        ? "로딩중..."
                        : `${statsSummary.monthly.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="statsRow statsBilling">
                    <span className="statsIcon" aria-hidden="true">
                      <AdminIcon name="subscription" size={14} />
                    </span>
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

          <div className="toolsHead">
            <div>
              <span className="sectionLabel">QUICK TOOLS</span>
              <h2 className="cardTitle">빠른 관리</h2>
            </div>
            <p>업무 영역을 선택해 필요한 기능으로 이동하세요.</p>
          </div>

          <div className="btnGroup">
            <button
              className={`cardBtn ${activeSection === "store" ? "cardBtnOn" : ""}`}
              onClick={() =>
                setActiveSection((prev) => (prev === "store" ? null : "store"))
              }
              disabled={!selectedStoreId}
            >
              <span className="cardBtnIcon" aria-hidden="true">
                <AdminIcon name="store" size={20} />
              </span>
              <span className="cardBtnCopy">
                <span className="cardBtnTitle">매장 관리</span>
                <span className="cardBtnDesc">정보 · 직원 · QR</span>
              </span>
              <span className="cardBtnArrow" aria-hidden="true">
                ›
              </span>
            </button>

            <button
              className={`cardBtn ${activeSection === "ops" ? "cardBtnOn" : ""}`}
              onClick={() =>
                setActiveSection((prev) => (prev === "ops" ? null : "ops"))
              }
              disabled={!selectedStoreId}
            >
              <span className="cardBtnIcon" aria-hidden="true">
                <AdminIcon name="menu" size={20} />
              </span>
              <span className="cardBtnCopy">
                <span className="cardBtnTitle">메뉴 관리</span>
                <span className="cardBtnDesc">카테고리 · 옵션 · 메뉴</span>
              </span>
              <span className="cardBtnArrow" aria-hidden="true">
                ›
              </span>
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
              <span className="cardBtnIcon" aria-hidden="true">
                <AdminIcon name="support" size={20} />
              </span>
              <span className="cardBtnCopy">
                <span className="cardBtnTitle">지원 센터</span>
                <span className="cardBtnDesc">문의 및 문제 해결</span>
              </span>
              <span className="cardBtnArrow" aria-hidden="true">
                ›
              </span>
            </button>
          </div>

          {activeSection === "store" ? (
            <div className="subPanel shortcutPanel" ref={subPanelRef}>
              <button className="shortcutCard" onClick={() => go("/admin/store")}>
                <span className="shortcutIcon"><AdminIcon name="store" /></span>
                <span className="shortcutCopy"><strong>매장 정보</strong><small>기본 정보와 운영 설정</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button className="shortcutCard" onClick={() => go("/admin/members")}>
                <span className="shortcutIcon shortcutIconGreen"><AdminIcon name="members" /></span>
                <span className="shortcutCopy"><strong>직원·권한</strong><small>직원 등록과 접근 권한</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button className="shortcutCard" onClick={() => go("/admin/qr")}>
                <span className="shortcutIcon shortcutIconPurple"><AdminIcon name="qr" /></span>
                <span className="shortcutCopy"><strong>매장 QR</strong><small>테이블 주문 QR 생성</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button className="shortcutCard" onClick={() => go("/admin/loyalty")}>
                <span className="shortcutIcon shortcutIconOrange"><AdminIcon name="loyalty" /></span>
                <span className="shortcutCopy"><strong>포인트·쿠폰</strong><small>적립과 고객 혜택 설정</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button
                className={`shortcutCard ${canOpenOnlinePaymentSettings ? "" : "shortcutCardDisabled"}`}
                onClick={() => {
                  if (canOpenOnlinePaymentSettings) {
                    go("/admin/billing");
                    return;
                  }
                  setMsg("온라인 결제 설정은 선결제 옵션 구독 후 사용할 수 있습니다.");
                }}
                type="button"
              >
                <span className="shortcutIcon shortcutIconPayment"><AdminIcon name="payment" /></span>
                <span className="shortcutCopy">
                  <strong>온라인 결제{canOpenOnlinePaymentSettings ? "" : " · 잠김"}</strong>
                  <small>{canOpenOnlinePaymentSettings ? "선결제와 결제 설정" : "선결제 옵션 구독 후 사용 가능"}</small>
                </span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
            </div>
          ) : null}

          {activeSection === "ops" ? (
            <div className="subPanel shortcutPanel" ref={subPanelRef}>
              <button className="shortcutCard" onClick={() => go("/admin/categories")}>
                <span className="shortcutIcon"><AdminIcon name="category" /></span>
                <span className="shortcutCopy"><strong>카테고리</strong><small>분류와 노출 순서</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button className="shortcutCard" onClick={() => go("/admin/options")}>
                <span className="shortcutIcon shortcutIconGreen"><AdminIcon name="options" /></span>
                <span className="shortcutCopy"><strong>옵션</strong><small>사이즈와 추가 선택</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              <button className="shortcutCard" onClick={() => go("/admin/menu")}>
                <span className="shortcutIcon shortcutIconPurple"><AdminIcon name="menu" /></span>
                <span className="shortcutCopy"><strong>메뉴</strong><small>상품과 판매 정보</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
              </button>
              {(selectedStoreCounts?.menus || 0) > 0 ? (
                <button className="shortcutCard" onClick={() => go("/admin/menu/option-connect")}>
                  <span className="shortcutIcon shortcutIconOrange"><AdminIcon name="link" /></span>
                  <span className="shortcutCopy"><strong>옵션 연결 확인</strong><small>메뉴별 연결 상태와 일괄 설정</small></span>
                  <span className="shortcutArrow" aria-hidden="true">›</span>
                </button>
              ) : null}
            </div>
          ) : null}

          {activeSection === "support" ? (
            <div className="subPanel shortcutPanel" ref={subPanelRef}>
              <button className="shortcutCard" onClick={() => go("/admin/support")}>
                <span className="shortcutIcon"><AdminIcon name="support" /></span>
                <span className="shortcutCopy"><strong>문의하기</strong><small>운영 중 궁금한 점과 문제 해결</small></span>
                <span className="shortcutArrow" aria-hidden="true">›</span>
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
  --bg: #f3f6fb;
  --card: #ffffff;
  --text: #14213d;
  --muted: #667085;
  --line: #e4e9f2;
  --brand: #0f1f3d;
  --brand-blue: #2563eb;
  --brand-soft: #eef4ff;
  --radius: 22px;
}
body {
  background:
    radial-gradient(circle at 8% 0%, rgba(37,99,235,.08), transparent 26rem),
    var(--bg);
  color: var(--text);
}
.button, button, a { -webkit-tap-highlight-color: transparent; }
.wrap{
  width:100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid;
  gap: 20px;
}
.adminLayout{
  display:grid;
  grid-template-columns: minmax(310px, 370px) minmax(0, 1fr);
  gap:20px;
  align-items:start;
}
.topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  min-height:52px;
}
.brandArea{
  display:flex;
  align-items:center;
  gap:12px;
  min-width:0;
}
.adminBadge{
  display:inline-flex;
  align-items:center;
  min-height:25px;
  padding:0 9px;
  border:1px solid #cbd8ef;
  border-radius:999px;
  background:rgba(255,255,255,.72);
  color:#49617f;
  font-size:10px;
  font-weight:900;
  letter-spacing:.08em;
  white-space:nowrap;
}
.topActions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  justify-content:flex-end;
}
.topActions .btn{
  min-height:40px;
  padding:10px 13px;
  border-radius:12px;
  font-size:clamp(12px, 0.75vw, 13px);
}
.welcomeHero{
  position:relative;
  overflow:hidden;
  isolation:isolate;
  min-height:230px;
  padding:34px 38px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:32px;
  border-radius:28px;
  color:#fff;
  background:linear-gradient(125deg,#0c1b35 0%,#132d59 57%,#1f55a8 100%);
  box-shadow:0 24px 60px rgba(15,31,61,.2);
}
.welcomeHero::before{
  content:"";
  position:absolute;
  z-index:-1;
  width:330px;
  height:330px;
  right:-80px;
  top:-190px;
  border-radius:50%;
  border:70px solid rgba(255,255,255,.055);
}
.welcomeHero::after{
  content:"";
  position:absolute;
  z-index:-1;
  width:220px;
  height:220px;
  left:47%;
  bottom:-185px;
  border-radius:50%;
  background:rgba(80,145,255,.16);
}
.welcomeCopy{ max-width:650px; }
.mobileWelcome,.mobileStoreToggle{ display:none; }
.eyebrow,.sectionLabel{
  display:block;
  color:#7baaff;
  font-size:10px;
  line-height:1.2;
  font-weight:900;
  letter-spacing:.13em;
}
.h1{
  margin:12px 0 0;
  font-size:clamp(28px, 3.1vw, 43px);
  line-height:1.2;
  font-weight:900;
  letter-spacing:-.045em;
  word-break:keep-all;
}
.desc{
  margin:15px 0 0;
  max-width:560px;
  color:#c8d7ed;
  font-size:clamp(13px, 1.2vw, 15px);
  font-weight:650;
  line-height:1.65;
  word-break:keep-all;
}
.heroStore{
  width:min(275px,32%);
  min-width:230px;
  padding:22px;
  display:grid;
  gap:8px;
  border:1px solid rgba(255,255,255,.16);
  border-radius:20px;
  background:rgba(255,255,255,.1);
  box-shadow:inset 0 1px rgba(255,255,255,.08);
  backdrop-filter:blur(12px);
}
.heroStoreLabel{ color:#aebed6; font-size:11px; font-weight:800; }
.heroStore strong{ overflow:hidden; color:#fff; font-size:18px; text-overflow:ellipsis; white-space:nowrap; }
.heroStatus{ display:flex; align-items:center; gap:6px; color:#a7f3d0; font-size:12px; font-weight:850; }
.heroStatus i{ width:7px; height:7px; border-radius:50%; background:#34d399; box-shadow:0 0 0 4px rgba(52,211,153,.13); }
.heroStatusSetup{ color:#fed7aa; }
.heroStatusSetup i{ background:#fb923c; box-shadow:0 0 0 4px rgba(251,146,60,.14); }
.heroStatusInactive,.heroStatusNeutral{ color:#d4dbe7; }
.heroStatusInactive i,.heroStatusNeutral i{ background:#94a3b8; box-shadow:0 0 0 4px rgba(148,163,184,.13); }
.muted{
  color:var(--muted);
  font-weight:650;
  font-size:clamp(12px, 0.85vw, 13px);
  line-height:1.55;
}
.card{
  background:var(--card);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:22px;
  box-shadow:0 10px 28px rgba(30,55,90,.055);
}
.loadingCard{ min-height:320px; padding:40px; display:grid; place-items:center; align-content:center; gap:20px; text-align:center; border:1px solid var(--line); border-radius:28px; background:#fff; box-shadow:0 20px 50px rgba(30,55,90,.08); }
.loadingTitle{ margin:0 0 5px; font-size:20px; letter-spacing:-.03em; }
.loadingSpinner{ width:28px; height:28px; border:3px solid #dce6f5; border-top-color:var(--brand-blue); border-radius:50%; animation:adminSpin .8s linear infinite; }
@keyframes adminSpin{ to{ transform:rotate(360deg); } }
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
  margin:5px 0 0;
  font-size:clamp(18px, 1.5vw, 21px);
  font-weight:900;
  letter-spacing:-.025em;
}
.sectionLabel{ color:#4675bd; }
.sectionDesc{ margin-top:12px; }
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
  border-radius:16px;
  padding:13px 15px;
  font-weight:800;
}
.setupBanner{
  border:1px solid #fde68a;
  background:linear-gradient(90deg,#fffbeb,#fffdf5);
  color:#92400e;
  border-radius:18px;
  padding:16px 18px;
  display:flex;
  justify-content:space-between;
  gap:12px;
}
.setupBannerActions{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.setupBannerPrimary{
  min-height:36px;
  padding:7px 11px;
  font-size:12px;
  border-radius:9px;
}
.setupBannerSecondary{
  min-height:34px;
  padding:6px 9px;
  border-color:transparent;
  background:transparent;
  color:#7c6547;
  font-size:12px;
  border-radius:9px;
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
  border:1px solid #c8d9f6;
  background:#fff;
  color:#214f96;
  padding:7px 12px;
  font-size:13px;
  font-weight:950;
}
.dashboardGrid{
  display:grid;
  gap:10px;
}
.overviewCard{
  border:1px solid var(--line);
  background:#fff;
  border-radius:18px;
  padding:18px;
}
.overviewCardSelected{
  border-color:#d5e1f3;
  background:linear-gradient(145deg,#f8fbff,#f2f6fc);
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
  font-size:clamp(17px, 1.2vw, 19px);
  font-weight:900;
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
  appearance:none;
  -webkit-appearance:none;
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  -webkit-text-fill-color: currentColor;
  min-height:42px;
  padding:10px 14px;
  border-radius:12px;
  cursor:pointer;
  font-family:inherit;
  font-weight:850;
  font-size:clamp(13px, 0.95vw, 14px);
  line-height:1.2;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  text-decoration:none;
  transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease,background .18s ease;
}
.btn:hover:not(:disabled){ border-color:#b8c8df; box-shadow:0 5px 14px rgba(30,55,90,.08); transform:translateY(-1px); }
.btnGroup{
  display:grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap:10px;
  margin-top:14px;
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
  background:var(--brand);
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
  font-weight:850;
  cursor:pointer;
}
.filterChipOn{
  border-color:var(--brand);
  background:var(--brand);
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
  border-radius:16px;
  padding:14px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
  transition:border-color .18s ease,background .18s ease,box-shadow .18s ease,transform .18s ease;
}
.storeRow:hover{ border-color:#c3d1e5; box-shadow:0 7px 18px rgba(30,55,90,.07); transform:translateY(-1px); }
.storeRowOn{
  border:2px solid #477cc7;
  background:var(--brand-soft);
  box-shadow:0 8px 20px rgba(37,99,235,.09);
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
.storeActionButton{
  min-height:34px;
  padding:6px 9px;
  border-radius:9px;
  font-size:12px;
  line-height:1;
  box-shadow:none;
  white-space:nowrap;
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
  font-weight:900;
  font-size:clamp(13px, 0.95vw, 14px);
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
  min-width:0;
  min-height:92px;
  text-align:left;
  border:1px solid var(--line);
  background:#fff;
  color:var(--text);
  -webkit-text-fill-color: currentColor;
  border-radius:17px;
  padding:14px;
  cursor:pointer;
  display:grid;
  grid-template-columns:38px minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease,background .18s ease;
}
.cardBtn:hover:not(:disabled){ border-color:#b8c8df; box-shadow:0 8px 20px rgba(30,55,90,.08); transform:translateY(-2px); }
.cardBtn:disabled{
  opacity:.5;
  cursor:not-allowed;
}
.cardBtnOn{
  background:linear-gradient(135deg,var(--brand),#173967);
  color:#fff;
  border-color:var(--brand);
}
.cardBtnOn .cardBtnDesc{
  color:#b9cae3;
}
.cardBtnIcon{ width:38px; height:38px; display:grid; place-items:center; border-radius:12px; background:#edf3fb; color:#234c83; font-size:20px; font-weight:900; }
.cardBtnOn .cardBtnIcon{ background:rgba(255,255,255,.12); color:#fff; }
.cardBtnCopy{ min-width:0; display:grid; gap:4px; }
.cardBtnTitle{
  margin:0;
  font-size:clamp(13px, 1vw, 15px);
  font-weight:900;
  line-height:1.2;
  white-space:nowrap;
}
.cardBtnDesc{ overflow:hidden; color:#7b879b; font-size:11px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
.cardBtnArrow{ color:#9aa8ba; font-size:24px; line-height:1; transform:rotate(90deg); transition:transform .18s ease; }
.cardBtnOn .cardBtnArrow{ color:#fff; transform:rotate(-90deg); }
.toolsHead{ margin-top:22px; display:flex; align-items:end; justify-content:space-between; gap:16px; }
.toolsHead p{ margin:0; color:var(--muted); font-size:12px; font-weight:650; }
.subPanel{
  margin-top:14px;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:9px;
  border:1px solid var(--line);
  background:#f6f8fc;
  border-radius:18px;
  padding:12px;
}
.shortcutPanel{ grid-template-columns:repeat(2,minmax(0,1fr)); background:linear-gradient(180deg,#f8fafe 0%,#f3f6fb 100%); }
.shortcutCard{ appearance:none; min-width:0; min-height:68px; padding:10px 11px; display:grid; grid-template-columns:34px minmax(0,1fr) auto; align-items:center; gap:9px; border:1px solid var(--line); border-radius:14px; background:#fff; color:var(--text); cursor:pointer; font-family:inherit; text-align:left; transition:border-color .18s ease,box-shadow .18s ease,transform .18s ease,background .18s ease; }
.shortcutCard:hover:not(.shortcutCardDisabled){ border-color:#aec4e1; box-shadow:0 8px 20px rgba(27,61,103,.09); transform:translateY(-1px); }
.shortcutIcon{ width:34px; height:34px; display:grid; place-items:center; border-radius:11px; background:#eaf2ff; color:#235da8; }
.shortcutIconGreen{ background:#ecf9f2; color:#168657; }
.shortcutIconPurple{ background:#f2edff; color:#7650c7; }
.shortcutIconOrange{ background:#fff2e8; color:#b95d1d; }
.shortcutIconPayment{ background:#edf1f7; color:#405a7c; }
.shortcutCopy{ min-width:0; display:grid; gap:3px; }
.shortcutCopy strong{ overflow:hidden; color:var(--text); font-size:12px; font-weight:900; text-overflow:ellipsis; white-space:nowrap; }
.shortcutCopy small{ overflow:hidden; color:#78869a; font-size:9px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
.shortcutArrow{ color:#93a5bb; font-size:20px; }
.shortcutCardDisabled{ background:#f7f8fa; opacity:.76; }
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
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:9px;
}
.statsRow{
  min-width:0;
  min-height:105px;
  padding:13px;
  display:grid;
  align-content:start;
  gap:7px;
  border:1px solid #e3e9f2;
  border-radius:15px;
  background:#fff;
  font-weight:850;
}
.statsIcon{ width:27px; height:27px; display:grid; place-items:center; border-radius:9px; background:#edf4ff; color:#2563eb; font-size:12px; font-weight:900; }
.statsWeekly .statsIcon{ background:#f0fdf4; color:#15803d; }
.statsMonthly .statsIcon{ background:#f5f3ff; color:#7c3aed; }
.statsBilling .statsIcon{ background:#fff7ed; color:#c2410c; }
.statsLabel{
  color:var(--muted);
  font-size:12px;
}
.statsValue{
  overflow:hidden;
  font-size:clamp(13px,1.25vw,17px);
  letter-spacing:-.03em;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.stickyCard{
  position:sticky;
  top:10px;
  z-index:5;
}
@media (max-width: 960px){
  .wrap{
    max-width: 900px;
    padding:18px;
  }
  .adminLayout{
    grid-template-columns:minmax(245px,280px) minmax(0,1fr);
    gap:14px;
  }
  .storeList{
    max-height:min(57vh,560px);
  }
  .topbar{
    align-items:center;
  }
  .welcomeHero{ min-height:174px; padding:24px 28px; }
  .heroStore{ width:235px; min-width:210px; padding:17px; }
  .h1{ margin-top:8px; font-size:clamp(25px,3.5vw,34px); }
  .desc{ margin-top:9px; font-size:13px; }
  .card{ padding:17px; }
  .statsSummaryCompact{ grid-template-columns:repeat(2,minmax(0,1fr)); }
  .statsRow{ min-height:86px; padding:10px; gap:4px; }
  .cardBtn{ min-height:78px; padding:11px; grid-template-columns:34px minmax(0,1fr) auto; gap:7px; }
  .cardBtnIcon{ width:34px; height:34px; }
  .setupBanner{
    align-items:flex-start;
  }
}
@media (max-width: 740px){
  .adminLayout{ grid-template-columns:1fr; }
  .menuCard{ order:2; }
  .listCard{ order:1; }
  .mobileStoreToggle{
    width:100%;
    margin-top:12px;
    padding:12px 13px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    border:1px solid #cbd9ee;
    border-radius:14px;
    background:#f7faff;
    color:var(--text);
    text-align:left;
    cursor:pointer;
  }
  .mobileStoreToggle > span:first-child{ min-width:0; display:grid; gap:3px; }
  .mobileStoreToggle small{ color:var(--muted); font-size:10px; font-weight:750; }
  .mobileStoreToggle strong{ overflow:hidden; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }
  .mobileStoreToggleAction{ flex:0 0 auto; color:#245da9; font-size:12px; font-weight:900; }
  .storePickerClosed .storePickerDetails{ display:none; }
  .storePickerOpen .storePickerDetails{ display:block; }
  .storePickerOpen .storeList{ max-height:min(44vh,360px); }
}
@media (max-width: 640px){
  .adminLayout{
    grid-template-columns: 1fr;
  }
  .wrap{
    max-width: 100%;
    padding:14px 14px calc(32px + env(safe-area-inset-bottom));
    gap:14px;
  }
  .topbar{
    display:flex;
    align-items:center;
    flex-wrap:wrap;
    gap:10px;
  }
  .brandArea{
    flex:1 1 auto;
  }
  .topActions{
    width:100%;
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:7px;
  }
  .topActions .btn{
    width:100%;
    min-height:42px;
    padding:8px 7px;
    font-size:12px;
    white-space:nowrap;
  }
  .adminBadge{ display:none; }
  .welcomeHero{ min-height:0; padding:16px; display:grid; grid-template-columns:minmax(0,.9fr) minmax(158px,1.1fr); gap:12px; border-radius:19px; }
  .welcomeHero::before{ width:240px; height:240px; right:-100px; top:-150px; border-width:50px; }
  .welcomeCopy{ display:flex; align-items:center; }
  .welcomeCopy .eyebrow,.welcomeCopy .h1,.welcomeCopy .desc{ display:none; }
  .mobileWelcome{ display:block; color:#fff; font-size:clamp(16px,4.6vw,20px); line-height:1.4; letter-spacing:-.035em; word-break:keep-all; }
  .heroStore{ width:100%; min-width:0; padding:13px; border-radius:15px; }
  .heroStoreLabel{ font-size:10px; }
  .heroStore strong{ font-size:15px; }
  .card{
    padding:17px;
    border-radius:19px;
  }
  .setupBannerActions{
    width:100%;
  }
  .setupBannerActions .btn{
    flex:0 1 auto;
  }
  .storeRow{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:8px;
  }
  .storeRow > div:first-child{
    min-width:0;
    flex:1 1 auto;
  }
  .storeActions{
    flex:0 0 auto;
    flex-direction:column;
    align-items:center;
    justify-content:flex-start;
    gap:4px;
    margin-left:auto;
    min-width:72px;
  }
  .storeActions .pill,
  .storeActions .btnSmall{
    line-height:1;
    white-space:nowrap;
  }
  .storeActions .pill{
    padding:6px 9px;
    font-size:11px;
  }
  .storeActions .btnSmall{
    min-height:36px;
    padding:7px 9px;
    font-size:11px;
  }
  .btnGroup{
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:6px;
  }
  .cardBtn{
    min-height:82px;
    padding:9px 5px;
    display:flex;
    flex-direction:column;
    justify-content:center;
    text-align:center;
    gap:6px;
  }
  .cardBtnCopy{ display:block; }
  .cardBtnTitle{ font-size:12px; }
  .cardBtnDesc,.cardBtnArrow{ display:none; }
  .cardBtnIcon{ width:32px; height:32px; border-radius:10px; font-size:17px; }
  .toolsHead{ align-items:start; }
  .toolsHead p{ display:none; }
  .subPanel{ grid-template-columns:1fr; }
  .shortcutPanel{ grid-template-columns:repeat(2,minmax(0,1fr)); padding:8px; gap:7px; }
  .shortcutCard{ min-height:58px; padding:8px; grid-template-columns:29px minmax(0,1fr); gap:7px; }
  .shortcutIcon{ width:29px; height:29px; border-radius:9px; }
  .shortcutIcon svg{ width:16px; height:16px; }
  .shortcutCopy strong{ font-size:11px; }
  .shortcutCopy small{ font-size:8px; }
  .shortcutArrow{ display:none; }
  .statsSummaryCompact{ grid-template-columns:repeat(2,minmax(0,1fr)); }
  .statsRow{ min-height:74px; padding:9px; grid-template-columns:22px minmax(0,1fr); align-items:center; gap:3px 6px; }
  .statsIcon{ width:22px; height:22px; border-radius:7px; font-size:10px; grid-row:1/3; }
  .statsLabel{ font-size:10px; }
  .statsValue{ font-size:13px; }
  .storeList{
    max-height: min(42vh, 360px);
  }
  .setupBanner{
    display:grid;
    gap:10px;
  }
}
@media (max-width: 360px){
  .topActions .btn{ padding-inline:4px; font-size:11px; }
  .welcomeHero{ grid-template-columns:1fr; }
  .mobileWelcome{ display:none; }
  .statsSummaryCompact{ grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (prefers-reduced-motion:reduce){
  .btn,.cardBtn,.shortcutCard,.storeRow{ transition:none; }
  .loadingSpinner{ animation-duration:1.8s; }
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
