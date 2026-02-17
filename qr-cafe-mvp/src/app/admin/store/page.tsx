"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { loadStoreProfile, saveStoreProfile, useStoreProfile } from "@/app/lib/storeProfile";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";

const STORE_IMAGE_BUCKET = "store-assets";

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
    storeName: String(p?.storeName ?? ""),
    storeDesc: String(p?.storeDesc ?? ""),
    mainImage: String(p?.mainImage ?? ""),
    logoImage: String(p?.logoImage ?? ""),
    mainImageOverlayStrength: clampOverlay(Number(p?.mainImageOverlayStrength ?? 55)),
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

export default function AdminStorePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState<string>("");
  const { profile, setProfile } = useStoreProfile(storeId);
  const [storeCreatedAt, setStoreCreatedAt] = useState<string | null>(null);
  const [showAddr, setShowAddr] = useState(false);
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  // ✅ 폼 상태(편집용)
  const [draft, setDraft] = useState(profile);

  // ✅ 저장 UI 피드백
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
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
      const { data, error } = await supabase
        .from("stores")
        .select("created_at")
        .eq("store_id", storeId)
        .maybeSingle();
      if (!mounted) return;
      if (error) {
        console.error("[admin/store] load created_at error:", error.message);
        setStoreCreatedAt(null);
        return;
      }
      setStoreCreatedAt(data?.created_at || null);
    })();
    return () => {
      mounted = false;
    };
  }, [storeId]);

  // ✅ 변경 여부: 핵심 필드만 비교 (extra는 저장도 안 하니 제외)
  const isDirty = useMemo(() => {
    const a = pickCore(draft);
    const b = pickCore(profile);
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [draft, profile]);

  const remainingDays = useMemo(() => calcRemainingDays(storeCreatedAt), [storeCreatedAt]);

  // ✅ 미리보기용 오버레이 계산(0~100)
  const strength = clampOverlay(Number((draft as any).mainImageOverlayStrength ?? 55));
  const overlayBg = useMemo(() => {
    const aTop = 0.10 + 0.35 * (strength / 100);
    const aMid = 0.18 + 0.45 * (strength / 100);
    const aBot = 0.25 + 0.60 * (strength / 100);

    return `linear-gradient(
      to bottom,
      rgba(0,0,0,${aTop}) 0%,
      rgba(0,0,0,${aMid}) 55%,
      rgba(0,0,0,${aBot}) 100%
    )`;
  }, [strength]);

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

      saveStoreProfile(storeId, {
        ...(draft as any),
        ...core,
      });

      const { error: imageErr } = await supabase
        .from("stores")
        .update({
          store_name: (draft as any).storeName || null,
          main_image_url: (draft as any).mainImage || null,
          logo_image_url: (draft as any).logoImage || null,
        })
        .eq("store_id", storeId);

      if (imageErr) {
        console.error("[admin/store] image update error:", imageErr.message);
        setUploadMsg("이미지 저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }

      // ✅ 즉시 반영
      const fresh = loadStoreProfile(storeId);
      setProfile(fresh);

      setSaveState("saved");
      setLastSavedAt(Date.now());
    } catch {
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
    const { error } = await supabase.storage.from(STORE_IMAGE_BUCKET).upload(path, file, { upsert: true });
    if (error) throw error;

    const { data } = supabase.storage.from(STORE_IMAGE_BUCKET).getPublicUrl(path);
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
          max-width: 920px;
          margin: 0 auto;
          padding: 14px;
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
          grid-template-columns: 1.2fr 1fr;
          gap: 10px;
          align-items: start;
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
          background: #fff;
          font-weight: 800;
          width: 100%;
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

        @media (max-width: 860px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .wrap {
            padding: 10px;
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
            gap: 6px;
            display: grid;
            grid-template-columns: 1fr;
          }

          .badge {
            font-size: 11px;
            padding: 7px 9px;
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
            onClick={() => router.push(`/admin?store=${encodeURIComponent(storeId)}`)}
          >
            관리자 화면
          </button>
        </div>
      </header>

      <div className="badgeRow">
        {saveState === "saved" ? (
          <span className="badge badgeSaved">저장됨 ✅</span>
        ) : saveState === "error" ? (
          <span className="badge badgeError">저장 실패 ❗</span>
        ) : lastSavedAt ? (
          <span className="badge">마지막 저장: {new Date(lastSavedAt).toLocaleTimeString()}</span>
        ) : (
          <span className="badge">미저장</span>
        )}
        {remainingDays !== null ? (
          <span className="badge">
            무료 사용기간 {FREE_TRIAL_DAYS}일 · 잔여 {remainingDays}일
          </span>
        ) : (
          <span className="badge">무료 사용기간 {FREE_TRIAL_DAYS}일</span>
        )}
      </div>

      {uploadMsg ? <div className="alert">{uploadMsg}</div> : null}

      <section className="grid">
        {/* ✅ 미리보기(위쪽) */}
        <div className="card previewWrap">
          <h2 className="cardTitle">미리보기</h2>

          <div className="hero">
            {(draft as any).mainImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="heroImg" src={(draft as any).mainImage} alt="main" />
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
                    <span style={{ color: "white", fontWeight: 900, fontSize: 12 }}>logo</span>
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <h3 className="storeName">{(draft as any).storeName || "매장명"}</h3>
                </div>
              </div>
            </div>
          </div>

          <div className="previewCard">
            <p className="descText">{(draft as any).storeDesc || "매장 설명이 여기에 표시됩니다."}</p>
          </div>

        </div>

        {/* 설정 */}
        <div className="card settingsCard">
          <h2 className="cardTitle">기본 정보</h2>

          <div className="field">
            <div className="label">매장명</div>
            <input
              className="input"
              value={(draft as any).storeName}
              onChange={(e) => setDraft((p: any) => ({ ...p, storeName: e.target.value }))}
              placeholder="예: XIMEN 순천점"
            />
          </div>

          <div className="field">
            <div className="label">
              매장 ID <span className="pill">수정 불가</span>
            </div>
            <input className="input" value={storeId} disabled placeholder="예: ximen" />
          </div>

          <div className="field">
            <div className="label">매장 설명</div>
            <textarea
              className="textarea"
              value={(draft as any).storeDesc}
              onChange={(e) => setDraft((p: any) => ({ ...p, storeDesc: e.target.value }))}
              placeholder="예) QR로 간편하게 주문하고 기다리세요..."
            />
          </div>

          <div className="field">
            <div className="label">대표 이미지 업로드</div>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={(e) => onUploadMain(e.target.files?.[0] || null)}
              disabled={uploadingMain}
            />
            <div className="hint">
              {uploadingMain
                ? "업로드 중..."
                : (draft as any).mainImage
                  ? "대표 이미지 등록됨"
                  : "아직 등록된 이미지가 없습니다."}
            </div>
          </div>

          <div className="field">
            <div className="label">로고 이미지 업로드 (선택)</div>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={(e) => onUploadLogo(e.target.files?.[0] || null)}
              disabled={uploadingLogo}
            />
            <div className="hint">
              {uploadingLogo
                ? "업로드 중..."
                : (draft as any).logoImage
                  ? "로고 이미지 등록됨"
                  : "아직 등록된 이미지가 없습니다."}
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
                    mainImageOverlayStrength: clampOverlay(Number(e.target.value)),
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
                    mainImageOverlayStrength: clampOverlay(Number(e.target.value)),
                  }))
                }
              />
            </div>

          </div>

          <div className="detailBlock">
            <h3 className="cardTitle">매장 상세 정보</h3>

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
                <button type="button" className="btn" onClick={openAddressSearch}>
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
                    extra: { ...(p?.extra || {}), addressDetail: e.target.value },
                  }))
                }
                placeholder="상세주소 (선택) 예: 101동 1203호"
                style={{ marginTop: 8 }}
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

          <div className="btnRow">
            <button className="btn btnPrimary" onClick={onSave} disabled={!isDirty || saving}>
              {saving ? "저장 중..." : "저장"}
            </button>

            <button className="btn" onClick={onReset} disabled={!isDirty || saving}>
              변경 취소
            </button>

            {isDirty ? <span className="badge">변경됨</span> : <span className="badge">변경 없음</span>}
          </div>

          {lastSavedAt ? <div className="hint">마지막 저장: {new Date(lastSavedAt).toLocaleString()}</div> : null}

        </div>
      </section>

      {showAddr ? (
        <div className="modalOverlay" onClick={closeAddressSearch}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <b style={{ fontSize: 16 }}>주소 검색</b>
              <button type="button" className="btn" onClick={closeAddressSearch}>
                닫기
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <DaumPostcodeEmbed onComplete={onCompleteAddress} autoClose={false} />
            </div>
            <p className="hint" style={{ marginTop: 10 }}>도로명 주소를 검색하세요.</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
