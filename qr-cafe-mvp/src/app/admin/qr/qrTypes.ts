export type AdminQrCode = {
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

export type ImageSource = "store_main" | "custom_url" | "none";

export type AdminQrDesignSettings = {
  store_id: string;
  template_key: string;
  accent_color: string;
  counter_title: string;
  counter_description: string;
  table_title: string;
  table_description: string;
  image_source: ImageSource;
  custom_image_url: string;
  show_logo: boolean;
  show_main_image: boolean;
  show_store_name: boolean;
  show_target_url: boolean;
  counter_print_preset: string;
  table_print_preset: string;
};

export type PrintTarget = "counter" | "table";
export type CounterPrintPreset = "a5_card" | "a4_poster" | "a3_poster" | "a4_2up";
export type TablePrintPreset = "a4_12" | "a4_8" | "a4_4";
export type TemplateKey = "simple" | "cafe_poster" | "premium_dark" | "soft_round";

export type PaperPreset = {
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  copies?: number;
};
