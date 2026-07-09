import type { AdminQrDesignSettings, CounterPrintPreset, ImageSource, PaperPreset, TablePrintPreset, TemplateKey } from "./qrTypes";

export const COUNTER_PRINT_PRESETS: Record<CounterPrintPreset, PaperPreset> = {
  a5_card: { label: "A5 카드", shortLabel: "A5", width: 874, height: 1240, copies: 1 },
  a4_poster: { label: "A4 포스터", shortLabel: "A4", width: 1240, height: 1754, copies: 1 },
  a3_poster: { label: "A3 대형", shortLabel: "A3", width: 1754, height: 2480, copies: 1 },
  a4_2up: { label: "A4 2분할", shortLabel: "2분할", width: 1240, height: 1754, copies: 2 },
};

export const TABLE_PRINT_PRESETS: Record<TablePrintPreset, { label: string; cols: number; rows: number }> = {
  a4_12: { label: "A4 12분할", cols: 3, rows: 4 },
  a4_8: { label: "A4 8분할 추천", cols: 2, rows: 4 },
  a4_4: { label: "A4 4분할", cols: 2, rows: 2 },
};

export const TEMPLATE_OPTIONS: Array<{ key: TemplateKey; label: string; hint: string }> = [
  { key: "simple", label: "기본형", hint: "깔끔한 미니멀" },
  { key: "cafe_poster", label: "사진형", hint: "이미지 포스터" },
  { key: "premium_dark", label: "다크형", hint: "고급 다크 포스터" },
  { key: "soft_round", label: "소프트형", hint: "따뜻한 카페 카드" },
];

export const ACCENT_COLORS = ["#111827", "#7c3aed", "#b45309", "#047857", "#be123c"];

export function normalizeTemplateKey(v: unknown): TemplateKey {
  return v === "cafe_poster" || v === "premium_dark" || v === "soft_round" ? v : "simple";
}

export function normalizeColor(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#111827";
}

export function normalizeBool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeImageSource(v: unknown): ImageSource {
  return v === "none" ? "none" : "store_main";
}

export function designWithDefaults(storeId: string, counterDescription: string, row?: Partial<AdminQrDesignSettings> | null): AdminQrDesignSettings {
  const fallback = defaultDesignSettings(storeId, counterDescription);
  if (!row) return fallback;
  return {
    ...fallback,
    ...row,
    store_id: storeId,
    template_key: normalizeTemplateKey(row.template_key),
    counter_template_key: normalizeTemplateKey(row.counter_template_key || row.template_key),
    table_template_key: normalizeTemplateKey(row.table_template_key || row.template_key),
    accent_color: normalizeColor(row.accent_color),
    counter_title: String(row.counter_title || fallback.counter_title),
    counter_description: String(row.counter_description || fallback.counter_description),
    table_title: String(row.table_title || fallback.table_title),
    table_description: String(row.table_description || fallback.table_description),
    image_source: normalizeImageSource(row.show_main_image === false ? "none" : row.image_source),
    custom_image_url: String(row.custom_image_url || ""),
    show_logo: normalizeBool(row.show_logo, fallback.show_logo),
    show_main_image: normalizeImageSource(row.show_main_image === false ? "none" : row.image_source) !== "none",
    show_store_name: normalizeBool(row.show_store_name, fallback.show_store_name),
    show_target_url: false,
  };
}

export function defaultDesignSettings(storeId: string, counterDescription: string): AdminQrDesignSettings {
  return {
    store_id: storeId,
    template_key: "simple",
    counter_template_key: "simple",
    table_template_key: "simple",
    accent_color: "#111827",
    counter_title: "QR로 간편하게 주문하세요",
    counter_description: counterDescription,
    table_title: "테이블에서 바로 주문",
    table_description: "QR을 찍고 메뉴를 선택해 주세요.",
    image_source: "store_main",
    custom_image_url: "",
    show_logo: true,
    show_main_image: true,
    show_store_name: true,
    show_target_url: false,
    counter_print_preset: "a4_2up",
    table_print_preset: "a4_12",
  };
}
