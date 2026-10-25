import type { Draft } from "./draftModel";

// Development preview only. Never reuse this global key for actual store data.
export const DRAFT_STORAGE_KEY = "rion:menu-setup-preview:v1";
export const draftStorageKey = (storeId: string) => storeId ? `${DRAFT_STORAGE_KEY}:store:${encodeURIComponent(storeId)}` : DRAFT_STORAGE_KEY;
export type PendingEdit = { kind: "menu" | "category" | "group"; id: string; draft: Draft };
export type SavedDraft = { version: 1; savedAt: string; draft: Draft; pendingEdit?: PendingEdit };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
const fields = (value: Record<string, unknown>, names: string[]) => names.every((name) => typeof value[name] === "string");
const unique = (items: { id: string }[]) => new Set(items.map((item) => item.id)).size === items.length;

// Validate structure, not business completeness: unfinished prices/options must survive.
export function isDraft(value: unknown): value is Draft {
  if (!object(value) || !Array.isArray(value.categories) || !Array.isArray(value.groups) || !Array.isArray(value.menus)) return false;
  if (value.source !== undefined && value.source !== "ai") return false;
  if (value.notes !== undefined && !strings(value.notes)) return false;
  if (value.reviewed !== undefined && (!object(value.reviewed) || !Object.entries(value.reviewed).every(([key, signature]) => /^(menu|group):.+/.test(key) && typeof signature === "string"))) return false;
  if (!value.categories.every((item) => object(item) && fields(item, ["id", "name"]))) return false;
  if (!value.groups.every((item) => object(item) && fields(item, ["id", "name", "menuId", "max"])
    && ["common", "exclusive"].includes(String(item.scope)) && ["", "yes", "no"].includes(String(item.required))
    && (item.suggested === undefined || typeof item.suggested === "boolean") && Array.isArray(item.items)
    && item.items.every((option) => object(option) && fields(option, ["id", "name", "price"])) && unique(item.items))) return false;
  if (!value.menus.every((item) => object(item) && fields(item, ["id", "name", "price", "categoryId"])
    && typeof item.selected === "boolean" && strings(item.groupIds) && object(item.prices)
    && Object.values(item.prices).every((price) => typeof price === "string"))) return false;
  return unique(value.categories) && unique(value.groups) && unique(value.menus);
}

export function parseSavedDraft(raw: string): SavedDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt)) || !isDraft(value.draft)) return null;
    if (value.pendingEdit !== undefined) {
      const pending = value.pendingEdit;
      if (!object(pending) || typeof pending.id !== "string" || !isDraft(pending.draft)) return null;
      const list = pending.kind === "menu" ? pending.draft.menus : pending.kind === "category" ? pending.draft.categories : pending.kind === "group" ? pending.draft.groups : null;
      if (!list?.some((item) => item.id === pending.id)) return null;
    }
    return value as SavedDraft;
  } catch { return null; }
}
