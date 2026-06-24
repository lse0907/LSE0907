"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId } from "@/app/lib/currentStore";
import SetupProgressBanner from "@/app/admin/_components/SetupProgressBanner";

type OptionGroup = {
  id: string;
  store_id: string;
  name: string;
  required?: boolean | null;
  min?: number | null;
  max?: number | null;
  sort_order?: number | null;
  scope?: "common" | "exclusive" | null;
};

type OptionItem = {
  id: string;
  store_id: string;
  group_id: string;
  name: string;
  price_delta?: number | null;
};

type MenuSummary = {
  id: string;
  name: string;
  option_group_ids?: string[] | null;
};

type ConfirmState = {
  open: boolean;
  title: string;
  description: string;
  action: null | (() => void | Promise<void>);
};

function toErrMsg(e: unknown) {
  if (e instanceof Error) return e.message;
  return String(e ?? "알 수 없는 오류");
}

function getPolicyText(group: OptionGroup) {
  const min = Math.max(Number(group.min ?? 0), 0);
  const max = Math.max(Number(group.max ?? 1), 1);
  return group.required ? `필수 ${min}~${max}개` : `선택 ${min}~${max}개`;
}

function AdminMenuOptionConnectInner() {
  const sp = useSearchParams();
  const setupMode = (sp.get("mode") || "manual").trim();
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<OptionItem[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [menuQuery, setMenuQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [selectedMenuIds, setSelectedMenuIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(false);
  const [connectionStepConfirmed, setConnectionStepConfirmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgTone, setMsgTone] = useState<"neutral" | "success" | "error">("neutral");
  const [confirmState, setConfirmState] = useState<ConfirmState>({ open: false, title: "", description: "", action: null });

  useEffect(() => {
    const queryStore = (sp.get("store") || "").trim();
    const savedStore = (getCurrentStoreId() || "").trim();
    const sid = queryStore || savedStore;
    setStoreId(sid);
    if (sid) setCurrentStoreId(sid);
  }, [sp]);

  const refresh = async () => {
    if (!storeId) return;
    setLoading(true);
    setMsg("");
    setMsgTone("neutral");
    try {
      const [gRes, iRes, mRes, sRes] = await Promise.all([
        supabase
          .from("option_groups")
          .select("id, store_id, name, required, min, max, sort_order, scope")
          .eq("store_id", storeId)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
        supabase
          .from("option_items")
          .select("id, store_id, group_id, name, price_delta")
          .eq("store_id", storeId)
          .order("created_at", { ascending: true }),
        supabase
          .from("menu_items")
          .select("id, name, option_group_ids")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false }),
        supabase.from("stores").select("setup_completed,setup_last_step,store_name").eq("store_id", storeId).maybeSingle(),
      ]);

      if (gRes.error) throw gRes.error;
      if (iRes.error) throw iRes.error;
      if (mRes.error) throw mRes.error;
      if (sRes.error) throw sRes.error;

      const nextGroups = ((gRes.data || []) as OptionGroup[]).filter((group) => (group.scope || "common") !== "exclusive");
      const nextItems = (iRes.data || []) as OptionItem[];
      const nextMenus = (mRes.data || []) as MenuSummary[];
      const storeRow = sRes.data as { setup_completed?: boolean | null; setup_last_step?: number | null; store_name?: string | null } | null;

      setGroups(nextGroups);
      setItems(nextItems);
      setMenus(nextMenus);
      setStoreName(String(storeRow?.store_name || ""));
      setSetupCompleted(Boolean(storeRow?.setup_completed));
      setConnectionStepConfirmed(Number(storeRow?.setup_last_step || 0) >= 4 || Boolean(storeRow?.setup_completed));
      setSelectedGroupId((prev) => (prev && nextGroups.some((group) => group.id === prev) ? prev : nextGroups[0]?.id || ""));
    } catch (e: unknown) {
      console.error("[admin/menu/option-connect] refresh:", toErrMsg(e));
      setMsgTone("error");
      setMsg(`옵션 연결 확인 데이터 로드 실패: ${toErrMsg(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const groupItems = useMemo(
    () => items.filter((item) => item.group_id === selectedGroupId),
    [items, selectedGroupId]
  );
  const linkedMenus = useMemo(() => {
    if (!selectedGroup) return [];
    return menus.filter((menu) => (Array.isArray(menu.option_group_ids) ? menu.option_group_ids.includes(selectedGroup.id) : false));
  }, [menus, selectedGroup]);
  const linkedMenuIdSet = useMemo(() => new Set(linkedMenus.map((menu) => menu.id)), [linkedMenus]);
  const optionLinkedMenuCount = useMemo(
    () => menus.filter((menu) => Array.isArray(menu.option_group_ids) && menu.option_group_ids.length > 0).length,
    [menus]
  );
  const optionUnlinkedMenuCount = Math.max(menus.length - optionLinkedMenuCount, 0);
  const filteredMenus = useMemo(() => {
    const q = menuQuery.trim().toLowerCase();
    return menus.filter((menu) => {
      const linked = linkedMenuIdSet.has(menu.id);
      const matchesQuery = !q || menu.name.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "linked" && linked) ||
        (statusFilter === "unlinked" && !linked);
      return matchesQuery && matchesStatus;
    });
  }, [linkedMenuIdSet, menuQuery, menus, statusFilter]);
  const visibleMenuIds = useMemo(() => filteredMenus.map((menu) => menu.id), [filteredMenus]);
  const allVisibleSelected = visibleMenuIds.length > 0 && visibleMenuIds.every((id) => selectedMenuIds.includes(id));
  const groupItemLabel = groupItems.map((item) => item.name).join(" / ");

  useEffect(() => {
    setSelectedMenuIds([]);
    setMenuQuery("");
    setStatusFilter("all");
  }, [selectedGroupId]);

  const openConfirm = (title: string, description: string, action: () => void | Promise<void>) => {
    setConfirmState({ open: true, title, description, action });
  };
  const closeConfirm = () => {
    setConfirmState({ open: false, title: "", description: "", action: null });
  };
  const toggleMenuSelection = (menuId: string) => {
    setSelectedMenuIds((prev) => (prev.includes(menuId) ? prev.filter((id) => id !== menuId) : [...prev, menuId]));
  };
  const toggleVisibleMenus = () => {
    if (visibleMenuIds.length === 0) return;
    setSelectedMenuIds((prev) => {
      const prevSet = new Set(prev);
      const shouldClear = visibleMenuIds.every((id) => prevSet.has(id));
      if (shouldClear) return prev.filter((id) => !visibleMenuIds.includes(id));
      for (const id of visibleMenuIds) prevSet.add(id);
      return Array.from(prevSet);
    });
  };

  const applyConnection = async (mode: "connect" | "disconnect") => {
    if (!selectedGroup || saving || loading) return;
    const targetIds = selectedMenuIds.filter((id) => menus.some((menu) => menu.id === id));
    if (targetIds.length === 0) {
      setMsgTone("error");
      setMsg("연결을 변경할 메뉴를 선택해 주세요.");
      return;
    }

    const run = async () => {
      closeConfirm();
      try {
        setSaving(true);
        setMsg("");
        const nextMenus = menus.map((menu) => {
          if (!targetIds.includes(menu.id)) return menu;
          const currentIds = Array.isArray(menu.option_group_ids) ? menu.option_group_ids : [];
          const optionGroupIds =
            mode === "connect"
              ? Array.from(new Set([...currentIds, selectedGroup.id]))
              : currentIds.filter((id) => id !== selectedGroup.id);
          return { ...menu, option_group_ids: optionGroupIds };
        });

        for (const menu of nextMenus.filter((menu) => targetIds.includes(menu.id))) {
          const { error } = await supabase
            .from("menu_items")
            .update({ option_group_ids: menu.option_group_ids || [] })
            .eq("store_id", storeId)
            .eq("id", menu.id);
          if (error) throw error;
        }

        setMenus(nextMenus);
        setSelectedMenuIds([]);
        setMsgTone("success");
        setMsg(
          mode === "connect"
            ? `${targetIds.length}개 메뉴에 "${selectedGroup.name}" 옵션을 연결했습니다.`
            : `${targetIds.length}개 메뉴에서 "${selectedGroup.name}" 옵션 연결을 해제했습니다.`
        );
      } catch (e: unknown) {
        console.error("[admin/menu/option-connect] applyConnection:", toErrMsg(e));
        setMsgTone("error");
        setMsg(`메뉴 옵션 연결 변경 실패: ${toErrMsg(e)}`);
      } finally {
        setSaving(false);
      }
    };

    if (mode === "disconnect") {
      openConfirm(
        "옵션 연결 해제",
        `선택한 ${targetIds.length}개 메뉴에서 "${selectedGroup.name}" 옵션을 제거할까요? 고객 주문 화면에서 해당 옵션이 보이지 않습니다.`,
        () => void run()
      );
      return;
    }
    await run();
  };

  const onCompleteConnectionStep = async () => {
    if (!storeId || loading || groups.length === 0 || menus.length === 0) return;
    try {
      setSaving(true);
      setMsg("");
      const { error } = await supabase
        .from("stores")
        .update({
          setup_last_step: 4,
          setup_completed: false,
          setup_completed_at: null,
        })
        .eq("store_id", storeId);
      if (error) throw error;
      setSetupCompleted(false);
      setConnectionStepConfirmed(true);
      setMsgTone("success");
      setMsg("옵션 연결 확인이 완료되었습니다. 초기설정 페이지에서 최종 완료를 진행해 주세요.");
    } catch (e: unknown) {
      setMsgTone("error");
      setMsg(`옵션 연결 확인 저장 실패: ${toErrMsg(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const setupBackHref = `/admin/setup${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`;
  const adminHomeHref = `/admin${storeId ? `?store=${encodeURIComponent(storeId)}` : ""}`;
  const menuHref = `/admin/menu${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`;
  const optionsHref = `/admin/options${storeId ? `?store=${encodeURIComponent(storeId)}&mode=${encodeURIComponent(setupMode)}` : ""}`;

  return (
    <main className="wrap">
      <style jsx global>{`
        :root {
          color-scheme: light;
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
          max-width: 1050px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 10px;
        }
        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .titleRow {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          flex-wrap: wrap;
          width: 100%;
        }
        .h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 6px 0 0 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 800;
          line-height: 1.45;
        }
        .headerActionRow,
        .btnRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .summaryGrid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .summaryItem {
          border: 1px solid #dbe1ea;
          border-radius: 999px;
          padding: 7px 10px;
          background: linear-gradient(180deg, #ffffff, #f8fafc);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
        }
        .summaryItemInfo {
          border-color: #bfdbfe;
          background: linear-gradient(180deg, #eff6ff, #ffffff);
        }
        .summaryItemWarn {
          border-color: #fed7aa;
          background: linear-gradient(180deg, #fff7ed, #ffffff);
        }
        .summaryLabel {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
          white-space: nowrap;
        }
        .summaryValue {
          color: var(--text);
          font-size: 16px;
          font-weight: 950;
          letter-spacing: -0.03em;
          line-height: 1;
        }
        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
          font-size: 14px;
          line-height: 1.2;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        .btnPrimary {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .msgBox {
          border-radius: 12px;
          padding: 9px 10px;
          font-weight: 900;
          border: 1px solid #e5e7eb;
          background: #f8fafc;
          color: #374151;
        }
        .msgBoxSuccess {
          border-color: #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .msgBoxError {
          border-color: #fecaca;
          background: #fef2f2;
          color: #991b1b;
        }
        .grid {
          display: grid;
          grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.4fr);
          gap: 10px;
          align-items: start;
        }
        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }
        .cardIntro {
          margin: 6px 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.45;
        }
        .flowGuide {
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1e40af;
          border-radius: 12px;
          padding: 8px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.35;
        }
        .flowSteps {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .flowStep {
          border: 1px solid #bfdbfe;
          background: #fff;
          color: #1d4ed8;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 12px;
          font-weight: 950;
          white-space: nowrap;
        }
        .muted {
          color: var(--muted);
          font-weight: 800;
          font-size: 13px;
        }
        .list {
          display: grid;
          gap: 6px;
          margin-top: 10px;
          max-height: 360px;
          overflow-y: auto;
          padding-right: 2px;
        }
        .groupMeta {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          font-size: 12px;
          color: var(--muted);
          font-weight: 850;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .groupBtn {
          text-align: left;
          border: 1px solid var(--line);
          background: #fff;
          border-radius: 12px;
          padding: 9px 10px;
          cursor: pointer;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
        }
        .groupBtnOn {
          border: 2px solid var(--brand);
        }
        .rowTop {
          display: inline-flex;
          gap: 6px;
          align-items: center;
          min-width: 0;
        }
        .name {
          font-weight: 950;
          font-size: 14px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pill,
        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          padding: 4px 8px;
        }
        .pill {
          background: #f3f4f6;
          color: #111827;
        }
        .statusLinked {
          background: #dcfce7;
          color: #166534;
        }
        .statusUnlinked {
          background: #fff7ed;
          color: #9a3412;
        }
        .ruleSummary {
          margin-top: 8px;
          border: 1px solid #dbeafe;
          background: #eff6ff;
          color: #1e40af;
          border-radius: 12px;
          padding: 9px 11px;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.35;
        }
        .tools {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          margin-top: 12px;
        }
        .input {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          font-weight: 800;
          font-size: 14px;
          width: 100%;
        }
        .filters {
          display: inline-flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .filterChip {
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          -webkit-text-fill-color: currentColor;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 950;
          cursor: pointer;
        }
        .filterChipOn {
          border-color: #111827;
          background: #111827;
          color: #fff;
        }
        .selectBar {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #f8fafc;
          padding: 9px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .checkLabel {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 950;
          color: #111827;
          cursor: pointer;
        }
        .menuList {
          display: grid;
          gap: 6px;
          max-height: 460px;
          overflow-y: auto;
          padding-right: 2px;
          margin-top: 10px;
        }
        .menuRow {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: #fff;
          padding: 10px 12px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
        }
        .menuRowOn {
          border-color: #bfdbfe;
          background: #eff6ff;
        }
        .menuMeta {
          min-width: 0;
          display: flex;
          align-items: center;
        }
        .menuName {
          font-size: 14px;
          font-weight: 950;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          border-top: 1px dashed var(--line);
          padding-top: 10px;
          margin-top: 10px;
        }
        .actionSummary {
          color: #334155;
          font-size: 13px;
          font-weight: 900;
          line-height: 1.35;
          min-width: 0;
        }
        .dangerBtn {
          border-color: #fecaca;
          color: #b91c1c;
          background: #fff;
        }
        .actionBtns {
          display: inline-flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .emptyBox {
          border: 1px dashed var(--line);
          border-radius: 12px;
          background: #f8fafc;
          padding: 12px;
          margin-top: 10px;
          display: grid;
          gap: 8px;
        }
        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: grid;
          place-items: center;
          padding: 16px;
          z-index: 90;
        }
        .modalCard {
          width: min(460px, 100%);
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 14px;
          display: grid;
          gap: 10px;
          box-shadow: 0 14px 40px rgba(15, 23, 42, 0.18);
        }
        @media (max-width: 900px) {
          .grid,
          .tools {
            grid-template-columns: 1fr;
          }
          .filters {
            justify-content: flex-start;
          }
          .menuRow {
            grid-template-columns: minmax(0, 1fr) auto;
          }
          .list {
            max-height: 220px;
          }
          .flowGuide {
            padding: 7px 9px;
          }
          .flowStep {
            padding: 3px 7px;
          }
          .card {
            padding: 12px;
          }
          .summaryGrid {
            gap: 6px;
          }
          .summaryItem {
            padding: 6px 8px;
            min-height: 30px;
          }
          .summaryLabel { font-size: 11px; }
          .summaryValue { font-size: 15px; }
          .actionBtns,
          .actionBtns .btn {
            width: 100%;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <div>
            <h1 className="h1">옵션 연결 확인</h1>
            <p className="sub">
              {storeName ? `${storeName} 매장 · ` : ""}메뉴별 공통옵션 연결 상태를 확인하고, 필요한 경우 한 번에 연결합니다.
            </p>
          </div>
          <div className="headerActionRow">
            <a className="btn" href={adminHomeHref}>관리자 홈</a>
            <a className="btn" href={optionsHref}>옵션관리</a>
            <a className="btn" href={menuHref}>메뉴관리</a>
          </div>
        </div>
      </header>

      {!setupCompleted && storeId ? (
        <SetupProgressBanner
          stepLabel="옵션 연결 확인"
          stepNumber={4}
          modeLabel={setupMode === "copy" ? "원본 복사" : setupMode === "bulk" ? "일괄 등록" : "직접 설정"}
          modeDescription="메뉴별 옵션 연결 상태를 확인하는 단계입니다."
          stepGuide="옵션이 필요한 메뉴에 공통옵션이 연결되어 있는지 확인해 주세요."
          completeLabel="옵션 연결 확인 완료"
          isCompleted={connectionStepConfirmed}
          completedLabel="옵션 연결 확인 완료"
          completedDescription="메뉴별 옵션 연결 상태를 확인했습니다."
          completeDisabled={loading || saving || groups.length === 0 || menus.length === 0}
          disabledReason="공통옵션과 메뉴를 등록한 뒤 확인할 수 있습니다."
          noticeText="옵션이 필요 없는 메뉴는 연결하지 않아도 됩니다."
          setupHref={setupBackHref}
          onComplete={() => void onCompleteConnectionStep()}
        />
      ) : null}

      {storeId ? (
        <section className="card" aria-label="옵션 연결 상태 요약">
          <h2 className="cardTitle">옵션 연결 현황</h2>
          <div className="summaryGrid" style={{ marginTop: 10 }}>
            <div className="summaryItem">
              <span className="summaryLabel">등록 메뉴</span>
              <strong className="summaryValue">{menus.length}</strong>
            </div>
            <div className={`summaryItem ${optionLinkedMenuCount > 0 ? "summaryItemInfo" : ""}`.trim()}>
              <span className="summaryLabel">옵션 연결</span>
              <strong className="summaryValue">{optionLinkedMenuCount}</strong>
            </div>
            <div className={`summaryItem ${optionUnlinkedMenuCount > 0 ? "summaryItemWarn" : ""}`.trim()}>
              <span className="summaryLabel">옵션 미연결</span>
              <strong className="summaryValue">{optionUnlinkedMenuCount}</strong>
            </div>
            <div className="summaryItem">
              <span className="summaryLabel">공통옵션</span>
              <strong className="summaryValue">{groups.length}</strong>
            </div>
          </div>
          <p className="cardIntro">옵션이 필요 없는 메뉴는 미연결 상태로 두어도 됩니다.</p>
        </section>
      ) : null}

      <section className="flowGuide" aria-label="옵션 연결 확인 사용 순서">
        <span>사용 순서</span>
        <span className="flowSteps">
          <span className="flowStep">상태 확인</span>
          <span className="flowStep">① 옵션 선택</span>
          <span className="flowStep">② 메뉴 선택</span>
          <span className="flowStep">연결 적용</span>
        </span>
      </section>

      {msg ? (
        <div className={`msgBox ${msgTone === "success" ? "msgBoxSuccess" : msgTone === "error" ? "msgBoxError" : ""}`}>
          {msg}
        </div>
      ) : null}

      {!storeId ? (
        <section className="card">
          <h2 className="cardTitle">매장을 먼저 선택해 주세요</h2>
          <p className="muted" style={{ marginTop: 8 }}>관리자 홈에서 매장을 선택한 뒤 다시 들어와 주세요.</p>
          <div className="btnRow" style={{ marginTop: 12 }}>
            <a className="btn btnPrimary" href="/admin">관리자 홈</a>
          </div>
        </section>
      ) : (
        <section className="grid">
          <div className="card">
            <h2 className="cardTitle">① 연결할 공통옵션 선택 ({groups.length})</h2>
            <p className="cardIntro">메뉴에 함께 보여줄 공통옵션을 하나 선택하세요.</p>
            {loading ? <p className="muted" style={{ marginTop: 10 }}>옵션을 불러오는 중...</p> : null}
            {!loading && groups.length === 0 ? (
              <div className="emptyBox">
                <div className="muted">먼저 공통옵션 그룹과 항목을 등록해 주세요.</div>
                <a className="btn btnPrimary" href={optionsHref}>옵션관리로 이동</a>
              </div>
            ) : null}
            <div className="list">
              {groups.map((group) => {
                const linkedCount = menus.filter((menu) =>
                  Array.isArray(menu.option_group_ids) ? menu.option_group_ids.includes(group.id) : false
                ).length;
                const itemCount = items.filter((item) => item.group_id === group.id).length;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`groupBtn ${selectedGroupId === group.id ? "groupBtnOn" : ""}`}
                    onClick={() => setSelectedGroupId(group.id)}
                    disabled={saving || loading}
                  >
                    <span className="rowTop">
                      <span className="name">{group.name}</span>
                      <span className="groupMeta">항목 {itemCount}개 · {getPolicyText(group)}</span>
                    </span>
                    <span className={`statusBadge ${linkedCount > 0 ? "statusLinked" : "statusUnlinked"}`}>
                      {linkedCount > 0 ? `연결 ${linkedCount}` : "미연결"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h2 className="cardTitle">② 적용할 메뉴 선택</h2>
            {!selectedGroup ? (
              <p className="muted" style={{ marginTop: 10 }}>공통옵션을 선택해 주세요.</p>
            ) : (
              <>
                <div className="ruleSummary">
                  {selectedGroup.name} {groupItemLabel ? `· ${groupItemLabel}` : "· 옵션 항목을 먼저 추가해 주세요."}
                </div>
                <div className="btnRow" style={{ marginTop: 8 }}>
                  <span className="statusBadge statusLinked">연결 {linkedMenus.length}개</span>
                  <span className="statusBadge statusUnlinked">미연결 {Math.max(menus.length - linkedMenus.length, 0)}개</span>
                </div>

                <div className="tools">
                  <input
                    className="input"
                    value={menuQuery}
                    onChange={(e) => setMenuQuery(e.target.value)}
                    placeholder="메뉴명 검색"
                    disabled={saving || loading || menus.length === 0}
                  />
                  <div className="filters" role="tablist" aria-label="옵션 연결 상태 필터">
                    {[
                      { key: "all", label: "전체" },
                      { key: "linked", label: "연결됨" },
                      { key: "unlinked", label: "미연결" },
                    ].map((filter) => (
                      <button
                        key={filter.key}
                        className={`filterChip ${statusFilter === filter.key ? "filterChipOn" : ""}`}
                        type="button"
                        onClick={() => setStatusFilter(filter.key as "all" | "linked" | "unlinked")}
                        disabled={saving || loading}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="selectBar">
                  <label className="checkLabel">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleMenus}
                      disabled={saving || loading || visibleMenuIds.length === 0}
                    />
                    현재 목록 전체 선택
                  </label>
                  <span className="muted">표시 {filteredMenus.length}개 · 선택 {selectedMenuIds.length}개</span>
                </div>

                {menus.length === 0 ? (
                  <div className="emptyBox">
                    <div className="muted">메뉴를 등록한 뒤 공통옵션을 연결할 수 있습니다.</div>
                    <a className="btn btnPrimary" href={menuHref}>메뉴관리로 이동</a>
                  </div>
                ) : filteredMenus.length === 0 ? (
                  <div className="emptyBox">
                    <div className="muted">검색어 또는 연결 상태 필터를 변경해 주세요.</div>
                  </div>
                ) : (
                  <div className="menuList">
                    {filteredMenus.map((menu) => {
                      const isLinked = linkedMenuIdSet.has(menu.id);
                      const isSelected = selectedMenuIds.includes(menu.id);
                      return (
                        <label key={menu.id} className={`menuRow ${isSelected ? "menuRowOn" : ""}`}>
                          <span className="checkLabel">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleMenuSelection(menu.id)}
                              disabled={saving || loading}
                            />
                            <span className="menuMeta">
                              <span className="menuName">{menu.name}</span>
                            </span>
                          </span>
                          <span className={`statusBadge ${isLinked ? "statusLinked" : "statusUnlinked"}`}>
                            {isLinked ? "연결됨" : "미연결"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="actions">
                  <div className="actionSummary">
                    {selectedGroup.name} · 선택 메뉴 {selectedMenuIds.length}개
                  </div>
                  <div className="actionBtns">
                    <button
                      className="btn btnPrimary"
                      type="button"
                      onClick={() => void applyConnection("connect")}
                      disabled={saving || loading || selectedMenuIds.length === 0 || groupItems.length === 0}
                    >
                      선택 메뉴에 연결하기
                    </button>
                    <button
                      className="btn dangerBtn"
                      type="button"
                      onClick={() => void applyConnection("disconnect")}
                      disabled={saving || loading || selectedMenuIds.length === 0}
                    >
                      선택 메뉴에서 이 옵션 제거
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {confirmState.open ? (
        <div className="modalOverlay">
          <div className="modalCard">
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 950 }}>{confirmState.title}</h3>
            <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>{confirmState.description}</p>
            <div className="btnRow" style={{ justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn" type="button" onClick={closeConfirm} disabled={saving}>취소</button>
              <button className="btn btnPrimary" type="button" onClick={() => void confirmState.action?.()} disabled={saving}>확인</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function AdminMenuOptionConnectPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminMenuOptionConnectInner />
    </Suspense>
  );
}
