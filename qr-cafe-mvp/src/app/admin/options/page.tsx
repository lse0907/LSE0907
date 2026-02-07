// src/app/admin/options/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  required: boolean;
  min: number;
  max: number;
};

type OptionItem = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta: number;
};

function uid(prefix = "opt") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export default function AdminOptionsPage() {
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState<string>("");

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<OptionItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [badge, setBadge] = useState<"idle" | "saved" | "error">("idle");
  const badgeText = badge === "saved" ? "저장됨 ✅" : badge === "error" ? "저장 실패 ❗" : " ";

  // 1) storeId 로드
  useEffect(() => {
    const queryStore = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = queryStore || saved;
    if (sid) {
      setStoreId(sid);
      setCurrentStoreId(sid);
    } else {
      setStoreId("");
    }
  }, [sp]);

  // 2) 데이터 로드
  const refresh = async () => {
    if (!storeId) return;

    setLoading(true);
    try {
      // 로그인 체크(원인 파악 쉬움)
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!authData?.user) {
        // 비로그인이라면 화면에서 안내만 (미들웨어에서 막는 게 더 좋음)
        setGroups([]);
        setItems([]);
        setSelectedGroupId("");
        return;
      }

      const gRes = await supabase
        .from("option_groups")
        .select("id, store_id, name, required, min, max")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });

      if (gRes.error) throw gRes.error;

      const iRes = await supabase
        .from("option_items")
        .select("id, store_id, group_id, name, price_delta")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });

      if (iRes.error) throw iRes.error;

      const nextGroups = (gRes.data || []) as OptionGroup[];
      const nextItems = (iRes.data || []) as OptionItem[];

      setGroups(nextGroups);
      setItems(nextItems);

      // 선택 그룹 자동 세팅
      setSelectedGroupId((prev) => {
        if (prev && nextGroups.some((x) => x.id === prev)) return prev;
        return nextGroups[0]?.id || "";
      });
    } catch (e: any) {
      console.error("[admin/options] refresh error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  const groupItems = useMemo(
    () => items.filter((it) => it.group_id === selectedGroupId),
    [items, selectedGroupId]
  );

  // 공통: 뱃지 처리
  const markSaved = () => {
    setBadge("saved");
    setTimeout(() => setBadge("idle"), 1600);
  };
  const markError = () => {
    setBadge("error");
    setTimeout(() => setBadge("idle"), 1600);
  };

  // ===== 그룹 CRUD =====
  const addGroup = async () => {
    if (!storeId) return alert("선택된 매장이 없습니다. 매장을 먼저 선택/생성하세요.");
    try {
      setSaving(true);
      setBadge("idle");

      const id = uid("group");
      const row = {
        id,
        store_id: storeId,
        name: "새 옵션그룹",
        required: false,
        min: 0,
        max: 1,
      };

      const { error } = await supabase.from("option_groups").insert([row]);
      if (error) throw error;

      await refresh();
      setSelectedGroupId(id);
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] addGroup:", e?.message || e);
      markError();
      alert(`그룹 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateGroup = async (patch: Partial<OptionGroup>) => {
    if (!selectedGroup) return;
    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("option_groups")
        .update({
          name: patch.name ?? selectedGroup.name,
          required: patch.required ?? selectedGroup.required,
          min: typeof patch.min === "number" ? patch.min : selectedGroup.min,
          max: typeof patch.max === "number" ? patch.max : selectedGroup.max,
        })
        .eq("id", selectedGroup.id)
        .eq("store_id", storeId);

      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] updateGroup:", e?.message || e);
      markError();
      alert(`그룹 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup) return;
    if (!confirm("이 옵션그룹을 삭제할까요? (그룹의 옵션아이템도 함께 삭제됩니다)")) return;

    try {
      setSaving(true);
      setBadge("idle");

      // 아이템 먼저 삭제
      const delItems = await supabase
        .from("option_items")
        .delete()
        .eq("store_id", storeId)
        .eq("group_id", selectedGroup.id);

      if (delItems.error) throw delItems.error;

      // 그룹 삭제
      const delGroup = await supabase
        .from("option_groups")
        .delete()
        .eq("store_id", storeId)
        .eq("id", selectedGroup.id);

      if (delGroup.error) throw delGroup.error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] deleteGroup:", e?.message || e);
      markError();
      alert(`그룹 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  // ===== 아이템 CRUD =====
  const addItem = async () => {
    if (!selectedGroup) return alert("그룹을 먼저 선택하세요.");
    try {
      setSaving(true);
      setBadge("idle");

      const row = {
        id: uid("item"),
        store_id: storeId,
        group_id: selectedGroup.id,
        name: "새 옵션",
        price_delta: 0,
      };

      const { error } = await supabase.from("option_items").insert([row]);
      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] addItem:", e?.message || e);
      markError();
      alert(`옵션 추가 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const updateItem = async (id: string, patch: Partial<OptionItem>) => {
    const cur = items.find((x) => x.id === id);
    if (!cur) return;

    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("option_items")
        .update({
          name: patch.name ?? cur.name,
          price_delta: typeof patch.price_delta === "number" ? patch.price_delta : cur.price_delta,
        })
        .eq("id", id)
        .eq("store_id", storeId);

      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] updateItem:", e?.message || e);
      markError();
      alert(`옵션 저장 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (!confirm("이 옵션을 삭제할까요?")) return;
    try {
      setSaving(true);
      setBadge("idle");

      const { error } = await supabase
        .from("option_items")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);

      if (error) throw error;

      await refresh();
      markSaved();
    } catch (e: any) {
      console.error("[admin/options] deleteItem:", e?.message || e);
      markError();
      alert(`옵션 삭제 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
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
      `}</style>

      <style jsx>{`
        .wrap {
          max-width: 1050px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
        }
        .h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 6px 0 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        .badge {
          padding: 8px 10px;
          border-radius: 999px;
          font-weight: 900;
          font-size: 12px;
          border: 1px solid var(--line);
          background: #fff;
          min-width: 96px;
          text-align: center;
        }
        .badgeSaved {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }
        .badgeError {
          border-color: #fecaca;
          background: #fef2f2;
        }

        .grid {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 10px;
          align-items: start;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }
        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 12px;
        }
        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
        }
        .btnPrimary {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .btnDanger {
          border-color: #fecaca;
          color: #b91c1c;
          background: #fff;
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .list {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .rowBtn {
          text-align: left;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
        }
        .name {
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 12px;
        }

        .field {
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 800;
          width: 100%;
        }
        .row3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
        }

        .itemCard {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 8px;
        }
        .itemTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: center;
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
          .row3 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">옵션 관리</h1>
          <p className="sub">옵션 그룹/옵션 항목을 등록합니다. (예: 샷 추가, 시럽)</p>
          <p className="sub" style={{ marginTop: 6 }}>
            현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
          </p>
        </div>

        {badge === "saved" ? (
          <span className="badge badgeSaved">{badgeText}</span>
        ) : badge === "error" ? (
          <span className="badge badgeError">{badgeText}</span>
        ) : (
          <span className="badge">{badgeText}</span>
        )}
      </header>

      {!storeId ? (
        <section className="card">
          <h2 className="cardTitle">매장을 먼저 선택/생성하세요</h2>
          <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            현재 선택된 매장(저장된 매장)이 없습니다.<br />
            관리자 홈에서 매장을 선택한 뒤 다시 들어와 주세요.
          </p>
          <div className="btnRow">
            <a className="btn btnPrimary" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
              관리자 홈으로
            </a>
          </div>
        </section>
      ) : (
        <section className="grid">
          {/* 그룹 */}
          <div className="card">
            <h2 className="cardTitle">옵션 그룹 ({groups.length})</h2>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={addGroup} disabled={saving || loading}>
                + 새 그룹
              </button>
              <button className="btn" onClick={refresh} disabled={saving || loading}>
                새로고침
              </button>
              <a className="btn" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
                관리자 홈
              </a>
            </div>

            <div className="list">
              {groups.map((g) => (
                <button
                  key={g.id}
                  className={`rowBtn ${g.id === selectedGroupId ? "rowBtnOn" : ""}`}
                  onClick={() => setSelectedGroupId(g.id)}
                >
                  <div className="name">{g.name}</div>
                  <div className="muted">
                    {g.required ? "필수" : "선택"} · {g.min}~{g.max}개 · id: {g.id}
                  </div>
                </button>
              ))}
              {!loading && groups.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  아직 옵션 그룹이 없습니다. “+ 새 그룹”으로 시작하세요.
                </div>
              ) : null}
            </div>
          </div>

          {/* 상세 */}
          <div className="card">
            <h2 className="cardTitle">그룹 상세</h2>

            {!selectedGroup ? (
              <p className="muted" style={{ marginTop: 10 }}>
                그룹을 선택하세요.
              </p>
            ) : (
              <>
                <div className="field">
                  <div className="label">그룹명</div>
                  <input
                    className="input"
                    value={selectedGroup.name}
                    onChange={(e) => updateGroup({ name: e.target.value })}
                    disabled={saving || loading}
                  />
                </div>

                <div className="field">
                  <div className="label">필수 여부</div>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 900 }}>
                    <input
                      type="checkbox"
                      checked={selectedGroup.required}
                      onChange={(e) =>
                        updateGroup({ required: e.target.checked, min: e.target.checked ? 1 : 0 })
                      }
                      disabled={saving || loading}
                    />
                    필수
                  </label>
                </div>

                <div className="row3">
                  <div className="field">
                    <div className="label">최소 선택</div>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(selectedGroup.min)}
                      onChange={(e) => updateGroup({ min: toInt(e.target.value, selectedGroup.min) })}
                      disabled={saving || loading}
                    />
                  </div>
                  <div className="field">
                    <div className="label">최대 선택</div>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={String(selectedGroup.max)}
                      onChange={(e) =>
                        updateGroup({
                          max: Math.max(toInt(e.target.value, selectedGroup.max), selectedGroup.min),
                        })
                      }
                      disabled={saving || loading}
                    />
                  </div>
                  <div className="field">
                    <div className="label">그룹 ID</div>
                    <input className="input" value={selectedGroup.id} readOnly />
                  </div>
                </div>

                <div className="btnRow">
                  <button className="btn btnPrimary" onClick={addItem} disabled={saving || loading}>
                    + 옵션 추가
                  </button>
                  <button className="btn btnDanger" onClick={deleteGroup} disabled={saving || loading}>
                    그룹 삭제
                  </button>
                </div>

                <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950 }}>
                    옵션 항목 ({groupItems.length})
                  </h3>

                  <div className="list" style={{ marginTop: 10 }}>
                    {groupItems.map((it) => (
                      <div key={it.id} className="itemCard">
                        <div className="itemTop">
                          <div style={{ fontWeight: 950 }}>{it.name}</div>
                          <button
                            className="btn btnDanger"
                            onClick={() => deleteItem(it.id)}
                            disabled={saving || loading}
                          >
                            삭제
                          </button>
                        </div>

                        <div className="row3">
                          <div className="field" style={{ marginTop: 0 }}>
                            <div className="label">옵션명</div>
                            <input
                              className="input"
                              value={it.name}
                              onChange={(e) => updateItem(it.id, { name: e.target.value })}
                              disabled={saving || loading}
                            />
                          </div>
                          <div className="field" style={{ marginTop: 0 }}>
                            <div className="label">추가금(원)</div>
                            <input
                              className="input"
                              inputMode="numeric"
                              value={String(it.price_delta)}
                              onChange={(e) => updateItem(it.id, { price_delta: toInt(e.target.value, it.price_delta) })}
                              disabled={saving || loading}
                            />
                          </div>
                          <div className="field" style={{ marginTop: 0 }}>
                            <div className="label">옵션 ID</div>
                            <input className="input" value={it.id} readOnly />
                          </div>
                        </div>
                      </div>
                    ))}

                    {!loading && groupItems.length === 0 ? (
                      <div className="muted" style={{ marginTop: 10 }}>
                        이 그룹에는 옵션 항목이 없습니다. “+ 옵션 추가”를 눌러주세요.
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
