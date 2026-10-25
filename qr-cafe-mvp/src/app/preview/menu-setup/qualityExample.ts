import type { Draft } from "./draftModel";

// Hand-authored UX fixture, not an AI result or a real store menu.
export function qualityExampleDraft(): Draft {
  return { source: "ai", notes: ["검증용 가상 예시입니다. 메뉴명 오인식·중복과 잘못된 사이즈 연결을 일부러 넣었습니다."],
    categories: [{ id: "coffee", name: "커피" }, { id: "latte", name: "라떼" }],
    groups: [{ id: "sizes", name: "사이즈", scope: "common", menuId: "", required: "yes", max: "1", items: [
      { id: "l", name: "L", price: "0" }, { id: "j", name: "J", price: "800" }, { id: "k", name: "K", price: "1600" }] }],
    menus: [
      { id: "americano", selected: true, name: "아메리카노", price: "3000", categoryId: "coffee", groupIds: ["sizes"], prices: {} },
      { id: "misread", selected: true, name: "크림라떼", price: "3600", categoryId: "coffee", groupIds: ["sizes"], prices: { j: "1200", k: "2400" } },
      { id: "cream", selected: true, name: "크림라떼", price: "4500", categoryId: "coffee", groupIds: ["sizes"], prices: {} },
      { id: "black-sugar", selected: true, name: "흑임자라떼", price: "4000", categoryId: "latte", groupIds: ["sizes"], prices: { j: "1200", k: "2400" } },
    ] };
}
export function qualityExamplePhoto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="460" viewBox="0 0 780 460"><rect width="780" height="460" rx="16" fill="#183d3b"/><g fill="#fff" font-family="sans-serif" font-size="26"><text x="36" y="50">검증용 가상 메뉴판 · 실제 매장 아님</text><text x="36" y="120">커피</text><text x="470" y="120">L       J       K</text><text x="36" y="180">아메리카노</text><text x="470" y="180">3.0   3.8   4.6</text><text x="36" y="235">코리아노</text><text x="470" y="235">3.6   4.8   6.0</text><text x="36" y="290">크림라떼 (단일 사이즈)</text><text x="470" y="290">4.5     —     —</text><text x="36" y="350">라떼</text><text x="36" y="405">흑당라떼</text><text x="470" y="405">4.0   5.2   6.4</text></g></svg>`;
  return { id: "quality-example", name: "검증용 가상 메뉴판.svg", url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}
