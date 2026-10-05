"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";
import MenuAdminNav from "@/app/admin/_components/MenuAdminNav";

type ImportTarget = "categories" | "menus";

type CategoryUploadRow = {
  category_name: string;
  sort_order: number | null;
  is_active: boolean;
};

type MenuUploadRow = {
  menu_name: string;
  price: number;
  is_sold_out: boolean;
  category_name: string;
  source_row: number;
};

type UploadError = {
  sheet: "categories" | "menus";
  row: number;
  column: string;
  message: string;
  value: string;
  solution: string;
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
  price: number | null;
  is_sold_out: boolean | null;
  category_id: string | null;
};

type ImportPreview = {
  createdCats: number;
  updatedCats: number;
  unchangedCats: number;
  createdMenus: number;
  updatedMenus: number;
  unchangedMenus: number;
  uncategorizedMenus: number;
  menuChanges: string[];
};

type ImportResult = {
  createdCats: number;
  updatedCats: number;
  unchangedCats: number;
  createdMenus: number;
  updatedMenus: number;
  unchangedMenus: number;
  uncategorizedMenus: number;
};

const targetOptions: Array<{ key: ImportTarget; title: string; step: string; icon: string; fileName: string }> = [
  { key: "categories", title: "카테고리 등록", step: "01", icon: "카테고리", fileName: "categories.csv" },
  { key: "menus", title: "메뉴 등록", step: "02", icon: "메뉴", fileName: "menus.csv" },
];

function uid(prefix = "row") {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeKey(v: string) {
  return String(v || "").trim().toLowerCase();
}

function normalizeName(v: string) {
  return String(v || "").trim();
}

function parseBooleanValue(v: string, fallback: boolean) {
  const raw = String(v || "").trim();
  const t = raw.toLowerCase();
  if (!t) return { value: fallback, valid: true };
  if (["y", "yes", "true", "1"].includes(t)) return { value: true, valid: true };
  if (["n", "no", "false", "0"].includes(t)) return { value: false, valid: true };
  return { value: fallback, valid: false };
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

function getInitialTarget(value: string | null): ImportTarget {
  return value === "menus" ? "menus" : "categories";
}

function includesCategories(target: ImportTarget) {
  return target === "categories";
}

function includesMenus(target: ImportTarget) {
  return target === "menus";
}

function AdminImportPageInner() {
  const sp = useSearchParams();
  const [storeId] = useState(() => (sp.get("store") || getCurrentStoreId() || "").trim());
  const [target, setTarget] = useState<ImportTarget>(() => getInitialTarget(sp.get("target")));
  const [storeName, setStoreName] = useState("");
  const [categoriesFile, setCategoriesFile] = useState<File | null>(null);
  const [menusFile, setMenusFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<UploadError[]>([]);
  const [categoryRows, setCategoryRows] = useState<CategoryUploadRow[]>([]);
  const [menuRows, setMenuRows] = useState<MenuUploadRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasValidated, setHasValidated] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");

  const targetMeta = targetOptions.find((option) => option.key === target) || targetOptions[0];
  const needsCategoriesFile = includesCategories(target);
  const needsMenusFile = includesMenus(target);
  const canValidate = useMemo(() => {
    if (!storeId) return false;
    if (needsCategoriesFile && !categoriesFile) return false;
    if (needsMenusFile && !menusFile) return false;
    return true;
  }, [storeId, categoriesFile, menusFile, needsCategoriesFile, needsMenusFile]);
  const canApply = hasValidated && preview !== null && errors.length === 0 && (needsCategoriesFile ? categoryRows.length > 0 : true) && (needsMenusFile ? menuRows.length > 0 : true);
  const validationSummary = `${needsCategoriesFile ? `카테고리 ${categoryRows.length}건` : "카테고리 파일 없음"} / ${needsMenusFile ? `메뉴 ${menuRows.length}건` : "메뉴 파일 없음"}`;

  const setStatus = (tone: "neutral" | "success" | "error", text: string) => {
    setMsgTone(tone);
    setMsg(text);
  };

  const resetValidation = () => {
    setErrors([]);
    setCategoryRows([]);
    setMenuRows([]);
    setPreview(null);
    setHasValidated(false);
    setResult(null);
    setConfirmOpen(false);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!storeId) {
        setStoreName("");
        return;
      }
      const { data: storeData } = await supabase.from("stores").select("store_name").eq("store_id", storeId).maybeSingle();
      if (!mounted) return;
      setStoreName(String(storeData?.store_name || ""));
    })().catch(() => {
      if (!mounted) return;
      setStoreName("");
    });
    return () => {
      mounted = false;
    };
  }, [storeId]);


  const onTargetChange = (next: ImportTarget) => {
    setTarget(next);
    resetValidation();
    setStatus("neutral", "");
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
      "category_name,sort_order,is_active",
      "커피,1,Y",
      "논커피,2,Y",
      "디저트,3,Y",
    ].join("\r\n");
    downloadTemplate("categories_template.csv", categoriesCsv);
  };

  const onDownloadMenuTemplate = () => {
    const menusCsv = [
      "menu_name,price,category_name,is_sold_out",
      "아메리카노,4500,커피,N",
      "카페라떼,5200,커피,N",
      "쿠키,3200,디저트,N",
    ].join("\r\n");
    downloadTemplate("menus_template.csv", menusCsv);
  };

  const addError = (nextErrors: UploadError[], error: UploadError) => {
    nextErrors.push(error);
  };

  const parseCategoryRows = (catRowsRaw: string[][], nextErrors: UploadError[]) => {
    const catHeader = catRowsRaw[0] || [];
    const catIndex = new Map(catHeader.map((h, i) => [normalizeKey(h), i]));
    const parsedCats: CategoryUploadRow[] = [];
    const catNameSet = new Set<string>();

    if (catRowsRaw.length < 2) {
      addError(nextErrors, {
        sheet: "categories",
        row: 1,
        column: "file",
        message: "업로드한 파일에 등록할 카테고리 데이터가 없습니다.",
        value: "",
        solution: "템플릿 예시 행 아래에 실제 카테고리를 입력한 뒤 다시 업로드해 주세요.",
      });
    }
    if (!catIndex.has("category_name")) {
      addError(nextErrors, {
        sheet: "categories",
        row: 1,
        column: "category_name",
        message: "필수 컬럼이 없습니다.",
        value: "",
        solution: "첫 줄의 영문 컬럼명을 수정하지 말고 템플릿 그대로 사용해 주세요.",
      });
      return { parsedCats, catNameSet };
    }

    for (let r = 1; r < catRowsRaw.length; r += 1) {
      const row = catRowsRaw[r];
      const categoryName = normalizeName(row[catIndex.get("category_name") ?? -1] || "");
      const sortText = normalizeName(row[catIndex.get("sort_order") ?? -1] || "");
      const activeText = normalizeName(row[catIndex.get("is_active") ?? -1] || "");
      if (!categoryName && !sortText && !activeText) continue;

      if (!categoryName) {
        addError(nextErrors, {
          sheet: "categories",
          row: r + 1,
          column: "category_name",
          message: "카테고리명이 비어 있습니다.",
          value: categoryName,
          solution: "category_name 칸에 카테고리명을 입력해 주세요.",
        });
        continue;
      }
      const key = normalizeKey(categoryName);
      if (catNameSet.has(key)) {
        addError(nextErrors, {
          sheet: "categories",
          row: r + 1,
          column: "category_name",
          message: "같은 카테고리명이 두 번 입력되었습니다.",
          value: categoryName,
          solution: "하나만 남기거나 이름을 다르게 수정해 주세요.",
        });
        continue;
      }
      catNameSet.add(key);

      let sortOrder: number | null = null;
      if (sortText) {
        const n = Number(sortText);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
          addError(nextErrors, {
            sheet: "categories",
            row: r + 1,
            column: "sort_order",
            message: "정렬순서는 1 이상의 정수만 가능합니다.",
            value: sortText,
            solution: "1, 2, 3처럼 숫자만 입력하거나 비워두세요.",
          });
          continue;
        }
        sortOrder = n;
      }

      const activeParsed = parseBooleanValue(activeText, true);
      if (!activeParsed.valid) {
        addError(nextErrors, {
          sheet: "categories",
          row: r + 1,
          column: "is_active",
          message: "사용 여부는 Y 또는 N으로 입력해 주세요.",
          value: activeText,
          solution: "사용이면 Y, 숨김이면 N을 입력하거나 비워두세요.",
        });
        continue;
      }

      parsedCats.push({ category_name: categoryName, sort_order: sortOrder, is_active: activeParsed.value });
    }

    return { parsedCats, catNameSet };
  };

  const parseMenuRows = (menuRowsRaw: string[][], nextErrors: UploadError[]) => {
    const menuHeader = menuRowsRaw[0] || [];
    const menuIndex = new Map(menuHeader.map((h, i) => [normalizeKey(h), i]));
    const parsedMenus: MenuUploadRow[] = [];
    const menuNameSet = new Set<string>();

    if (menuRowsRaw.length < 2) {
      addError(nextErrors, {
        sheet: "menus",
        row: 1,
        column: "file",
        message: "업로드한 파일에 등록할 메뉴 데이터가 없습니다.",
        value: "",
        solution: "템플릿 예시 행 아래에 실제 메뉴를 입력한 뒤 다시 업로드해 주세요.",
      });
    }

    for (const col of ["menu_name", "price"]) {
      if (!menuIndex.has(col)) {
        addError(nextErrors, {
          sheet: "menus",
          row: 1,
          column: col,
          message: "필수 컬럼이 없습니다.",
          value: "",
          solution: "첫 줄의 영문 컬럼명을 수정하지 말고 템플릿 그대로 사용해 주세요.",
        });
      }
    }
    if (!menuIndex.has("menu_name") || !menuIndex.has("price")) return parsedMenus;

    for (let r = 1; r < menuRowsRaw.length; r += 1) {
      const row = menuRowsRaw[r];
      const menuName = normalizeName(row[menuIndex.get("menu_name") ?? -1] || "");
      const priceText = normalizeName(row[menuIndex.get("price") ?? -1] || "");
      const soldOutText = normalizeName(row[menuIndex.get("is_sold_out") ?? -1] || "");
      const categoryName = normalizeName(row[menuIndex.get("category_name") ?? -1] || "");
      if (!menuName && !priceText && !soldOutText && !categoryName) continue;

      if (!menuName) {
        addError(nextErrors, {
          sheet: "menus",
          row: r + 1,
          column: "menu_name",
          message: "메뉴명이 비어 있습니다.",
          value: menuName,
          solution: "menu_name 칸에 메뉴명을 입력해 주세요.",
        });
        continue;
      }

      const menuKey = normalizeKey(menuName);
      if (menuNameSet.has(menuKey)) {
        addError(nextErrors, {
          sheet: "menus",
          row: r + 1,
          column: "menu_name",
          message: "같은 메뉴명이 두 번 입력되었습니다.",
          value: menuName,
          solution: "하나만 남기거나 이름을 다르게 수정해 주세요.",
        });
        continue;
      }
      menuNameSet.add(menuKey);

      if (!priceText || !/^\d+$/.test(priceText)) {
        addError(nextErrors, {
          sheet: "menus",
          row: r + 1,
          column: "price",
          message: "가격은 숫자만 입력해 주세요.",
          value: priceText,
          solution: "4500처럼 숫자만 입력해 주세요. 쉼표, 원, ₩ 기호는 제거해 주세요.",
        });
        continue;
      }
      const price = Number(priceText);
      if (!Number.isSafeInteger(price) || price < 0 || price > 2147483647) {
        addError(nextErrors, {
          sheet: "menus",
          row: r + 1,
          column: "price",
          message: "가격이 허용 범위를 벗어났습니다.",
          value: priceText,
          solution: "0부터 2,147,483,647 사이의 숫자로 입력해 주세요.",
        });
        continue;
      }

      const soldOutParsed = parseBooleanValue(soldOutText, false);
      if (!soldOutParsed.valid) {
        addError(nextErrors, {
          sheet: "menus",
          row: r + 1,
          column: "is_sold_out",
          message: "품절 여부는 Y 또는 N으로 입력해 주세요.",
          value: soldOutText,
          solution: "판매 중이면 N, 품절이면 Y를 입력하거나 비워두세요.",
        });
        continue;
      }

      parsedMenus.push({ menu_name: menuName, price, is_sold_out: soldOutParsed.value, category_name: categoryName, source_row: r + 1 });
    }

    return parsedMenus;
  };

  const readExistingRows = async () => {
    const [catRes, menuRes] = await Promise.all([
      supabase.from("menu_categories").select("id,name,sort_order,is_active").eq("store_id", storeId),
      supabase.from("menu_items").select("id,name,sort_order,price,is_sold_out,category_id").eq("store_id", storeId),
    ]);
    if (catRes.error) throw catRes.error;
    if (menuRes.error) throw menuRes.error;
    return {
      existingCats: (catRes.data || []) as CategoryDbRow[],
      existingMenus: (menuRes.data || []) as MenuDbRow[],
    };
  };

  const buildPreview = (
    cats: CategoryUploadRow[],
    menus: MenuUploadRow[],
    existingCats: CategoryDbRow[],
    existingMenus: MenuDbRow[],
  ) => {
    const nextErrors: UploadError[] = [];
    const next: ImportPreview = {
      createdCats: 0, updatedCats: 0, unchangedCats: 0,
      createdMenus: 0, updatedMenus: 0, unchangedMenus: 0,
      uncategorizedMenus: 0, menuChanges: [],
    };
    const catByName = new Map(existingCats.map((cat) => [normalizeKey(cat.name), cat]));
    const uploadedCatByName = new Map(cats.map((cat) => [normalizeKey(cat.category_name), cat]));
    const menuByName = new Map(existingMenus.map((menu) => [normalizeKey(menu.name), menu]));

    cats.forEach((row, index) => {
      const found = catByName.get(normalizeKey(row.category_name));
      if (!found) {
        next.createdCats += 1;
        return;
      }
      const desiredOrder = row.sort_order ?? index + 1;
      if (found.name !== row.category_name || Number(found.sort_order) !== desiredOrder || Boolean(found.is_active) !== row.is_active) {
        next.updatedCats += 1;
      } else {
        next.unchangedCats += 1;
      }
    });

    menus.forEach((row) => {
      const found = menuByName.get(normalizeKey(row.menu_name));
      const categoryKey = normalizeKey(row.category_name);
      const category = row.category_name ? catByName.get(categoryKey) : null;
      const uploadedCategory = row.category_name ? uploadedCatByName.get(categoryKey) : null;
      const categoryIsActive = uploadedCategory?.is_active ?? category?.is_active;
      if (row.category_name && (!category && !uploadedCategory || !categoryIsActive)) {
        nextErrors.push({
          sheet: "menus", row: row.source_row, column: "category_name",
          message: category || uploadedCategory ? "사용 중지된 카테고리입니다." : "등록된 카테고리를 찾을 수 없습니다.",
          value: row.category_name,
          solution: "사용 중인 카테고리명을 정확히 입력하거나, 카테고리를 먼저 등록해 주세요.",
        });
        return;
      }
      const finalCategoryId = row.category_name ? category?.id ?? (uploadedCategory ? `new:${categoryKey}` : null) : found?.category_id ?? null;
      if (!finalCategoryId) next.uncategorizedMenus += 1;
      if (!found) {
        next.createdMenus += 1;
        return;
      }
      const changes: string[] = [];
      if (found.name !== row.menu_name) changes.push("이름");
      if (Number(found.price) !== row.price) changes.push("가격");
      if (Boolean(found.is_sold_out) !== row.is_sold_out) changes.push("품절 여부");
      if (row.category_name && found.category_id !== finalCategoryId) changes.push("카테고리");
      if (changes.length) {
        next.updatedMenus += 1;
        next.menuChanges.push(`${row.menu_name}: ${changes.join("·")} 변경`);
      } else {
        next.unchangedMenus += 1;
      }
    });

    return { next, nextErrors };
  };

  const parseAndValidate = async () => {
    if (!canValidate) return;
    setChecking(true);
    setStatus("neutral", "");
    setErrors([]);
    setCategoryRows([]);
    setMenuRows([]);
    setPreview(null);
    setHasValidated(false);
    setResult(null);

    try {
      const nextErrors: UploadError[] = [];
      let parsedCats: CategoryUploadRow[] = [];
      let parsedMenus: MenuUploadRow[] = [];

      if (needsCategoriesFile) {
        if (!categoriesFile) throw new Error("카테고리 파일을 선택해 주세요.");
        const catRowsRaw = parseCsv(await categoriesFile.text());
        const result = parseCategoryRows(catRowsRaw, nextErrors);
        parsedCats = result.parsedCats;
      }

      if (needsMenusFile) {
        if (!menusFile) throw new Error("메뉴 파일을 선택해 주세요.");
        const menuRowsRaw = parseCsv(await menusFile.text());
        parsedMenus = parseMenuRows(menuRowsRaw, nextErrors);
      }

      if (!nextErrors.length) {
        const { existingCats, existingMenus } = await readExistingRows();
        const plan = buildPreview(parsedCats, parsedMenus, existingCats, existingMenus);
        nextErrors.push(...plan.nextErrors);
        if (!plan.nextErrors.length) setPreview(plan.next);
      }
      setErrors(nextErrors);
      setCategoryRows(parsedCats);
      setMenuRows(parsedMenus);
      setHasValidated(true);

      if (nextErrors.length > 0) {
        setStatus("error", `검증 실패: 수정이 필요한 항목 ${nextErrors.length}건`);
      } else {
        setStatus("success", `검증 완료: ${needsCategoriesFile ? `카테고리 ${parsedCats.length}건` : ""}${needsCategoriesFile && needsMenusFile ? ", " : ""}${needsMenusFile ? `메뉴 ${parsedMenus.length}건` : ""}`);
      }
    } catch (e) {
      setStatus("error", `파일 검증 실패: ${String((e as Error)?.message || e)}`);
    } finally {
      setChecking(false);
    }
  };

  const openApplyConfirm = () => {
    if (!storeId) return setStatus("error", "관리자 홈에서 매장을 먼저 선택해 주세요.");
    if (!hasValidated) return setStatus("error", "먼저 검증 실행을 완료해 주세요.");
    if (errors.length > 0) return setStatus("error", "오류가 남아있어 반영할 수 없습니다.");
    if (!canApply) return setStatus("error", "반영할 데이터가 없습니다. 먼저 검증을 실행해 주세요.");
    setConfirmOpen(true);
  };

  const applyImport = async () => {
    setConfirmOpen(false);
    setSaving(true);
    setStatus("neutral", "");
    try {
      const { existingCats, existingMenus } = await readExistingRows();
      const latestPlan = buildPreview(categoryRows, menuRows, existingCats, existingMenus);
      if (latestPlan.nextErrors.length || JSON.stringify(latestPlan.next) !== JSON.stringify(preview)) {
        resetValidation();
        setStatus("error", "등록 정보가 바뀌었습니다. 파일을 다시 검증해 주세요.");
        return;
      }
      const catByName = new Map(existingCats.map((c) => [normalizeKey(c.name), c]));
      let createdCats = 0;
      let updatedCats = 0;

      if (needsCategoriesFile) {
        for (let i = 0; i < categoryRows.length; i += 1) {
          const row = categoryRows[i];
          const key = normalizeKey(row.category_name);
          const found = catByName.get(key);
          if (found) {
            const desiredOrder = row.sort_order ?? i + 1;
            if (found.name === row.category_name && Number(found.sort_order) === desiredOrder && Boolean(found.is_active) === row.is_active) continue;
            const { data, error } = await supabase
              .from("menu_categories")
              .update({ name: row.category_name, sort_order: desiredOrder, is_active: row.is_active })
              .eq("store_id", storeId)
              .eq("id", found.id)
              .select("id").maybeSingle();
            if (error || !data) throw error || new Error("카테고리 수정 권한을 확인해 주세요.");
            updatedCats += 1;
          } else {
            const newId = uid("cat");
            const { data, error } = await supabase.from("menu_categories").insert([
              { id: newId, store_id: storeId, name: row.category_name, sort_order: row.sort_order ?? i + 1, is_active: row.is_active },
            ]).select("id").single();
            if (error || !data) throw error || new Error("카테고리를 저장하지 못했습니다.");
            createdCats += 1;
            catByName.set(key, { id: newId, name: row.category_name, sort_order: row.sort_order ?? i + 1, is_active: row.is_active });
          }
        }
      }

      let createdMenus = 0;
      let updatedMenus = 0;
      if (needsMenusFile) {
        const menuByName = new Map(existingMenus.map((m) => [normalizeKey(m.name), m]));
        const usedMenuIds = existingMenus.map((m) => m.id);
        const maxSort = existingMenus.reduce((acc, cur) => Math.max(acc, Number(cur.sort_order || 0)), 0);

        for (let i = 0; i < menuRows.length; i += 1) {
          const row = menuRows[i];
          const key = normalizeKey(row.menu_name);
          const found = menuByName.get(key);
          const categoryId = row.category_name ? catByName.get(normalizeKey(row.category_name))?.id : undefined;
          if (found) {
            if (found.name === row.menu_name && Number(found.price) === row.price && Boolean(found.is_sold_out) === row.is_sold_out && (!categoryId || found.category_id === categoryId)) continue;
            const patch: Record<string, unknown> = { name: row.menu_name, price: row.price, is_sold_out: row.is_sold_out };
            if (categoryId) patch.category_id = categoryId;
            const { data, error } = await supabase
              .from("menu_items")
              .update(patch)
              .eq("store_id", storeId)
              .eq("id", found.id)
              .select("id").maybeSingle();
            if (error || !data) throw error || new Error("메뉴 수정 권한을 확인해 주세요.");
            updatedMenus += 1;
          } else {
            const id = buildNextMenuId(storeId, usedMenuIds);
            usedMenuIds.push(id);
            const { data, error } = await supabase.from("menu_items").insert([
              { id, store_id: storeId, name: row.menu_name, price: row.price, category_id: categoryId || null, is_sold_out: row.is_sold_out, image: "", option_group_ids: [], sort_order: maxSort + i + 1 },
            ]).select("id").single();
            if (error || !data) throw error || new Error("메뉴를 저장하지 못했습니다.");
            createdMenus += 1;
          }
        }
      }

      const nextResult = { createdCats, updatedCats, unchangedCats: preview?.unchangedCats || 0, createdMenus, updatedMenus, unchangedMenus: preview?.unchangedMenus || 0, uncategorizedMenus: preview?.uncategorizedMenus || 0 };
      setResult(nextResult);
      setStatus("success", `반영 완료: 카테고리 생성 ${createdCats} / 수정 ${updatedCats}, 메뉴 생성 ${createdMenus} / 수정 ${updatedMenus}`);
    } catch (e) {
      setStatus("error", `반영 중 오류가 발생했습니다. 일부 항목은 저장됐을 수 있습니다. 목록을 확인한 뒤 다시 검증해 주세요. (${String((e as Error)?.message || e)})`);
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
        body { background: var(--bg); color: var(--text); }
      `}</style>
      <style jsx>{`
        .wrap { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 14px; }
        .card { background: rgba(255, 255, 255, 0.96); border: 1px solid #e2e8f0; border-radius: 20px; padding: 18px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); display: grid; gap: 14px; }
        .hero { border-color: #bfdbfe; background: linear-gradient(135deg, #eff6ff 0%, #ffffff 58%); box-shadow: 0 14px 36px rgba(37, 99, 235, 0.09); }
        .heroActions { display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 2px; }
        .heroBtn { flex: 1 0 0; min-width: 0; min-height: 36px; padding: 8px 10px; font-size: 13px; white-space: nowrap; }
        .title { margin: 0; font-size: 28px; line-height: 1.15; letter-spacing: -0.03em; font-weight: 950; }
        .sectionTitle { margin: 0; font-size: 18px; font-weight: 950; color: #0f172a; }
        .muted { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0; }
        .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .btn { border: 1px solid #d1d5db; background: #fff; border-radius: 12px; padding: 10px 13px; font-weight: 900; cursor: pointer; color: #111827; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-height: 40px; transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease; }
        .btn:hover:not(:disabled) { border-color: #94a3b8; background: #f8fafc; box-shadow: 0 8px 18px rgba(15, 23, 42, 0.07); transform: translateY(-1px); }
        .btn:disabled { cursor: not-allowed; background: #f3f4f6; color: #9ca3af; box-shadow: none; transform: none; }
        .btnPrimary { background: #111827; color: #fff; border-color: #111827; box-shadow: 0 10px 20px rgba(17, 24, 39, 0.16); }
        .btnPrimary:hover:not(:disabled) { background: #1f2937; border-color: #1f2937; }
        .input { border: 1px solid #d1d5db; border-radius: 12px; padding: 10px 12px; background: #fff; color: #111827; min-height: 42px; }
        .modeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .modeCard { position: relative; overflow: hidden; text-align: left; border: 1px solid #e2e8f0; border-radius: 18px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); padding: 14px; cursor: pointer; display: grid; gap: 12px; min-height: 126px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05); transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease; }
        .modeCard::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: #e2e8f0; }
        .modeCard:hover { border-color: #bfdbfe; box-shadow: 0 14px 30px rgba(37, 99, 235, 0.10); transform: translateY(-1px); }
        .modeCardOn { border-color: #60a5fa; background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%); box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16), 0 16px 34px rgba(37, 99, 235, 0.14); }
        .modeCardOn::before { background: linear-gradient(90deg, #2563eb, #60a5fa); }
        .modeHead { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
        .modeIdentity { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .modeIcon { width: fit-content; min-width: 38px; height: 38px; border-radius: 999px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; background: #f1f5f9; color: #334155; font-size: 12px; font-weight: 950; flex: 0 0 auto; white-space: nowrap; }
        .modeCardOn .modeIcon { background: #dbeafe; color: #1d4ed8; }
        .modeTitleBlock { display: grid; gap: 3px; min-width: 0; }
        .modeStep { color: #64748b; font-size: 12px; font-weight: 950; letter-spacing: 0.04em; }
        .modeTitle { font-size: 16px; font-weight: 950; color: #0f172a; }
        .badge { border-radius: 999px; padding: 4px 8px; font-size: 12px; font-weight: 950; background: #e0f2fe; color: #075985; white-space: nowrap; }
        .modeStatus { width: fit-content; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 950; background: #f1f5f9; color: #475569; }
        .modeStatusOn { background: #dbeafe; color: #1d4ed8; }
        .modeDownload { justify-self: stretch; }
        .workGrid, .resultGrid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr); gap: 14px; align-items: stretch; }
        .miniCard { border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); display: grid; gap: 10px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8); }
        .miniTitle { font-weight: 950; color: #0f172a; }
        .guideBox { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; border-radius: 14px; padding: 12px; font-weight: 850; line-height: 1.5; }
        .fieldLabel { font-weight: 950; color: #334155; font-size: 13px; }
        .fileName { font-weight: 900; color: #0f172a; word-break: break-all; }
        .statusCard { border-radius: 16px; padding: 14px; border: 1px solid #e5e7eb; background: #f8fafc; display: grid; gap: 8px; }
        .statusSuccess { border-color: #86efac; background: #ecfdf5; color: #166534; }
        .statusError { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }
        .statusWarn { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
        .msg { border-radius: 12px; padding: 10px 12px; font-weight: 900; border: 1px solid #e5e7eb; background: #f8fafc; }
        .msgSuccess { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
        .msgError { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
        .errorList { display: grid; gap: 8px; }
        .errorCard { border: 1px solid #fecaca; background: #fff7f7; border-radius: 14px; padding: 12px; display: grid; gap: 6px; }
        .errorMeta { color: #991b1b; font-weight: 950; }
        .errorSolution { color: #7f1d1d; font-size: 13px; line-height: 1.45; }
        .countPill { border: 1px solid #dbeafe; background: #eff6ff; color: #1e3a8a; border-radius: 999px; padding: 6px 10px; font-weight: 950; }
        .changeList { max-height: 180px; overflow-y: auto; margin: 0; padding-left: 20px; color: #334155; font-size: 13px; line-height: 1.6; }
        .modalOverlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: grid; place-items: center; padding: 16px; z-index: 50; }
        .modalCard { width: min(100%, 460px); background: #fff; border-radius: 18px; padding: 18px; border: 1px solid #e5e7eb; box-shadow: 0 24px 70px rgba(15, 23, 42, 0.26); display: grid; gap: 12px; }
        .modalTitle { margin: 0; font-size: 18px; font-weight: 950; }
        .modalActions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
        @media (max-width: 760px) {
          .wrap { padding: 16px 12px 48px; }
          .card { padding: 14px; border-radius: 16px; }
          .title { font-size: 24px; }
          .modeGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .workGrid, .resultGrid { grid-template-columns: 1fr; }
          .modeCard { padding: 12px; min-height: 118px; }
          .modeHead { flex-direction: row; align-items: flex-start; gap: 8px; }
          .modeIdentity { align-items: flex-start; flex-direction: column; gap: 8px; }
          .modeIcon { min-width: 34px; height: 30px; border-radius: 999px; padding: 0 8px; font-size: 11px; }
          .modeStatus { flex: 0 0 auto; padding: 4px 7px; font-size: 11px; }
          .modeTitle { font-size: 15px; }
          .btn:not(.heroBtn), .input { width: 100%; }
          .heroActions { gap: 6px; }
          .heroBtn { padding: 7px 8px; font-size: 12px; }
          .row { align-items: stretch; }
          .modalActions { flex-direction: column-reverse; }
        }
        @media (min-width: 761px) and (max-width: 980px) {
          .wrap { max-width: 860px; }
          .workGrid { grid-template-columns: minmax(0, 1fr) minmax(260px, 0.92fr); }
        }
        @media (max-width: 420px) {
          .modeGrid { gap: 8px; }
          .modeCard { padding: 11px; }
          .modeDownload { padding-left: 8px; padding-right: 8px; font-size: 13px; }
        }
      `}</style>

      <AdminPageHeader title="일괄 등록" description="CSV 파일로 카테고리와 메뉴를 빠르게 등록합니다." storeId={storeId} storeName={storeName} eyebrow="MENU MANAGEMENT" />
      <MenuAdminNav active="import" storeId={storeId} />
      {!storeId ? <div className="statusCard statusWarn">관리자 홈에서 매장을 먼저 선택해 주세요.</div> : null}

      <section className="card">
        <div>
          <h2 className="sectionTitle">무엇을 등록할까요?</h2>
          <div className="summaryText" style={{ marginTop: 4 }}>
            <p className="muted">카테고리를 먼저 등록해 주세요.</p>
            <p className="muted">메뉴 파일에 카테고리명을 넣으면 함께 연결됩니다.</p>
          </div>
        </div>
        <div className="modeGrid">
          {targetOptions.map((option) => (
            <div
              key={option.key}
              className={`modeCard ${target === option.key ? "modeCardOn" : ""}`}
              onClick={() => onTargetChange(option.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onTargetChange(option.key);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="modeHead">
                <span className="modeIdentity">
                  <span className="modeIcon" aria-hidden="true">{option.icon}</span>
                  <span className="modeTitleBlock">
                    <span className="modeStep">STEP {option.step}</span>
                    <span className="modeTitle">{option.title}</span>
                  </span>
                </span>
                <span className={`modeStatus ${target === option.key ? "modeStatusOn" : ""}`}>
                  {target === option.key ? "선택됨" : "선택하기"}
                </span>
              </span>
              {target === option.key ? (
                <button
                  className="btn modeDownload"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (option.key === "categories") onDownloadCategoryTemplate();
                    if (option.key === "menus") onDownloadMenuTemplate();
                  }}
                  type="button"
                >
                  템플릿 다운로드
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="sectionTitle">1. 작성 방법 및 업로드</h2>
        {!storeId ? <div className="statusCard statusWarn">관리자 홈에서 매장을 먼저 선택하면 파일 검증을 실행할 수 있습니다.</div> : null}
        <div className="workGrid">
          {needsCategoriesFile ? (
            <>
              <div className="miniCard">
                <div className="miniTitle">카테고리 작성 규칙</div>
                <p className="muted"><b>필수</b> category_name: 카테고리명입니다. 예: 커피, 식사, 사이드</p>
                <p className="muted"><b>선택</b> sort_order: 숫자가 작을수록 먼저 보입니다.</p>
                <p className="muted"><b>선택</b> is_active: Y 또는 N으로 입력합니다. 비우면 Y입니다.</p>
                <div className="guideBox">첫 줄의 영문 컬럼명은 수정하지 마세요. 같은 카테고리명은 한 번만 입력해 주세요.</div>
              </div>
              <div className="miniCard">
                <div className="miniTitle">카테고리 파일 업로드</div>
                <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => { setCategoriesFile(e.target.files?.[0] || null); resetValidation(); }} />
                <div className="fileName">{categoriesFile ? `✅ ${categoriesFile.name}` : "아직 선택된 파일이 없습니다."}</div>
                <button className="btn btnPrimary" onClick={parseAndValidate} disabled={!canValidate || checking || saving} type="button">
                  {checking ? "검증 중..." : "검증 실행"}
                </button>
              </div>
            </>
          ) : null}
          {needsMenusFile ? (
            <>
              <div className="miniCard">
                <div className="miniTitle">메뉴 작성 규칙</div>
                <p className="muted"><b>필수</b> menu_name, price</p>
                <p className="muted"><b>선택</b> category_name: 등록된 카테고리명을 입력합니다.</p>
                <p className="muted"><b>선택</b> is_sold_out: Y 또는 N. 비우면 N입니다.</p>
                <p className="muted">price는 4500처럼 숫자만 입력합니다. 쉼표, 원, ₩ 기호는 제외해 주세요.</p>
                <div className="guideBox">기존 CSV도 사용할 수 있습니다. 카테고리명이 빈 새 메뉴는 나중에 직접 연결해야 합니다.</div>
              </div>
              <div className="miniCard">
                <div className="miniTitle">메뉴 파일 업로드</div>
                <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => { setMenusFile(e.target.files?.[0] || null); resetValidation(); }} />
                <div className="fileName">{menusFile ? `✅ ${menusFile.name}` : "아직 선택된 파일이 없습니다."}</div>
                <button className="btn btnPrimary" onClick={parseAndValidate} disabled={!canValidate || checking || saving} type="button">
                  {checking ? "검증 중..." : "검증 실행"}
                </button>
              </div>
            </>
          ) : null}
        </div>
        {msg ? <div className={`msg ${msgTone === "success" ? "msgSuccess" : msgTone === "error" ? "msgError" : ""}`.trim()}>{msg}</div> : null}
      </section>

      <section className="card">
        <h2 className="sectionTitle">2. 검증 결과</h2>
        {!hasValidated ? (
          <div className="statusCard statusWarn">파일을 선택한 뒤 검증 실행을 눌러주세요.</div>
        ) : errors.length === 0 ? (
          <div className="statusCard statusSuccess">
            <b>✅ 검증 완료</b>
            <span>{validationSummary}을 반영할 수 있습니다.</span>
          </div>
        ) : (
          <>
            <div className="statusCard statusError">
              <b>❌ 수정이 필요한 항목 {errors.length}건</b>
              <span>파일을 수정한 뒤 다시 업로드해 주세요.</span>
            </div>
            <div className="errorList">
              {errors.map((err, idx) => (
                <div className="errorCard" key={`${err.sheet}-${err.row}-${err.column}-${idx}`}>
                  <div className="errorMeta">{err.sheet}.csv / {err.row}행 / {err.column}</div>
                  <div>{err.message}</div>
                  <div className="muted">입력값: {err.value || "-"}</div>
                  <div className="errorSolution">해결: {err.solution}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="sectionTitle">3. 반영 예정</h2>
        {preview ? (
          <>
            <div className="row">
              {needsCategoriesFile ? <span className="countPill">카테고리 새로 등록 {preview.createdCats} · 수정 {preview.updatedCats} · 변경 없음 {preview.unchangedCats}</span> : null}
              {needsMenusFile ? <span className="countPill">메뉴 새로 등록 {preview.createdMenus} · 수정 {preview.updatedMenus} · 변경 없음 {preview.unchangedMenus}</span> : null}
            </div>
            {preview.uncategorizedMenus > 0 ? <div className="guideBox">카테고리 미지정 메뉴 {preview.uncategorizedMenus}개는 등록 후 메뉴 관리에서 연결해 주세요.</div> : null}
            {preview.menuChanges.length > 0 ? (
              <details>
                <summary>수정될 메뉴 {preview.menuChanges.length}개 보기</summary>
                <ul className="changeList">{preview.menuChanges.map((change) => <li key={change}>{change}</li>)}</ul>
              </details>
            ) : null}
          </>
        ) : <p className="muted">파일을 검증하면 새로 등록하거나 수정할 항목이 표시됩니다.</p>}
        <p className="muted">같은 이름의 기존 항목은 새로 만들지 않고 변경된 값만 수정합니다.</p>
        <div className="row">
          <button className="btn btnPrimary" onClick={openApplyConfirm} disabled={checking || saving || !canApply} type="button">
            {saving ? "반영 중..." : "검증 통과 데이터 반영"}
          </button>
        </div>
      </section>

      {result ? (
        <section className="card statusSuccess">
          <h2 className="sectionTitle">✅ 반영 완료</h2>
          <p className="muted">카테고리 생성 {result.createdCats} / 수정 {result.updatedCats}, 메뉴 생성 {result.createdMenus} / 수정 {result.updatedMenus}</p>
          {result.uncategorizedMenus > 0 ? <p className="muted">카테고리 미지정 메뉴 {result.uncategorizedMenus}개는 메뉴 관리에서 연결해 주세요.</p> : null}
          <div className="row">
            {target === "categories" ? <a className="btn btnPrimary" href={`/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}&mode=bulk` : ""}`}>옵션 설정으로 이동</a> : null}
            {target === "menus" ? <a className="btn btnPrimary" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}&mode=bulk` : ""}`}>메뉴 관리로 이동</a> : null}
            <a className="btn" href={`/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}&mode=bulk` : ""}`}>메뉴관리</a>
            <a className="btn" href={`/admin/categories${storeId ? `?store=${encodeURIComponent(storeId)}&mode=bulk` : ""}`}>카테고리관리</a>
          </div>
        </section>
      ) : null}

      {confirmOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-labelledby="import-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}>
          <div className="modalCard">
            <h3 id="import-confirm-title" className="modalTitle">일괄 등록을 반영할까요?</h3>
            <p className="muted">{targetMeta.title} 데이터를 현재 매장에 반영합니다.</p>
            {preview ? <div className="guideBox">새로 등록 {preview.createdCats + preview.createdMenus}개 · 기존 항목 수정 {preview.updatedCats + preview.updatedMenus}개. 기존 항목의 변경된 값은 덮어씁니다.</div> : null}
            {preview?.menuChanges.length ? <ul className="changeList">{preview.menuChanges.map((change) => <li key={change}>{change}</li>)}</ul> : null}
            <div className="modalActions">
              <button className="btn" type="button" onClick={() => setConfirmOpen(false)} disabled={saving}>취소</button>
              <button className="btn btnPrimary" type="button" onClick={() => void applyImport()} disabled={saving}>{saving ? "반영 중..." : "반영하기"}</button>
            </div>
          </div>
        </div>
      ) : null}
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
