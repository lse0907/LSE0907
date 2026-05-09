"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type SetupStep = 0 | 1 | 2 | 3 | 4;

type StoreSetupRow = {
  store_id: string;
  store_name: string | null;
  setup_completed: boolean | null;
  setup_last_step: number | null;
};

const stepOrder: Array<{ step: SetupStep; title: string; desc: string; href?: string }> = [
  { step: 1, title: "카테고리 설정", desc: "카테고리를 먼저 등록하세요.", href: "/admin/categories" },
  { step: 2, title: "옵션 설정", desc: "옵션 그룹/항목을 등록하세요.", href: "/admin/options" },
  { step: 3, title: "메뉴 설정", desc: "메뉴를 등록하고 카테고리/옵션을 연결하세요.", href: "/admin/menu" },
];

function AdminSetupPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const storeId = (sp.get("store") || getCurrentStoreId() || "").trim();
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastStep, setLastStep] = useState<SetupStep>(0);
  const [msg, setMsg] = useState("");

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
    await saveStep(4);
    router.push(`/admin?store=${encodeURIComponent(storeId)}`);
  };

  return (
    <main className="wrap">
      <h1>초기 설정</h1>
      <p className="muted">{storeName ? `${storeName} 매장` : "선택한 매장"}의 기본 설정을 완료해 주세요.</p>

      {loading ? <p>로딩 중...</p> : null}
      {!loading ? (
        <section className="card">
          <h2>진행 단계</h2>
          <ul>
            {stepOrder.map((row) => {
              const done = lastStep > row.step || lastStep === 4;
              const current = lastStep === row.step;
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
            <button disabled={saving} onClick={() => router.push(`/admin?store=${encodeURIComponent(storeId)}`)}>
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
