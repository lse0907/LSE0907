/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { setCurrentStoreId } from "@/app/lib/currentStore";
import {
  DEFAULT_STORE_PROFILE,
  saveStoreProfile,
} from "@/app/lib/storeProfile";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";
import { prepareStoreImage } from "@/app/lib/storeImageUpload";
import AdminPageHeader from "@/app/admin/_components/AdminPageHeader";

const STORE_IMAGE_BUCKET = "store-assets";

function clampOverlay(v: number) {
  if (!Number.isFinite(v))
    return DEFAULT_STORE_PROFILE.mainImageOverlayStrength;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function getFileExt(name: string) {
  const trimmed = name.trim();
  if (!trimmed.includes(".")) return "";
  return trimmed.split(".").pop() || "";
}

export default function AdminStoreCreatePage() {
  const router = useRouter();

  const [storeName, setStoreName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [storeDesc, setStoreDesc] = useState("");
  const [mainImage, setMainImage] = useState("");
  const [logoImage, setLogoImage] = useState("");
  const [overlayStrength, setOverlayStrength] = useState(
    DEFAULT_STORE_PROFILE.mainImageOverlayStrength,
  );

  const [bizNo, setBizNo] = useState("");
  const [industry, setIndustry] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [hours, setHours] = useState("");
  const [sns, setSns] = useState("");

  const [showAddr, setShowAddr] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploadingMain, setUploadingMain] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const overlayBg = useMemo(() => {
    const aTop = 0.1 + 0.35 * (overlayStrength / 100);
    const aMid = 0.18 + 0.45 * (overlayStrength / 100);
    const aBot = 0.25 + 0.6 * (overlayStrength / 100);

    return `linear-gradient(
      to bottom,
      rgba(0,0,0,${aTop}) 0%,
      rgba(0,0,0,${aMid}) 55%,
      rgba(0,0,0,${aBot}) 100%
    )`;
  }, [overlayStrength]);

  const validate = () => {
    if (!storeName.trim()) return "매장명을 입력해주세요.";
    if (!storeId.trim()) return "매장 ID를 입력해주세요.";
    if (!bizNo.trim()) return "사업자등록번호를 입력해주세요.";
    if (!industry.trim()) return "업종을 입력해주세요.";
    if (!phone.trim()) return "매장 전화번호를 입력해주세요.";
    if (!address.trim()) return "매장 주소를 검색해서 선택해주세요.";
    if (!hours.trim()) return "영업시간을 입력해주세요.";
    return "";
  };

  const openAddressSearch = () => setShowAddr(true);
  const closeAddressSearch = () => setShowAddr(false);

  const onCompleteAddress = (data: Address) => {
    const picked = (data.address || "").trim();
    setAddress(picked);
    closeAddressSearch();

    setTimeout(() => {
      const el = document.getElementById("storeAddressDetailInput");
      if (el) (el as HTMLInputElement).focus();
    }, 50);
  };

  const uploadStoreImage = async (file: File, kind: "main" | "logo") => {
    const trimmedStoreId = storeId.trim();
    if (!trimmedStoreId) {
      setMsg("이미지를 올리기 전에 매장 ID를 먼저 입력해주세요.");
      return "";
    }

    const uploadFile = await prepareStoreImage(file);
    const ext = getFileExt(uploadFile.name) || "png";
    const path = `${trimmedStoreId}/${kind}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(STORE_IMAGE_BUCKET)
      .upload(path, uploadFile, {
        upsert: true,
        contentType: uploadFile.type || undefined,
      });
    if (error) throw error;

    const { data } = supabase.storage
      .from(STORE_IMAGE_BUCKET)
      .getPublicUrl(path);
    return data.publicUrl || "";
  };

  const onUploadMain = async (file: File | null) => {
    if (!file) return;
    setUploadingMain(true);
    setMsg("");
    try {
      const url = await uploadStoreImage(file, "main");
      if (url) setMainImage(url);
    } catch (e: any) {
      setMsg(`대표 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingMain(false);
    }
  };

  const onUploadLogo = async (file: File | null) => {
    if (!file) return;
    setUploadingLogo(true);
    setMsg("");
    try {
      const url = await uploadStoreImage(file, "logo");
      if (url) setLogoImage(url);
    } catch (e: any) {
      setMsg(`로고 이미지 업로드 실패: ${String(e?.message || e)}`);
    } finally {
      setUploadingLogo(false);
    }
  };

  const onCreate = async () => {
    setMsg("");
    const v = validate();
    if (v) {
      setMsg(v);
      return;
    }

    const id = storeId.trim();
    const name = storeName.trim();

    setCreating(true);
    try {
      const check = await supabase
        .from("stores")
        .select("store_id")
        .eq("store_id", id)
        .maybeSingle();
      if (check.error) throw check.error;
      if (check.data) {
        setMsg("이미 사용 중인 매장 ID입니다. 다른 ID를 입력해주세요.");
        setCreating(false);
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id || null;

      const insStore = await supabase.from("stores").insert([
        {
          store_id: id,
          store_name: name,
          owner_user_id: userId,
        } as any,
      ]);

      if (insStore.error) {
        if (String(insStore.error.message || "").includes("owner_user_id")) {
          const retry = await supabase
            .from("stores")
            .insert([{ store_id: id, store_name: name } as any]);
          if (retry.error) throw retry.error;
        } else {
          throw insStore.error;
        }
      }

      if (userId) {
        const insMem = await supabase.from("store_members").insert([
          {
            store_id: id,
            user_id: userId,
            role: "owner",
          },
        ]);
        if (insMem.error) throw insMem.error;
      }

      if (mainImage.trim() || logoImage.trim()) {
        const { error: imageErr } = await supabase
          .from("stores")
          .update({
            main_image_url: mainImage.trim() || null,
            logo_image_url: logoImage.trim() || null,
          })
          .eq("store_id", id);
        if (imageErr) {
          console.error(
            "[admin/store/create] image update error:",
            imageErr.message,
          );
          setMsg(
            "이미지는 저장되지 않았습니다. 매장 정보에서 다시 저장해주세요.",
          );
        }
      }

      saveStoreProfile(id, {
        staffViewMode: "simple",
        storeName: name,
        storeDesc: storeDesc.trim() || DEFAULT_STORE_PROFILE.storeDesc,
        mainImage: mainImage.trim(),
        logoImage: logoImage.trim(),
        mainImageOverlayStrength: clampOverlay(overlayStrength),
        extra: {
          bizNo: bizNo.trim(),
          industry: industry.trim(),
          phone: phone.trim(),
          address: address.trim(),
          addressDetail: addressDetail.trim(),
          hours: hours.trim(),
          sns: sns.trim(),
        },
      });

      setCurrentStoreId(id);
      router.push(`/admin/setup?store=${encodeURIComponent(id)}`);
    } catch (e: any) {
      console.error("[admin/store/create] create error:", e?.message || e);
      setMsg(`매장 생성 실패: ${String(e?.message || e)}`);
    } finally {
      setCreating(false);
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
          max-width: 980px;
          margin: 0 auto;
          padding: 14px;
          display: grid;
          gap: 12px;
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

        .card {
          background: var(--card);
          border: 1px solid var(--line);
          border-radius: var(--radius);
          padding: 14px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }

        .grid {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 12px;
          align-items: start;
        }

        .sideStack,
        .formStack {
          display: grid;
          gap: 12px;
          align-content: start;
        }

        .inlineGrid,
        .extraInfoGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .advancedGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .basicHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .statusBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
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

        .btn {
          border: 1px solid var(--line);
          background: var(--card);
          padding: 10px 14px;
          border-radius: 12px;
          cursor: pointer;
          font-weight: 950;
        }

        .topHomeBtn {
          white-space: nowrap;
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
          margin-top: 6px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }

        .hintWrap {
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .alert {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 900;
        }

        .sliderRow {
          display: grid;
          grid-template-columns: 1fr 90px;
          gap: 10px;
          align-items: center;
        }

        .addressRow {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .addressSearchBtn {
          flex: 0 0 auto;
          white-space: nowrap;
        }

        .createActionCard {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .createActionText {
          display: grid;
          gap: 4px;
        }

        .range {
          width: 100%;
        }

        .previewWrap {
          display: grid;
          gap: 10px;
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

        .previewCard {
          border: 1px solid var(--line);
          border-radius: 18px;
          background: #fff;
          padding: 12px;
        }

        .descText {
          margin: 0;
          color: var(--text);
          white-space: pre-line;
          font-size: 14px;
          line-height: 1.5;
          font-weight: 750;
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
            padding: 12px;
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
          .btn {
            font-size: 13px;
            padding: 9px 11px;
          }
          .inlineGrid,
          .extraInfoGrid {
            grid-template-columns: 1fr;
          }
          .formStack {
            order: 1;
          }
          .sideStack {
            order: 2;
          }
          .addressRow {
            flex-direction: column;
            align-items: stretch;
          }
          .addressSearchBtn,
          .createActionCard .btn {
            width: 100%;
          }
          .createActionCard {
            align-items: stretch;
          }
          .hero {
            height: 150px;
          }
          .previewCard {
            padding: 10px;
          }
          .storeName {
            font-size: 18px;
          }
        }
      `}</style>

      <AdminPageHeader
        title="매장 만들기"
        description="필수 정보를 입력하면 바로 초기 설정을 이어갈 수 있습니다."
        eyebrow="NEW STORE"
      />

      {msg ? <div className="alert">{msg}</div> : null}

      <section className="grid">
        <div className="sideStack">
          <section className="card previewWrap">
            <h2 className="cardTitle">미리보기</h2>

            <div className="hero">
              {mainImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="heroImg" src={mainImage} alt="main" />
              ) : (
                <div className="heroFallback">대표 이미지를 등록하세요</div>
              )}
              <div className="overlay" style={{ background: overlayBg }} />

              <div className="heroInner">
                <div className="logoRow">
                  <div style={{ minWidth: 0 }}>
                    <h3 className="storeName">{storeName || "매장명"}</h3>
                  </div>
                </div>
              </div>
            </div>

            <div className="previewCard">
              <div className="logoRow" style={{ marginBottom: 12 }}>
                <div
                  className="logo"
                  style={{ background: "#fff", borderColor: "#dfe4eb" }}
                >
                  {logoImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoImage}
                      alt="등록할 매장 로고"
                      style={{ objectFit: "contain", padding: 5 }}
                    />
                  ) : (
                    <span style={{ color: "#0f1f3d", fontWeight: 900 }}>
                      {Array.from(storeName || "매장")[0]}
                    </span>
                  )}
                </div>
                <div>
                  <strong>{storeName || "매장명"}</strong>
                  <div className="hint">
                    로고는 밝은 고객 화면에서 표시됩니다.
                  </div>
                </div>
              </div>
              <p className="descText">
                {storeDesc || "매장 설명이 여기에 표시됩니다."}
              </p>
            </div>
          </section>

          <section className="card">
            <h2 className="cardTitle">이미지 / 브랜딩</h2>

            <div className="inlineGrid">
              <div className="field">
                <div className="label">
                  대표 이미지 업로드
                  <span className="pill">선택</span>
                </div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    await onUploadMain(input.files?.[0] || null);
                    input.value = "";
                  }}
                  disabled={uploadingMain}
                />
                <div className="hint hintWrap">
                  {uploadingMain
                    ? "업로드 중..."
                    : mainImage
                      ? "대표 이미지 등록 완료"
                      : "아직 등록된 이미지가 없습니다."}
                </div>
              </div>

              <div className="field">
                <div className="label">
                  로고 이미지 업로드
                  <span className="pill">선택</span>
                </div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    await onUploadLogo(input.files?.[0] || null);
                    input.value = "";
                  }}
                  disabled={uploadingLogo}
                />
                <div className="hint hintWrap">
                  {uploadingLogo
                    ? "업로드 중..."
                    : logoImage
                      ? "로고 이미지 등록 완료"
                      : "아직 등록된 이미지가 없습니다."}
                </div>
                {logoImage ? (
                  <div className="logoRow">
                    <div
                      className="logo"
                      style={{ background: "#fff", borderColor: "#dfe4eb" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoImage}
                        alt="선택한 로고 미리보기"
                        style={{ objectFit: "contain", padding: 5 }}
                      />
                    </div>
                    <span className="hint">현재 선택한 로고</span>
                  </div>
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
                  value={overlayStrength}
                  onChange={(e) =>
                    setOverlayStrength(clampOverlay(Number(e.target.value)))
                  }
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={String(overlayStrength)}
                  onChange={(e) =>
                    setOverlayStrength(clampOverlay(Number(e.target.value)))
                  }
                />
              </div>
            </div>
          </section>
        </div>

        <div className="formStack" role="group" aria-label="매장 기본 정보">
          <section className="card" aria-labelledby="store-create-basic-title">
            <div className="basicHead">
              <h2 className="cardTitle" id="store-create-basic-title">
                기본 정보
              </h2>
              <span className="statusBadge">생성 전</span>
            </div>

            <div className="inlineGrid">
              <div className="field">
                <div className="label">
                  매장명 <span className="pill">필수</span>
                </div>
                <input
                  className="input"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="예: XIMEN 순천점"
                />
              </div>

              <div className="field">
                <div className="label">
                  매장 ID <span className="pill">필수</span>
                </div>
                <input
                  className="input"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  placeholder="예: ximen"
                />
              </div>
            </div>

            <div className="field">
              <div className="label">
                매장 설명 <span className="pill">선택</span>
              </div>
              <textarea
                className="textarea"
                value={storeDesc}
                onChange={(e) => setStoreDesc(e.target.value)}
                placeholder="예) QR로 간편하게 주문하고 기다리세요..."
              />
            </div>

            <div className="field">
              <div className="label">
                매장 전화번호 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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
                  value={address}
                  readOnly
                  placeholder="주소 검색으로 입력"
                />
                <button
                  type="button"
                  className="btn addressSearchBtn"
                  onClick={openAddressSearch}
                >
                  주소 검색
                </button>
              </div>
              <div className="label" style={{ marginTop: 8 }}>
                상세 주소 <span className="pill">선택</span>
              </div>
              <input
                id="storeAddressDetailInput"
                className="input"
                value={addressDetail}
                onChange={(e) => setAddressDetail(e.target.value)}
                placeholder="예: 101동 1203호"
                style={{ marginTop: 8 }}
              />
            </div>
          </section>
        </div>
      </section>

      <section className="advancedGrid" aria-label="매장 세부 정보">
        <section className="card">
          <h2 className="cardTitle">매장 추가 정보</h2>

          <div className="extraInfoGrid">
            <div className="field">
              <div className="label">
                사업자등록번호 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={bizNo}
                onChange={(e) => setBizNo(e.target.value)}
                placeholder="예: 000-00-00000"
              />
            </div>

            <div className="field">
              <div className="label">
                업종 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="예: 카페, 음식점"
              />
            </div>

            <div className="field">
              <div className="label">
                영업시간 <span className="pill">필수</span>
              </div>
              <input
                className="input"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="예: 10:00 ~ 22:00"
              />
            </div>

            <div className="field">
              <div className="label">
                SNS 링크 <span className="pill">선택</span>
              </div>
              <input
                className="input"
                value={sns}
                onChange={(e) => setSns(e.target.value)}
                placeholder="예: instagram.com/..."
              />
            </div>
          </div>
        </section>

        <section className="card createActionCard">
          <div className="createActionText">
            <h2 className="cardTitle">매장 생성</h2>
            <p className="hint">
              필수 정보를 확인한 뒤 매장을 생성하면 초기 설정 화면으로
              이동합니다.
            </p>
          </div>
          <button
            className="btn btnPrimary"
            onClick={onCreate}
            disabled={creating}
          >
            {creating ? "생성 중..." : "매장 생성"}
          </button>
        </section>
      </section>

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
