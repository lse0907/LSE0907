"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

const MENU_IMAGE_BUCKET = "menu-assets";

type MenuItem = {
  id: string;
  store_id: string;
  name: string;
  price: number;
  image?: string | null;
  is_sold_out?: boolean | null;
  option_group_ids?: string[] | null;
  sort_order?: number | null;
};

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  scope?: "common" | "exclusive" | null;
  linked_menu_id?: string | null;
  required?: boolean;
  min?: number;
  max?: number;
};

type OptionItem = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta?: number | null;
};

type MenuOptionPrice = {
  store_id: string;
  menu_id: string;
  option_item_id: string;
  price_delta: number;
};

type MenuDraft = {
  id: string;
  name: string;
  price: string;
  image: string;
  isSoldOut: boolean;
  optionGroupIds: string[];
  sortOrder: string;
  optionPriceByItem: Record<string, string>;
};

function slugify(input: string) {
  const base = (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-+|\-+$/g, "");
  if (!base) return "";
  return base.slice(0, 40);
}

function toInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function getFileExt(name: string) {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

const emptyDraft: MenuDraft = {
  id: "",
  name: "",
  price: "",
  image: "",
  isSoldOut: false,
  optionGroupIds: [],
  sortOrder: "",
  optionPriceByItem: {},
};

export default function AdminMenuPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [optionItems, setOptionItems] = useState<OptionItem[]>([]);
  const [optionPrices, setOptionPrices] = useState<MenuOptionPrice[]>([]);
  const [hasLinkedMenuColumn, setHasLinkedMenuColumn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [badge, setBadge] = useState<"idle" | "saved" | "error">("idle");
  const badgeText = badge === "saved" ? "저장됨 ✅" : badge === "error" ? "저장 실패 ❗" : " ";
  const [uploadingImage, setUploadingImage] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newExclusiveGroup, setNewExclusiveGroup] = useState({
    name: "",
    required: false,
    min: "0",
    max: "1",
  });
  const [newExclusiveItems, setNewExclusiveItems] = useState<string[]>([""]);

  const [draft, setDraft] = useState<MenuDraft>(emptyDraft);
  const [selectedId, setSelectedId] = useState<string>("");

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

  const refresh = async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!authData?.user) {
        setItems([]);
        setGroups([]);
        setSelectedId("");
        setDraft(emptyDraft);
        return;
      }

      const menuRes = await supabase
        .from("menu_items")
        .select("id,store_id,name,price,image,is_sold_out,option_group_ids,sort_order")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (menuRes.error) throw menuRes.error;

      let groupData: OptionGroup[] = [];
      const groupRes = await supabase
        .from("option_groups")
        .select("id,store_id,name,scope,linked_menu_id,required,min,max")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (groupRes.error) {
        const missingLinkedMenuColumn =
          groupRes.error.code === "42703" && String(groupRes.error.message || "").includes("linked_menu_id");

        if (!missingLinkedMenuColumn) throw groupRes.error;

        const fallbackRes = await supabase
          .from("option_groups")
          .select("id,store_id,name,scope,required,min,max")
          .eq("store_id", storeId)
          .order("created_at", { ascending: true });
        if (fallbackRes.error) throw fallbackRes.error;

        setHasLinkedMenuColumn(false);
        groupData = (fallbackRes.data || []).map((g) => ({ ...g, linked_menu_id: null })) as OptionGroup[];
      } else {
        setHasLinkedMenuColumn(true);
        groupData = (groupRes.data || []) as OptionGroup[];
      }

      const itemRes = await supabase
        .from("option_items")
        .select("id,store_id,group_id,name,price_delta")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true });

      if (itemRes.error) throw itemRes.error;

      const priceRes = await supabase
        .from("menu_option_prices")
        .select("store_id,menu_id,option_item_id,price_delta")
        .eq("store_id", storeId);

      if (priceRes.error) throw priceRes.error;

      setItems((menuRes.data || []) as MenuItem[]);
      setGroups(groupData);
      setOptionItems((itemRes.data || []) as OptionItem[]);
      setOptionPrices((priceRes.data || []) as MenuOptionPrice[]);

      setSelectedId((prev) => {
        if (prev && (menuRes.data || []).some((x) => x.id === prev)) return prev;
        return (menuRes.data || [])[0]?.id || "";
      });
    } catch (e: any) {
      console.error("[admin/menu] refresh error:", e?.message || e);
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

  useEffect(() => {
    if (!selectedId) {
      setDraft(emptyDraft);
      return;
    }
    const found = items.find((x) => x.id === selectedId);
    if (!found) return;

    setDraft({
      id: found.id || "",
      name: found.name || "",
      price: String(found.price ?? ""),
      image: found.image || "",
      isSoldOut: Boolean(found.is_sold_out),
      optionGroupIds: Array.isArray(found.option_group_ids) ? found.option_group_ids : [],
      sortOrder: found.sort_order != null ? String(found.sort_order) : "",
      optionPriceByItem: optionPrices
        .filter((row) => row.menu_id === found.id)
        .reduce<Record<string, string>>((acc, row) => {
          acc[row.option_item_id] = String(row.price_delta ?? 0);
          return acc;
        }, {}),
    });
  }, [items, selectedId, optionPrices]);

  const sortedItems = useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      const ao = Number(a.sort_order ?? 999999);
      const bo = Number(b.sort_order ?? 999999);
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    return list;
  }, [items]);

  const onNew = () => {
    setSelectedId("");
    setDraft(emptyDraft);
    setMsg("");
  };

  const onSave = async () => {
    if (!storeId) return;
    const name = draft.name.trim();
    const id = draft.id.trim();
    const price = toInt(draft.price, -1);

    if (!name) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    if (!id) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    if (price < 0) {
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
      return;
    }

    setSaving(true);
    setBadge("idle");

    try {
      if (!hasLinkedMenuColumn) {
        const hasExclusiveSelection = draft.optionGroupIds.some((gid) => {
          const group = groups.find((g) => g.id === gid);
          return group?.scope === "exclusive";
        });

        if (hasExclusiveSelection) {
          setBadge("error");
          setTimeout(() => setBadge("idle"), 1600);
          setMsg("DB에 linked_menu_id 컬럼이 없어 전용옵션 저장이 불가합니다. SQL 마이그레이션을 먼저 실행해 주세요.");
          return;
        }
      }

      const filteredGroups = draft.optionGroupIds.filter((gid) => {
        const group = groups.find((g) => g.id === gid);
        if (!group) return false;
        if (group.scope !== "exclusive") return true;
        return !group.linked_menu_id || group.linked_menu_id === id;
      });

      const payload = {
        id,
        store_id: storeId,
        name,
        price,
        image: draft.image.trim(),
        is_sold_out: draft.isSoldOut,
        option_group_ids: filteredGroups,
        sort_order: draft.sortOrder ? toInt(draft.sortOrder, 0) : null,
      };

      const exists = items.some((x) => x.id === id);
      if (exists) {
        const upd = await supabase
          .from("menu_items")
          .update(payload)
          .eq("id", id)
          .eq("store_id", storeId);
        if (upd.error) throw upd.error;
      } else {
        const ins = await supabase.from("menu_items").insert([payload]);
        if (ins.error) throw ins.error;
      }

      const activeOptionItemIds = new Set(
        filteredGroups.flatMap((gid) =>
          optionItems.filter((it) => it.group_id === gid).map((it) => it.id)
        )
      );

      if (activeOptionItemIds.size === 0) {
        const delAll = await supabase.from("menu_option_prices").delete().eq("menu_id", id).eq("store_id", storeId);
        if (delAll.error) throw delAll.error;
      } else {
        const ids = [...activeOptionItemIds];
        const inFilter = `(${ids.map((val) => `"${val}"`).join(",")})`;
        const delOther = await supabase
          .from("menu_option_prices")
          .delete()
          .eq("menu_id", id)
          .eq("store_id", storeId)
          .not("option_item_id", "in", inFilter);
        if (delOther.error) throw delOther.error;

        const rows = ids.map((optionItemId) => ({
          store_id: storeId,
          menu_id: id,
          option_item_id: optionItemId,
          price_delta: toInt(draft.optionPriceByItem[optionItemId] ?? "0", 0),
        }));
        const up = await supabase
          .from("menu_option_prices")
          .upsert(rows, { onConflict: "store_id,menu_id,option_item_id" });
        if (up.error) throw up.error;
      }

      await refresh();
      setSelectedId(id);
      setBadge("saved");
      setTimeout(() => setBadge("idle"), 1600);
    } catch (e: any) {
      console.error("[admin/menu] save error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!storeId) return;
    const id = draft.id.trim();
    if (!id) return;

    setSaving(true);
    setBadge("idle");
    try {
      const del = await supabase.from("menu_items").delete().eq("id", id).eq("store_id", storeId);
      if (del.error) throw del.error;
      await refresh();
      setSelectedId("");
      setDraft(emptyDraft);
      setBadge("saved");
      setTimeout(() => setBadge("idle"), 1600);
    } catch (e: any) {
      console.error("[admin/menu] delete error:", e?.message || e);
      setBadge("error");
      setTimeout(() => setBadge("idle"), 1600);
    } finally {
      setSaving(false);
    }
  };

  const toggleGroup = (id: string) => {
    setDraft((prev) => {
      const has = prev.optionGroupIds.includes(id);
      const next = has ? prev.optionGroupIds.filter((g) => g !== id) : [...prev.optionGroupIds, id];
      if (!has) return { ...prev, optionGroupIds: next };

      const nextPrices = { ...prev.optionPriceByItem };
      optionItems
        .filter((it) => it.group_id === id)
        .forEach((it) => {
          delete nextPrices[it.id];
        });
      return { ...prev, optionGroupIds: next, optionPriceByItem: nextPrices };
    });
  };

  const createExclusiveGroupInMenu = async () => {
    if (!storeId) return;
    const menuId = draft.id.trim();
    if (!menuId) {
      setMsg("전용옵션을 만들기 전에 메뉴명을 입력해 메뉴 ID를 먼저 만들어주세요.");
      return;
    }
    const groupName = newExclusiveGroup.name.trim();
    if (!groupName) {
      setMsg("전용옵션 그룹명을 입력해주세요.");
      return;
    }

    const cleanedItems = newExclusiveItems.map((x) => x.trim()).filter(Boolean);
    if (cleanedItems.length === 0) {
      setMsg("전용옵션 항목을 1개 이상 입력해주세요.");
      return;
    }

    setSaving(true);
    setMsg("");
    try {
      const groupId = `group_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
      const min = newExclusiveGroup.required ? Math.max(1, toInt(newExclusiveGroup.min, 1)) : toInt(newExclusiveGroup.min, 0);
      const max = Math.max(toInt(newExclusiveGroup.max, 1), min);

      const groupInsert = await supabase.from("option_groups").insert([
        {
          id: groupId,
          store_id: storeId,
          name: groupName,
          required: newExclusiveGroup.required,
          min,
          max,
          scope: "exclusive",
          linked_menu_id: menuId,
        },
      ]);
      if (groupInsert.error) throw groupInsert.error;

      const itemRows = cleanedItems.map((itemName) => ({
        id: `item_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`,
        store_id: storeId,
        group_id: groupId,
        name: itemName,
      }));
      const itemInsert = await supabase.from("option_items").insert(itemRows);
      if (itemInsert.error) throw itemInsert.error;

      setDraft((prev) => ({
        ...prev,
        optionGroupIds: prev.optionGroupIds.includes(groupId) ? prev.optionGroupIds : [...prev.optionGroupIds, groupId],
      }));
      setNewExclusiveGroup({ name: "", required: false, min: "0", max: "1" });
      setNewExclusiveItems([""]);
      await refresh();
      setMsg("전용옵션 그룹을 생성했고 현재 메뉴에 자동 연결했습니다.");
    } catch (e: any) {
      setMsg(`전용옵션 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onBack = () => {
    if (storeId) {
      router.push(`/admin?store=${encodeURIComponent(storeId)}`);
    } else {
      router.push("/admin");
    }
  };

  const isEditing = Boolean(selectedId);
  const selectedGroups = groups.filter((g) => draft.optionGroupIds.includes(g.id));
  const commonGroups = groups.filter((g) => (g.scope || "common") !== "exclusive");
  const exclusiveGroups = groups.filter(
    (g) => (g.scope || "common") === "exclusive" && (!draft.id.trim() || g.linked_menu_id === draft.id.trim())
  );
  const itemsByGroup = useMemo(() => {
    const map = new Map<string, OptionItem[]>();
    optionItems.forEach((it) => {
      if (!map.has(it.group_id)) map.set(it.group_id, []);
      map.get(it.group_id)?.push(it);
    });
    return map;
  }, [optionItems]);

  const getOptionPrice = (item: OptionItem) => {
    if (draft.optionPriceByItem[item.id] != null) return draft.optionPriceByItem[item.id];
    return String(item.price_delta ?? 0);
  };

  const onUploadMenuImage = async (file: File | null) => {
    if (!file) return;
    if (!draft.id.trim()) {
      setMsg("이미지를 올리려면 메뉴 ID를 먼저 입력해주세요.");
      return;
    }

    setUploadingImage(true);
    setMsg("");
    try {
      const ext = getFileExt(file.name) || "png";
      const path = `${storeId}/${draft.id.trim()}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(MENU_IMAGE_BUCKET).upload(path, file, { upsert: true });
      if (error) throw error;

      const { data } = supabase.storage.from(MENU_IMAGE_BUCKET).getPublicUrl(path);
      const url = data.publicUrl || "";
      if (url) setDraft((prev) => ({ ...prev, image: url }));
    } catch (e: any) {
      setMsg(`메뉴 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingImage(false);
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
          --brand: #0f172a;
          --brand-soft: #e2e8f0;
          --accent: #2563eb;
          --radius: 16px;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
        .wrap {
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-end;
        }
        .h1 {
          margin: 0;
          font-size: 26px;
          font-weight: 950;
        }
        .sub {
          margin: 6px 0 0 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.4;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 12px;
        }
        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 12px;
        }
        .badge {
          height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid var(--line);
          display: inline-flex;
          align-items: center;
          font-size: 12px;
          font-weight: 900;
          color: var(--muted);
        }
        .badgeSaved {
          border-color: #bbf7d0;
          color: #15803d;
        }
        .badgeError {
          border-color: #fecaca;
          color: #991b1b;
        }
        .btnRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 12px;
        }
        .btn {
          border: 1px solid var(--line);
          background: #fff;
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
        .btn:disabled {
          opacity: 0.5;
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
          display: grid;
          gap: 6px;
        }
        .rowBtnOn {
          border: 2px solid var(--brand);
        }
        .name {
          font-weight: 900;
          font-size: 14px;
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
        .optionGrid {
          display: grid;
          gap: 8px;
          margin-top: 8px;
        }
        .optionRow {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 800;
        }
        .hint {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }
        .divider {
          height: 1px;
          background: var(--line);
          margin: 10px 0;
        }
        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">메뉴 관리</h1>
          <p className="sub">메뉴 기본정보와 옵션 가격을 관리합니다. (모바일 화면 최적화)</p>
          <p className="sub" style={{ marginTop: 6 }}>
            현재 매장: <b>{storeId || "(미선택)"}</b> {loading ? "· 불러오는 중..." : ""}
          </p>
          {msg ? (
            <p className="sub" style={{ marginTop: 6, color: "#b91c1c" }}>
              {msg}
            </p>
          ) : null}
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
            현재 선택된 매장이 없습니다.<br />
            관리자 홈에서 매장을 선택한 뒤 다시 들어와 주세요.
          </p>
          <div className="btnRow">
            <button className="btn btnPrimary" onClick={onBack}>
              관리자 홈으로
            </button>
          </div>
        </section>
      ) : (
        <section className="grid">
          <div className="card">
            <h2 className="cardTitle">메뉴 목록 ({items.length})</h2>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={onNew} disabled={saving || loading}>
                + 새 메뉴
              </button>
              <button className="btn" onClick={refresh} disabled={saving || loading}>
                새로고침
              </button>
              <button className="btn" onClick={onBack}>
                관리자 홈
              </button>
            </div>

            <div className="list">
              {sortedItems.map((m) => (
                <button
                  key={m.id}
                  className={`rowBtn ${m.id === selectedId ? "rowBtnOn" : ""}`}
                  onClick={() => setSelectedId(m.id)}
                >
                  <div className="name">{m.name}</div>
                  <div className="muted">
                    {Number(m.price || 0).toLocaleString()}원 · 옵션 {m.option_group_ids?.length || 0}개
                  </div>
                </button>
              ))}
              {!loading && items.length === 0 ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  아직 메뉴가 없습니다. “+ 새 메뉴”로 시작하세요.
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <h2 className="cardTitle">메뉴 상세</h2>

            <div className="field">
              <div className="label">메뉴명</div>
              <input
                className="input"
                value={draft.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    name: nextName,
                    id: prev.id || slugify(nextName),
                  }));
                }}
                placeholder="예: 아메리카노"
                disabled={saving || loading}
              />
            </div>

            <div className="field">
              <div className="label">기본 가격</div>
              <input
                className="input"
                inputMode="numeric"
                value={draft.price}
                onChange={(e) => setDraft((prev) => ({ ...prev, price: e.target.value }))}
                placeholder="예: 4500"
                disabled={saving || loading}
              />
            </div>

            <div className="field">
              <div className="label">메뉴 이미지</div>
              <div className="btnRow" style={{ marginTop: 4 }}>
                <label className="btn">
                  {uploadingImage ? "업로드 중..." : "이미지 업로드"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => onUploadMenuImage(e.target.files?.[0] || null)}
                    disabled={saving || loading || uploadingImage}
                  />
                </label>
              </div>
              <input className="input" value={draft.image} readOnly placeholder="이미지 업로드 후 자동 입력" />
            </div>

            <div className="field">
              <div className="label">노출 순서 (작을수록 위로)</div>
              <input
                className="input"
                inputMode="numeric"
                value={draft.sortOrder}
                onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: e.target.value }))}
                placeholder="예: 10"
                disabled={saving || loading}
              />
            </div>

            <div className="field">
              <div className="label">품절</div>
              <label className="optionRow">
                <input
                  type="checkbox"
                  checked={draft.isSoldOut}
                  onChange={(e) => setDraft((prev) => ({ ...prev, isSoldOut: e.target.checked }))}
                  disabled={saving || loading}
                />
                품절 처리
              </label>
            </div>

            <div className="field">
              <button className="btn" type="button" onClick={() => setShowAdvanced((p) => !p)}>
                {showAdvanced ? "고급설정 접기" : "고급설정 열기"}
              </button>
              {showAdvanced ? (
                <>
                  <div className="label">메뉴 ID</div>
                  <input
                    className="input"
                    value={draft.id}
                    onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))}
                    placeholder="예: americano"
                    disabled={saving || loading || isEditing}
                  />
                  <div className="hint">이미 등록된 메뉴를 수정할 때는 ID 변경을 막아두었어요.</div>
                </>
              ) : null}
            </div>

            <div className="field">
              <div className="label">공통옵션 연결</div>
              {commonGroups.length === 0 ? (
                <div className="muted">등록된 옵션 그룹이 없습니다.</div>
              ) : (
                <div className="optionGrid">
                  {commonGroups.map((g) => (
                    <label key={g.id} className="optionRow">
                      <input
                        type="checkbox"
                        checked={draft.optionGroupIds.includes(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        disabled={saving || loading}
                      />
                      {g.name}
                      <span className="muted">
                        · {g.scope === "exclusive" ? "전용옵션" : "공통옵션"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <div className="label">전용옵션 (현재 메뉴 전용)</div>
              {exclusiveGroups.length === 0 ? <div className="muted">아직 전용옵션이 없습니다.</div> : null}
              <div className="optionGrid">
                {exclusiveGroups.map((g) => (
                  <label key={g.id} className="optionRow">
                    <input
                      type="checkbox"
                      checked={draft.optionGroupIds.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      disabled={saving || loading}
                    />
                    {g.name}
                    <span className="muted">· 전용옵션</span>
                  </label>
                ))}
              </div>

              <div className="divider" />
              <div className="hint">메뉴 화면에서 전용옵션을 바로 만들 수 있어요.</div>
              <input
                className="input"
                value={newExclusiveGroup.name}
                onChange={(e) => setNewExclusiveGroup((p) => ({ ...p, name: e.target.value }))}
                placeholder="전용옵션 그룹명 (예: 당도)"
                disabled={saving || loading}
              />
              <label className="optionRow">
                <input
                  type="checkbox"
                  checked={newExclusiveGroup.required}
                  onChange={(e) =>
                    setNewExclusiveGroup((p) => ({ ...p, required: e.target.checked, min: e.target.checked ? "1" : p.min }))
                  }
                  disabled={saving || loading}
                />
                필수 선택
              </label>
              <div className="optionRow">
                <input
                  className="input"
                  style={{ maxWidth: 120 }}
                  inputMode="numeric"
                  value={newExclusiveGroup.min}
                  onChange={(e) => setNewExclusiveGroup((p) => ({ ...p, min: e.target.value }))}
                  placeholder="최소"
                  disabled={saving || loading}
                />
                <input
                  className="input"
                  style={{ maxWidth: 120 }}
                  inputMode="numeric"
                  value={newExclusiveGroup.max}
                  onChange={(e) => setNewExclusiveGroup((p) => ({ ...p, max: e.target.value }))}
                  placeholder="최대"
                  disabled={saving || loading}
                />
              </div>
              {newExclusiveItems.map((row, idx) => (
                <div className="optionRow" key={`new-item-${idx}`}>
                  <input
                    className="input"
                    value={row}
                    onChange={(e) =>
                      setNewExclusiveItems((prev) => prev.map((v, i) => (i === idx ? e.target.value : v)))
                    }
                    placeholder={`옵션 항목 ${idx + 1}`}
                    disabled={saving || loading}
                  />
                  {newExclusiveItems.length > 1 ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setNewExclusiveItems((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={saving || loading}
                    >
                      제거
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="btnRow" style={{ marginTop: 6 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setNewExclusiveItems((prev) => [...prev, ""])}
                  disabled={saving || loading}
                >
                  항목 추가
                </button>
                <button className="btn" type="button" onClick={createExclusiveGroupInMenu} disabled={saving || loading}>
                  전용옵션 생성
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label">옵션 추가금 설정</div>
              <div className="hint">메뉴마다 다른 옵션 가격을 설정할 수 있습니다.</div>
              {selectedGroups.length === 0 ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  연결된 옵션 그룹이 없습니다.
                </div>
              ) : (
                <div className="optionGrid" style={{ marginTop: 10 }}>
                  {selectedGroups.map((group) => {
                    const groupOptions = itemsByGroup.get(group.id) || [];
                    return (
                      <div key={group.id} className="card" style={{ padding: 12 }}>
                        <div className="name" style={{ marginBottom: 6 }}>
                          {group.name}
                          <span className="muted" style={{ marginLeft: 6 }}>
                            ({group.scope === "exclusive" ? "전용옵션" : "공통옵션"})
                          </span>
                        </div>
                        {groupOptions.length === 0 ? (
                          <div className="muted">옵션 항목이 없습니다.</div>
                        ) : (
                          groupOptions.map((item) => (
                            <div key={item.id} className="optionRow" style={{ justifyContent: "space-between" }}>
                              <span>{item.name}</span>
                              <input
                                className="input"
                                style={{ maxWidth: 120 }}
                                inputMode="numeric"
                                value={getOptionPrice(item)}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    optionPriceByItem: {
                                      ...prev.optionPriceByItem,
                                      [item.id]: e.target.value,
                                    },
                                  }))
                                }
                                disabled={saving || loading}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={onSave} disabled={saving || loading}>
                {saving ? "저장 중..." : "저장"}
              </button>
              <button className="btn" onClick={onNew} disabled={saving || loading}>
                새로 작성
              </button>
              <button className="btn" onClick={onDelete} disabled={saving || loading || !draft.id}>
                삭제
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
