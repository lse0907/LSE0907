"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { setCurrentStoreId } from "@/app/lib/currentStore";
import { DEFAULT_STORE_PROFILE, saveStoreProfile } from "@/app/lib/storeProfile";
import DaumPostcodeEmbed, { Address } from "react-daum-postcode";

const FREE_TRIAL_DAYS = 30;

function clampOverlay(v: number) {
  if (!Number.isFinite(v)) return DEFAULT_STORE_PROFILE.mainImageOverlayStrength;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export default function AdminStoreCreatePage() {
  const router = useRouter();

  const [storeName, setStoreName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [storeDesc, setStoreDesc] = useState("");
  const [mainImage, setMainImage] = useState("");
  const [logoImage, setLogoImage] = useState("");
  const [overlayStrength, setOverlayStrength] = useState(DEFAULT_STORE_PROFILE.mainImageOverlayStrength);

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
      const check = await supabase.from("stores").select("store_id").eq("store_id", id).maybeSingle();
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
          const retry = await supabase.from("stores").insert([{ store_id: id, store_name: name } as any]);
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

      saveStoreProfile(id, {
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
          billing: "",
        },
      });

      setCurrentStoreId(id);
      router.push(`/admin?store=${encodeURIComponent(id)}`);
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
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">매장 만들기</h1>
          <p className="sub">필수 정보 입력 후 저장하면 매장이 생성됩니다.</p>
        </div>
        <button className="btn" type="button" onClick={() => router.back()}>
          뒤로가기
        </button>
      </header>

      {msg ? <div className="alert">{msg}</div> : null}

      <section className="grid">
        <div className="card previewWrap">
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
                {logoImage ? (
                  <div className="logo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoImage} alt="logo" />
                  </div>
                ) : (
                  <div className="logo" aria-hidden="true">
                    <span style={{ color: "white", fontWeight: 900, fontSize: 12 }}>logo</span>
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <h3 className="storeName">{storeName || "매장명"}</h3>
                </div>
              </div>
            </div>
          </div>

          <div className="previewCard">
            <p className="descText">{storeDesc || "매장 설명이 여기에 표시됩니다."}</p>
          </div>

          <div className="hint">* 오버레이 강도를 올리면 이미지가 더 어두워지고 글자가 더 잘 보입니다.</div>
        </div>

        <div className="card">
          <h2 className="cardTitle">기본 정보</h2>

          <div className="field">
            <div className="label">
              매장명 <span className="pill">필수</span>
            </div>
            <input className="input" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">
              매장 ID <span className="pill">필수</span>
            </div>
            <input className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)} />
            <div className="hint">영문/숫자/하이픈 권장. 중복된 ID는 사용할 수 없습니다.</div>
          </div>

          <div className="field">
            <div className="label">매장 설명 (선택)</div>
            <textarea
              className="textarea"
              value={storeDesc}
              onChange={(e) => setStoreDesc(e.target.value)}
              placeholder="예) QR로 간편하게 주문하고 기다리세요..."
            />
          </div>

          <div className="field">
            <div className="label">대표 이미지 경로 (선택)</div>
            <input
              className="input"
              value={mainImage}
              onChange={(e) => setMainImage(e.target.value)}
              placeholder='예: "/hero.jpg"'
            />
          </div>

          <div className="field">
            <div className="label">로고 이미지 경로 (선택)</div>
            <input
              className="input"
              value={logoImage}
              onChange={(e) => setLogoImage(e.target.value)}
              placeholder='예: "/logo.png"'
            />
          </div>

          <div className="field">
            <div className="label">대표이미지 오버레이 강도 (선택)</div>
            <div className="sliderRow">
              <input
                className="range"
                type="range"
                min={0}
                max={100}
                value={overlayStrength}
                onChange={(e) => setOverlayStrength(clampOverlay(Number(e.target.value)))}
              />
              <input
                className="input"
                inputMode="numeric"
                value={String(overlayStrength)}
                onChange={(e) => setOverlayStrength(clampOverlay(Number(e.target.value)))}
              />
            </div>
            <div className="hint">0 = 거의 원본 / 100 = 아주 어둡게</div>
          </div>

          <h2 className="cardTitle" style={{ marginTop: 16 }}>
            매장 상세 정보
          </h2>

          <div className="field">
            <div className="label">
              사업자등록번호 <span className="pill">필수</span>
            </div>
            <input className="input" value={bizNo} onChange={(e) => setBizNo(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">
              업종 <span className="pill">필수</span>
            </div>
            <input className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">
              매장 전화번호 <span className="pill">필수</span>
            </div>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">
              매장 주소 <span className="pill">필수</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={address} readOnly placeholder="주소 검색으로 입력" />
              <button type="button" className="btn" onClick={openAddressSearch}>
                주소 검색
              </button>
            </div>
            <input
              id="storeAddressDetailInput"
              className="input"
              value={addressDetail}
              onChange={(e) => setAddressDetail(e.target.value)}
              placeholder="상세주소 (선택) 예: 101동 1203호"
              style={{ marginTop: 8 }}
            />
          </div>

          <div className="field">
            <div className="label">
              영업시간 <span className="pill">필수</span>
            </div>
            <input className="input" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">SNS 링크 (선택)</div>
            <input className="input" value={sns} onChange={(e) => setSns(e.target.value)} />
          </div>

          <div className="field">
            <div className="label">
              결제/구독 정보 <span className="pill">비활성</span>
            </div>
            <textarea className="textarea" disabled value="" placeholder="예: 현재 플랜 / 결제수단 ..." />
            <div className="hint">지금은 표시만 하고, 정식 오픈 때 결제 연동을 붙입니다.</div>
          </div>

          <div className="btnRow">
            <button className="btn btnPrimary" onClick={onCreate} disabled={creating}>
              {creating ? "생성 중..." : "매장 생성"}
            </button>
            <span className="hint">무료 사용기간 {FREE_TRIAL_DAYS}일이 기본 제공됩니다.</span>
          </div>
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
            <p className="hint" style={{ marginTop: 10 }}>
              도로명 주소를 검색하고 선택하세요.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
