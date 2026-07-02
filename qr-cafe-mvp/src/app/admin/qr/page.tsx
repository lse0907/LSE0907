// src/app/admin/qr/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";
import { useStoreProfile } from "@/app/lib/storeProfile";

type AdminQrCode = {
  id: string;
  store_id: string;
  qr_type: "counter" | "table" | "pickup" | "custom";
  label: string;
  table_no: number | null;
  target_url: string;
  status: "active" | "inactive" | "archived";
  sort_order: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AdminQrDesignSettings = {
  store_id: string;
  template_key: string;
  accent_color: string;
  counter_title: string;
  counter_description: string;
  table_title: string;
  table_description: string;
  show_logo: boolean;
  show_main_image: boolean;
  show_store_name: boolean;
  show_target_url: boolean;
  counter_print_preset: string;
  table_print_preset: string;
};

const START_PATH = "/";
type PrintTarget = "counter" | "table";
type CounterPrintPreset = "a5_card" | "a4_poster" | "a3_poster" | "a4_2up";
type TablePrintPreset = "a4_12" | "a4_8" | "a4_4";
type TemplateKey = "simple" | "cafe_poster" | "premium_dark" | "soft_round";

type PaperPreset = {
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  copies?: number;
};

const COUNTER_PRINT_PRESETS: Record<CounterPrintPreset, PaperPreset> = {
  a5_card: { label: "A5 카드", shortLabel: "A5", width: 874, height: 1240, copies: 1 },
  a4_poster: { label: "A4 포스터", shortLabel: "A4", width: 1240, height: 1754, copies: 1 },
  a3_poster: { label: "A3 대형", shortLabel: "A3", width: 1754, height: 2480, copies: 1 },
  a4_2up: { label: "A4 2분할", shortLabel: "2분할", width: 1240, height: 1754, copies: 2 },
};

const TABLE_PRINT_PRESETS: Record<TablePrintPreset, { label: string; cols: number; rows: number }> = {
  a4_12: { label: "A4 12분할", cols: 3, rows: 4 },
  a4_8: { label: "A4 8분할 추천", cols: 2, rows: 4 },
  a4_4: { label: "A4 4분할", cols: 2, rows: 2 },
};

const TEMPLATE_OPTIONS: Array<{ key: TemplateKey; label: string; hint: string }> = [
  { key: "simple", label: "심플", hint: "기본" },
  { key: "cafe_poster", label: "카페", hint: "이미지" },
  { key: "premium_dark", label: "다크", hint: "고급" },
  { key: "soft_round", label: "소프트", hint: "부드럽게" },
];

const ACCENT_COLORS = ["#111827", "#7c3aed", "#b45309", "#047857", "#be123c"];

const QR_VERSION_DATA = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewords: 7, align: [] as number[] },
  { version: 2, size: 25, dataCodewords: 34, eccCodewords: 10, align: [6, 18] },
  { version: 3, size: 29, dataCodewords: 55, eccCodewords: 15, align: [6, 22] },
  { version: 4, size: 33, dataCodewords: 80, eccCodewords: 20, align: [6, 26] },
  { version: 5, size: 37, dataCodewords: 108, eccCodewords: 26, align: [6, 30] },
];

const FORMAT_BITS_L_MASK_0 = "111011111000100";

function getQrVersion(text: string) {
  const bytes = new TextEncoder().encode(text);
  const neededBits = 4 + 8 + bytes.length * 8;
  const picked = QR_VERSION_DATA.find((v) => v.dataCodewords * 8 >= neededBits + 4);
  if (!picked) throw new Error("QR URL이 너무 깁니다. 짧은 도메인 또는 QR ID 방식이 필요합니다.");
  return { ...picked, bytes };
}

function gfMul(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z & 0xff;
}

function reedSolomonGenerator(degree: number) {
  let result = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= gfMul(result[j], root);
      next[j + 1] ^= result[j];
    }
    result = next;
    root = gfMul(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

function appendBits(out: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

function bitsToCodewords(bits: number[]) {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] || 0);
    out.push(b);
  }
  return out;
}

function createReserved(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function createModules(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(false));
}

function setModule(modules: boolean[][], reserved: boolean[][], x: number, y: number, dark: boolean, reserve = true) {
  if (x < 0 || y < 0 || y >= modules.length || x >= modules.length) return;
  modules[y][x] = dark;
  if (reserve) reserved[y][x] = true;
}

function drawFinder(modules: boolean[][], reserved: boolean[][], x: number, y: number) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setModule(modules, reserved, xx, yy, dark);
    }
  }
}

function drawAlignment(modules: boolean[][], reserved: boolean[][], cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
      setModule(modules, reserved, cx + dx, cy + dy, dark);
    }
  }
}

function drawFunctionPatterns(modules: boolean[][], reserved: boolean[][], version: number, align: number[]) {
  const size = modules.length;
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, size - 7, 0);
  drawFinder(modules, reserved, 0, size - 7);

  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setModule(modules, reserved, i, 6, dark);
    setModule(modules, reserved, 6, i, dark);
  }

  if (version > 1) {
    for (const y of align) {
      for (const x of align) {
        if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
        drawAlignment(modules, reserved, x, y);
      }
    }
  }

  setModule(modules, reserved, 8, size - 8, true);
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
}

function drawFormatBits(modules: boolean[][], reserved: boolean[][]) {
  const size = modules.length;
  const bits = FORMAT_BITS_L_MASK_0.split("").map((b) => b === "1");
  const pos1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  const pos2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  pos1.forEach(([x, y], i) => setModule(modules, reserved, x, y, bits[i]));
  pos2.forEach(([x, y], i) => setModule(modules, reserved, x, y, bits[i]));
}

function createQrModules(text: string) {
  const { version, size, dataCodewords, eccCodewords, align, bytes } = getQrVersion(text);
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const b of bytes) appendBits(bits, b, 8);
  appendBits(bits, 0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = bitsToCodewords(bits);
  for (let pad = 0xec; data.length < dataCodewords; pad ^= 0xec ^ 0x11) data.push(pad);
  const codewords = [...data, ...reedSolomonRemainder(data, eccCodewords)];
  const allBits: number[] = [];
  for (const cw of codewords) appendBits(allBits, cw, 8);

  const modules = createModules(size);
  const reserved = createReserved(size);
  drawFunctionPatterns(modules, reserved, version, align);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        if (reserved[y][x]) continue;
        const raw = bitIndex < allBits.length ? allBits[bitIndex++] === 1 : false;
        modules[y][x] = raw !== ((x + y) % 2 === 0);
      }
    }
    upward = !upward;
  }

  drawFormatBits(modules, reserved);
  return modules;
}

function createQrDataUrl(text: string, pixelSize = 720) {
  const modules = createQrModules(text);
  const moduleCount = modules.length;
  const quiet = 4;
  const canvas = document.createElement("canvas");
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("QR 캔버스를 만들 수 없습니다.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixelSize, pixelSize);
  const cell = Math.floor(pixelSize / (moduleCount + quiet * 2));
  const offset = Math.floor((pixelSize - cell * (moduleCount + quiet * 2)) / 2) + quiet * cell;
  ctx.fillStyle = "#111827";
  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (modules[y][x]) ctx.fillRect(offset + x * cell, offset + y * cell, cell, cell);
    }
  }
  return canvas.toDataURL("image/png");
}

function clampInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function parseTableList(input: string): number[] {
  const s = (input || "").trim();
  if (!s) return [];

  const parts = s
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*(?:~|-)\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let i = start; i <= end; i++) out.push(i);
      }
      continue;
    }
    const n = Number(p);
    if (Number.isFinite(n)) out.push(Math.floor(n));
  }

  return uniq(out).filter((n) => n > 0).sort((a, b) => a - b);
}

function safePathJoin(origin: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatTableLabel(n: number) {
  return `테이블 ${n}`;
}

function withQuery(url: string, params: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function newClientId(prefix: string) {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeTemplateKey(v: unknown): TemplateKey {
  return v === "cafe_poster" || v === "premium_dark" || v === "soft_round" ? v : "simple";
}

function normalizeColor(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#111827";
}

function normalizeBool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function designWithDefaults(storeId: string, counterDescription: string, row?: Partial<AdminQrDesignSettings> | null): AdminQrDesignSettings {
  const fallback = defaultDesignSettings(storeId, counterDescription);
  if (!row) return fallback;
  return {
    ...fallback,
    ...row,
    store_id: storeId,
    template_key: normalizeTemplateKey(row.template_key),
    accent_color: normalizeColor(row.accent_color),
    counter_title: String(row.counter_title || fallback.counter_title),
    counter_description: String(row.counter_description || fallback.counter_description),
    table_title: String(row.table_title || fallback.table_title),
    table_description: String(row.table_description || fallback.table_description),
    show_logo: normalizeBool(row.show_logo, fallback.show_logo),
    show_main_image: normalizeBool(row.show_main_image, fallback.show_main_image),
    show_store_name: normalizeBool(row.show_store_name, fallback.show_store_name),
    show_target_url: normalizeBool(row.show_target_url, fallback.show_target_url),
  };
}

function defaultDesignSettings(storeId: string, counterDescription: string): AdminQrDesignSettings {
  return {
    store_id: storeId,
    template_key: "simple",
    accent_color: "#111827",
    counter_title: "QR로 간편하게 주문하세요",
    counter_description: counterDescription,
    table_title: "테이블에서 바로 주문",
    table_description: "QR을 찍고 메뉴를 선택해 주세요.",
    show_logo: true,
    show_main_image: true,
    show_store_name: true,
    show_target_url: false,
    counter_print_preset: "a4_2up",
    table_print_preset: "a4_12",
  };
}

function normalizeQrStatus(v: unknown): AdminQrCode["status"] {
  return v === "inactive" || v === "archived" ? v : "active";
}

function normalizeQrType(v: unknown): AdminQrCode["qr_type"] {
  return v === "table" || v === "pickup" || v === "custom" ? v : "counter";
}

function rowToQrCode(row: Record<string, unknown>): AdminQrCode {
  return {
    id: String(row?.id || ""),
    store_id: String(row?.store_id || ""),
    qr_type: normalizeQrType(row?.qr_type),
    label: String(row?.label || ""),
    table_no: row.table_no === null || row.table_no === undefined ? null : Number(row.table_no),
    target_url: String(row?.target_url || ""),
    status: normalizeQrStatus(row?.status),
    sort_order: row.sort_order === null || row.sort_order === undefined ? null : Number(row.sort_order),
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function AdminQrPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [origin, setOrigin] = useState<string>("");

  // ✅ 선택 매장
  const [storeId, setStoreId] = useState<string>("");

  const { profile } = useStoreProfile(storeId);

  // ✅ 화면에서만 쓰는(선택) 값들
  const [makeCounter, setMakeCounter] = useState(true);
  const [makeTables, setMakeTables] = useState(false);
  const [printTarget, setPrintTarget] = useState<PrintTarget>("counter");
  const [counterPrintPreset, setCounterPrintPreset] = useState<CounterPrintPreset>("a4_2up");
  const [tablePrintPreset, setTablePrintPreset] = useState<TablePrintPreset>("a4_8");

  const [rangeStart, setRangeStart] = useState("1");
  const [rangeEnd, setRangeEnd] = useState("20");
  const [customTables, setCustomTables] = useState("");

  const [qrRows, setQrRows] = useState<AdminQrCode[]>([]);
  const [designSettings, setDesignSettings] = useState<AdminQrDesignSettings | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrSaving, setQrSaving] = useState(false);
  const [qrMsg, setQrMsg] = useState("");
  const [qrMsgTone, setQrMsgTone] = useState<"success" | "error" | "neutral">("neutral");

  // ✅ 카운터 안내 문구는 QR페이지에서 별도로 관리(현재는 storeProfile 저장 대상 아님)
  const [counterDesc] = useState(
    "QR로 간편하게 주문하고 기다리세요.\n주문 후 직원 안내에 따라 픽업/수령해 주세요."
  );

  // ✅ storeId 결정: query > currentStore
  useEffect(() => {
    const q = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = q || saved;

    if (!sid) {
      // 선택 매장 없이 들어오면 관리자 홈으로
      router.replace("/admin");
      return;
    }
    setStoreId(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const storeName = profile?.storeName ?? "카페 브라운";
  const mainImage = profile?.mainImage ?? "/hero.jpg";
  const logoImage = profile?.logoImage ?? "";

  const pendingTableNumbers = useMemo(() => {
    const a = clampInt(rangeStart, 1);
    const b = clampInt(rangeEnd, 20);

    const start = Math.min(a, b);
    const end = Math.max(a, b);

    const range: number[] = [];
    for (let i = start; i <= end; i++) range.push(i);

    const custom = parseTableList(customTables);

    return uniq([...range, ...custom]).filter((n) => n > 0).sort((x, y) => x - y);
  }, [rangeStart, rangeEnd, customTables]);

  const counterQr = useMemo(
    () => qrRows.find((row) => row.qr_type === "counter" && row.status === "active") || null,
    [qrRows]
  );

  const activeTableQrs = useMemo(
    () =>
      qrRows
        .filter((row) => row.qr_type === "table" && row.status === "active" && Number(row.table_no) > 0)
        .sort((a, b) => Number(a.table_no) - Number(b.table_no)),
    [qrRows]
  );

  const tableNumbers = useMemo(
    () => (makeTables ? activeTableQrs.map((row) => Number(row.table_no)).filter((n) => n > 0) : []),
    [activeTableQrs, makeTables]
  );

  const inactiveCount = useMemo(() => qrRows.filter((row) => row.status !== "active").length, [qrRows]);

  const baseStartUrl = useMemo(() => {
    if (!origin) return "";
    return safePathJoin(origin, START_PATH);
  }, [origin]);

  // ✅ 핵심: store 파라미터를 항상 넣는다
  const counterUrl = useMemo(() => {
    if (!baseStartUrl || !storeId) return "";
    return withQuery(baseStartUrl, { store: storeId });
  }, [baseStartUrl, storeId]);

  const tableUrl = (n: number) => {
    if (!baseStartUrl || !storeId) return "";
    return withQuery(baseStartUrl, { store: storeId, table: String(n) });
  };

  const refreshQrData = async () => {
    if (!storeId) return;
    setQrLoading(true);
    setQrMsg("");
    setQrMsgTone("neutral");

    const [qrRes, designRes] = await Promise.all([
      supabase
        .from("store_qr_codes")
        .select("id,store_id,qr_type,label,table_no,target_url,status,sort_order,created_at,updated_at")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("store_qr_design_settings").select("*").eq("store_id", storeId).maybeSingle(),
    ]);

    if (qrRes.error) {
      setQrRows([]);
      setQrMsgTone("error");
      setQrMsg(
        `QR 목록을 불러오지 못했습니다. Supabase SQL 적용 여부를 확인해 주세요. (${qrRes.error.message})`
      );
    } else {
      setQrRows((Array.isArray(qrRes.data) ? qrRes.data : []).map(rowToQrCode));
    }

    if (designRes.error) {
      const next = designWithDefaults(storeId, counterDesc);
      setDesignSettings(next);
      setCounterPrintPreset(next.counter_print_preset as CounterPrintPreset);
      setTablePrintPreset(next.table_print_preset as TablePrintPreset);
      setQrMsgTone((prev) => (prev === "error" ? prev : "neutral"));
    } else {
      const row = designRes.data as Partial<AdminQrDesignSettings> | null;
      const next = designWithDefaults(storeId, counterDesc, row);
      setDesignSettings(next);
      if (next.counter_print_preset in COUNTER_PRINT_PRESETS) setCounterPrintPreset(next.counter_print_preset as CounterPrintPreset);
      if (next.table_print_preset in TABLE_PRINT_PRESETS) setTablePrintPreset(next.table_print_preset as TablePrintPreset);
    }

    setQrLoading(false);
  };

  useEffect(() => {
    refreshQrData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  async function ensureDesignSettings() {
    if (!storeId) return;
    const payload = {
      ...(designSettings || defaultDesignSettings(storeId, counterDesc)),
      store_id: storeId,
      counter_print_preset: counterPrintPreset,
      table_print_preset: tablePrintPreset,
    };
    const { error } = await supabase.from("store_qr_design_settings").upsert(payload, { onConflict: "store_id" });
    if (error) throw error;
    setDesignSettings(payload);
  }

  const updateDesignSetting = <K extends keyof AdminQrDesignSettings>(key: K, value: AdminQrDesignSettings[K]) => {
    setDesignSettings((prev) => ({
      ...(prev || defaultDesignSettings(storeId, counterDesc)),
      store_id: storeId,
      [key]: value,
    }));
  };

  async function saveDesignSettings() {
    if (!storeId) return;
    setQrSaving(true);
    setQrMsg("");
    try {
      await ensureDesignSettings();
      setQrMsgTone("success");
      setQrMsg("디자인 저장됨");
    } catch (e: unknown) {
      setQrMsgTone("error");
      setQrMsg(`디자인 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  async function ensureCounterQr() {
    if (!origin || !storeId || !counterUrl) {
      setQrMsgTone("error");
      setQrMsg("선택된 매장 또는 브라우저 주소 정보를 확인할 수 없습니다.");
      return;
    }
    if (counterQr) {
      setQrMsgTone("neutral");
      setQrMsg("이미 사용 중인 카운터 QR이 있습니다. 기존 QR을 재사용합니다.");
      return;
    }

    setQrSaving(true);
    setQrMsg("");
    try {
      await ensureDesignSettings();
      const payload = {
        id: newClientId("qr_counter"),
        store_id: storeId,
        qr_type: "counter",
        label: "카운터 QR",
        table_no: null,
        target_url: counterUrl,
        status: "active",
        sort_order: 0,
      };
      const { error } = await supabase.from("store_qr_codes").insert([payload]);
      if (error) throw error;
      setQrMsgTone("success");
      setQrMsg("카운터 QR을 저장했습니다. 앞으로 이 QR을 재사용할 수 있습니다.");
      await refreshQrData();
    } catch (e: unknown) {
      setQrMsgTone("error");
      setQrMsg(`카운터 QR 저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  async function addTableQrs() {
    if (!origin || !storeId || !baseStartUrl) {
      setQrMsgTone("error");
      setQrMsg("선택된 매장 또는 브라우저 주소 정보를 확인할 수 없습니다.");
      return;
    }
    if (!pendingTableNumbers.length) {
      setQrMsgTone("error");
      setQrMsg("추가할 테이블 번호를 입력해 주세요.");
      return;
    }

    const existing = new Set(activeTableQrs.map((row) => Number(row.table_no)));
    const createNums = pendingTableNumbers.filter((n) => !existing.has(n));
    if (!createNums.length) {
      setQrMsgTone("neutral");
      setQrMsg("입력한 테이블 QR은 이미 모두 등록되어 있습니다.");
      return;
    }

    setQrSaving(true);
    setQrMsg("");
    try {
      await ensureDesignSettings();
      const payload = createNums.map((n) => ({
        id: newClientId(`qr_t${n}`),
        store_id: storeId,
        qr_type: "table",
        label: formatTableLabel(n),
        table_no: n,
        target_url: tableUrl(n),
        status: "active",
        sort_order: n,
      }));
      const { error } = await supabase.from("store_qr_codes").insert(payload);
      if (error) throw error;
      setMakeTables(true);
      setQrMsgTone("success");
      setQrMsg(`테이블 QR ${createNums.length}개를 추가했습니다. 기존 QR은 중복 생성하지 않았습니다.`);
      await refreshQrData();
    } catch (e: unknown) {
      setQrMsgTone("error");
      setQrMsg(`테이블 QR 추가 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  async function updateQrStatus(row: AdminQrCode, status: AdminQrCode["status"]) {
    setQrSaving(true);
    setQrMsg("");
    try {
      const { error } = await supabase
        .from("store_qr_codes")
        .update({ status })
        .eq("id", row.id)
        .eq("store_id", storeId);
      if (error) throw error;
      setQrMsgTone("success");
      setQrMsg(`${row.label} 상태를 ${status === "active" ? "사용 중" : "비활성"}으로 변경했습니다.`);
      await refreshQrData();
    } catch (e: unknown) {
      setQrMsgTone("error");
      setQrMsg(`QR 상태 변경 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  // ==========================
  // ✅ 카운터 PNG (A4 1장에 2개)
  // ==========================
  async function downloadCounterPng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeCounter) {
      alert("카운터 QR 생성 체크박스를 켜주세요.");
      return;
    }

    const ds = designSettings || defaultDesignSettings(storeId, counterDesc);
    const preset = COUNTER_PRINT_PRESETS[counterPrintPreset];
    const A4_W = preset.width;
    const A4_H = preset.height;
    const copies = preset.copies || 1;
    const posterH = Math.floor(A4_H / copies);

    const padding = Math.max(42, Math.round(A4_W * 0.04));
    const imgH = Math.floor(posterH * (counterPrintPreset === "a5_card" ? 0.54 : 0.62));
    const bottomH = posterH - imgH;

    const qrSrc = createQrDataUrl(counterQr?.target_url || counterUrl, 720);
    const [qrImg] = await Promise.all([
      loadImage(qrSrc).catch((e) => {
        throw new Error("QR 이미지 로드 실패\n" + String(e));
      }),
    ]);

    const heroImg = ds.show_main_image ? await loadImage(mainImage).catch(() => null) : null;
    const logoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;

    const canvas = document.createElement("canvas");
    canvas.width = A4_W;
    canvas.height = A4_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_W, A4_H);

    const qrSize = Math.min(Math.round(A4_W * 0.24), Math.round(bottomH * 0.72), 360);

    for (let i = 0; i < copies; i++) {
      const topY = i * posterH;

      if (heroImg) {
        const sw = heroImg.naturalWidth;
        const sh = heroImg.naturalHeight;

        const targetW = A4_W;
        const targetH = imgH;
        const srcRatio = sw / sh;
        const dstRatio = targetW / targetH;

        let cropW = sw;
        let cropH = sh;
        let cropX = 0;
        let cropY = 0;

        if (srcRatio > dstRatio) {
          cropW = Math.floor(sh * dstRatio);
          cropX = Math.floor((sw - cropW) / 2);
        } else {
          cropH = Math.floor(sw / dstRatio);
          cropY = Math.floor((sh - cropH) / 2);
        }

        ctx.drawImage(heroImg, cropX, cropY, cropW, cropH, 0, topY, targetW, targetH);
      } else {
        const g = ctx.createLinearGradient(0, topY, A4_W, topY + imgH);
        g.addColorStop(0, ds.template_key === "soft_round" ? ds.accent_color : "#111827");
        g.addColorStop(1, ds.template_key === "premium_dark" ? "#030712" : "#374151");
        ctx.fillStyle = g;
        ctx.fillRect(0, topY, A4_W, imgH);
      }

      ctx.fillStyle = ds.template_key === "soft_round" ? "#fff7ed" : ds.template_key === "premium_dark" ? "#030712" : ds.accent_color || "#111827";
      ctx.fillRect(0, topY + imgH, A4_W, bottomH);

      const textX = padding;
      const textY = topY + imgH + padding;

      const logoBox = 70;
      if (logoImg) {
        roundRect(
          ctx,
          textX,
          textY,
          logoBox,
          logoBox,
          18,
          "rgba(255,255,255,0.12)",
          "rgba(255,255,255,0.22)"
        );
        ctx.save();
        ctx.beginPath();
        roundedClipPath(ctx, textX, textY, logoBox, logoBox, 18);
        ctx.clip();
        ctx.drawImage(logoImg, textX, textY, logoBox, logoBox);
        ctx.restore();
      } else {
        roundRect(
          ctx,
          textX,
          textY,
          logoBox,
          logoBox,
          18,
          "rgba(255,255,255,0.12)",
          "rgba(255,255,255,0.22)"
        );
        ctx.fillStyle = "#ffffff";
        ctx.font =
          "900 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText("QR", textX + 20, textY + 46);
      }

      ctx.fillStyle = "#ffffff";
      ctx.font =
        "950 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, textX + logoBox + 18, textY + 34);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font =
        "850 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(ds.counter_title, textX + logoBox + 18, textY + 62);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font =
        "800 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      const lines = (ds.counter_description || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      let dy = textY + 96;
      for (const line of lines.slice(0, 3)) {
        ctx.fillText(line, textX, dy);
        dy += 26;
      }

      const qrX = A4_W - padding - qrSize;
      const qrY = topY + imgH + Math.floor((bottomH - qrSize) / 2);

      roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 18, "#ffffff", "rgba(255,255,255,0.18)");
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font =
        "800 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      if (ds.show_target_url) ctx.fillText(trimMiddle(counterUrl, 68), padding, topY + posterH - 22);

      if (i < copies - 1) {
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, posterH);
        ctx.lineTo(A4_W, posterH);
        ctx.stroke();
      }
    }

    downloadCanvasAsPng(canvas, `counter-qr_${storeId}_${counterPrintPreset}_${Date.now()}.png`);
  }

  // ==========================
  // ✅ 테이블 PNG (A4 3x4 = 12개/장)
  // ==========================
  async function downloadTablePng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeTables) {
      alert("테이블 QR 생성 체크박스를 켜주세요.");
      return;
    }
    if (tableNumbers.length === 0) {
      alert("테이블 번호가 없습니다. 범위/추가 테이블을 입력해 주세요.");
      return;
    }

    const ds = designSettings || defaultDesignSettings(storeId, counterDesc);
    const A4_W = 1240;
    const A4_H = 1754;

    const preset = TABLE_PRINT_PRESETS[tablePrintPreset];
    const COLS = preset.cols;
    const ROWS = preset.rows;
    const PER_PAGE = COLS * ROWS;

    const padding = 34;
    const gap = 18;

    const cardW = Math.floor((A4_W - padding * 2 - gap * (COLS - 1)) / COLS);
    const cardH = Math.floor((A4_H - padding * 2 - gap * (ROWS - 1)) / ROWS);

    const innerPad = 16;
    const labelH = 76;
    const qrSize = Math.min(240, cardW - innerPad * 2);

    const pages: number[][] = [];
    for (let i = 0; i < tableNumbers.length; i += PER_PAGE) {
      pages.push(tableNumbers.slice(i, i + PER_PAGE));
    }

    for (let p = 0; p < pages.length; p++) {
      const nums = pages[p];

      const qrPromises = nums.map((n) => {
        const url = tableUrl(n);
        const src = createQrDataUrl(url, 720);
        return loadImage(src).then((img) => ({ n, img, url }));
      });

      let loaded: Array<{ n: number; img: HTMLImageElement; url: string }>;
      try {
        loaded = await Promise.all(qrPromises);
      } catch (e) {
        alert("테이블 QR 로드 실패\n" + String(e));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = A4_W;
      canvas.height = A4_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, A4_W, A4_H);

      ctx.fillStyle = "#111827";
      ctx.font =
        "900 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(`${ds.show_store_name ? storeName : ds.table_title} · 테이블 QR`, padding, 26);

      for (let i = 0; i < loaded.length; i++) {
        const row = Math.floor(i / COLS);
        const col = i % COLS;

        const x = padding + col * (cardW + gap);
        const y = padding + row * (cardH + gap) + 10;

        roundRect(ctx, x, y, cardW, cardH, 16, "#ffffff", "#e5e7eb");

        ctx.fillStyle = "#111827";
        ctx.font =
          "950 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(ds.show_store_name ? storeName : ds.table_title, x + innerPad, y + 28);

        ctx.fillStyle = "#111827";
        ctx.font =
          "950 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(formatTableLabel(loaded[i].n), x + innerPad, y + 56);

        const qrX = x + Math.floor((cardW - qrSize) / 2);
        const qrY = y + labelH;

        roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 14, "#ffffff", "#e5e7eb");
        ctx.drawImage(loaded[i].img, qrX, qrY, qrSize, qrSize);

        ctx.fillStyle = "#9ca3af";
        ctx.font =
          "800 10.5px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        if (ds.show_target_url) ctx.fillText(trimMiddle(loaded[i].url, 52), x + innerPad, y + cardH - 14);
      }

      downloadCanvasAsPng(canvas, `table-qr_${storeId}_${tablePrintPreset}_${p + 1}of${pages.length}_${Date.now()}.png`);
      if (pages.length > 1) await sleep(350);
    }
  }

  const effectiveDesign = designSettings || defaultDesignSettings(storeId, counterDesc);

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
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
        }
        .topbar {
          display: grid;
          gap: 6px;
          margin-bottom: 10px;
        }
        .titleRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .h1 {
          margin: 0;
          font-size: 26px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .pill {
          font-size: 12px;
          font-weight: 900;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #fff;
          color: #6b7280;
          white-space: nowrap;
        }
        .desc {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.4;
          font-weight: 750;
          word-break: keep-all;
        }
        .panelGrid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 10px;
          align-items: start;
          margin-top: 10px;
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
        .formGrid {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
        }
        .input,
        .textarea {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          font-weight: 800;
          width: 100%;
        }
        .textarea {
          min-height: 72px;
          resize: vertical;
          white-space: pre-wrap;
        }
        .compactTextarea {
          min-height: 58px;
        }
        .checkRow {
          display: grid;
          gap: 8px;
        }
        .checkItem {
          display: flex;
          gap: 10px;
          align-items: center;
          font-weight: 900;
          color: var(--text);
        }
        .checkItem small {
          color: var(--muted);
          font-weight: 800;
        }
        .row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 10px;
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
        .btn:disabled,
        .btnPrimary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .hint {
          margin-top: 8px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }
        .statusGrid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-top: 10px;
        }
        .statCard {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
        }
        .statNum {
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.03em;
        }
        .msg {
          margin-top: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.45;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--muted);
        }
        .msg.success {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .msg.error {
          border-color: #fecaca;
          background: #fef2f2;
          color: #991b1b;
        }
        .manageGrid {
          display: grid;
          grid-template-columns: 0.95fr 1.05fr;
          gap: 10px;
          margin-top: 10px;
        }
        .qrList {
          display: grid;
          gap: 8px;
          margin-top: 10px;
          max-height: 360px;
          overflow: auto;
          padding-right: 2px;
        }
        .qrRow {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: center;
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 10px;
          background: #fff;
        }
        .qrMeta {
          display: grid;
          gap: 3px;
          min-width: 0;
        }
        .qrName {
          font-size: 13px;
          font-weight: 950;
        }
        .qrSmall {
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.35;
          word-break: break-all;
        }
        .badge {
          display: inline-flex;
          width: fit-content;
          padding: 4px 8px;
          border-radius: 999px;
          background: #f3f4f6;
          color: #4b5563;
          font-size: 11px;
          font-weight: 950;
        }
        .presetGrid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        .presetBtn {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 14px;
          padding: 12px;
          text-align: left;
          cursor: pointer;
          display: grid;
          gap: 4px;
        }
        .presetBtn strong {
          font-size: 13px;
          font-weight: 950;
        }
        .presetBtn span {
          min-height: 15px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 900;
        }
        .presetBtn.selected {
          border-color: var(--brand);
          box-shadow: 0 0 0 2px rgba(17,24,39,0.08);
        }
        .designGrid {
          display: grid;
          gap: 10px;
        }
        .colorRow,
        .toggleRow {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .colorBtn {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          border: 2px solid #fff;
          box-shadow: 0 0 0 1px var(--line);
          cursor: pointer;
        }
        .colorBtn.selected { box-shadow: 0 0 0 3px rgba(17,24,39,0.22); }
        .toggleChip {
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 999px;
          padding: 8px 11px;
          font-size: 12px;
          font-weight: 950;
          cursor: pointer;
        }
        .toggleChip.selected {
          color: #fff;
          background: var(--brand);
          border-color: var(--brand);
        }
        .summaryBox {
          display: grid;
          gap: 4px;
          padding: 12px;
          border-radius: 14px;
          background: #f9fafb;
          border: 1px solid var(--line);
        }
        .summaryBox b { font-size: 14px; }
        .summaryBox span { color: var(--muted); font-size: 12px; font-weight: 900; }
        .printPreview {
          margin-top: 14px;
          display: grid;
          place-items: center;
          min-height: 360px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #f9fafb;
          padding: 14px;
        }
        .posterPreview {
          width: min(100%, 270px);
          aspect-ratio: 1 / 1.414;
          border-radius: 16px;
          overflow: hidden;
          border: 1px solid var(--line);
          background: #fff;
          box-shadow: 0 10px 30px rgba(15,23,42,0.08);
        }
        .posterPreview.tall { width: min(100%, 245px); }
        .posterHero {
          height: 58%;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #111827, #4b5563);
          color: #fff;
          font-weight: 950;
          padding: 14px;
          text-align: center;
        }
        .posterBottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 14px;
          background: #111827;
          color: #fff;
          height: 42%;
        }
        .posterBottom div:first-child { display: grid; gap: 6px; }
        .posterBottom span { color: rgba(255,255,255,0.72); font-size: 11px; font-weight: 850; }
        .fakeQr {
          flex: 0 0 76px;
          height: 76px;
          display: grid;
          place-items: center;
          background: #fff;
          color: #111827;
          border-radius: 10px;
          font-weight: 950;
        }
        .sheetPreview {
          width: 100%;
          max-width: 390px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }
        .miniQr {
          display: grid;
          gap: 8px;
          justify-items: center;
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          padding: 10px;
          min-height: 110px;
        }
        .miniQr span { font-size: 11px; font-weight: 950; }
        .miniQr b {
          width: 64px;
          height: 64px;
          display: grid;
          place-items: center;
          border: 6px solid #111827;
          font-size: 12px;
        }
        .advancedBox { margin-top: 14px; }
        .advancedBox summary { cursor: pointer; font-weight: 950; }
        .qrList.compact { max-height: 220px; }
        .previewHead {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .count {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .grid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .qrCard {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 10px;
          min-width: 0;
        }
        .qrLabel {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .qrLabel strong {
          font-weight: 950;
        }
        .qrLabel span {
          font-size: 12px;
          color: var(--muted);
          font-weight: 850;
          white-space: nowrap;
        }
        .qrImgWrap {
          display: grid;
          place-items: center;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fafafa;
        }
        .qrImgWrap img {
          width: 100%;
          height: auto;
          max-width: 260px;
        }
        .qrUrl {
          font-size: 11px;
          color: var(--muted);
          font-weight: 800;
          word-break: break-all;
          line-height: 1.35;
        }
        @media (max-width: 980px) {
          .panelGrid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 520px) {
          .row2 {
            grid-template-columns: 1fr;
          }
          .grid {
            grid-template-columns: 1fr;
          }
          .statusGrid,
          .manageGrid,
          .presetGrid {
            grid-template-columns: 1fr;
          }
          .qrRow {
            grid-template-columns: 1fr;
          }
          .h1 {
            font-size: 24px;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <h1 className="h1">매장 QR 만들기</h1>
          <span className="pill">선택 매장: {storeId || "—"}</span>
        </div>
        <p className="desc">QR을 출력해 매장에 붙이세요.</p>
      </header>

      <section className="statusGrid" aria-label="QR 등록 현황">
        <div className="statCard">
          <div className="label">카운터 QR</div>
          <div className="statNum">{counterQr ? 1 : 0}</div>
          <div className="hint">대표 QR</div>
        </div>
        <div className="statCard">
          <div className="label">테이블 QR</div>
          <div className="statNum">{activeTableQrs.length}</div>
          <div className="hint">사용 중</div>
        </div>
        <div className="statCard">
          <div className="label">사용 중지</div>
          <div className="statNum">{inactiveCount}</div>
          <div className="hint">비활성 QR</div>
        </div>
      </section>

      {qrMsg ? <div className={`msg ${qrMsgTone}`}>{qrMsg}</div> : null}

      <section className="manageGrid">
        <div className="card">
          <h2 className="cardTitle">QR 목록</h2>

          <div className="btnRow">
            <button className="btn btnPrimary" onClick={ensureCounterQr} disabled={qrSaving || qrLoading || !origin || !storeId || !!counterQr}>
              {counterQr ? "카운터 QR 등록됨" : "카운터 QR 저장"}
            </button>
            <button className="btn" onClick={refreshQrData} disabled={qrSaving || qrLoading || !storeId}>
              {qrLoading ? "불러오는 중..." : "목록 새로고침"}
            </button>
          </div>

          <div className="qrList">
            {qrLoading ? (
              <div className="hint">QR 목록을 불러오는 중입니다.</div>
            ) : qrRows.length === 0 ? (
              <div className="hint">아직 저장된 QR이 없습니다. 카운터 QR을 저장하거나 테이블 QR을 추가해 주세요.</div>
            ) : (
              qrRows.map((row) => (
                <div className="qrRow" key={row.id}>
                  <div className="qrMeta">
                    <span className="badge">{row.status === "active" ? "사용 중" : row.status === "inactive" ? "비활성" : "보관"}</span>
                    <div className="qrName">{row.label || (row.qr_type === "table" ? formatTableLabel(Number(row.table_no)) : "카운터 QR")}</div>
                  </div>
                  <button
                    className="btn"
                    onClick={() => updateQrStatus(row, row.status === "active" ? "inactive" : "active")}
                    disabled={qrSaving || row.status === "archived"}
                  >
                    {row.status === "active" ? "사용 중지" : "다시 사용"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="cardTitle">테이블 QR 추가</h2>
          <p className="desc" style={{ marginTop: 8 }}>중복 번호는 자동 제외됩니다.</p>

          <div className="formGrid">
            <div className="row2">
              <div className="field">
                <div className="label">테이블 범위 시작</div>
                <input className="input" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} inputMode="numeric" />
              </div>
              <div className="field">
                <div className="label">테이블 범위 종료</div>
                <input className="input" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} inputMode="numeric" />
              </div>
            </div>

            <div className="field">
              <div className="label">추가 테이블(선택)</div>
              <input
                className="input"
                value={customTables}
                onChange={(e) => setCustomTables(e.target.value)}
                placeholder='예: "21,22,30" 또는 "1~5"'
              />
            </div>

            <div className="hint">
              추가 대상 <b>{pendingTableNumbers.length}</b>개
            </div>

            <div className="btnRow">
              <button className="btn btnPrimary" onClick={addTableQrs} disabled={qrSaving || qrLoading || !origin || !storeId || pendingTableNumbers.length === 0}>
                테이블 QR 저장/추가
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panelGrid">
        <div className="card">
          <h2 className="cardTitle">출력 설정</h2>

          <div className="formGrid">
            <div className="field">
              <div className="label">출력 대상</div>
              <div className="btnRow">
                <button
                  className={`btn ${printTarget === "counter" ? "btnPrimary" : ""}`}
                  onClick={() => {
                    setPrintTarget("counter");
                    setMakeCounter(true);
                  }}
                >
                  카운터 QR
                </button>
                <button
                  className={`btn ${printTarget === "table" ? "btnPrimary" : ""}`}
                  onClick={() => {
                    setPrintTarget("table");
                    setMakeTables(true);
                  }}
                >
                  테이블 QR
                </button>
              </div>
            </div>

            {printTarget === "counter" ? (
              <div className="field">
                <div className="label">출력 크기</div>
                <div className="presetGrid">
                  {(Object.entries(COUNTER_PRINT_PRESETS) as Array<[CounterPrintPreset, PaperPreset]>).map(([key, preset]) => (
                    <button
                      className={`presetBtn ${counterPrintPreset === key ? "selected" : ""}`}
                      key={key}
                      onClick={() => setCounterPrintPreset(key)}
                    >
                      <strong>{preset.label}</strong>
                      <span>{key === "a3_poster" ? "입구용" : key === "a4_2up" ? "2개 출력" : ""}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="field">
                <div className="label">출력 크기</div>
                <div className="presetGrid">
                  {(Object.entries(TABLE_PRINT_PRESETS) as Array<[TablePrintPreset, { label: string; cols: number; rows: number }]>).map(([key, preset]) => (
                    <button
                      className={`presetBtn ${tablePrintPreset === key ? "selected" : ""}`}
                      key={key}
                      onClick={() => setTablePrintPreset(key)}
                    >
                      <strong>{preset.label}</strong>
                      <span>{key === "a4_8" ? "추천" : `${preset.cols}×${preset.rows}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field">
              <div className="label">디자인</div>
              <div className="presetGrid">
                {TEMPLATE_OPTIONS.map((option) => (
                  <button
                    className={`presetBtn ${effectiveDesign.template_key === option.key ? "selected" : ""}`}
                    key={option.key}
                    onClick={() => updateDesignSetting("template_key", option.key)}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">색상</div>
              <div className="colorRow">
                {ACCENT_COLORS.map((color) => (
                  <button
                    aria-label={`색상 ${color}`}
                    className={`colorBtn ${effectiveDesign.accent_color === color ? "selected" : ""}`}
                    key={color}
                    onClick={() => updateDesignSetting("accent_color", color)}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">문구</div>
              <input
                className="input"
                value={printTarget === "counter" ? effectiveDesign.counter_title : effectiveDesign.table_title}
                onChange={(e) =>
                  printTarget === "counter"
                    ? updateDesignSetting("counter_title", e.target.value)
                    : updateDesignSetting("table_title", e.target.value)
                }
                placeholder="예: QR로 주문하세요"
              />
              <textarea
                className="textarea compactTextarea"
                value={printTarget === "counter" ? effectiveDesign.counter_description : effectiveDesign.table_description}
                onChange={(e) =>
                  printTarget === "counter"
                    ? updateDesignSetting("counter_description", e.target.value)
                    : updateDesignSetting("table_description", e.target.value)
                }
                placeholder="예: 주문 후 카운터에서 받아가세요"
              />
            </div>

            <div className="field">
              <div className="label">표시 항목</div>
              <div className="toggleRow">
                {([
                  ["show_logo", "로고"],
                  ["show_main_image", "대표 이미지"],
                  ["show_store_name", "매장명"],
                  ["show_target_url", "URL"],
                ] as Array<["show_logo" | "show_main_image" | "show_store_name" | "show_target_url", string]>).map(([key, label]) => (
                  <button
                    className={`toggleChip ${effectiveDesign[key] ? "selected" : ""}`}
                    key={String(key)}
                    onClick={() => updateDesignSetting(key, !effectiveDesign[key])}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="btnRow">
              <button className="btn" onClick={saveDesignSettings} disabled={qrSaving || !storeId}>
                디자인 저장
              </button>
            </div>

            <div className="summaryBox">
              {printTarget === "counter" ? (
                <>
                  <b>카운터 QR {counterQr ? 1 : 0}개</b>
                  <span>{COUNTER_PRINT_PRESETS[counterPrintPreset].label} · {COUNTER_PRINT_PRESETS[counterPrintPreset].copies || 1}장</span>
                </>
              ) : (
                <>
                  <b>테이블 QR {activeTableQrs.length}개</b>
                  <span>{TABLE_PRINT_PRESETS[tablePrintPreset].label} · {Math.max(1, Math.ceil(activeTableQrs.length / (TABLE_PRINT_PRESETS[tablePrintPreset].cols * TABLE_PRINT_PRESETS[tablePrintPreset].rows)))}장</span>
                </>
              )}
            </div>

            <div className="hint">출력 전 스캔 확인</div>

            <div className="btnRow">
              {printTarget === "counter" ? (
                <button
                  className="btn btnPrimary"
                  onClick={() => {
                    downloadCounterPng();
                  }}
                  disabled={!counterQr || !origin || !storeId}
                >
                  포스터 다운로드
                </button>
              ) : (
                <button
                  className="btn btnPrimary"
                  onClick={() => {
                    downloadTablePng();
                  }}
                  disabled={activeTableQrs.length === 0 || !origin || !storeId}
                >
                  카드 다운로드
                </button>
              )}
              <a className="btn" href="/admin">
                관리자 홈
              </a>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="previewHead">
            <h2 className="cardTitle">미리보기</h2>
            <div className="count">기본형</div>
          </div>

          <div className="printPreview">
            {printTarget === "counter" ? (
              <div className={`posterPreview ${counterPrintPreset === "a3_poster" ? "tall" : ""}`}>
                <div className="posterHero" style={{ background: `linear-gradient(135deg, ${effectiveDesign.accent_color}, #111827)` }}>{effectiveDesign.show_store_name ? storeName : effectiveDesign.counter_title}</div>
                <div className="posterBottom">
                  <div>
                    <strong>{effectiveDesign.counter_title}</strong>
                    <span>{effectiveDesign.counter_description.split("\n")[0] || "카운터/입구용"}</span>
                  </div>
                  <div className="fakeQr">QR</div>
                </div>
              </div>
            ) : (
              <div className="sheetPreview">
                {Array.from({ length: Math.min(TABLE_PRINT_PRESETS[tablePrintPreset].cols * TABLE_PRINT_PRESETS[tablePrintPreset].rows, Math.max(activeTableQrs.length, 1)) }).map((_, idx) => (
                  <div className="miniQr" key={idx}>
                    <span>{effectiveDesign.show_store_name ? activeTableQrs[idx]?.label || `테이블 ${idx + 1}` : effectiveDesign.table_title}</span>
                    <b style={{ borderColor: effectiveDesign.accent_color }}>QR</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="advancedBox">
            <summary>고급 관리</summary>
            <div className="qrList compact">
              {qrRows.length === 0 ? (
                <div className="hint">QR이 없습니다.</div>
              ) : (
                qrRows.map((row) => (
                  <div className="qrRow" key={row.id}>
                    <div className="qrMeta">
                      <span className="badge">{row.status === "active" ? "사용 중" : row.status === "inactive" ? "사용 중지" : "보관"}</span>
                      <div className="qrName">{row.label || (row.qr_type === "table" ? formatTableLabel(Number(row.table_no)) : "카운터 QR")}</div>
                      <div className="qrSmall">{row.target_url}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={() => updateQrStatus(row, row.status === "active" ? "inactive" : "active")}
                      disabled={qrSaving || row.status === "archived"}
                    >
                      {row.status === "active" ? "사용 중지" : "다시 사용"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}

function trimMiddle(s: string, maxLen: number) {
  const str = String(s || "");
  if (str.length <= maxLen) return str;
  const head = Math.ceil((maxLen - 3) / 2);
  const tail = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, head)}...${str.slice(str.length - tail)}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  roundedClipPath(ctx, x, y, w, h, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function roundedClipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}
export default function AdminQrPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminQrPageInner />
    </Suspense>
  );
}