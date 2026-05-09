"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { clearCurrentStoreId, getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type SetupStep = 0 | 1 | 2 | 3 | 4;

type StoreSetupRow = {
  store_id: string;
  store_name: string | null;
  setup_completed: boolean | null;
  setup_last_step: number | null;
};
type SetupCounts = {
  categories: number;
  options: number;
  menus: number;
};

const stepOrder: Array<{ step: SetupStep; title: string; desc: string; href?: string }> = [
  { step: 1, title: "카테고리 설정", desc: "카테고리를 먼저 등록하세요.", href: "/admin/categories" },
  { step: 2, title: "옵션 설정", desc: "옵션 그룹/항목을 등록하세요.", href: "/admin/options" },
  { step: 3, title: "메뉴 설정", desc: "메뉴를 등록하고 카테고리/옵션을 연결하세요.", href: "/admin/menu" },
];

function computeProgressStep(counts: SetupCounts): 1 | 2 | 3 {
  if (counts.categories < 1) return 1;
  if (counts.menus < 1) return 2;
  return 3;
}

function AdminSetupPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = (sp.get("store") || getCurrentStoreId() || "").trim();
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastStep, setLastStep] = useState<SetupStep>(0);
  const [msg, setMsg] = useState("");
  const [counts, setCounts] = useState<SetupCounts>({ categories: 0, options: 0, menus: 0 });

  useEffect(() => {
    if (!storeId) {
      router.replace("/admin");
      return;
    }
    setCurrentStoreId(storeId);
  }, [router, storeId]);

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      setMsg("");
      const { data, error } = await supabase
        .from("stores")
        .select("store_id,store_name,setup_completed,setup_last_step")
        .eq("store_id", storeId)
        .maybeSingle();

      if (!mounted) return;
      if (error) {
        setMsg(`초기 설정 정보 로드 실패: ${error.message}`);
        setLoading(false);
        return;
      }
      const row = (data || null) as StoreSetupRow | null;
      if (!row) {
        setMsg("매장 정보를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }
      setStoreName(String(row.store_name || ""));
      const step = Number(row.setup_last_step || 0);
      if (row.setup_completed) {
        setLastStep(4);
      } else if (step >= 1 && step <= 3) {
        setLastStep(step as SetupStep);
      } else {
        setLastStep(0);
      }
      setLoading(false);
    })();

    return () => {
      mounted = false;
    };
  }, [storeId]);

  const loadCounts = async (sid: string) => {
    const [catRes, optRes, menuRes] = await Promise.all([
      supabase.from("menu_categories").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("option_groups").select("id", { count: "exact", head: true }).eq("store_id", sid),
      supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("store_id", sid),
    ]);
    if (catRes.error || optRes.error || menuRes.error) return null;
    const next = {
      categories: Number(catRes.count || 0),
      options: Number(optRes.count || 0),
      menus: Number(menuRes.count || 0),
    };
    setCounts(next);
    return next;
  };

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const next = await loadCounts(storeId);
      if (!mounted || !next) return;
      setCounts(next);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId]);

  const saveStep = async (step: SetupStep) => {
    if (!storeId) return;
    setSaving(true);
    setMsg("");
    const payload = {
      setup_last_step: step,
      setup_completed: step >= 4,
      setup_completed_at: step >= 4 ? new Date().toISOString() : null,
    } as Record<string, unknown>;

    const { data: authData } = await supabase.auth.getUser();
    if (step >= 4 && authData?.user?.id) {
      payload.setup_completed_by = authData.user.id;
    }

    const { error } = await supabase.from("stores").update(payload).eq("store_id", storeId);
    if (error) {
      setMsg(`저장 실패: ${error.message}`);
      setSaving(false);
      return;
    }
    setLastStep(step);
    setSaving(false);
  };

  const onGoStep = async (step: SetupStep, href?: string) => {
    await saveStep(step);
    if (!href) return;
    router.push(`${href}?store=${encodeURIComponent(storeId)}`);
  };

  const onComplete = async () => {
    const latest = (await loadCounts(storeId)) || counts;
    if (latest.categories < 1) {
      setMsg("초기 설정 완료 전, 카테고리를 최소 1개 이상 등록해 주세요.");
      return;
    }
    if (latest.menus < 1) {
      setMsg("초기 설정 완료 전, 메뉴를 최소 1개 이상 등록해 주세요.");
      return;
    }
    await saveStep(4);
    router.push(`/admin?store=${encodeURIComponent(storeId)}`);
  };

  const progressStep = computeProgressStep(counts);

  const onSkipForNow = async () => {
    if (!storeId) return router.push("/admin");
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id || "";
    if (!uid) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const memRes = await supabase.from("store_members").select("store_id").eq("user_id", uid);
    if (memRes.error) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);
    const ids = (memRes.data || []).map((x: { store_id?: string | null }) => String(x.store_id || "")).filter(Boolean);
    if (!ids.length) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const storesRes = await supabase
      .from("stores")
      .select("store_id,setup_completed")
      .in("store_id", ids)
      .eq("setup_completed", true)
      .order("store_id", { ascending: true });
    if (storesRes.error) return router.push(`/admin?store=${encodeURIComponent(storeId)}`);

    const completedIds = (storesRes.data || [])
      .map((x: { store_id?: string | null }) => String(x.store_id || ""))
      .filter(Boolean);
    const fallbackStoreId = completedIds.find((id) => id !== storeId) || completedIds[0] || "";
    if (!fallbackStoreId) {
      clearCurrentStoreId();
      return router.push("/admin");
    }
    setCurrentStoreId(fallbackStoreId);
    return router.push(`/admin?store=${encodeURIComponent(fallbackStoreId)}`);
  };

  return (
    <main className="wrap">
      <h1>초기 설정</h1>
      <p className="muted">{storeName ? `${storeName} 매장` : "선택한 매장"}의 기본 설정을 완료해 주세요.</p>

      {loading ? <p>로딩 중...</p> : null}
      {!loading ? (
        <section className="card">
          <h2>진행 단계</h2>
          <p className="muted">진행률: {progressStep}/3</p>
          <div className="progressWrap" aria-hidden>
            <div className="progressFill" style={{ width: `${(progressStep / 3) * 100}%` }} />
          </div>
          <p className="muted">
            현재 등록 수 · 카테고리 {counts.categories}개 · 옵션그룹 {counts.options}개 · 메뉴 {counts.menus}개
          </p>
          <ul>
            {stepOrder.map((row) => {
              const done = row.step === 1 ? counts.categories > 0 : row.step === 2 ? counts.menus > 0 : counts.menus > 0;
              const current = !done && row.step === progressStep;
              return (
                <li key={row.step} className="stepItem">
                  <div>
                    <strong>
                      {row.step}. {row.title} {done ? "✅" : current ? "(진행 중)" : ""}
                    </strong>
                    <p className="muted">{row.desc}</p>
                  </div>
                  <button disabled={saving} onClick={() => onGoStep(row.step, row.href)}>
                    {done ? "다시 열기" : "바로 가기"}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="actions">
            <button disabled={saving} onClick={onSkipForNow}>
              나중에 하기
            </button>
            <button disabled={saving} onClick={onComplete}>
              초기 설정 완료
            </button>
          </div>
          {msg ? <p className="error">{msg}</p> : null}
        </section>
      ) : null}

      <style jsx>{`
        .wrap { max-width: 920px; margin: 0 auto; padding: 16px; }
        .muted { color: #6b7280; }
        .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; }
        ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
        .stepItem { display: flex; justify-content: space-between; gap: 12px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; }
        .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .progressWrap { height: 8px; border-radius: 999px; background: #f3f4f6; overflow: hidden; margin: 8px 0; }
        .progressFill { height: 100%; background: #111827; border-radius: 999px; transition: width .2s ease; }
        button { padding: 8px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; }
        .error { color: #b91c1c; margin-top: 8px; }
      `}</style>
    </main>
  );
}

export default function AdminSetupPage() {
  return (
    <Suspense fallback={<main style={{ padding: 16 }}>로딩 중...</main>}>
      <AdminSetupPageInner />
    </Suspense>
  );
}
