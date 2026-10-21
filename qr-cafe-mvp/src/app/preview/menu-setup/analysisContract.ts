import { isDraft } from "./draftStorage";
import type { Draft } from "./draftModel";

export type AnalysisSource = { name: string; kind: "image" | "csv"; content: string };
// Keep serialized sources plus the small request envelope below Vercel's 4.5MB
// function body limit. Base64 and JSON metadata count too; photo count is not capped.
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
export const MAX_OUTPUT_TOKENS = 14000;
export function validateSources(value: unknown): AnalysisSource[] {
  if (!Array.isArray(value) || !value.length) throw new Error("분석할 이미지 또는 CSV를 첨부해주세요.");
  let size = 0;
  for (const source of value) {
    if (!source || typeof source !== "object" || typeof source.name !== "string" || !source.name.trim() || source.name.length > 200 || typeof source.content !== "string") throw new Error("첨부 자료 형식을 확인해주세요.");
    size += new TextEncoder().encode(source.content).length;
    if (source.kind === "image") {
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.content)) throw new Error("분석용 이미지는 JPG·PNG·WebP로 첨부해주세요.");
    } else if (source.kind === "csv") {
      if (!source.content.trim() || source.content.length > 200000 || source.content.includes("\u0000")) throw new Error("CSV가 비어 있거나 한 번에 분석하기에 너무 큽니다. 파일을 나눠주세요.");
    } else throw new Error("지원하지 않는 첨부 형식입니다.");
  }
  if (size > MAX_REQUEST_BYTES || new TextEncoder().encode(JSON.stringify(value)).length > MAX_REQUEST_BYTES) throw new Error("한 번에 전송할 자료가 너무 큽니다. 사진 크기를 줄이거나 나누어 첨부해주세요.");
  return value as AnalysisSource[];
}

const str = { type: "string" };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const array = (items: unknown) => ({ type: "array", items });
export const MENU_SCHEMA = object({
  categories: array(object({ id: str, name: str })),
  groups: array(object({ id: str, name: str, scope: { type: "string", enum: ["common", "exclusive"] }, menuId: str,
    required: { type: "string", enum: ["", "yes", "no"] }, max: str,
    items: array(object({ id: str, name: str, price: str })) })),
  menus: array(object({ id: str, name: str, price: str, categoryId: str, groupIds: array(str), prices: array(object({ itemId: str, price: str })) })),
  warnings: array(str),
});

export function normalizeAnalysis(value: unknown): Draft {
  if (!value || typeof value !== "object") throw new Error("AI 결과 형식을 확인하지 못했습니다.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.menus) || !raw.menus.length || raw.menus.length > 500 || !Array.isArray(raw.warnings) || !raw.warnings.every((item) => typeof item === "string")) throw new Error("메뉴를 읽지 못했거나 결과가 너무 큽니다. 자료를 나눠 다시 확인해주세요.");
  const menus = raw.menus.map((menu) => {
    if (!menu || typeof menu !== "object" || !Array.isArray(menu.prices)) throw new Error("메뉴별 요금 결과가 올바르지 않습니다.");
    const prices: Record<string, string> = {};
    for (const entry of menu.prices) {
      if (!entry || typeof entry.itemId !== "string" || typeof entry.price !== "string" || Object.hasOwn(prices, entry.itemId) || ["__proto__", "constructor", "prototype"].includes(entry.itemId)) throw new Error("메뉴별 요금 연결이 올바르지 않습니다.");
      prices[entry.itemId] = entry.price;
    }
    return { ...menu, selected: true, prices };
  });
  const draft = { categories: raw.categories, groups: raw.groups, menus, notes: raw.warnings, source: "ai" };
  if (!isDraft(draft)) throw new Error("AI 결과에 잘못된 항목이나 중복 식별자가 있습니다.");
  const validated: Draft = draft;
  const optionIds = validated.groups.flatMap((group) => group.items.map((item) => item.id));
  if ([...validated.categories, ...validated.groups, ...validated.menus].some((item) => !item.id.trim()) || optionIds.some((id) => !id.trim())) throw new Error("비어 있는 식별자가 있습니다.");
  if (new Set(optionIds).size !== optionIds.length) throw new Error("옵션 식별자가 중복되었습니다.");
  for (const menu of validated.menus) {
    if (new Set(menu.groupIds).size !== menu.groupIds.length || menu.groupIds.some((id) => !validated.groups.some((group) => group.id === id && (group.scope === "common" || group.menuId === menu.id)))) throw new Error("옵션 연결을 확인하지 못했습니다.");
    const connected = validated.groups.filter((group) => menu.groupIds.includes(group.id)).flatMap((group) => group.items.map((item) => item.id));
    if (Object.keys(menu.prices).some((id) => !connected.includes(id))) throw new Error("추가 요금의 옵션 연결이 잘못되었습니다.");
  }
  return validated;
}
