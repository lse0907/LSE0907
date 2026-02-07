// src/app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId, setCurrentStoreId, clearCurrentStoreId } from "@/app/lib/currentStore";
import { DEFAULT_STORE_PROFILE, saveStoreProfile } from "@/app/lib/storeProfile";

type StoreRow = {
  store_id: string;
  store_name: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MemberRow = {
  store_id: string;
  role: string | null;
};

function slugifyStoreId(input: string) {
  const base = (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-")
    .replace(/^\-+|\-+$/g, "");

  const suffix = Math.random().toString(16).slice(2, 8);
  const out = base.length >= 3 ? base : `store-${suffix}`;
  return out.slice(0, 40);
}

function clampOverlay(v: number) {
  if (!Number.isFinite(v)) return DEFAULT_STORE_PROFILE.mainImageOverlayStrength;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export default function AdminHomePage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [booting, setBooting] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);

  const [selectedStoreId, setSelectedStoreIdState] = useState<string | null>(() => getCurrentStoreId());
  const [activeTab, setActiveTab] = useState<"stats" | "ops" | "settings">("stats");
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrollToCreate, setScrollToCreate] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createId, setCreateId] = useState("");
  const [createDesc, setCreateDesc] = useState(DEFAULT_STORE_PROFILE.storeDesc);
  const [createMainImage, setCreateMainImage] = useState(DEFAULT_STORE_PROFILE.mainImage);
  const [createLogoImage, setCreateLogoImage] = useState(DEFAULT_STORE_PROFILE.logoImage);
  const [createOverlayStrength, setCreateOverlayStrength] = useState(DEFAULT_STORE_PROFILE.mainImageOverlayStrength);
  const [msg, setMsg] = useState<string>("");

  const selectedStore = useMemo(() => {
    if (!selectedStoreId) return null;
    return stores.find((s) => s.store_id === selectedStoreId) || null;
  }, [stores, selectedStoreId]);

  const selectedRole = useMemo(() => {
    if (!selectedStoreId) return null;
    return members.find((m) => m.store_id === selectedStoreId)?.role || null;
  }, [members, selectedStoreId]);

  const setSelectedStoreId = (storeId: string) => {
    setSelectedStoreIdState(storeId);
    setCurrentStoreId(storeId);
  };

  const loadMyStores = async (uid: string) => {
    const memRes = await supabase
      .from("store_members")
      .select("store_id, role")
      .eq("user_id", uid)
      .order("id", { ascending: true });

    if (memRes.error) throw memRes.error;

    const memRows = (memRes.data || []) as MemberRow[];
    setMembers(memRows);

    const ids = memRows.map((m) => m.store_id).filter(Boolean);
    if (!ids.length) {
      setStores([]);
      return;
    }

    const storeRes = await supabase
      .from("stores")
      .select("store_id, store_name, created_at, updated_at")
      .in("store_id", ids);

    if (storeRes.error) throw storeRes.error;

    const list = (storeRes.data || []) as StoreRow[];
    list.sort((a, b) => String(a.store_name || "").localeCompare(String(b.store_name || "")));
    setStores(list);
  };

  useEffect(() => {
    (async () => {
      setBooting(true);
      setMsg("");

      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setBooting(false);
        router.replace("/login");
        return;
      }

      const u = data.user;
      if (!u) {
        setBooting(false);
        router.replace("/login");
        return;
      }

      setUserId(u.id);

      try {
        await loadMyStores(u.id);

        const saved = getCurrentStoreId();
        const fromQuery = (sp.get("store") || "").trim();
        const preferred = fromQuery || saved;
        if (preferred) {
          setSelectedStoreId(preferred);
        }
      } catch (e: any) {
        console.error("[admin] load stores error:", e?.message || e);
        setMsg(`매장 목록 로드 실패: ${String(e?.message || e)}`);
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  useEffect(() => {
    if (!stores.length) {
      setSelectedStoreIdState(null);
      clearCurrentStoreId();
      return;
    }
    if (selectedStoreId && stores.some((s) => s.store_id === selectedStoreId)) {
      return;
    }
    setSelectedStoreId(stores[0].store_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, selectedStoreId]);

  useEffect(() => {
    if (!createName.trim()) return;
    if (createId.trim()) return;
    setCreateId(slugifyStoreId(createName));
  }, [createName, createId]);

  const onCreateStore = async () => {
    if (!userId) return;
    setMsg("");

    const name = createName.trim();
    const id = createId.trim();

    if (!name) return setMsg("매장명을 입력해주세요.");
    if (!id) return setMsg("매장 ID를 입력해주세요.");

    setCreating(true);
    try {
      const insStore = await supabase.from("stores").insert([
        {
          store_id: id,
          store_name: name,
          owner_user_id: userId,
        } as any,
      ]);

      if (insStore.error) {
        if (String(insStore.error.message || "").includes("owner_user_id")) {
          const retry = await supabase.from("stores").insert([{ store_id: id, store_name: name } as any]);
          if (retry.error) throw retry.error;
        } else {
          throw insStore.error;
        }
      }

      const insMem = await supabase.from("store_members").insert([
        {
          store_id: id,
          user_id: userId,
          role: "owner",
        },
      ]);

      if (insMem.error) throw insMem.error;

      saveStoreProfile(id, {
        storeName: name,
        storeDesc: createDesc.trim() || DEFAULT_STORE_PROFILE.storeDesc,
        mainImage: createMainImage.trim() || DEFAULT_STORE_PROFILE.mainImage,
        logoImage: createLogoImage.trim(),
        mainImageOverlayStrength: clampOverlay(createOverlayStrength),
        extra: { ...DEFAULT_STORE_PROFILE.extra },
      });

      await loadMyStores(userId);
      setSelectedStoreId(id);

      setCreateName("");
      setCreateId("");
      setCreateDesc(DEFAULT_STORE_PROFILE.storeDesc);
      setCreateMainImage(DEFAULT_STORE_PROFILE.mainImage);
      setCreateLogoImage(DEFAULT_STORE_PROFILE.logoImage);
      setCreateOverlayStrength(DEFAULT_STORE_PROFILE.mainImageOverlayStrength);
      setMsg("매장이 생성되었습니다 ✅");
    } catch (e: any) {
      console.error("[admin] create store error:", e?.message || e);
      setMsg(`매장 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setCreating(false);
      setTimeout(() => setMsg(""), 2000);
    }
  };

  const go = (path: string) => {
    if (!selectedStoreId) {
      setMsg("먼저 매장을 선택하거나 생성해주세요.");
      return;
    }
    router.push(`${path}?store=${encodeURIComponent(selectedStoreId)}`);
  };

  const openCreateTab = () => {
    setActiveTab("settings");
    setScrollToCreate(true);
  };

  useEffect(() => {
    if (!scrollToCreate) return;
    const target = document.getElementById("create-store-panel");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const timer = setTimeout(() => setScrollToCreate(false), 300);
    return () => clearTimeout(timer);
  }, [scrollToCreate]);

  if (booting) {
    return (
      <main className="wrap">
        <style jsx global>{baseCss}</style>
        <div className="card">
          <h1 className="h1">관리자</h1>
          <p className="muted">로딩 중...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <style jsx global>{baseCss}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">관리자</h1>
          <p className="desc">모바일에 맞춘 탭 화면입니다. 먼저 매장을 선택하세요.</p>
        </div>

        <div className="menuWrap">
          <button className="menuBtn" onClick={() => setMenuOpen((prev) => !prev)} aria-label="메뉴 열기">
            ⋯
          </button>
          {menuOpen ? (
            <div className="menuPanel">
              <a className="menuItem" href="/menu">
                고객 화면
              </a>
              <a className="menuItem" href="/logout">
                로그아웃
              </a>
            </div>
          ) : null}
        </div>
      </header>

      {msg ? <div className="alert">{msg}</div> : null}

      {/* ===== 매장 선택 ===== */}
      <section className="card">
        <div className="cardHead">
          <h2 className="cardTitle">매장 선택</h2>
          <span className="pill">{stores.length}개</span>
        </div>

        {stores.length === 0 ? (
          <div className="emptyBox">
            <p className="muted">
              아직 등록된 매장이 없습니다. 매장을 만들면서 기본 정보까지 함께 입력해 주세요.
            </p>
            <button className="btn btnPrimary" onClick={openCreateTab}>
              매장 만들기
            </button>
          </div>
        ) : (
          <div className="storeList">
            {stores.map((s) => {
              const on = s.store_id === selectedStoreId;
              const role = members.find((m) => m.store_id === s.store_id)?.role || "-";
              return (
                <button
                  key={s.store_id}
                  className={`storeRow ${on ? "storeRowOn" : ""}`}
                  onClick={() => setSelectedStoreId(s.store_id)}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="storeName">
                      {s.store_name || "(이름 없음)"} <span className="muted">· {s.store_id}</span>
                    </div>
                    <div className="muted">권한: {role}</div>
                  </div>
                  <div className="pill">{on ? "선택됨" : "선택"}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== 관리자 탭 ===== */}
      <section className="card">
        <div className="tabHeader">
          <button
            className={`tabBtn ${activeTab === "stats" ? "tabBtnOn" : ""}`}
            onClick={() => setActiveTab("stats")}
          >
            통계
          </button>
          <button
            className={`tabBtn ${activeTab === "ops" ? "tabBtnOn" : ""}`}
            onClick={() => setActiveTab("ops")}
          >
            운영
          </button>
          <button
            className={`tabBtn ${activeTab === "settings" ? "tabBtnOn" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            설정
          </button>
        </div>

        <div className="tabMeta">
          <span className="pill">
            {selectedStore ? `${selectedStore.store_name || selectedStore.store_id}` : "매장 미선택"}
            {selectedRole ? ` · ${selectedRole}` : ""}
          </span>
          <span className="muted">순서: 매장 만들기 → 매장 선택 → 메뉴/옵션</span>
        </div>

        {activeTab === "stats" ? (
          <div className="cards">
            <button className="cardBtn" onClick={() => go("/admin/stats")} disabled={!selectedStoreId}>
              <div className="cardBtnTitle">통계 바로가기</div>
              <div className="cardBtnDesc">매출/기간별 CSV 다운로드를 확인합니다.</div>
            </button>
          </div>
        ) : null}

        {activeTab === "ops" ? (
          <div className="cards">
            <button className="cardBtn" onClick={() => go("/admin/menu")} disabled={!selectedStoreId}>
              <div className="cardBtnTitle">메뉴 관리</div>
              <div className="cardBtnDesc">메뉴/가격/이미지/옵션 연결 + 노출 순서를 관리합니다.</div>
            </button>

            <button className="cardBtn" onClick={() => go("/admin/options")} disabled={!selectedStoreId}>
              <div className="cardBtnTitle">옵션 관리</div>
              <div className="cardBtnDesc">옵션 그룹/옵션 항목을 등록합니다.</div>
            </button>

            <button className="cardBtn" onClick={() => go("/admin/qr")} disabled={!selectedStoreId}>
              <div className="cardBtnTitle">QR 생성</div>
              <div className="cardBtnDesc">테이블/카운터 QR 생성 후 인쇄용 파일을 만듭니다.</div>
            </button>
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <div className="cards">
            <div className="cardPanel" id="create-store-panel">
              <div className="cardPanelHead">
                <div>
                  <div className="cardBtnTitle">매장 만들기 + 정보 입력</div>
                  <div className="cardBtnDesc">매장을 만들면서 기본 정보를 함께 등록합니다.</div>
                </div>
                <span className="pill">owner 자동 등록</span>
              </div>

              <div className="formGrid">
                <div className="field">
                  <div className="label">매장명</div>
                  <input
                    className="input"
                    value={createName}
                    onChange={(e) => {
                      setCreateName(e.target.value);
                      setCreateId("");
                    }}
                    placeholder="예: 테스트 매장"
                  />
                </div>

                <div className="field">
                  <div className="label">매장 ID (URL/DB 키)</div>
                  <input
                    className="input"
                    value={createId}
                    onChange={(e) => setCreateId(e.target.value)}
                    placeholder="예: ximen"
                  />
                  <div className="hint">영문/숫자/하이픈 권장. 나중에 QR/데이터 키로 사용합니다.</div>
                </div>
              </div>

              <div className="field">
                <div className="label">매장 설명</div>
                <textarea
                  className="textarea"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="예) QR로 간편하게 주문하고 기다리세요..."
                />
              </div>

              <div className="field">
                <div className="label">대표 이미지 경로 (public 기준)</div>
                <input
                  className="input"
                  value={createMainImage}
                  onChange={(e) => setCreateMainImage(e.target.value)}
                  placeholder='예: "/hero.jpg"'
                />
              </div>

              <div className="field">
                <div className="label">로고 이미지 경로 (선택)</div>
                <input
                  className="input"
                  value={createLogoImage}
                  onChange={(e) => setCreateLogoImage(e.target.value)}
                  placeholder='예: "/logo.png" (없으면 빈칸)'
                />
              </div>

              <div className="field">
                <div className="label">대표이미지 오버레이 강도 (0~100)</div>
                <div className="sliderRow">
                  <input
                    className="range"
                    type="range"
                    min={0}
                    max={100}
                    value={createOverlayStrength}
                    onChange={(e) => setCreateOverlayStrength(clampOverlay(Number(e.target.value)))}
                  />
                  <input
                    className="input"
                    inputMode="numeric"
                    value={String(createOverlayStrength)}
                    onChange={(e) => setCreateOverlayStrength(clampOverlay(Number(e.target.value)))}
                  />
                </div>
                <div className="hint">0 = 거의 원본 / 100 = 아주 어둡게</div>
              </div>

              <div className="btnRow">
                <button className="btn btnPrimary" onClick={onCreateStore} disabled={creating}>
                  {creating ? "생성 중..." : "매장 등록"}
                </button>
              </div>
            </div>

            <button className="cardBtn" onClick={() => go("/admin/store")} disabled={!selectedStoreId}>
              <div className="cardBtnTitle">매장 정보 수정</div>
              <div className="cardBtnDesc">생성 후에 기본 정보를 수정할 때 사용합니다.</div>
            </button>
          </div>
        ) : null}

        {!selectedStoreId ? (
          <div className="alert" style={{ marginTop: 12 }}>
            매장을 선택해야 기능을 사용할 수 있어요.
          </div>
        ) : null}
      </section>
    </main>
  );
}

const baseCss = `
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
.wrap{
  max-width: 920px;
  margin: 0 auto;
  padding: 14px;
  display: grid;
  gap: 12px;
}
.topbar{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
}
.menuWrap{
  position:relative;
}
.menuBtn{
  height:38px;
  width:44px;
  border-radius:12px;
  border:1px solid var(--line);
  background:#fff;
  font-size:22px;
  font-weight:900;
  cursor:pointer;
}
.menuPanel{
  position:absolute;
  top:46px;
  right:0;
  background:#fff;
  border:1px solid var(--line);
  border-radius:14px;
  min-width:140px;
  box-shadow:0 8px 24px rgba(15,23,42,0.12);
  padding:6px;
  display:grid;
  gap:4px;
  z-index:10;
}
.menuItem{
  padding:10px 12px;
  border-radius:10px;
  font-weight:900;
  color:var(--text);
  text-decoration:none;
}
.menuItem:hover{
  background:#f3f4f6;
}
.h1{
  margin:0;
  font-size:28px;
  font-weight:950;
  letter-spacing:-0.02em;
}
.desc{
  margin:6px 0 0 0;
  color:var(--muted);
  font-size:13px;
  font-weight:800;
  line-height:1.4;
  word-break:keep-all;
}
.muted{
  color:var(--muted);
  font-weight:800;
  font-size:12px;
}
.card{
  background:var(--card);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:14px;
  box-shadow:0 1px 0 rgba(0,0,0,0.03);
}
.cardHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.cardTitle{
  margin:0;
  font-size:16px;
  font-weight:950;
}
.pill{
  font-size:12px;
  font-weight:900;
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--line);
  background:#f9fafb;
  color:#6b7280;
  white-space:nowrap;
}
.alert{
  border:1px solid #fecaca;
  background:#fef2f2;
  color:#991b1b;
  border-radius:14px;
  padding:10px 12px;
  font-weight:900;
}
.tabHeader{
  display:grid;
  grid-template-columns:repeat(3, 1fr);
  gap:8px;
}
.emptyBox{
  margin-top:12px;
  display:grid;
  gap:10px;
  align-items:start;
}
.tabBtn{
  border:1px solid var(--line);
  background:#fff;
  padding:10px 0;
  border-radius:12px;
  font-weight:950;
  cursor:pointer;
}
.tabBtnOn{
  background:var(--brand);
  color:#fff;
  border-color:var(--brand);
}
.tabMeta{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:8px;
  margin-top:12px;
  flex-wrap:wrap;
}
.textarea{
  padding:10px 12px;
  border-radius:12px;
  border:1px solid var(--line);
  background:#fff;
  font-weight:800;
  width:100%;
  min-height:88px;
  resize:vertical;
  white-space:pre-wrap;
}
.sliderRow{
  display:grid;
  grid-template-columns:1fr 90px;
  gap:10px;
  align-items:center;
}
.range{
  width:100%;
}
.formGrid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:12px;
}
.field{
  display:grid;
  gap:6px;
}
.label{
  font-size:12px;
  color:var(--muted);
  font-weight:900;
}
.input{
  padding:10px 12px;
  border-radius:12px;
  border:1px solid var(--line);
  background:#fff;
  font-weight:800;
  width:100%;
}
.hint{
  color:var(--muted);
  font-size:12px;
  font-weight:800;
  line-height:1.35;
}
.btnRow{
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  margin-top:12px;
}
.btn{
  border:1px solid var(--line);
  background:#fff;
  padding:10px 14px;
  border-radius:12px;
  cursor:pointer;
  font-weight:950;
}
.btnPrimary{
  background:var(--brand);
  color:#fff;
  border-color:var(--brand);
}
.btn:disabled, .btnPrimary:disabled{
  opacity:.5;
  cursor:not-allowed;
}
.storeList{
  display:grid;
  gap:10px;
  margin-top:12px;
}
.storeRow{
  text-align:left;
  border:1px solid var(--line);
  background:#fff;
  border-radius:14px;
  padding:12px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
}
.storeRowOn{
  border:2px solid var(--brand);
}
.storeName{
  font-weight:950;
  font-size:14px;
}
.cards{
  display:grid;
  gap:12px;
  margin-top:12px;
}
.cardPanel{
  border:1px solid var(--line);
  border-radius:16px;
  padding:14px;
  background:#fff;
  display:grid;
  gap:12px;
}
.cardPanelHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.cardBtn{
  text-align:left;
  border:1px solid var(--line);
  background:#fff;
  border-radius:16px;
  padding:14px;
  cursor:pointer;
}
.cardBtn:disabled{
  opacity:.5;
  cursor:not-allowed;
}
.cardBtnTitle{
  margin:0;
  font-size:18px;
  font-weight:950;
}
.cardBtnDesc{
  margin-top:6px;
  font-size:13px;
  font-weight:800;
  color:var(--muted);
  line-height:1.4;
}
@media (max-width: 820px){
  .formGrid{ grid-template-columns:1fr; }
}
`;
