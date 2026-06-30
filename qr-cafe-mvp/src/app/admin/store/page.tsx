"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import {
  fetchStoreProfileFromDb,
  saveStoreProfile,
  useStoreProfile,
} from "@/app/lib/storeProfile";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";

const STORE_IMAGE_BUCKET = "store-assets";
type StoreStatus = "active" | "inactive" | "deleted";

function normalizeStoreStatus(status?: string | null): StoreStatus {
  if (status === "inactive" || status === "deleted") return status;
  return "active";
}

function getStatusLabel(status: StoreStatus) {
  if (status === "inactive") return "비활성";
  if (status === "deleted") return "삭제됨";
  return "운영중";
}

function clampOverlay(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function getFileExt(name: string) {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

// ✅ "실제로 저장/반영되는 핵심 필드"만 비교/저장에 사용
function pickCore(p: any) {
  return {
    staffViewMode: p?.staffViewMode === "station" ? "station" : "simple",
    storeName: String(p?.storeName ?? ""),
    storeDesc: String(p?.storeDesc ?? ""),
    mainImage: String(p?.mainImage ?? ""),
    logoImage: String(p?.logoImage ?? ""),
    mainImageOverlayStrength: clampOverlay(
      Number(p?.mainImageOverlayStrength ?? 55),
    ),
    extra: {
      bizNo: String(p?.extra?.bizNo ?? ""),
      industry: String(p?.extra?.industry ?? ""),
      phone: String(p?.extra?.phone ?? ""),
      address: String(p?.extra?.address ?? ""),
      addressDetail: String(p?.extra?.addressDetail ?? ""),
      hours: String(p?.extra?.hours ?? ""),
      sns: String(p?.extra?.sns ?? ""),
    },
  };
}

const FREE_TRIAL_DAYS = 30;

function calcRemainingDays(createdAt?: string | null) {
  if (!createdAt) return null;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const diffMs = Date.now() - created;
  const usedDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, FREE_TRIAL_DAYS - usedDays);
}

function AdminstorePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState<string>("");
  const {
    profile,
    setProfile,
    loading: profileLoading,
    loadError: profileLoadError,
  } = useStoreProfile(storeId);
  const [storeCreatedAt, setStoreCreatedAt] = useState<string | null>(null);
  const [storeStatus, setStoreStatus] = useState<StoreStatus>("active");
  const [statusSaving, setStatusSaving] = useState(false);
  const [showAddr, setShowAddr] = useState(false);
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  // ✅ 폼 상태(편집용)
  const [draft, setDraft] = useState(profile);

  // ✅ 저장 UI 피드백
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // ✅ profile이 외부에서 바뀌면 draft도 동기화
  useEffect(() => {
    const q = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = q || saved;
    if (!sid) {
      router.replace("/admin");
      return;
    }
    setStoreId(sid);
  }, [router, sp]);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    if (!storeId) return;
    let mounted = true;
    (async () => {
      // `status` can be unavailable before docs/sql/supabase-store-lifecycle-v1.sql is applied.
      let res: any = await supabase
        .from("stores")
        .select("created_at,status")
        .eq("store_id", storeId)
        .maybeSingle();
      if (res.error && /status/i.test(res.error.message || "")) {
        res = await supabase
          .from("stores")
          .select("created_at")
          .eq("store_id", storeId)
          .maybeSingle();
      }
      if (!mounted) return;
      if (res.error) {
        console.error(
          "[admin/store] load store status error:",
          res.error.message,
        );
        setStoreCreatedAt(null);
        setStoreStatus("active");
        return;
      }
      setStoreCreatedAt(res.data?.created_at || null);
      setStoreStatus(normalizeStoreStatus(res.data?.status));
    })();
    return () => {
      mounted = false;
    };
  }, [storeId]);

  // ✅ 변경 여부: 저장 대상 핵심 필드만 비교
  const isDirty = useMemo(() => {
    const a = pickCore(draft);
    const b = pickCore(profile);
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [draft, profile]);

  const remainingDays = useMemo(
    () => calcRemainingDays(storeCreatedAt),
    [storeCreatedAt],
  );

  // ✅ 미리보기용 오버레이 계산(0~100)
  const strength = clampOverlay(
    Number((draft as any).mainImageOverlayStrength ?? 55),
  );
  const overlayBg = useMemo(() => {
    const aTop = 0.1 + 0.35 * (strength / 100);
    const aMid = 0.18 + 0.45 * (strength / 100);
    const aBot = 0.25 + 0.6 * (strength / 100);

    return `linear-gradient(
      to bottom,
      rgba(0,0,0,${aTop}) 0%,
      rgba(0,0,0,${aMid}) 55%,
      rgba(0,0,0,${aBot}) 100%
    )`;
  }, [strength]);

  const updateStoreStatus = async (nextStatus: StoreStatus) => {
    if (!storeId || statusSaving) return;
    const nextLabel = getStatusLabel(nextStatus);
    const ok = window.confirm(
      nextStatus === "inactive"
        ? "매장을 비활성화할까요? 고객 주문 페이지와 운영 진입이 제한될 수 있습니다."
        : "매장을 다시 활성화할까요?",
    );
    if (!ok) return;

    setStatusSaving(true);
    setUploadMsg("");
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id || null;
      const payload =
        nextStatus === "inactive"
          ? {
              status: "inactive",
              deactivated_at: new Date().toISOString(),
              deactivated_by: userId,
            }
          : {
              status: "active",
              deactivated_at: null,
              deactivated_by: null,
            };
      const { error } = await supabase
        .from("stores")
        .update(payload)
        .eq("store_id", storeId);
      if (error) throw error;
      setStoreStatus(nextStatus);
      setUploadMsg(`매장 상태를 ${nextLabel}(으)로 변경했습니다.`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setUploadMsg(`매장 상태 변경 실패: ${message}`);
    } finally {
      setStatusSaving(false);
    }
  };

  const onSave = async () => {
    if (!storeId) {
      setSaveState("error");
      return;
    }
    setSaving(true);
    setSaveState("idle");
    setUploadMsg("");

    try {
      // ✅ 핵심 필드만 저장 의도를 고정
      const core = pickCore(draft);

      const { error: saveErr } = await supabase
        .from("stores")
        .update({
          store_name: core.storeName || null,
          store_desc: core.storeDesc || null,
          main_image_url: core.mainImage || null,
          logo_image_url: core.logoImage || null,
          staff_view_mode: core.staffViewMode,
          phone: core.extra.phone || null,
          address: core.extra.address || null,
          address_detail: core.extra.addressDetail || null,
          business_hours: core.extra.hours || null,
          business_number: core.extra.bizNo || null,
          industry: core.extra.industry || null,
          sns_url: core.extra.sns || null,
          main_image_overlay_strength: core.mainImageOverlayStrength,
        })
        .eq("store_id", storeId);

      if (saveErr) throw saveErr;

      // ✅ DB 저장 성공 후 Supabase row를 다시 읽어 기준 데이터를 화면/캐시에 반영
      const fresh = await fetchStoreProfileFromDb(storeId);
      const resolved = fresh || {
        ...(draft as any),
        ...core,
      };
      saveStoreProfile(storeId, resolved);
      setProfile(resolved);

      setSaveState("saved");
      setLastSavedAt(Date.now());
    } catch (e: any) {
      console.error("[admin/store] save store profile error:", e?.message || e);
      setUploadMsg(
        `매장 정보 저장 실패: ${String(e?.message || e || "잠시 후 다시 시도해주세요.")}`,
      );
      setSaveState("error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveState("idle"), 2000);
    }
  };

  const onReset = () => {
    setDraft(profile);
    setSaveState("idle");
  };

  const openAddressSearch = () => setShowAddr(true);
  const closeAddressSearch = () => setShowAddr(false);

  const onCompleteAddress = (data: Address) => {
    const picked = (data.address || "").trim();
    setDraft((p: any) => ({
      ...p,
      extra: {
        ...(p?.extra || {}),
        address: picked,
      },
    }));
    closeAddressSearch();

    setTimeout(() => {
      const el = document.getElementById("storeAddressDetailInput");
      if (el) (el as HTMLInputElement).focus();
    }, 50);
  };

  const uploadStoreImage = async (file: File, kind: "main" | "logo") => {
    if (!storeId) {
      setUploadMsg("매장 정보를 먼저 불러온 뒤에 이미지를 업로드해 주세요.");
      return "";
    }
    const ext = getFileExt(file.name) || "png";
    const path = `${storeId}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(STORE_IMAGE_BUCKET)
      .upload(path, file, { upsert: true });
    if (error) throw error;

    const { data } = supabase.storage
      .from(STORE_IMAGE_BUCKET)
      .getPublicUrl(path);
    return data.publicUrl || "";
  };

  const onUploadMain = async (file: File | null) => {
    if (!file) return;
    setUploadingMain(true);
    setUploadMsg("");
    try {
      const url = await uploadStoreImage(file, "main");
      if (url) {
        setDraft((p: any) => ({ ...p, mainImage: url }));
      }
    } catch (e: any) {
      setUploadMsg(`대표 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingMain(false);
    }
  };

  const onUploadLogo = async (file: File | null) => {
    if (!file) return;
    setUploadingLogo(true);
    setUploadMsg("");
    try {
      const url = await uploadStoreImage(file, "logo");
      if (url) {
        setDraft((p: any) => ({ ...p, logoImage: url }));
      }
    } catch (e: any) {
      setUploadMsg(`로고 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <main className="wrap">
      <style jsx global>{`
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
      `}</style>

      <style jsx>{`
        .wrap {
          max-width: 1120px;
          margin: 0 auto;
          padding: 14px 14px 116px;
          display: grid;
          gap: 10px;
        }

        .topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
        }
        .topActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .badgeRow {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }

        .h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }

        .sub {
          margin: 4px 0 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
        }

        .badge {
          padding: 8px 10px;
          border-radius: 999px;
          font-weight: 900;
          font-size: 12px;
          border: 1px solid var(--line);
          background: #fff;
        }
        .badgeSaved {
          border-color: #bbf7d0;
          background: #f0fdf4;
        }
        .badgeError {
          border-color: #fecaca;
          background: #fef2f2;
        }
        .badgeDirty {
          border-color: #fed7aa;
          background: #fff7ed;
          color: #9a3412;
        }
        .uploadStatusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
        }
        .uploadStatusBadgeRegistered {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }
        .uploadStatusBadgeEmpty {
          border: 1px solid #d1d5db;
          background: #f9fafb;
          color: #4b5563;
        }
        .alert {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 900;
        }

        .grid {
          display: grid;
          grid-template-columns: minmax(320px, 0.95fr) minmax(400px, 1.05fr);
          gap: 12px;
          align-items: start;
        }
        .sideStack,
        .formStack {
          display: grid;
          gap: 10px;
          align-content: start;
        }
        .advancedGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          align-items: start;
        }
        .inlineGrid,
        .extraInfoGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .operationGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }
        .miniPanel {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
        }
        .sectionLead {
          margin: 4px 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }

        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .cardTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
        }

        .pageMeta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fff;
        }
        .metaText {
          color: var(--muted);
          font-size: 12px;
          font-weight: 850;
          line-height: 1.3;
        }
        .basicHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          flex-wrap: wrap;
        }
        .operationStrip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 10px;
          padding: 10px 12px;
          border: 1px solid #dbeafe;
          border-radius: 14px;
          background: #f8fbff;
        }
        .operationText {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .operationTitle {
          font-size: 13px;
          font-weight: 950;
          color: var(--text);
        }
        .operationDesc {
          color: var(--muted);
          font-size: 11px;
          font-weight: 800;
          line-height: 1.35;
        }
        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 12px;
          font-weight: 950;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .statusBadgeInactive {
          border-color: #cbd5e1;
          background: #f1f5f9;
          color: #475569;
        }
        .btnMuted {
          border-color: #cbd5e1;
          background: #f8fafc;
          color: #334155;
        }

        .field {
          display: grid;
          gap: 6px;
          margin-top: 10px;
        }

        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .pill {
          font-size: 11px;
          font-weight: 950;
          color: #6b7280;
          border: 1px solid var(--line);
          background: #f9fafb;
          padding: 4px 8px;
          border-radius: 999px;
          white-space: nowrap;
        }

        .input,
        .textarea {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: #ffffff;
          color: #111827;
          -webkit-text-fill-color: #111827;
          caret-color: #111827;
          font-weight: 800;
          width: 100%;
          color-scheme: light;
        }

        .input::placeholder,
        .textarea::placeholder {
          color: #9ca3af;
          -webkit-text-fill-color: #9ca3af;
        }

        .textarea {
          min-height: 88px;
          resize: vertical;
          white-space: pre-wrap;
        }

        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 12px;
          align-items: center;
        }

        .addressRow {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .addressRow .input {
          min-width: 0;
        }

        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
        }

        .btnPrimary {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }
        .btnCompact {
          padding: 8px 11px;
          border-radius: 10px;
          font-size: 12px;
          white-space: nowrap;
        }

        .btn:disabled,
        .btnPrimary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .hint {
          margin-top: 8px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }

        /* ===== 미리보기 ===== */
        .previewWrap {
          display: grid;
          gap: 10px;
        }

        .settingsCard {
          display: grid;
          align-content: start;
        }

        .detailBlock {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px dashed var(--line);
        }
        .stickySaveBar {
          position: fixed;
          left: max(14px, calc((100vw - 1120px) / 2 + 14px));
          right: max(14px, calc((100vw - 1120px) / 2 + 14px));
          bottom: 14px;
          z-index: 60;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border: 1px solid #fed7aa;
          border-radius: 16px;
          background: rgba(255, 247, 237, 0.98);
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
          backdrop-filter: blur(10px);
        }
        .stickyActions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .hero {
          position: relative;
          height: 220px;
          border-radius: 18px;
          overflow: hidden;
          background: linear-gradient(135deg, #111827 0%, #374151 100%);
        }

        .heroImg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .heroFallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          color: #fff;
          font-weight: 900;
          font-size: 14px;
          text-align: center;
          padding: 12px;
        }

        .overlay {
          position: absolute;
          inset: 0;
        }

        .heroInner {
          position: relative;
          height: 100%;
          display: grid;
          align-content: end;
          gap: 10px;
          padding: 14px;
        }

        .logoRow {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .logo {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.22);
          display: grid;
          place-items: center;
          overflow: hidden;
          flex: 0 0 auto;
        }

        .logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .storeName {
          margin: 0;
          color: #fff;
          font-weight: 950;
          font-size: 22px;
          letter-spacing: -0.02em;
          line-height: 1.15;
        }

        .descText {
          margin: 0;
          color: var(--text);
          white-space: pre-line;
          font-size: 14px;
          line-height: 1.5;
          font-weight: 750;
        }

        .previewCard {
          border: 1px solid var(--line);
          border-radius: 18px;
          background: #fff;
          padding: 12px;
        }

        .sliderRow {
          display: grid;
          grid-template-columns: 1fr 90px;
          gap: 10px;
          align-items: center;
        }

        .range {
          width: 100%;
        }

        .input:disabled,
        .textarea:disabled {
          background: #f9fafb;
          color: #6b7280;
          -webkit-text-fill-color: #6b7280;
          opacity: 1;
        }

        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          display: grid;
          place-items: center;
          padding: 16px;
          z-index: 50;
        }

        .modal {
          width: min(680px, 100%);
          background: #fff;
          border-radius: 16px;
          padding: 14px;
          border: 1px solid var(--line);
          box-shadow: 0 14px 40px rgba(15, 23, 42, 0.2);
        }

        .modalHead {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }

        @media (max-width: 980px) {
          .grid,
          .advancedGrid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .wrap {
            padding: 10px 10px 136px;
            gap: 8px;
          }

          .topbar {
            align-items: flex-start;
            flex-direction: row;
            justify-content: space-between;
            gap: 8px;
          }

          .topActions {
            width: auto;
            justify-content: flex-end;
            flex-wrap: nowrap;
          }

          .badgeRow {
            gap: 5px;
          }

          .pageMeta {
            align-items: flex-start;
            padding: 9px 10px;
          }

          .metaText {
            font-size: 11px;
          }

          .badge {
            font-size: 11px;
            padding: 6px 8px;
          }

          .inlineGrid,
          .extraInfoGrid,
          .operationGrid {
            grid-template-columns: 1fr;
          }

          .operationStrip {
            align-items: stretch;
            flex-direction: column;
          }

          .operationStrip .btn {
            width: 100%;
          }

          .stickySaveBar {
            left: 10px;
            right: 10px;
            bottom: 10px;
            align-items: stretch;
            flex-direction: column;
          }

          .stickyActions,
          .stickyActions .btn {
            width: 100%;
          }

          .card {
            padding: 12px;
            border-radius: 14px;
          }

          .previewWrap {
            gap: 8px;
          }

          .cardTitle {
            font-size: 15px;
          }

          .field {
            margin-top: 9px;
            gap: 5px;
          }

          .label {
            font-size: 11px;
            gap: 6px;
          }

          .pill {
            font-size: 10px;
            padding: 3px 7px;
          }

          .input,
          .textarea {
            padding: 10px;
            font-size: 14px;
          }

          .btn {
            font-size: 13px;
            padding: 9px 11px;
          }

          .sliderRow {
            grid-template-columns: 1fr 74px;
            gap: 8px;
          }

          .addressRow {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .addressRow .btn {
            width: 100%;
          }

          .btnRow {
            gap: 8px;
            margin-top: 14px;
          }

          .btnRow .btn {
            flex: 1 1 auto;
          }

          .detailBlock {
            margin-top: 12px;
            padding-top: 8px;
          }

          .primarySaveBar {
            gap: 8px;
          }

          .primarySaveBar .btn {
            flex: 1 1 auto;
          }

          .hero {
            height: 172px;
          }

          .previewCard {
            padding: 10px;
          }

          .descText {
            font-size: 13px;
            line-height: 1.45;
          }

          .hint {
            font-size: 11px;
            word-break: break-all;
          }

          .storeName {
            font-size: 16px;
          }
        }
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">매장 정보</h1>
          <p className="sub">필수 정보만 입력하세요.</p>
        </div>

        <div className="topActions">
          <button
            className="btn"
            type="button"
            onClick={() =>
              router.push(`/admin?store=${encodeURIComponent(storeId)}`)
            }
          >
            관리자 홈
          </button>
        </div>
      </header>

      <div className="pageMeta">
        <div className="badgeRow">
          <span
            className={`statusBadge ${storeStatus !== "active" ? "statusBadgeInactive" : ""}`.trim()}
          >
            {getStatusLabel(storeStatus)}
          </span>
          <span className="metaText">
            {remainingDays !== null
              ? `무료 사용기간 ${FREE_TRIAL_DAYS}일 · 잔여 ${remainingDays}일`
              : `무료 사용기간 ${FREE_TRIAL_DAYS}일`}
          </span>
        </div>
        {isDirty ? (
          <span className="badge badgeDirty">저장 필요</span>
        ) : saveState === "saved" ? (
          <span className="badge badgeSaved">저장 완료</span>
        ) : saveState === "error" ? (
          <span className="badge badgeError">저장 실패</span>
        ) : lastSavedAt ? (
          <span className="metaText">
            마지막 저장 {new Date(lastSavedAt).toLocaleTimeString()}
          </span>
        ) : null}
      </div>

      {uploadMsg ? <div className="alert">{uploadMsg}</div> : null}
      {profileLoading ? (
        <div className="alert">Supabase에서 매장 정보를 불러오는 중입니다.</div>
      ) : null}
      {!profileLoading && profileLoadError ? (
        <div className="alert">
          Supabase 매장 정보를 불러오지 못해 이 기기의 임시 정보를 표시
          중입니다. ({profileLoadError})
        </div>
      ) : null}

      <section className="grid">
        <div className="sideStack">
          <section className="card previewWrap">
            <div>
              <h2 className="cardTitle">미리보기</h2>
              <p className="sectionLead">
                고객 주문 화면에 보이는 대표 정보입니다.
              </p>
            </div>

            <div className="hero">
              {(draft as any).mainImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="heroImg"
                  src={(draft as any).mainImage}
                  alt="main"
                />
              ) : (
                <div className="heroFallback">대표 이미지를 등록하세요</div>
              )}
              <div className="overlay" style={{ background: overlayBg }} />

              <div className="heroInner">
                <div className="logoRow">
                  {(draft as any).logoImage ? (
                    <div className="logo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={(draft as any).logoImage} alt="logo" />
                    </div>
                  ) : (
                    <div className="logo" aria-hidden="true">
                      <span
                        style={{
                          color: "white",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        logo
                      </span>
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <h3 className="storeName">
                      {(draft as any).storeName || "매장명"}
                    </h3>
                  </div>
                </div>
              </div>
            </div>

            <div className="previewCard">
              <p className="descText">
                {(draft as any).storeDesc || "매장 설명이 여기에 표시됩니다."}
              </p>
            </div>
          </section>

          <section className="card">
            <h2 className="cardTitle">이미지 / 브랜딩</h2>
            <p className="sectionLead">
              주문 화면에 표시할 대표 이미지와 로고를 설정합니다.
            </p>

            <div className="inlineGrid">
              <div className="field">
                <div className="label">
                  대표 이미지 업로드
                  <span
                    className={`uploadStatusBadge ${(draft as any).mainImage ? "uploadStatusBadgeRegistered" : "uploadStatusBadgeEmpty"}`}
                  >
                    {(draft as any).mainImage ? "등록" : "미등록"}
                  </span>
                </div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => onUploadMain(e.target.files?.[0] || null)}
                  disabled={uploadingMain}
                />
                {uploadingMain ? (
                  <div className="hint">업로드 중...</div>
                ) : null}
              </div>

              <div className="field">
                <div className="label">
                  로고 이미지 업로드 (선택)
                  <span
                    className={`uploadStatusBadge ${(draft as any).logoImage ? "uploadStatusBadgeRegistered" : "uploadStatusBadgeEmpty"}`}
                  >
                    {(draft as any).logoImage ? "등록" : "미등록"}
                  </span>
                </div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => onUploadLogo(e.target.files?.[0] || null)}
                  disabled={uploadingLogo}
                />
                {uploadingLogo ? (
                  <div className="hint">업로드 중...</div>
                ) : null}
              </div>
            </div>

            <div className="field">
              <div className="label">대표이미지 오버레이 강도 (0~100)</div>
              <div className="sliderRow">
                <input
                  className="range"
                  type="range"
                  min={0}
                  max={100}
                  value={strength}
                  onChange={(e) =>
                    setDraft((p: any) => ({
                      ...p,
                      mainImageOverlayStrength: clampOverlay(
                        Number(e.target.value),
                      ),
                    }))
                  }
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={String(strength)}
                  onChange={(e) =>
                    setDraft((p: any) => ({
                      ...p,
                      mainImageOverlayStrength: clampOverlay(
                        Number(e.target.value),
                      ),
                    }))
                  }
                />
              </div>
            </div>
          </section>
        </div>

        <div className="formStack" role="group" aria-label="매장 기본 및 추가 정보">
          <section className="card" aria-labelledby="store-basic-info-title">
            <div className="basicHead">
              <div>
                <h2 className="cardTitle">기본 정보</h2>
                <p className="sectionLead">
                  고객 안내와 주문 운영에 바로 쓰이는 핵심 정보입니다.
                </p>
              </div>
              <span
                className={`statusBadge ${storeStatus !== "active" ? "statusBadgeInactive" : ""}`.trim()}
              >
                {getStatusLabel(storeStatus)}
              </span>
            </div>

            <div className="inlineGrid">
              <div className="field">
                <div className="label">매장명</div>
                <input
                  className="input"
                  value={(draft as any).storeName}
                  onChange={(e) =>
                    setDraft((p: any) => ({ ...p, storeName: e.target.value }))
                  }
                  placeholder="예: XIMEN 순천점"
                />
              </div>
              <div className="field">
                <div className="label">
                  매장 ID <span className="pill">수정 불가</span>
                </div>
                <input
                  className="input"
                  value={storeId}
                  disabled
                  placeholder="예: ximen"
                />
              </div>
            </div>

            <div className="field">
              <div className="label">매장 설명</div>
              <textarea
                className="textarea"
                value={(draft as any).storeDesc}
                onChange={(e) =>
                  setDraft((p: any) => ({ ...p, storeDesc: e.target.value }))
                }
                placeholder="예) QR로 간편하게 주문하고 기다리세요..."
              />
            </div>

            <div className="field">
              <div className="label">
                매장 전화번호 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={(draft as any)?.extra?.phone || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: { ...(p?.extra || {}), phone: e.target.value },
                  }))
                }
                placeholder="예: 010-0000-0000"
              />
            </div>

            <div className="field">
              <div className="label">
                매장 주소 <span className="pill">필수</span>
              </div>
              <div className="addressRow">
                <input
                  className="input"
                  value={(draft as any)?.extra?.address || ""}
                  readOnly
                  placeholder="주소 검색으로 입력"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={openAddressSearch}
                >
                  주소 검색
                </button>
              </div>
              <input
                id="storeAddressDetailInput"
                className="input"
                value={(draft as any)?.extra?.addressDetail || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: {
                      ...(p?.extra || {}),
                      addressDetail: e.target.value,
                    },
                  }))
                }
                placeholder="상세주소 (선택) 예: 101동 1203호"
                style={{ marginTop: 8 }}
              />
            </div>

            {lastSavedAt ? (
              <div className="hint">
                마지막 저장: {new Date(lastSavedAt).toLocaleString()}
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <section className="advancedGrid" aria-label="매장 세부 설정">
        <section className="card">
          <h2 className="cardTitle">매장 추가 정보</h2>
          <p className="sectionLead">
            정산·안내에 필요한 세부 정보를 넓은 화면에서 한 번에 관리합니다.
          </p>

          <div className="extraInfoGrid">
            <div className="field">
              <div className="label">
                사업자등록번호 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={(draft as any)?.extra?.bizNo || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: { ...(p?.extra || {}), bizNo: e.target.value },
                  }))
                }
                placeholder="예: 000-00-00000"
              />
            </div>

            <div className="field">
              <div className="label">
                업종 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={(draft as any)?.extra?.industry || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: { ...(p?.extra || {}), industry: e.target.value },
                  }))
                }
                placeholder="예: 카페, 음식점"
              />
            </div>

            <div className="field">
              <div className="label">
                영업시간 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={(draft as any)?.extra?.hours || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: { ...(p?.extra || {}), hours: e.target.value },
                  }))
                }
                placeholder="예: 10:00 ~ 22:00"
              />
            </div>

            <div className="field">
              <div className="label">SNS 링크 (선택)</div>
              <input
                className="input"
                value={(draft as any)?.extra?.sns || ""}
                onChange={(e) =>
                  setDraft((p: any) => ({
                    ...p,
                    extra: { ...(p?.extra || {}), sns: e.target.value },
                  }))
                }
                placeholder="예: instagram.com/..."
              />
            </div>
          </div>
        </section>
        <section className="card">
          <h2 className="cardTitle">운영 관리</h2>
          <p className="sectionLead">
            직원 화면 방식과 매장 운영 상태를 함께 관리합니다.
          </p>

          <div className="operationGrid">
            <div className="miniPanel">
              <div className="operationText">
                <span className="operationTitle">직원 화면 모드</span>
                <span className="operationDesc">
                  매장 운영 방식에 맞는 직원 화면을 선택합니다.
                </span>
              </div>
              <div className="field">
                <select
                  className="input"
                  value={
                    (draft as any).staffViewMode === "station"
                      ? "station"
                      : "simple"
                  }
                  onChange={(e) =>
                    setDraft((p: any) => ({
                      ...p,
                      staffViewMode:
                        e.target.value === "station" ? "station" : "simple",
                    }))
                  }
                >
                  <option value="simple">Simple Mode (통합형)</option>
                  <option value="station">Station Mode (분리형)</option>
                </select>
                <div className="hint">
                  Simple: 직원 1~2명 매장에 적합 / Station: 주문관리·제조·준비
                  역할 분리에 적합
                </div>
              </div>
            </div>

            <div className="miniPanel">
              <div className="operationText">
                <span className="operationTitle">
                  현재 상태: {getStatusLabel(storeStatus)}
                </span>
                <span className="operationDesc">
                  {storeStatus === "inactive"
                    ? "비활성 매장은 운영 재개 전까지 별도 관리가 필요합니다."
                    : "필요할 때 매장을 임시로 비활성화할 수 있습니다."}
                </span>
              </div>
              <div className="operationStrip">
                {storeStatus === "deleted" ? (
                  <button
                    className="btn btnMuted btnCompact"
                    type="button"
                    disabled
                  >
                    삭제된 매장
                  </button>
                ) : storeStatus === "inactive" ? (
                  <button
                    className="btn btnPrimary btnCompact"
                    type="button"
                    onClick={() => void updateStoreStatus("active")}
                    disabled={statusSaving}
                  >
                    다시 활성화
                  </button>
                ) : (
                  <button
                    className="btn btnMuted btnCompact"
                    type="button"
                    onClick={() => void updateStoreStatus("inactive")}
                    disabled={statusSaving}
                  >
                    매장 비활성화
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </section>

      {isDirty ? (
        <div className="stickySaveBar" role="status" aria-live="polite">
          <span className="badge badgeDirty">변경사항이 있습니다.</span>
          <div className="stickyActions">
            <button className="btn" onClick={onReset} disabled={saving}>
              변경 취소
            </button>
            <button
              className="btn btnPrimary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      ) : null}

      {showAddr ? (
        <div className="modalOverlay" onClick={closeAddressSearch}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <b style={{ fontSize: 16 }}>주소 검색</b>
              <button
                type="button"
                className="btn"
                onClick={closeAddressSearch}
              >
                닫기
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <DaumPostcodeEmbed
                onComplete={onCompleteAddress}
                autoClose={false}
              />
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              도로명 주소를 검색하세요.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
export default function AdminstorePage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <p className="muted">로딩 중...</p>
        </div>
      }
    >
      <AdminstorePageInner />
    </Suspense>
  );
}
