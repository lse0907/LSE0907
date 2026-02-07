"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { loadStoreProfile, saveStoreProfile, useStoreProfile } from "@/app/lib/storeProfile";

function clampOverlay(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ✅ "실제로 저장/반영되는 핵심 필드"만 비교/저장에 사용
function pickCore(p: any) {
  return {
    storeName: String(p?.storeName ?? ""),
    storeDesc: String(p?.storeDesc ?? ""),
    mainImage: String(p?.mainImage ?? ""),
    logoImage: String(p?.logoImage ?? ""),
    mainImageOverlayStrength: clampOverlay(Number(p?.mainImageOverlayStrength ?? 55)),
  };
}

export default function AdminStorePage() {
  const router = useRouter();
  const sp = useSearchParams();
  const [storeId, setStoreId] = useState<string>("");
  const { profile, setProfile } = useStoreProfile(storeId);

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

  // ✅ 변경 여부: 핵심 필드만 비교 (extra는 저장도 안 하니 제외)
  const isDirty = useMemo(() => {
    const a = pickCore(draft);
    const b = pickCore(profile);
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [draft, profile]);

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

    try {
      // ✅ 핵심 필드만 저장 의도를 고정
      const core = pickCore(draft);

      saveStoreProfile(storeId, {
        ...(draft as any),
        ...core,
      });

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

        /* 확장(비활성) */
        .disabledNote {
          color: var(--muted);
          font-size: 12px;
          font-weight: 800;
          margin-top: 6px;
        }
        .input:disabled,
        .textarea:disabled {
          background: #f9fafb;
          color: #6b7280;
        }

        @media (max-width: 860px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <header className="topbar">
        <div>
          <h1 className="h1">매장 정보</h1>
          <p className="sub">저장하면 스타트/QR 등 화면에 즉시 반영됩니다.</p>
        </div>

        <div>
          {saveState === "saved" ? (
            <span className="badge badgeSaved">저장됨 ✅</span>
          ) : saveState === "error" ? (
            <span className="badge badgeError">저장 실패 ❗</span>
          ) : lastSavedAt ? (
            <span className="badge">마지막 저장: {new Date(lastSavedAt).toLocaleTimeString()}</span>
          ) : (
            <span className="badge">미저장</span>
          )}
        </div>
      </header>

      <section className="grid">
        {/* ✅ 미리보기(위쪽) */}
        <div className="card previewWrap">
          <h2 className="cardTitle">미리보기</h2>

          <div className="hero">
            {(draft as any).mainImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="heroImg" src={(draft as any).mainImage} alt="main" />
            ) : null}
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
                    <span style={{ color: "white", fontWeight: 950 }}>QR</span>
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

          <div className="hint">* 오버레이 강도를 올리면 이미지가 더 어두워지고 글자가 더 잘 보입니다.</div>
        </div>

        {/* 설정 */}
        <div className="card">
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
            <div className="label">매장 설명</div>
            <textarea
              className="textarea"
              value={(draft as any).storeDesc}
              onChange={(e) => setDraft((p: any) => ({ ...p, storeDesc: e.target.value }))}
              placeholder="예) QR로 간편하게 주문하고 기다리세요..."
            />
          </div>

          <div className="field">
            <div className="label">대표 이미지 경로 (public 기준)</div>
            <input
              className="input"
              value={(draft as any).mainImage}
              onChange={(e) => setDraft((p: any) => ({ ...p, mainImage: e.target.value }))}
              placeholder='예: "/hero.jpg"'
            />
          </div>

          <div className="field">
            <div className="label">로고 이미지 경로 (선택)</div>
            <input
              className="input"
              value={(draft as any).logoImage}
              onChange={(e) => setDraft((p: any) => ({ ...p, logoImage: e.target.value }))}
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

            <div className="hint">0 = 거의 원본 / 100 = 아주 어둡게</div>
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

          {lastSavedAt ? <div className="hint">마지막 저장 시각: {new Date(lastSavedAt).toLocaleString()}</div> : null}

          {/* ==========================
              ✅ 추후 확장(비활성)
              ========================== */}
          <div style={{ marginTop: 18 }}>
            <h2 className="cardTitle">추후 확장(비활성)</h2>
            <div className="hint">* 지금은 화면에만 고정해 두고, DB/다중매장/구독 단계에서 연결합니다.</div>

            <div className="field">
              <div className="label">
                사업자번호 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: 000-00-00000" />
            </div>

            <div className="field">
              <div className="label">
                업종 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: 카페/음료" />
            </div>

            <div className="field">
              <div className="label">
                전화번호 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: 010-0000-0000" />
            </div>

            <div className="field">
              <div className="label">
                주소 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: 전남 순천시 ..." />
            </div>

            <div className="field">
              <div className="label">
                영업시간 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: 10:00 ~ 22:00" />
            </div>

            <div className="field">
              <div className="label">
                SNS 링크 <span className="pill">추후 제공</span>
              </div>
              <input className="input" disabled value="" placeholder="예: instagram.com/..." />
            </div>

            <div className="field">
              <div className="label">
                결제/구독 정보 <span className="pill">추후 제공</span>
              </div>
              <textarea className="textarea" disabled value="" placeholder="예: 현재 플랜 / 결제수단 ..." />
            </div>

            <div className="disabledNote">지금은 저장/연동하지 않습니다. (UI만 고정해두는 단계)</div>
          </div>
        </div>
      </section>
    </main>
  );
}
