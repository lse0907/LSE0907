import { registrationState } from "./draftModel";
import { isDraft } from "./draftStorage";

const integer = (value: string) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new Error("가격·선택 수가 관리자 저장 범위를 벗어났습니다.");
  return Number(value);
};
const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");

/** Builds new rows only. No DB access, existing-ID reuse, setup completion, or QR changes. */
export function buildAdminPlan(input: unknown, storeId: string, nextId: () => string) {
  if (!storeId.trim() || !isDraft(input)) throw new Error("매장과 초안을 확인해주세요.");
  if (input.menus.length > 500 || input.categories.length > 100 || input.groups.length > 200
    || input.groups.reduce((sum, group) => sum + group.items.length, 0) > 4000) throw new Error("초안이 너무 큽니다. 나누어 확인해주세요.");
  const state = registrationState(input);
  if (!state.canRegister) throw new Error("초안의 확인할 항목을 먼저 처리해주세요.");
  const priceCount = state.menus.reduce((sum, menu) => sum + state.groups.filter((group) => menu.groupIds.includes(group.id)).reduce((n, group) => n + group.items.length, 0), 0);
  if (priceCount > 20000) throw new Error("메뉴별 옵션 요금 연결이 너무 많습니다. 나누어 등록해주세요.");
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (!unique(state.categories.map((category) => normalized(category.name)))) throw new Error("같은 이름의 카테고리를 정리해주세요.");
  const itemIds = input.groups.flatMap((group) => group.items.map((item) => item.id));
  if (!unique(itemIds)) throw new Error("옵션 항목 식별자가 중복되었습니다.");
  const knownItems = new Set(itemIds);
  for (const menu of state.menus) {
    if (!unique(menu.groupIds) || Object.keys(menu.prices).some((id) => !knownItems.has(id))) throw new Error("메뉴의 옵션 연결을 확인해주세요.");
  }
  const generated = new Set<string>();
  const allocate = (prefix: string) => {
    const id = `${prefix}_${nextId().replace(/-/g, "")}`;
    if (!/^[a-zA-Z0-9_]+$/.test(id) || id.length > 40 || generated.has(id)) throw new Error("새 식별자를 만들지 못했습니다.");
    generated.add(id); return id;
  };
  const categoryIds = new Map(state.categories.map((category) => [category.id, allocate("cat")]));
  const menuIds = new Map(state.menus.map((menu) => [menu.id, allocate("menu")]));
  const groupIds = new Map(state.groups.map((group) => [group.id, allocate("group")]));
  const optionIds = new Map(state.groups.flatMap((group) => group.items.map((item) => [item.id, allocate("item")] as const)));
  const categoryRows = state.categories.map((category, index) => ({ id: categoryIds.get(category.id)!, store_id: storeId, name: category.name.trim(), sort_order: index + 1, is_active: true }));
  const groupRows = state.groups.map((group, index) => {
    const connected = state.menus.filter((menu) => menu.groupIds.includes(group.id));
    if (group.scope === "exclusive" && (connected.length !== 1 || connected[0].id !== group.menuId)) throw new Error("전용 옵션의 연결 메뉴를 확인해주세요.");
    return { id: groupIds.get(group.id)!, store_id: storeId, name: group.name.trim(), scope: group.scope,
      linked_menu_id: group.scope === "exclusive" ? menuIds.get(group.menuId)! : null,
      required: group.required === "yes", min: group.required === "yes" ? 1 : 0, max: integer(group.max), sort_order: index + 1 };
  });
  const optionRows = state.groups.flatMap((group) => group.items.map((item) => ({ id: optionIds.get(item.id)!, store_id: storeId, group_id: groupIds.get(group.id)!, name: item.name.trim(), price_delta: integer(item.price) })));
  const menuRows = state.menus.map((menu, index) => ({ id: menuIds.get(menu.id)!, store_id: storeId, name: menu.name.trim(), price: integer(menu.price),
    image: "", is_sold_out: false, category_id: categoryIds.get(menu.categoryId)!, option_group_ids: menu.groupIds.map((id) => groupIds.get(id)!),
    option_not_required: menu.groupIds.length === 0, sort_order: index + 1 }));
  // Match admin's effective per-menu price rows, including defaults and explicit zero overrides.
  const priceRows = state.menus.flatMap((menu) => state.groups.filter((group) => menu.groupIds.includes(group.id)).flatMap((group) => group.items.map((item) => ({
    store_id: storeId, menu_id: menuIds.get(menu.id)!, option_item_id: optionIds.get(item.id)!,
    price_delta: integer(menu.prices[item.id]?.trim() ? menu.prices[item.id] : item.price),
  }))));
  return { categoryRows, menuRows, groupRows, optionRows, priceRows,
    deferredGroups: input.groups.filter((group) => !groupIds.has(group.id)).map((group) => group.name),
    heldMenus: input.menus.length - state.menus.length };
}
