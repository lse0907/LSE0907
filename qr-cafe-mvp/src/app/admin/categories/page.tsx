"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type MenuCategory = {
  id: string;
  store_id: string;
  name: string;
  sort_order: number | null;
  is_active: boolean | null;
};

type MenuItem = {
  id: string;
  name: string;
  category_id: string | null;
};

function uid(prefix = "cat") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function CategoriesPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreIdState] = useState("");
  const [cats, setCats] = useState<MenuCategory[]>([]);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [msg, setMsg] = useState("");

  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editSortOrder, setEditSortOrder] = useState("");

  useEffect(() => {
    const queryStore = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = queryStore || saved;
    setStoreIdState(sid);
    if (sid) setCurrentStoreId(sid);
  }, [sp]);

  const refresh = async () => {
    if (!storeId) return;
    setLoading(true);
    setMsg("");
    const [{ data: cData, error: cErr }, { data: mData, error: mErr }] = await Promise.all([
      supabase
        .from("menu_categories")
        .select("id,store_id,name,sort_order,is_active")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("menu_items").select("id,name,category_id").eq("store_id", storeId),
    ]);

    if (cErr) {
      setMsg(cErr.message);
      setCats([]);
    } else {
      setCats((Array.isArray(cData) ? cData : []) as MenuCategory[]);
    }

    if (mErr) {
      setMsg((prev) => prev || mErr.message);
      setMenus([]);
    } else {
      setMenus((Array.isArray(mData) ? mData : []) as MenuItem[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of menus) {
      const key = String(m.category_id || "");
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [menus]);

  const onCreate = async () => {
    if (!storeId || !name.trim()) return;
    setSaving(true);
    setMsg("");
    const row = {
      id: uid(),
      store_id: storeId,
      name: name.trim(),
      sort_order: sortOrder.trim() ? toInt(sortOrder, 0) : null,
      is_active: true,
    };
    const { error } = await supabase.from("menu_categories").insert([row]);
    if (error) setMsg(error.message);
    else {
      setName("");
      setSortOrder("");
      await refresh();
    }
    setSaving(false);
  };

  const startEdit = (cat: MenuCategory) => {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditSortOrder(cat.sort_order == null ? "" : String(cat.sort_order));
    setMsg("");
  };

  const cancelEdit = () => {
    setEditId("");
    setEditName("");
    setEditSortOrder("");
  };

  const onSaveEdit = async (cat: MenuCategory) => {
    if (!storeId || !editName.trim()) {
      setMsg("카테고리명을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMsg("");
    const { error } = await supabase
      .from("menu_categories")
      .update({
        name: editName.trim(),
        sort_order: editSortOrder.trim() ? toInt(editSortOrder, 0) : null,
      })
      .eq("id", cat.id)
      .eq("store_id", storeId);

    if (error) {
      setMsg(error.message);
      setSaving(false);
      return;
    }

    cancelEdit();
    await refresh();
    setSaving(false);
  };

  const onDisable = async (cat: MenuCategory) => {
    const { error } = await supabase
      .from("menu_categories")
      .update({ is_active: false })
      .eq("id", cat.id)
      .eq("store_id", storeId);
    if (error) return setMsg(error.message);
    await refresh();
  };

  const onDeleteWithReassign = async (cat: MenuCategory) => {
    const others = cats.filter((c) => c.id !== cat.id && c.is_active !== false);
    if (!others.length) {
      setMsg("재할당 가능한 카테고리가 없어 삭제할 수 없습니다. 먼저 다른 카테고리를 만들어주세요.");
      return;
    }
    const target = others[0].id;
    setSaving(true);
    setMsg("");
    const upd = await supabase
      .from("menu_items")
      .update({ category_id: target })
      .eq("store_id", storeId)
      .eq("category_id", cat.id);
    if (upd.error) {
      setSaving(false);
      return setMsg(upd.error.message);
    }

    const del = await supabase.from("menu_categories").delete().eq("id", cat.id).eq("store_id", storeId);
    if (del.error) setMsg(del.error.message);
    else await refresh();
    setSaving(false);
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root { color-scheme: light; }
        body { background: #f6f7f9; color: #111827; }
      `}</style>
      <style jsx>{`
        .wrap{max-width:900px;margin:0 auto;padding:14px;display:grid;gap:12px}
        .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:14px;display:grid;gap:10px}
        .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .btn{border:1px solid #d1d5db;background:#fff;color:#111827;-webkit-text-fill-color:currentColor;padding:10px 12px;border-radius:10px;font-weight:900;cursor:pointer}
        .btnPrimary{background:#111827;color:#fff;border-color:#111827}
        .input{border:1px solid #d1d5db;border-radius:10px;padding:10px 12px}
        .name{font-weight:900}
        .muted{color:#6b7280;font-size:12px;font-weight:800}
      `}</style>

      <header className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>카테고리 관리</h1>
        <div className="row">
          <button className="btn" onClick={() => router.push(storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")}>관리자</button>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <input className="input" placeholder="카테고리명" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" inputMode="numeric" style={{ width: 120 }} placeholder="순서" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          <button className="btn btnPrimary" onClick={onCreate} disabled={saving || loading || !name.trim()}>생성</button>
        </div>
        <p className="muted">삭제 정책: 재할당 강제(삭제 시 첫 번째 활성 카테고리로 메뉴 이동)</p>
        <p className="muted">생성 후에도 카테고리명/순서는 수정 가능합니다.</p>
        {msg ? <div style={{ color: "#b91c1c", fontWeight: 900 }}>{msg}</div> : null}
      </section>

      <section className="card">
        {loading ? <p className="muted">불러오는 중...</p> : cats.length === 0 ? <p className="muted">등록된 카테고리가 없습니다.</p> : (
          <div style={{ display: "grid", gap: 8 }}>
            {cats.map((cat) => {
              const isEditing = editId === cat.id;
              return (
                <div key={cat.id} className="row" style={{ justifyContent: "space-between", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    {isEditing ? (
                      <>
                        <input
                          className="input"
                          placeholder="카테고리명"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={saving || loading}
                        />
                        <input
                          className="input"
                          inputMode="numeric"
                          style={{ width: 120 }}
                          placeholder="순서"
                          value={editSortOrder}
                          onChange={(e) => setEditSortOrder(e.target.value)}
                          disabled={saving || loading}
                        />
                      </>
                    ) : (
                      <>
                        <div className="name">{cat.name} {cat.is_active === false ? "(비활성)" : ""}</div>
                        <div className="muted">순서 {cat.sort_order ?? "-"} · 메뉴 {countByCategory.get(cat.id) || 0}개</div>
                      </>
                    )}
                  </div>

                  <div className="row">
                    {isEditing ? (
                      <>
                        <button className="btn btnPrimary" onClick={() => onSaveEdit(cat)} disabled={saving || loading || !editName.trim()}>저장</button>
                        <button className="btn" onClick={cancelEdit} disabled={saving || loading}>취소</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" onClick={() => startEdit(cat)} disabled={saving || loading}>수정</button>
                        <button className="btn" onClick={() => onDisable(cat)} disabled={saving || loading || cat.is_active === false}>비활성화</button>
                        <button className="btn" onClick={() => onDeleteWithReassign(cat)} disabled={saving || loading}>삭제(재할당)</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

export default function CategoriesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>로딩 중...</div>}>
      <CategoriesPageInner />
    </Suspense>
  );
}
