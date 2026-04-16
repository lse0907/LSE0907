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
type MyStore = {
  store_id: string;
  store_name: string | null;
};

function uid(prefix = "cat") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
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
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"error" | "success" | "neutral">("neutral");
  const [myStores, setMyStores] = useState<MyStore[]>([]);
  const [copySourceStoreId, setCopySourceStoreId] = useState("");
  const [copying, setCopying] = useState(false);

  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [orderDirty, setOrderDirty] = useState(false);
  const actionBusy = saving || copying;

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
    setMsgTone("neutral");
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
      setMsgTone("error");
      setMsg(cErr.message);
      setCats([]);
    } else {
      setCats((Array.isArray(cData) ? cData : []) as MenuCategory[]);
      setOrderDirty(false);
    }

    if (mErr) {
      setMsgTone("error");
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

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) return;
      const memRes = await supabase.from("store_members").select("store_id").eq("user_id", authData.user.id);
      if (memRes.error) return;
      const ids = (memRes.data || [])
        .map((x: { store_id: string | null }) => String(x.store_id || ""))
        .filter(Boolean);
      if (!ids.length) {
        if (mounted) setMyStores([]);
        return;
      }
      const storeRes = await supabase.from("stores").select("store_id,store_name").in("store_id", ids).order("store_name");
      if (storeRes.error) return;
      if (!mounted) return;
      const list = ((storeRes.data || []) as MyStore[]).filter((s) => s.store_id !== storeId);
      setMyStores(list);
      if (!copySourceStoreId && list.length > 0) setCopySourceStoreId(list[0].store_id);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId, copySourceStoreId]);

  const onCopyCategories = async () => {
    if (actionBusy) return;
    if (!storeId) {
      setMsgTone("error");
      return setMsg("현재 매장을 먼저 선택해주세요.");
    }
    if (!copySourceStoreId) {
      setMsgTone("error");
      return setMsg("원본 매장을 선택해주세요.");
    }
    if (copySourceStoreId === storeId) {
      setMsgTone("error");
      return setMsg("원본/대상 매장은 동일할 수 없습니다.");
    }
    if (!confirm("선택한 매장의 카테고리를 현재 매장으로 복사할까요?")) return;
    setCopying(true);
    setMsg("");
    setMsgTone("neutral");
    const { error } = await supabase.rpc("admin_copy_categories_v1", {
      p_source_store_id: copySourceStoreId,
      p_target_store_id: storeId,
    });
    if (error) {
      setMsgTone("error");
      setMsg(`카테고리 복사 실패: ${error.message}`);
      setCopying(false);
      return;
    }
    await refresh();
    setMsgTone("success");
    setMsg("카테고리 복사가 완료되었습니다.");
    setCopying(false);
  };

  const countByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of menus) {
      const key = String(m.category_id || "");
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [menus]);
  const sortedCats = useMemo(
    () =>
      [...cats].sort((a, b) => {
        const ao = Number(a.sort_order ?? Number.MAX_SAFE_INTEGER);
        const bo = Number(b.sort_order ?? Number.MAX_SAFE_INTEGER);
        if (ao !== bo) return ao - bo;
        return a.id.localeCompare(b.id);
      }),
    [cats]
  );

  const onCreate = async () => {
    if (actionBusy) return;
    if (!storeId || !name.trim()) return;
    setSaving(true);
    setMsg("");
    setMsgTone("neutral");
    const row = {
      id: uid(),
      store_id: storeId,
      name: name.trim(),
      sort_order: sortedCats.length + 1,
      is_active: true,
    };
    const { error } = await supabase.from("menu_categories").insert([row]);
    if (error) {
      setMsgTone("error");
      setMsg(error.message);
    }
    else {
      setName("");
      await refresh();
      setMsgTone("success");
      setMsg("카테고리를 생성했습니다.");
    }
    setSaving(false);
  };

  const startEdit = (cat: MenuCategory) => {
    setEditId(cat.id);
    setEditName(cat.name);
    setMsg("");
  };

  const cancelEdit = () => {
    setEditId("");
    setEditName("");
  };

  const onSaveEdit = async (cat: MenuCategory) => {
    if (actionBusy) return;
    if (!storeId || !editName.trim()) {
      setMsgTone("error");
      setMsg("카테고리명을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMsg("");
    setMsgTone("neutral");
    const { error } = await supabase
      .from("menu_categories")
      .update({
        name: editName.trim(),
      })
      .eq("id", cat.id)
      .eq("store_id", storeId);

    if (error) {
      setMsgTone("error");
      setMsg(error.message);
      setSaving(false);
      return;
    }

    cancelEdit();
    await refresh();
    setMsgTone("success");
    setMsg("카테고리를 수정했습니다.");
    setSaving(false);
  };

  const moveCategory = (catId: string, dir: -1 | 1) => {
    const idx = sortedCats.findIndex((c) => c.id === catId);
    if (idx < 0) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= sortedCats.length) return;

    const ids = sortedCats.map((c) => c.id);
    [ids[idx], ids[nextIdx]] = [ids[nextIdx], ids[idx]];

    setCats((prev) => {
      const orderMap = new Map(ids.map((id, i) => [id, i + 1]));
      return prev.map((c) => (orderMap.has(c.id) ? { ...c, sort_order: orderMap.get(c.id)! } : c));
    });
    setOrderDirty(true);
  };

  const saveCategoryOrder = async () => {
    if (!storeId || actionBusy || !orderDirty) return;
    try {
      setSaving(true);
      setMsg("");
      setMsgTone("neutral");
      for (let i = 0; i < sortedCats.length; i += 1) {
        const cat = sortedCats[i];
        const { error } = await supabase
          .from("menu_categories")
          .update({ sort_order: i + 1 })
          .eq("store_id", storeId)
          .eq("id", cat.id);
        if (error) throw error;
      }
      await refresh();
      setMsgTone("success");
      setMsg("카테고리 순서를 저장했습니다.");
      setOrderDirty(false);
    } catch (e: unknown) {
      setMsgTone("error");
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDisable = async (cat: MenuCategory) => {
    if (actionBusy) return;
    const { error } = await supabase
      .from("menu_categories")
      .update({ is_active: false })
      .eq("id", cat.id)
      .eq("store_id", storeId);
    if (error) {
      setMsgTone("error");
      return setMsg(error.message);
    }
    await refresh();
    setMsgTone("success");
    setMsg("카테고리를 비활성화했습니다.");
  };

  const onDeleteWithReassign = async (cat: MenuCategory) => {
    if (actionBusy) return;
    const others = cats.filter((c) => c.id !== cat.id && c.is_active !== false);
    if (!others.length) {
      setMsgTone("error");
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
      setMsgTone("error");
      return setMsg(upd.error.message);
    }

    const del = await supabase.from("menu_categories").delete().eq("id", cat.id).eq("store_id", storeId);
    if (del.error) {
      setMsgTone("error");
      setMsg(del.error.message);
    } else {
      await refresh();
      setMsgTone("success");
      setMsg("카테고리를 삭제하고 메뉴를 재할당했습니다.");
    }
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
        .headerRow{justify-content:space-between}
        .topActionRow{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:nowrap}
        .copyRow{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:nowrap}
        .copySelect{flex:1;min-width:0}
        .copyBtn{flex:0 0 auto;white-space:nowrap}
        .copyBtnShort{display:none}
        .btn{border:1px solid #d1d5db;background:#fff;color:#111827;-webkit-text-fill-color:currentColor;padding:10px 12px;border-radius:10px;font-weight:900;font-size:14px;line-height:1.2;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;cursor:pointer}
        .btnPrimary{background:#111827;color:#fff;border-color:#111827}
        .btnSmall{padding:7px 10px;font-size:12px;border-radius:9px;font-weight:800}
        .btnEdit{border-color:#d1d5db;color:#334155;background:#fff}
        .btnDisable{border-color:#fcd34d;color:#92400e;background:#fffbeb}
        .btnDelete{border-color:#fecaca;color:#b91c1c;background:#fff1f2}
        .orderActionRow{display:inline-flex;gap:4px}
        .orderBtn{border:1px solid #dbe2ea;background:linear-gradient(180deg,#fff,#f8fafc);border-radius:9px;width:26px;height:24px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
        .orderBtn:disabled{opacity:.45;cursor:not-allowed}
        .orderBtn svg{width:13px;height:13px;stroke:#334155;stroke-width:2.2;fill:none;stroke-linecap:round;stroke-linejoin:round}
        .categoryRow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;justify-content:space-between}
        .categoryMainRow{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}
        .categoryMetaRight{display:inline-flex;gap:8px;align-items:center;white-space:nowrap}
        .categoryActionRow{display:inline-flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
        .categoryOrderEdge{display:inline-flex;justify-content:flex-end}
        .listHeaderBlock{display:grid;gap:0}
        .listGuideText{margin:0}
        .input{border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;font-size:14px;font-weight:800}
        .name{font-weight:900}
        .muted{color:#6b7280;font-size:12px;font-weight:800}
        .subText{margin:0;color:#6b7280;font-size:12px;font-weight:800;line-height:1.45}
        .categoryListScroll{
          max-height:56vh;
          overflow-y:auto;
          padding-right:4px;
        }
        .categoryListScroll::-webkit-scrollbar{width:8px}
        .categoryListScroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:999px}
        @media (max-width: 640px) {
          .headerRow {
            align-items: flex-start;
            gap: 10px;
          }
          .topActionRow {
            width: 100%;
            flex-wrap: wrap;
            justify-content: flex-start;
          }
          .topActionRow .btn {
            flex: 0 0 auto;
          }
          .copyRow {
            flex-wrap: nowrap;
          }
          .copyBtnLong{display:none}
          .copyBtnShort{display:inline}
          .createRow > .input {
            width: 100% !important;
            min-width: 0;
          }
          .categoryListScroll{
            max-height:45vh;
          }
          .categoryRow{
            grid-template-columns:minmax(0,1fr) auto;
            align-items:center;
          }
          .categoryMainRow{
            grid-column:1;
            flex-wrap:nowrap;
            min-width:0;
          }
          .categoryMetaRight{
            flex:0 0 auto;
          }
          .categoryActionRow{
            width:100%;
            grid-column:1 / -1;
            justify-content:flex-end;
          }
          .categoryOrderEdge{
            grid-column:2;
            justify-content:flex-end;
          }
        }
        @media (min-width: 641px) and (max-width: 1024px) {
          .categoryListScroll{
            max-height:50vh;
          }
        }
      `}</style>

      <header className="row headerRow">
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 950 }}>카테고리 관리</h1>
        <div className="topActionRow">
          <button className="btn" onClick={() => router.push(storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin")}>관리자 홈 </button>
          <a className="btn" href={`/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>옵션관리</a>
          <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>메뉴관리</a>
        </div>
      </header>
      <p className="subText">메뉴 분류(카테고리)를 등록/수정/정렬합니다.</p>
      <p className="subText">
        현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
      </p>

      {!loading && cats.length === 0 ? (
        <section className="card">
          <div className="copyRow">
            <select className="input copySelect" value={copySourceStoreId} onChange={(e) => setCopySourceStoreId(e.target.value)}>
              <option value="">원본 매장 선택</option>
              {myStores.map((s) => (
                <option key={s.store_id} value={s.store_id}>
                  {s.store_name || s.store_id} ({s.store_id})
                </option>
              ))}
            </select>
            <button className="btn copyBtn" onClick={onCopyCategories} disabled={actionBusy || loading || !copySourceStoreId}>
              {copying ? "복사 중..." : <><span className="copyBtnLong">다른 매장 카테고리 복사</span><span className="copyBtnShort">카테고리 복사</span></>}
            </button>
          </div>
          <p className="subText" style={{ marginTop: 6 }}>
            최초 등록 시에만 복사 기능이 활성화됩니다.
          </p>
        </section>
      ) : null}

      <section className="card">
        <div className="row createRow">
          <input className="input" placeholder="카테고리명" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btnPrimary" onClick={onCreate} disabled={actionBusy || loading || !name.trim()}>생성</button>
        </div>
        <p className="muted">삭제 정책: 재할당 강제(삭제 시 첫 번째 활성 카테고리로 메뉴 이동)</p>
        {msg ? (
          <div
            style={{
              color: msgTone === "success" ? "#065f46" : msgTone === "error" ? "#b91c1c" : "#374151",
              fontWeight: 900,
            }}
          >
            {msg}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="listHeaderBlock">
          <div className="row headerRow">
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>카테고리 목록</h2>
            <button className="btn" onClick={saveCategoryOrder} disabled={actionBusy || loading || !orderDirty}>순서 저장</button>
          </div>
          <p className="muted listGuideText">카테고리 순서는 목록의 ↑/↓ 이동 후 저장하세요.</p>
        </div>
        {loading ? <p className="muted">불러오는 중...</p> : cats.length === 0 ? <p className="muted">등록된 카테고리가 없습니다.</p> : (
          <div className="categoryListScroll">
            <div style={{ display: "grid", gap: 8 }}>
            {sortedCats.map((cat, idx) => {
              const isEditing = editId === cat.id;
              return (
                <div key={cat.id} className="row" style={{ justifyContent: "space-between", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                  <div style={{ display: "grid", gap: 6, width: "100%" }}>
                    {isEditing ? (
                      <>
                        <input
                          className="input"
                          placeholder="카테고리명"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          disabled={actionBusy || loading}
                        />
                      </>
                    ) : (
                      <div className="categoryRow">
                        <div className="categoryMainRow">
                          <div className="name">{cat.name} {cat.is_active === false ? "(비활성)" : ""}</div>
                          <div className="categoryMetaRight">
                            <div className="muted">메뉴 {countByCategory.get(cat.id) || 0}개</div>
                          </div>
                        </div>
                        <div className="categoryActionRow">
                          <button className="btn btnSmall btnEdit" onClick={() => startEdit(cat)} disabled={actionBusy || loading}>수정</button>
                          <button className="btn btnSmall btnDisable" onClick={() => onDisable(cat)} disabled={actionBusy || loading || cat.is_active === false}>비활성화</button>
                          <button className="btn btnSmall btnDelete" onClick={() => onDeleteWithReassign(cat)} disabled={actionBusy || loading}>삭제(재할당)</button>
                        </div>
                        <div className="categoryOrderEdge">
                          <span className="orderActionRow">
                            <button
                              className="orderBtn"
                              type="button"
                              onClick={() => moveCategory(cat.id, -1)}
                              disabled={actionBusy || loading || idx === 0}
                              aria-label={`${cat.name} 위로 이동`}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 14l6-6 6 6" />
                              </svg>
                            </button>
                            <button
                              className="orderBtn"
                              type="button"
                              onClick={() => moveCategory(cat.id, 1)}
                              disabled={actionBusy || loading || idx === sortedCats.length - 1}
                              aria-label={`${cat.name} 아래로 이동`}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 10l6 6 6-6" />
                              </svg>
                            </button>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="row">
                      <button className="btn btnPrimary btnSmall" onClick={() => onSaveEdit(cat)} disabled={actionBusy || loading || !editName.trim()}>저장</button>
                      <button className="btn btnSmall" onClick={cancelEdit} disabled={actionBusy || loading}>취소</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            </div>
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
