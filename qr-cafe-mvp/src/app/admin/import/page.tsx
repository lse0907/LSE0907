"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";

type CategoryUploadRow = {
  category_name: string;
  sort_order: number | null;
  is_active: boolean;
};

type MenuUploadRow = {
  menu_name: string;
  price: number;
  category_name: string;
  is_sold_out: boolean;
};

type UploadError = {
  sheet: "categories" | "menus";
  row: number;
  column: string;
  message: string;
  value: string;
};

type CategoryDbRow = {
  id: string;
  name: string;
  sort_order: number | null;
  is_active: boolean | null;
};

type MenuDbRow = {
  id: string;
  name: string;
  sort_order: number | null;
};

function uid(prefix = "row") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeKey(v: string) {
  return String(v || "").trim().toLowerCase();
}

function normalizeName(v: string) {
  return String(v || "").trim();
}

function parseBooleanLike(v: string, fallback: boolean) {
  const t = String(v || "").trim().toLowerCase();
  if (!t) return fallback;
  if (["y", "yes", "true", "1"].includes(t)) return true;
  if (["n", "no", "false", "0"].includes(t)) return false;
  return fallback;
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      const next = line[i + 1];
      if (inQuotes && next === "\"") {
        cur += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out.map((v) => String(v || "").trim());
}

function parseCsv(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (!nonEmpty.length) return [];
  return nonEmpty.map(parseCsvLine);
}

function toMenuIdPrefix(storeId: string) {
  const part = String(storeId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${part || "store"}-menu-`;
}

function buildNextMenuId(storeId: string, existingIds: string[]) {
  const prefix = toMenuIdPrefix(storeId);
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let maxSeq = 0;
  for (const id of existingIds) {
    const m = String(id || "").match(re);
    if (!m) continue;
    const seq = Number(m[1]);
    if (Number.isFinite(seq)) maxSeq = Math.max(maxSeq, seq);
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

function AdminImportPageInner() {
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState(() => (sp.get("store") || getCurrentStoreId() || "").trim());
  const [categoriesFile, setCategoriesFile] = useState<File | null>(null);
  const [menusFile, setMenusFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<UploadError[]>([]);
  const [categoryRows, setCategoryRows] = useState<CategoryUploadRow[]>([]);
  const [menuRows, setMenuRows] = useState<MenuUploadRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");

  const canValidate = useMemo(() => !!storeId && !!categoriesFile && !!menusFile, [storeId, categoriesFile, menusFile]);

  const setStatus = (tone: "neutral" | "success" | "error", text: string) => {
    setMsgTone(tone);
    setMsg(text);
  };

  const onStoreIdChange = (v: string) => {
    const next = String(v || "").trim();
    setStoreId(next);
    if (next) setCurrentStoreId(next);
  };

  const downloadTemplate = (name: string, content: string) => {
    const bom = "\uFEFF";
    const blob = new Blob([bom, content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onDownloadCategoryTemplate = () => {
    const categoriesCsv = [
      "category_name,sort_order,is_active,note",
      "커피,1,Y,[🔴필수] 헤더(첫 줄 영문 키)는 수정하지 마세요.",
      "논커피,2,Y,[🟡주의] is_active 값은 Y 또는 N만 입력하세요.",
      "디저트,3,Y,[🟢예시] category_name=커피, sort_order=1",
    ].join("\r\n");
    downloadTemplate("categories_template.csv", categoriesCsv);
  };

  const onDownloadMenuTemplate = () => {
    const menusCsv = [
      "menu_name,price,category_name,is_sold_out,description,note",
      "아메리카노,4500,커피,N,기본 원두,[🔴필수] category_name은 categories.csv 값과 동일해야 합니다.",
      "카페라떼,5200,커피,N,,[🟡주의] price는 숫자만 입력하세요. (예: 4500)",
      "쿠키,3200,디저트,N,,[🟢예시] is_sold_out은 Y 또는 N",
    ].join("\r\n");
    downloadTemplate("menus_template.csv", menusCsv);
  };

  const parseAndValidate = async () => {
    if (!canValidate || !categoriesFile || !menusFile) return;
    setChecking(true);
    setStatus("neutral", "");
    setErrors([]);
    setCategoryRows([]);
    setMenuRows([]);

    try {
      const [catText, menuText] = await Promise.all([categoriesFile.text(), menusFile.text()]);
      const catRowsRaw = parseCsv(catText);
      const menuRowsRaw = parseCsv(menuText);
      const nextErrors: UploadError[] = [];

      if (catRowsRaw.length < 2) {
        nextErrors.push({ sheet: "categories", row: 1, column: "file", message: "categories 파일에 데이터가 없습니다.", value: "" });
      }
      if (menuRowsRaw.length < 2) {
        nextErrors.push({ sheet: "menus", row: 1, column: "file", message: "menus 파일에 데이터가 없습니다.", value: "" });
      }

      const catHeader = catRowsRaw[0] || [];
      const menuHeader = menuRowsRaw[0] || [];
      const catIndex = new Map(catHeader.map((h, i) => [normalizeKey(h), i]));
      const menuIndex = new Map(menuHeader.map((h, i) => [normalizeKey(h), i]));

      const needCat = ["category_name"];
      const needMenu = ["menu_name", "price", "category_name"];

      for (const col of needCat) {
        if (!catIndex.has(col)) {
          nextErrors.push({ sheet: "categories", row: 1, column: col, message: "필수 컬럼이 없습니다.", value: "" });
        }
      }
      for (const col of needMenu) {
        if (!menuIndex.has(col)) {
          nextErrors.push({ sheet: "menus", row: 1, column: col, message: "필수 컬럼이 없습니다.", value: "" });
        }
      }

      const parsedCats: CategoryUploadRow[] = [];
      const catNameSet = new Set<string>();

      for (let r = 1; r < catRowsRaw.length; r += 1) {
        const row = catRowsRaw[r];
        const categoryName = normalizeName(row[catIndex.get("category_name") ?? -1] || "");
        const sortText = normalizeName(row[catIndex.get("sort_order") ?? -1] || "");
        const activeText = normalizeName(row[catIndex.get("is_active") ?? -1] || "");
        if (!categoryName && !sortText && !activeText) continue;

        if (!categoryName) {
          nextErrors.push({ sheet: "categories", row: r + 1, column: "category_name", message: "카테고리명은 필수입니다.", value: categoryName });
          continue;
        }
        const key = normalizeKey(categoryName);
        if (catNameSet.has(key)) {
          nextErrors.push({ sheet: "categories", row: r + 1, column: "category_name", message: "중복 카테고리명입니다.", value: categoryName });
          continue;
        }
        catNameSet.add(key);

        let sortOrder: number | null = null;
        if (sortText) {
          const n = Number(sortText);
          if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
            nextErrors.push({ sheet: "categories", row: r + 1, column: "sort_order", message: "정렬순서는 1 이상의 정수만 가능합니다.", value: sortText });
            continue;
          }
          sortOrder = n;
        }

        parsedCats.push({
          category_name: categoryName,
          sort_order: sortOrder,
          is_active: parseBooleanLike(activeText, true),
        });
      }

      const parsedMenus: MenuUploadRow[] = [];
      const menuNameSet = new Set<string>();

      for (let r = 1; r < menuRowsRaw.length; r += 1) {
        const row = menuRowsRaw[r];
        const menuName = normalizeName(row[menuIndex.get("menu_name") ?? -1] || "");
        const priceText = normalizeName(row[menuIndex.get("price") ?? -1] || "");
        const categoryName = normalizeName(row[menuIndex.get("category_name") ?? -1] || "");
        const soldOutText = normalizeName(row[menuIndex.get("is_sold_out") ?? -1] || "");
        if (!menuName && !priceText && !categoryName && !soldOutText) continue;

        if (!menuName) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "menu_name", message: "메뉴명은 필수입니다.", value: menuName });
          continue;
        }

        const menuKey = normalizeKey(menuName);
        if (menuNameSet.has(menuKey)) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "menu_name", message: "중복 메뉴명입니다.", value: menuName });
          continue;
        }
        menuNameSet.add(menuKey);

        if (!priceText || !/^\d+$/.test(priceText)) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "price", message: "가격은 숫자만 입력하세요. (예: 4500)", value: priceText });
          continue;
        }
        const price = Number(priceText);
        if (price < 0) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "price", message: "가격은 0 이상이어야 합니다.", value: priceText });
          continue;
        }

        if (!categoryName) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "category_name", message: "카테고리명은 필수입니다.", value: categoryName });
          continue;
        }
        if (!catNameSet.has(normalizeKey(categoryName))) {
          nextErrors.push({ sheet: "menus", row: r + 1, column: "category_name", message: "categories 파일에 없는 카테고리명입니다.", value: categoryName });
          continue;
        }

        parsedMenus.push({
          menu_name: menuName,
          price,
          category_name: categoryName,
          is_sold_out: parseBooleanLike(soldOutText, false),
        });
      }

      setErrors(nextErrors);
      setCategoryRows(parsedCats);
      setMenuRows(parsedMenus);

      if (nextErrors.length > 0) {
        setStatus("error", `검증 실패: 오류 ${nextErrors.length}건`);
      } else {
        setStatus("success", `검증 완료: 카테고리 ${parsedCats.length}건, 메뉴 ${parsedMenus.length}건`);
      }
    } catch (e) {
      setStatus("error", `파일 파싱 실패: ${String((e as Error)?.message || e)}`);
    } finally {
      setChecking(false);
    }
  };

  const applyImport = async () => {
    if (!storeId) return setStatus("error", "매장 ID를 먼저 입력/선택해 주세요.");
    if (errors.length > 0) return setStatus("error", "오류가 남아있어 반영할 수 없습니다.");
    if (!categoryRows.length || !menuRows.length) return setStatus("error", "반영할 데이터가 없습니다. 먼저 검증을 실행해 주세요.");
    if (!confirm(`카테고리 ${categoryRows.length}건, 메뉴 ${menuRows.length}건을 반영할까요?`)) return;

    setSaving(true);
    setStatus("neutral", "");
    try {
      const catRes = await supabase
        .from("menu_categories")
        .select("id,name,sort_order,is_active")
        .eq("store_id", storeId);
      if (catRes.error) throw catRes.error;
      const existingCats = (catRes.data || []) as CategoryDbRow[];
      const catByName = new Map(existingCats.map((c) => [normalizeKey(c.name), c]));
      const categoryIdByName = new Map<string, string>();
      let createdCats = 0;
      let updatedCats = 0;

      for (let i = 0; i < categoryRows.length; i += 1) {
        const row = categoryRows[i];
        const key = normalizeKey(row.category_name);
        const found = catByName.get(key);
        if (found) {
          const { error } = await supabase
            .from("menu_categories")
            .update({
              name: row.category_name,
              sort_order: row.sort_order ?? i + 1,
              is_active: row.is_active,
            })
            .eq("store_id", storeId)
            .eq("id", found.id);
          if (error) throw error;
          updatedCats += 1;
          categoryIdByName.set(key, found.id);
        } else {
          const newId = uid("cat");
          const { error } = await supabase.from("menu_categories").insert([
            {
              id: newId,
              store_id: storeId,
              name: row.category_name,
              sort_order: row.sort_order ?? i + 1,
              is_active: row.is_active,
            },
          ]);
          if (error) throw error;
          createdCats += 1;
          categoryIdByName.set(key, newId);
          catByName.set(key, { id: newId, name: row.category_name, sort_order: row.sort_order ?? i + 1, is_active: row.is_active });
        }
      }

      const menuRes = await supabase
        .from("menu_items")
        .select("id,name,sort_order")
        .eq("store_id", storeId);
      if (menuRes.error) throw menuRes.error;
      const existingMenus = (menuRes.data || []) as MenuDbRow[];
      const menuByName = new Map(existingMenus.map((m) => [normalizeKey(m.name), m]));
      const usedMenuIds = existingMenus.map((m) => m.id);
      const maxSort = existingMenus.reduce((acc, cur) => Math.max(acc, Number(cur.sort_order || 0)), 0);
      let createdMenus = 0;
      let updatedMenus = 0;

      for (let i = 0; i < menuRows.length; i += 1) {
        const row = menuRows[i];
        const key = normalizeKey(row.menu_name);
        const found = menuByName.get(key);
        const categoryId = categoryIdByName.get(normalizeKey(row.category_name));
        if (!categoryId) throw new Error(`카테고리 매핑 실패: ${row.category_name}`);

        if (found) {
          const { error } = await supabase
            .from("menu_items")
            .update({
              name: row.menu_name,
              price: row.price,
              category_id: categoryId,
              is_sold_out: row.is_sold_out,
            })
            .eq("store_id", storeId)
            .eq("id", found.id);
          if (error) throw error;
          updatedMenus += 1;
        } else {
          const id = buildNextMenuId(storeId, usedMenuIds);
          usedMenuIds.push(id);
          const { error } = await supabase.from("menu_items").insert([
            {
              id,
              store_id: storeId,
              name: row.menu_name,
              price: row.price,
              category_id: categoryId,
              is_sold_out: row.is_sold_out,
              image: "",
              option_group_ids: [],
              sort_order: maxSort + i + 1,
            },
          ]);
          if (error) throw error;
          createdMenus += 1;
        }
      }

      setStatus(
        "success",
        `반영 완료: 카테고리 생성 ${createdCats} / 수정 ${updatedCats}, 메뉴 생성 ${createdMenus} / 수정 ${updatedMenus}`
      );
    } catch (e) {
      setStatus("error", `반영 실패: ${String((e as Error)?.message || e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
          --bg: #f6f7f9;
          --card: #ffffff;
          --text: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --brand: #111827;
        }
        body {
          background: var(--bg);
          color: var(--text);
        }
      `}</style>
      <style jsx>{`
        .wrap {
          max-width: 980px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 12px;
        }
        .card {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .btn {
          border: 1px solid #d1d5db;
          background: #fff;
          color: #111827;
          padding: 9px 12px;
          border-radius: 10px;
          font-weight: 900;
          font-size: 14px;
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btnPrimary {
          background: #111827;
          color: #fff;
          border-color: #111827;
        }
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .input {
          border: 1px solid #d1d5db;
          border-radius: 10px;
          padding: 9px 10px;
          font-size: 14px;
          font-weight: 800;
        }
        .title {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
        }
        .muted {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.4;
        }
        .msg {
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
        }
        .msgSuccess {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .msgError {
          border-color: #fecaca;
          background: #fef2f2;
          color: #991b1b;
        }
        .tableWrap {
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          max-height: 260px;
          overflow: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        th,
        td {
          border-bottom: 1px solid #f1f5f9;
          padding: 8px 10px;
          text-align: left;
          vertical-align: top;
        }
        th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          z-index: 1;
        }
      `}</style>

      <header className="card">
        <h1 className="title">일괄 데이터 업로드 (CSV)</h1>
        <p className="muted">
          점주 템플릿(카테고리/메뉴 기본정보)을 업로드합니다.
          <br />
          이미지/옵션연결/전용옵션은 이 단계에서 제외됩니다.
          <br />
          템플릿 파일은 엑셀 한글 깨짐 방지를 위해 UTF-8(BOM) 형식으로 다운로드됩니다.
        </p>
        <div className="row">
          <a className="btn" href={`/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
            관리자 홈
          </a>
          <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`}>
            메뉴관리
          </a>
          <button className="btn" onClick={onDownloadCategoryTemplate} type="button">카테고리 템플릿</button>
          <button className="btn" onClick={onDownloadMenuTemplate} type="button">메뉴 템플릿</button>
        </div>
      </header>

      <section className="card">
        <h2 style={{ margin: 0, fontSize: 18 }}>1) 업로드 파일 선택</h2>
        <p className="muted" style={{ margin: 0 }}>
          컬럼 헤더는 반드시 템플릿의 영문 키를 그대로 유지해 주세요.
          <br />
          category_name(카테고리명), sort_order(정렬순서), is_active(Y/N)
          <br />
          menu_name(메뉴명), price(가격), category_name(카테고리명), is_sold_out(Y/N)
          <br />
          검증/반영을 위해 categories.csv와 menus.csv 두 파일이 모두 필요합니다.
        </p>
        <div className="row">
          <label className="muted" style={{ minWidth: 96 }}>매장 ID</label>
          <input
            className="input"
            value={storeId}
            onChange={(e) => onStoreIdChange(e.target.value)}
            placeholder="store_id 입력 또는 기존 선택값 사용"
            style={{ minWidth: 280, flex: 1 }}
          />
        </div>
        <div className="row">
          <label className="muted" style={{ minWidth: 96 }}>categories.csv</label>
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCategoriesFile(e.target.files?.[0] || null)}
          />
        </div>
        <div className="row">
          <label className="muted" style={{ minWidth: 96 }}>menus.csv</label>
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setMenusFile(e.target.files?.[0] || null)}
          />
        </div>
        <div className="row">
          <button className="btn btnPrimary" onClick={parseAndValidate} disabled={!canValidate || checking || saving} type="button">
            {checking ? "검증 중..." : "검증 실행"}
          </button>
          <button className="btn" onClick={applyImport} disabled={checking || saving || errors.length > 0 || !categoryRows.length || !menuRows.length} type="button">
            {saving ? "반영 중..." : "검증 통과 데이터 반영"}
          </button>
        </div>
        {msg ? (
          <div className={`msg ${msgTone === "success" ? "msgSuccess" : msgTone === "error" ? "msgError" : ""}`.trim()}>
            {msg}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2 style={{ margin: 0, fontSize: 18 }}>2) 검증 결과</h2>
        <p className="muted">
          오류가 1건이라도 있으면 반영 버튼이 비활성화됩니다.
        </p>
        {errors.length === 0 ? (
          <p className="muted">오류 없음</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>시트</th>
                  <th>행</th>
                  <th>컬럼</th>
                  <th>오류</th>
                  <th>입력값</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((err, idx) => (
                  <tr key={`${err.sheet}-${err.row}-${err.column}-${idx}`}>
                    <td>{err.sheet}</td>
                    <td>{err.row}</td>
                    <td>{err.column}</td>
                    <td>{err.message}</td>
                    <td>{err.value || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ margin: 0, fontSize: 18 }}>3) 반영 예정 건수</h2>
        <p className="muted">
          카테고리 {categoryRows.length}건 / 메뉴 {menuRows.length}건
        </p>
      </section>
    </main>
  );
}

export default function AdminImportPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>로딩 중...</div>}>
      <AdminImportPageInner />
    </Suspense>
  );
}
