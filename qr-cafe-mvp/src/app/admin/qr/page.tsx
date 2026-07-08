// src/app/admin/qr/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { supabase } from "@/app/lib/supabaseClient";
import { useStoreProfile } from "@/app/lib/storeProfile";
import { ACCENT_COLORS, COUNTER_PRINT_PRESETS, TABLE_PRINT_PRESETS, TEMPLATE_OPTIONS, defaultDesignSettings, designWithDefaults } from "./qrDesign";
import { createCounterPosterCanvas as renderCounterPosterCanvas, createTableSheetCanvases as renderTableSheetCanvases } from "./qrCanvas";
import type { AdminQrCode, AdminQrDesignSettings, CounterPrintPreset, ImageSource, PaperPreset, PrintTarget, TablePrintPreset } from "./qrTypes";

const START_PATH = "/";

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
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewNote, setPreviewNote] = useState("");

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

  const updateImageSource = (source: ImageSource) => {
    setDesignSettings((prev) => ({
      ...(prev || defaultDesignSettings(storeId, counterDesc)),
      store_id: storeId,
      image_source: source,
      show_main_image: source !== "none",
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

  const ensureCounterQr = async () => {
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
  };

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

  function getSelectedMainImage(ds: AdminQrDesignSettings) {
    if (!ds.show_main_image || ds.image_source === "none") return "";
    return mainImage;
  }

  async function createCounterPosterCanvas() {
    const ds = designSettings || defaultDesignSettings(storeId, counterDesc);
    return renderCounterPosterCanvas({
      design: ds,
      preset: COUNTER_PRINT_PRESETS[counterPrintPreset],
      counterPrintPreset,
      targetUrl: counterQr?.target_url || counterUrl,
      storeName,
      mainImage: getSelectedMainImage(ds),
      logoImage,
    });
  }

  async function createTableSheetCanvases(nums: number[]) {
    const ds = designSettings || defaultDesignSettings(storeId, counterDesc);
    return renderTableSheetCanvases({
      design: ds,
      preset: TABLE_PRINT_PRESETS[tablePrintPreset],
      tableNumbers: nums,
      storeName,
      logoImage,
      mainImage: getSelectedMainImage(ds),
      getTableUrl: tableUrl,
    });
  }

  async function refreshPrintPreview(canApply: () => boolean = () => true) {
    if (!origin || !storeId) {
      setPreviewUrl("");
      setPreviewNote("매장을 선택해 주세요.");
      return;
    }

    setPreviewBusy(true);
    try {
      if (printTarget === "counter") {
        const canvas = await createCounterPosterCanvas();
        if (!canApply()) return;
        setPreviewUrl(canvas.toDataURL("image/png"));
        setPreviewNote(counterQr ? `${COUNTER_PRINT_PRESETS[counterPrintPreset].label} · 실제 다운로드 기준` : "카운터 QR 준비 전 미리보기");
      } else {
        const previewNums = tableNumbers.length > 0 ? tableNumbers : pendingTableNumbers.slice(0, TABLE_PRINT_PRESETS[tablePrintPreset].cols * TABLE_PRINT_PRESETS[tablePrintPreset].rows);
        if (previewNums.length === 0) {
          if (!canApply()) return;
          setPreviewUrl("");
          setPreviewNote("테이블 번호를 입력해 주세요.");
          return;
        }
        const canvases = await createTableSheetCanvases(previewNums);
        if (!canApply()) return;
        setPreviewUrl(canvases[0]?.toDataURL("image/png") || "");
        setPreviewNote(tableNumbers.length > 0 ? `${TABLE_PRINT_PRESETS[tablePrintPreset].label} · ${Math.max(1, canvases.length)}장 중 1장` : "추가 예정 번호 미리보기");
      }
    } catch (e: unknown) {
      if (!canApply()) return;
      setPreviewUrl("");
      setPreviewNote(e instanceof Error ? "미리보기를 만들 수 없습니다. 이미지 주소와 QR 정보를 확인해 주세요." : String(e));
    } finally {
      if (canApply()) setPreviewBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      refreshPrintPreview(() => !cancelled);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, storeId, printTarget, counterPrintPreset, tablePrintPreset, counterQr?.target_url, counterUrl, mainImage, logoImage, designSettings, storeName, activeTableQrs, pendingTableNumbers]);

  // ==========================
  // ✅ 카운터 PNG
  // ==========================
  async function downloadCounterPng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeCounter) {
      alert("카운터 QR을 먼저 준비해 주세요.");
      return;
    }

    setQrSaving(true);
    try {
      await ensureDesignSettings();
      const canvas = await createCounterPosterCanvas();
      downloadCanvasAsPng(canvas, `counter-qr_${storeId}_${counterPrintPreset}_${Date.now()}.png`);
    } catch (e: unknown) {
      alert(`카운터 QR 다운로드 실패\n${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  // ==========================
  // ✅ 테이블 PNG
  // ==========================
  async function downloadTablePng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeTables) {
      alert("테이블 QR을 먼저 선택해 주세요.");
      return;
    }
    if (tableNumbers.length === 0) {
      alert("저장된 테이블 QR이 없습니다. 테이블 QR을 먼저 만들어 주세요.");
      return;
    }

    setQrSaving(true);
    try {
      await ensureDesignSettings();
      const canvases = await createTableSheetCanvases(tableNumbers);
      for (let p = 0; p < canvases.length; p++) {
        downloadCanvasAsPng(canvases[p], `table-qr_${storeId}_${tablePrintPreset}_${p + 1}of${canvases.length}_${Date.now()}.png`);
        if (canvases.length > 1) await sleep(350);
      }
    } catch (e: unknown) {
      alert(`테이블 QR 다운로드 실패\n${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQrSaving(false);
    }
  }

  const effectiveDesign = designSettings || defaultDesignSettings(storeId, counterDesc);
  const selectedTemplate = TEMPLATE_OPTIONS.find((option) => option.key === effectiveDesign.template_key) || TEMPLATE_OPTIONS[0];

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
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }
        .topActions {
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: flex-end;
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
        .creatorGrid {
          display: grid;
          grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
          gap: 12px;
          align-items: start;
          margin-top: 12px;
        }
        .previewCard {
          position: sticky;
          top: 12px;
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
        .spanFull {
          grid-column: 1 / -1;
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
        .noticeBox {
          margin-top: 10px;
          display: grid;
          gap: 5px;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          color: #4b5563;
          font-size: 12px;
          font-weight: 850;
          line-height: 1.45;
        }
        .noticeBox b {
          color: #111827;
          font-weight: 950;
        }
        .checkList {
          margin: 10px 0 0;
          padding-left: 18px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.5;
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
        .setupBox {
          display: grid;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #f9fafb;
        }
        .setupBoxTitle {
          margin: 0;
          font-size: 13px;
          font-weight: 950;
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
        .templateBtn {
          min-height: 92px;
        }
        .templateSample {
          height: 42px;
          border-radius: 12px;
          border: 1px solid var(--line);
          padding: 6px;
          display: grid;
          grid-template-columns: 1fr 18px;
          gap: 5px;
          overflow: hidden;
        }
        .templateSample::before,
        .templateSample::after {
          content: "";
          display: block;
          border-radius: 8px;
        }
        .templateSample::after {
          background: #fff;
          border: 4px solid currentColor;
        }
        .templateSample.simple {
          background: #f8fafc;
          color: #111827;
        }
        .templateSample.simple::before { background: linear-gradient(#fff, #f3f4f6); border: 1px solid #e5e7eb; }
        .templateSample.cafe_poster {
          background: linear-gradient(135deg, #92400e, #111827 65%, #fff 66%);
          color: #111827;
        }
        .templateSample.cafe_poster::before { background: rgba(255,255,255,0.85); margin-top: 18px; }
        .templateSample.premium_dark {
          background: linear-gradient(135deg, #020617, #111827);
          color: #111827;
        }
        .templateSample.premium_dark::before { background: rgba(255,255,255,0.16); border-top: 3px solid #b45309; }
        .templateSample.soft_round {
          background: #fff7ed;
          color: #9a3412;
          border-color: #fed7aa;
        }
        .templateSample.soft_round::before { background: #fff; border-radius: 14px; border: 1px solid #fed7aa; }
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
        .previewImg {
          width: 100%;
          max-width: 430px;
          height: auto;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 10px 30px rgba(15,23,42,0.08);
        }
        .previewEmpty {
          display: grid;
          place-items: center;
          text-align: center;
          min-height: 220px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          line-height: 1.45;
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
        .advancedCard { margin-top: 12px; }
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
          .creatorGrid {
            grid-template-columns: 1fr;
          }
          .formGrid {
            grid-template-columns: 1fr;
          }
          .previewCard {
            position: static;
          }
          .printPreview {
            min-height: 300px;
          }
        }
        @media (max-width: 520px) {
          .wrap {
            padding: 10px;
          }
          .titleRow,
          .topActions {
            display: grid;
            justify-content: stretch;
          }
          .pill {
            white-space: normal;
          }
          .card {
            padding: 12px;
          }
          .btnRow {
            display: grid;
            grid-template-columns: 1fr;
          }
          .btn {
            width: 100%;
          }
          .printPreview {
            min-height: 240px;
            padding: 10px;
          }
          .previewImg {
            border-radius: 12px;
            box-shadow: 0 6px 18px rgba(15,23,42,0.08);
          }
          .row2 {
            grid-template-columns: 1fr;
          }
          .grid {
            grid-template-columns: 1fr;
          }
          .statusGrid,
          .presetGrid {
            grid-template-columns: 1fr;
          }
          .statusGrid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
          }
          .statCard {
            padding: 8px 6px;
            border-radius: 12px;
            text-align: center;
          }
          .statNum {
            font-size: 18px;
          }
          .statusGrid .label {
            font-size: 10px;
          }
          .statusGrid .hint {
            display: none;
          }
          .qrRow {
            grid-template-columns: 1fr;
          }
          .h1 {
            font-size: 24px;
          }
        }
        @media (min-width: 1024px) {
          .formGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items: start;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <div>
            <h1 className="h1">매장 QR 만들기</h1>
            <p className="desc">QR 출력물을 만들고 다운로드하세요.</p>
          </div>
          <div className="topActions">
            <span className="pill">선택 매장: {storeId || "—"}</span>
            <a className="btn" href={storeId ? `/admin?store=${encodeURIComponent(storeId)}` : "/admin"}>
              관리자 홈
            </a>
          </div>
        </div>
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

      <section className="creatorGrid">
        <div className="card">
          <h2 className="cardTitle">출력 설정</h2>

          <div className="formGrid">
            <div className="field spanFull">
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
              <div className="setupBox spanFull">
                <h3 className="setupBoxTitle">카운터 QR 준비</h3>
                <div className="hint">카운터/포장용 대표 QR입니다.</div>
                <div className="btnRow">
                  <button className="btn btnPrimary" onClick={ensureCounterQr} disabled={qrSaving || qrLoading || !origin || !storeId || !!counterQr}>
                    {counterQr ? "준비됨" : "QR 준비하기"}
                  </button>
                  <button className="btn" onClick={refreshQrData} disabled={qrSaving || qrLoading || !storeId}>
                    {qrLoading ? "확인 중..." : "상태 확인"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="setupBox spanFull">
                <h3 className="setupBoxTitle">테이블 번호</h3>
                <div className="hint">테이블 번호가 포함된 QR입니다.</div>
                <div className="row2">
                  <div className="field">
                    <div className="label">시작</div>
                    <input className="input" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} inputMode="numeric" />
                  </div>
                  <div className="field">
                    <div className="label">종료</div>
                    <input className="input" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} inputMode="numeric" />
                  </div>
                </div>
                <div className="field">
                  <div className="label">추가 번호</div>
                  <input
                    className="input"
                    value={customTables}
                    onChange={(e) => setCustomTables(e.target.value)}
                    placeholder='예: "21,22,30" 또는 "1~5"'
                  />
                </div>
                <div className="hint">추가 대상 <b>{pendingTableNumbers.length}</b>개 · 중복 제외</div>
                <div className="btnRow">
                  <button className="btn btnPrimary" onClick={addTableQrs} disabled={qrSaving || qrLoading || !origin || !storeId || pendingTableNumbers.length === 0}>
                    테이블 QR 만들기
                  </button>
                </div>
              </div>
            )}

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
                      <span>
                        {key === "a5_card"
                          ? "계산대용"
                          : key === "a4_poster"
                          ? "기본 포스터"
                          : key === "a3_poster"
                          ? "대형 입구용"
                          : "2개 출력"}
                      </span>
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
                      <span>
                        {key === "a4_12"
                          ? "12개 출력"
                          : key === "a4_8"
                          ? "추천 크기"
                          : "크게 출력"}
                      </span>
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
                    className={`presetBtn templateBtn ${effectiveDesign.template_key === option.key ? "selected" : ""}`}
                    key={option.key}
                    onClick={() => updateDesignSetting("template_key", option.key)}
                  >
                    <i className={`templateSample ${option.key}`} aria-hidden="true" />
                    <strong>{option.label}</strong>
                    <span>
                      {option.key === "simple"
                        ? "깔끔한 기본"
                        : option.key === "cafe_poster"
                        ? "사진 강조"
                        : option.key === "premium_dark"
                        ? "고급 다크"
                        : "따뜻한 카드"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">포인트 색상</div>
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
              <div className="hint">라인, 배지, 강조 문구에 사용돼요.</div>
            </div>

            <div className="field">
              <div className="label">이미지</div>
              <div className="btnRow">
                {([
                  ["store_main", "매장 대표 이미지"],
                  ["none", "이미지 없음"],
                ] as Array<[ImageSource, string]>).map(([source, label]) => (
                  <button
                    className={`toggleChip ${effectiveDesign.image_source === source ? "selected" : ""}`}
                    key={source}
                    onClick={() => updateImageSource(source)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="hint">사진형 배경에 사용됩니다.</div>
            </div>

            <div className="field">
              <div className="label">문구1 · 큰 안내 문구</div>
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
              <div className="label">문구2 · QR 아래 사용 안내</div>
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
              <div className="hint">긴 문구는 잘릴 수 있어요.</div>
            </div>

            <div className="field">
              <div className="label">브랜드 표시</div>
              <div className="toggleRow">
                {([
                  ["show_logo", "로고"],
                  ["show_store_name", "매장명"],
                ] as Array<["show_logo" | "show_store_name", string]>).map(([key, label]) => (
                  <button
                    className={`toggleChip ${effectiveDesign[key] ? "selected" : ""}`}
                    key={String(key)}
                    onClick={() => updateDesignSetting(key, !effectiveDesign[key])}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="hint">답답하면 로고나 매장명 중 하나만 켜세요.</div>
            </div>

            <div className="btnRow spanFull">
              <button className="btn" onClick={saveDesignSettings} disabled={qrSaving || !storeId}>
                디자인 저장
              </button>
            </div>
            <div className="noticeBox spanFull">
              <b>저장: 다음에도 사용 · 다운로드: 현재 디자인 PNG</b>
            </div>

            <div className="summaryBox spanFull">
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

            <div className="hint spanFull">다운로드 전 QR 스캔과 문구 겹침만 확인하세요.</div>
            <ul className="checkList spanFull">
              <li>QR 스캔 확인</li>
              <li>문구/로고 겹침 확인</li>
            </ul>

            <div className="btnRow spanFull">
              {printTarget === "counter" ? (
                <button
                  className="btn btnPrimary"
                  onClick={() => {
                    downloadCounterPng();
                  }}
                  disabled={!counterQr || !origin || !storeId}
                >
                  현재 디자인으로 포스터 다운로드
                </button>
              ) : (
                <button
                  className="btn btnPrimary"
                  onClick={() => {
                    downloadTablePng();
                  }}
                  disabled={activeTableQrs.length === 0 || !origin || !storeId}
                >
                  현재 디자인으로 카드 다운로드
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card previewCard">
          <div className="previewHead">
            <h2 className="cardTitle">미리보기</h2>
            <div className="count">{previewBusy ? "생성 중" : `${selectedTemplate.label} · ${printTarget === "counter" ? COUNTER_PRINT_PRESETS[counterPrintPreset].label : TABLE_PRINT_PRESETS[tablePrintPreset].label} · ${previewNote || "실제 출력 기준"}`}</div>
          </div>

          <div className="printPreview">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="previewImg" src={previewUrl} alt="QR 출력물 미리보기" />
            ) : (
              <div className="previewEmpty">{previewBusy ? "미리보기 생성 중..." : previewNote || "QR 설정을 확인해 주세요."}</div>
            )}
          </div>
          <div className="noticeBox">
            <span>미리보기는 축소 화면입니다. 다운로드는 실제 출력 크기입니다.</span>
          </div>

        </div>
      </section>

      <section className="card advancedCard">
        <details className="advancedBox">
          <summary>QR 상태 관리</summary>
          <div className="noticeBox">
            <span>인쇄해 사용 중인 QR은 사용 중지하지 마세요.</span>
          </div>
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
      </section>
    </main>
  );
}

export default function AdminQrPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminQrPageInner />
    </Suspense>
  );
}
