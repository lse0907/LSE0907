import type { Draft, Menu } from "./draftModel";

export type MenuComparison = { key: string; kind: "added" | "removed" | "changed" | "same" | "ambiguous"; before?: Menu; after?: Menu };
const normalize = (text: string) => text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
function key(menu: Menu, draft: Draft) { return JSON.stringify([normalize(draft.categories.find((item) => item.id === menu.categoryId)?.name || ""), normalize(menu.name)]); }
export function menuDescription(menu: Menu, draft: Draft) {
  return {
    category: draft.categories.find((item) => item.id === menu.categoryId)?.name || "분류 확인 필요",
    price: menu.price,
    options: menu.groupIds.map((id) => {
      const group = draft.groups.find((item) => item.id === id);
      return group ? { name: group.name, scope: group.scope, required: group.required, max: group.max,
        items: group.items.map((item) => ({ name: item.name, price: menu.prices[item.id] ?? item.price })) } : { name: "연결 확인 필요" };
    }),
  };
}
export function compareAnalysis(before: Draft | null, after: Draft): MenuComparison[] {
  const oldByKey = new Map<string, Menu[]>(); const newByKey = new Map<string, Menu[]>();
  for (const menu of before?.menus || []) { const k = key(menu, before!); oldByKey.set(k, [...(oldByKey.get(k) || []), menu]); }
  for (const menu of after.menus) { const k = key(menu, after); newByKey.set(k, [...(newByKey.get(k) || []), menu]); }
  return [...new Set([...oldByKey.keys(), ...newByKey.keys()])].flatMap((k): MenuComparison[] => {
    const old = oldByKey.get(k) || []; const next = newByKey.get(k) || [];
    if (old.length > 1 || next.length > 1) return [...old.map((menu, i) => ({ key: `${k}:old:${i}`, kind: "ambiguous" as const, before: menu })), ...next.map((menu, i) => ({ key: `${k}:new:${i}`, kind: "ambiguous" as const, after: menu }))];
    if (!old.length) return [{ key: k, kind: "added", after: next[0] }];
    if (!next.length) return [{ key: k, kind: "removed", before: old[0] }];
    return [{ key: k, kind: JSON.stringify(menuDescription(old[0], before!)) === JSON.stringify(menuDescription(next[0], after)) && old[0].selected === next[0].selected ? "same" : "changed", before: old[0], after: next[0] }];
  });
}

export function comparisonExample(base: Draft): Draft {
  const next = structuredClone(base);
  delete next.source;
  next.notes = ["가상 비교 예시입니다. 실제 AI 분석 결과가 아닙니다."];
  next.menus[0].price = String(Number(next.menus[0].price || 0) + 500);
  if (next.menus.length > 1) next.menus.pop();
  let id = "comparison-example-new";
  while (next.menus.some((menu) => menu.id === id)) id += "-new";
  next.menus.push({ id, name: "신메뉴 예시", price: "4500", categoryId: next.categories[0].id, selected: true, groupIds: [], prices: {} });
  return next;
}
