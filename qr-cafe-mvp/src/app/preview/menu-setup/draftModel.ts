export type Category = { id: string; name: string };
export type OptionItem = { id: string; name: string; price: string };
export type OptionGroup = { id: string; name: string; scope: "common" | "exclusive"; menuId: string; required: "" | "yes" | "no"; max: string; items: OptionItem[]; suggested?: boolean };
export type Menu = { id: string; selected: boolean; name: string; price: string; categoryId: string; groupIds: string[]; prices: Record<string, string> };
export type Draft = { categories: Category[]; groups: OptionGroup[]; menus: Menu[]; source?: "ai"; notes?: string[]; reviewed?: Record<string, string> };

const normalizedName = (name: string) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
export function duplicateMenus(menu: Menu, draft: Draft): Menu[] {
  if (!menu.selected || !normalizedName(menu.name)) return [];
  return draft.menus.filter((item) => item.selected && item.categoryId === menu.categoryId && normalizedName(item.name) === normalizedName(menu.name));
}
export function reviewSignature(kind: "menu" | "group", id: string, draft: Draft): string {
  if (kind === "menu") {
    const menu = draft.menus.find((item) => item.id === id);
    return JSON.stringify(menu ? { category: draft.categories.find((item) => item.id === menu.categoryId)?.name,
      peers: duplicateMenus(menu, draft).map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)) } : null);
  }
  return JSON.stringify({ group: draft.groups.find((item) => item.id === id),
    menus: draft.menus.filter((menu) => menu.selected && menu.groupIds.includes(id)).map((menu) => ({ ...menu })).sort((a, b) => a.id.localeCompare(b.id)) });
}
export function needsNameReview(menu: Menu, draft: Draft): boolean {
  return duplicateMenus(menu, draft).length > 1 && draft.reviewed?.[`menu:${menu.id}`] !== reviewSignature("menu", menu.id, draft);
}
export function scopeReviewApplies(group: OptionGroup, draft: Draft): boolean {
  const sizeLike = /사이즈|size/i.test(group.name) || group.items.some((item) => /^(L|J|K|Large|Jumbo|King)$/i.test(item.name.trim()));
  return draft.source === "ai" && sizeLike && draft.menus.some((menu) => menu.selected && menu.groupIds.includes(group.id));
}
export function needsScopeReview(group: OptionGroup, draft: Draft): boolean {
  return scopeReviewApplies(group, draft) && draft.reviewed?.[`group:${group.id}`] !== reviewSignature("group", group.id, draft);
}
export function markReviewed(draft: Draft, kind: "menu" | "group", id: string, checked: boolean): Draft {
  const reviewed = { ...draft.reviewed }; const key = `${kind}:${id}`;
  if (checked) reviewed[key] = reviewSignature(kind, id, draft); else delete reviewed[key];
  return { ...draft, reviewed };
}

export function exampleDraft(): Draft {
  const names = [
    ["아메리카노", "에스프레소", "콜드브루", "디카페인 아메리카노", "카페 룽고", "롱블랙", "아인슈페너", "코코넛 콜드브루", "오렌지 아메리카노", "에스프레소 토닉"],
    ["카페라떼", "바닐라라떼", "돌체라떼", "카라멜라떼", "카페모카", "헤이즐넛라떼", "연유라떼", "시그니처라떼", "흑임자라떼", "오트라떼"],
    ["얼그레이", "캐모마일", "페퍼민트", "루이보스", "레몬티", "자몽티", "유자티", "생강차", "히비스커스", "복숭아 아이스티"],
    ["레몬에이드", "자몽에이드", "청포도에이드", "오렌지에이드", "패션후르츠에이드", "딸기에이드", "블루레몬에이드", "라임에이드", "매실에이드", "유자에이드"],
    ["플레인 요거트", "딸기 요거트", "블루베리 요거트", "망고 요거트", "키위 스무디", "딸기 스무디", "망고 스무디", "초코 프라페", "말차 프라페", "쿠키 프라페"],
    ["치즈케이크", "초코케이크", "당근케이크", "티라미수", "크루아상", "소금빵", "버터스콘", "초코쿠키", "마들렌", "휘낭시에"],
  ];
  const categories = ["커피", "라떼", "티", "에이드", "요거트·스무디", "디저트"].map((name, index) => ({ id: `category-${index}`, name }));
  const menus = names.flatMap((list, category) => list.map((name, index): Menu => ({
    id: `menu-${category}-${index}`, name, selected: true, price: String(3000 + category * 300 + index * 100), categoryId: categories[category].id,
    groupIds: category < 2 ? ["temperature", "size"] : category === 2 ? ["temperature"] : [], prices: {},
  })));
  menus.find((menu) => menu.name === "레몬에이드")!.price = "";
  menus.find((menu) => menu.name === "카페라떼")!.prices = { ice: "500" };
  const signature = menus.find((menu) => menu.name === "시그니처라떼")!;
  signature.groupIds = [...signature.groupIds, "topping"];
  return { categories, menus, groups: [
    { id: "temperature", name: "온도", scope: "common", menuId: "", required: "yes", max: "1", items: [{ id: "hot", name: "HOT", price: "0" }, { id: "ice", name: "ICE", price: "0" }] },
    { id: "size", name: "사이즈", scope: "common", menuId: "", required: "", max: "1", suggested: true, items: [{ id: "regular", name: "기본", price: "0" }, { id: "large", name: "라지", price: "1000" }] },
    { id: "topping", name: "토핑", scope: "exclusive", menuId: signature.id, required: "no", max: "1", items: [{ id: "cream", name: "크림 추가", price: "500" }] },
  ] };
}
export function validPrice(value: string): boolean { return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647; }
export function groupValid(group: OptionGroup, draft: Draft): boolean {
  return !!group.name.trim() && (group.required === "yes" || group.required === "no") && /^\d+$/.test(group.max)
    && Number(group.max) >= 1 && Number(group.max) <= group.items.length && group.items.length > 0
    && group.items.every((item) => !!item.name.trim() && validPrice(item.price))
    && (group.scope === "common" || draft.menus.some((menu) => menu.id === group.menuId));
}
export function menuValid(menu: Menu, draft: Draft): boolean {
  return !!menu.name.trim() && !needsNameReview(menu, draft) && validPrice(menu.price) && draft.categories.some((category) => category.id === menu.categoryId && !!category.name.trim())
    && menu.groupIds.every((id) => { const group = draft.groups.find((item) => item.id === id); return !!group && (group.scope === "common" || group.menuId === menu.id)
      && group.items.every((item) => menu.prices[item.id] === undefined || validPrice(menu.prices[item.id])); });
}
export function menuIssues(menu: Menu, draft: Draft): string[] {
  const issues: string[] = [];
  if (!menu.name.trim()) issues.push("메뉴명 확인");
  if (needsNameReview(menu, draft)) issues.push("같은 이름 메뉴 확인");
  if (!validPrice(menu.price)) issues.push("가격 확인");
  if (!draft.categories.some((category) => category.id === menu.categoryId && !!category.name.trim())) issues.push("카테고리 확인");
  for (const id of menu.groupIds) {
    const group = draft.groups.find((item) => item.id === id);
    if (!group) { issues.push("옵션 연결 확인"); continue; }
    if (!groupValid(group, draft)) issues.push(`${group.name || "옵션"} 설정 확인`);
    if (needsScopeReview(group, draft)) issues.push(`${group.name || "사이즈"} 제공 범위 확인`);
    if (group.scope === "exclusive" && group.menuId !== menu.id) issues.push("전용 옵션 연결 확인");
    if (group.items.some((item) => menu.prices[item.id] !== undefined && !validPrice(menu.prices[item.id]))) issues.push("메뉴별 요금 확인");
  }
  return issues;
}
export function registrationState(draft: Draft) {
  const menus = draft.menus.filter((menu) => menu.selected);
  const categories = draft.categories.filter((category) => menus.some((menu) => menu.categoryId === category.id));
  const groups = draft.groups.filter((group) => menus.some((menu) => menu.groupIds.includes(group.id)));
  const pendingMenus = menus.filter((menu) => !menuValid(menu, draft));
  const pendingGroups = groups.filter((group) => !groupValid(group, draft) || needsScopeReview(group, draft));
  const pending = pendingMenus.length + pendingGroups.length;
  return { menus, categories, groups, pending, affected: menus.filter((menu) => menuIssues(menu, draft).length > 0).length,
    canRegister: menus.length > 0 && pending === 0 };
}
export function reviewTasks(draft: Draft) {
  const state = registrationState(draft);
  return [
    ...state.groups.filter((group) => !groupValid(group, draft) || needsScopeReview(group, draft)).map((group) => ({ kind: "group" as const, id: group.id, title: `${group.name || "이름 없는 옵션"} ${needsScopeReview(group, draft) ? "제공 범위 확인" : "옵션 설정"}`, description: `원본·선택 조건·추가 요금 확인 · 연결 메뉴 ${state.menus.filter((menu) => menu.groupIds.includes(group.id)).length}개` })),
    ...state.menus.filter((menu) => !menuValid(menu, draft)).map((menu) => ({ kind: "menu" as const, id: menu.id, title: `${menu.name || "이름 없는 메뉴"} 수정`, description: menuIssues(menu, draft).join(" · ") })),
  ];
}
export function selectCategory(draft: Draft, ids: string[], categoryId: string, select: boolean): string[] {
  const targets = draft.menus.filter((menu) => menu.selected && menu.categoryId === categoryId).map((menu) => menu.id);
  const result = new Set(ids);
  for (const id of targets) { if (select) result.add(id); else result.delete(id); }
  return [...result];
}
export function applyGroup(draft: Draft, groupId: string, menuIds: string[]): Draft {
  const group = draft.groups.find((item) => item.id === groupId);
  if (!group) return draft;
  const targets = new Set(menuIds);
  return { ...draft, menus: draft.menus.map((menu) => targets.has(menu.id) && (group.scope === "common" || group.menuId === menu.id)
    ? { ...menu, groupIds: menu.groupIds.includes(groupId) ? menu.groupIds : [...menu.groupIds, groupId] } : menu) };
}
export function orderCheck(menu: Menu, draft: Draft, selections: Record<string, string[]>) {
  let total = Number(menu.price);
  const errors = menuIssues(menu, draft);
  for (const id of menu.groupIds) {
    const group = draft.groups.find((item) => item.id === id);
    if (!group) continue;
    const chosen = selections[id] || [];
    if (group.required === "yes" && chosen.length === 0) errors.push(`${group.name}: 필수 옵션을 선택해주세요`);
    if (chosen.length > Number(group.max)) errors.push(`${group.name}은 최대 ${group.max}개입니다`);
    for (const itemId of chosen) {
      const item = group.items.find((entry) => entry.id === itemId);
      if (!item) { errors.push("유효하지 않은 옵션"); continue; }
      total += Number(menu.prices[item.id] ?? item.price);
    }
  }
  return { total, errors };
}
