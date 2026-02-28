// src/app/admin/qr/page.tsx
"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentStoreId } from "@/app/lib/currentStore";
import { useStoreProfile } from "@/app/lib/storeProfile";

type QrItem = {
  key: string;
  label: string;
  url: string;
  imgSrc: string;
};

const START_PATH = "/";
const PREVIEW_QR_SIZE = 220;

function qrImgUrl(dataUrl: string, size = 320, cacheBust = "") {
  const encoded = encodeURIComponent(dataUrl);
  const cb = cacheBust ? `&cb=${encodeURIComponent(cacheBust)}` : "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}${cb}`;
}

function clampInt(v: string, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function parseTableList(input: string): number[] {
  const s = (input || "").trim();
  if (!s) return [];

  const parts = s
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*(?:~|-)\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        for (let i = start; i <= end; i++) out.push(i);
      }
      continue;
    }
    const n = Number(p);
    if (Number.isFinite(n)) out.push(Math.floor(n));
  }

  return uniq(out).filter((n) => n > 0).sort((a, b) => a - b);
}

function safePathJoin(origin: string, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatTableLabel(n: number) {
  return `테이블 ${n}`;
}

function withQuery(url: string, params: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function AdminQrPageInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const [origin, setOrigin] = useState<string>("");

  // ✅ 선택 매장
  const [storeId, setStoreId] = useState<string>("");

  const { profile } = useStoreProfile(storeId);

  // ✅ 화면에서만 쓰는(선택) 값들
  const [makeCounter, setMakeCounter] = useState(true);
  const [makeTables, setMakeTables] = useState(false);

  const [rangeStart, setRangeStart] = useState("1");
  const [rangeEnd, setRangeEnd] = useState("20");
  const [customTables, setCustomTables] = useState("");

  const [showPreview, setShowPreview] = useState(false);
  const [seed, setSeed] = useState<string>("");

  // ✅ 카운터 안내 문구는 QR페이지에서 별도로 관리(현재는 storeProfile 저장 대상 아님)
  const [counterDesc, setCounterDesc] = useState(
    "QR로 간편하게 주문하고 기다리세요.\n주문 후 직원 안내에 따라 픽업/수령해 주세요."
  );

  // ✅ storeId 결정: query > currentStore
  useEffect(() => {
    const q = (sp.get("store") || "").trim();
    const saved = (getCurrentStoreId() || "").trim();
    const sid = q || saved;

    if (!sid) {
      // 선택 매장 없이 들어오면 관리자 홈으로
      router.replace("/admin");
      return;
    }
    setStoreId(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    setSeed(String(Date.now()));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setSeed(String(Date.now()));
  }, [storeId, profile]);

  const storeName = profile?.storeName ?? "카페 브라운";
  const mainImage = profile?.mainImage ?? "/hero.jpg";
  const logoImage = profile?.logoImage ?? "";

  const tableNumbers = useMemo(() => {
    if (!makeTables) return [];

    const a = clampInt(rangeStart, 1);
    const b = clampInt(rangeEnd, 20);

    const start = Math.min(a, b);
    const end = Math.max(a, b);

    const range: number[] = [];
    for (let i = start; i <= end; i++) range.push(i);

    const custom = parseTableList(customTables);

    return uniq([...range, ...custom]).filter((n) => n > 0).sort((x, y) => x - y);
  }, [makeTables, rangeStart, rangeEnd, customTables]);

  const baseStartUrl = useMemo(() => {
    if (!origin) return "";
    return safePathJoin(origin, START_PATH);
  }, [origin]);

  // ✅ 핵심: store 파라미터를 항상 넣는다
  const counterUrl = useMemo(() => {
    if (!baseStartUrl || !storeId) return "";
    return withQuery(baseStartUrl, { store: storeId });
  }, [baseStartUrl, storeId]);

  const tableUrl = (n: number) => {
    if (!baseStartUrl || !storeId) return "";
    return withQuery(baseStartUrl, { store: storeId, table: String(n) });
  };

  const previewItems = useMemo(() => {
    if (!origin || !baseStartUrl || !storeId) return [];

    const list: QrItem[] = [];
    const cacheBust = `${seed}-preview`;

    if (makeCounter) {
      list.push({
        key: "counter-sample",
        label: "카운터(샘플)",
        url: counterUrl,
        imgSrc: qrImgUrl(counterUrl, Math.max(240, PREVIEW_QR_SIZE), cacheBust),
      });
    }

    if (makeTables) {
      const first = tableNumbers[0] ?? 1;
      const url = tableUrl(first);
      list.push({
        key: `table-${first}-sample`,
        label: `${formatTableLabel(first)}(샘플)`,
        url,
        imgSrc: qrImgUrl(url, Math.max(240, PREVIEW_QR_SIZE), cacheBust),
      });
    }

    return list;
  }, [origin, baseStartUrl, storeId, makeCounter, makeTables, tableNumbers, seed, counterUrl]);

  // ==========================
  // ✅ 카운터 PNG (A4 1장에 2개)
  // ==========================
  async function downloadCounterPng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeCounter) {
      alert("카운터 QR 생성 체크박스를 켜주세요.");
      return;
    }

    const A4_W = 1240;
    const A4_H = 1754;
    const posterH = Math.floor(A4_H / 2);

    const padding = 50;
    const imgH = Math.floor(posterH * 0.66);
    const bottomH = posterH - imgH;

    const cacheBust = `${Date.now()}`;

    const qrSize = 260;

    const qrSrc = qrImgUrl(counterUrl, 720, cacheBust);
    const [qrImg] = await Promise.all([
      loadImage(qrSrc).catch((e) => {
        throw new Error("QR 이미지 로드 실패\n" + String(e));
      }),
    ]);

    const heroImg = await loadImage(mainImage).catch(() => null);
    const logoImg = logoImage ? await loadImage(logoImage).catch(() => null) : null;

    const canvas = document.createElement("canvas");
    canvas.width = A4_W;
    canvas.height = A4_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_W, A4_H);

    for (let i = 0; i < 2; i++) {
      const topY = i * posterH;

      if (heroImg) {
        const sw = heroImg.naturalWidth;
        const sh = heroImg.naturalHeight;

        const targetW = A4_W;
        const targetH = imgH;
        const srcRatio = sw / sh;
        const dstRatio = targetW / targetH;

        let cropW = sw;
        let cropH = sh;
        let cropX = 0;
        let cropY = 0;

        if (srcRatio > dstRatio) {
          cropW = Math.floor(sh * dstRatio);
          cropX = Math.floor((sw - cropW) / 2);
        } else {
          cropH = Math.floor(sw / dstRatio);
          cropY = Math.floor((sh - cropH) / 2);
        }

        ctx.drawImage(heroImg, cropX, cropY, cropW, cropH, 0, topY, targetW, targetH);
      } else {
        const g = ctx.createLinearGradient(0, topY, A4_W, topY + imgH);
        g.addColorStop(0, "#111827");
        g.addColorStop(1, "#374151");
        ctx.fillStyle = g;
        ctx.fillRect(0, topY, A4_W, imgH);
      }

      ctx.fillStyle = "#111827";
      ctx.fillRect(0, topY + imgH, A4_W, bottomH);

      const textX = padding;
      const textY = topY + imgH + padding;

      const logoBox = 70;
      if (logoImg) {
        roundRect(
          ctx,
          textX,
          textY,
          logoBox,
          logoBox,
          18,
          "rgba(255,255,255,0.12)",
          "rgba(255,255,255,0.22)"
        );
        ctx.save();
        ctx.beginPath();
        roundedClipPath(ctx, textX, textY, logoBox, logoBox, 18);
        ctx.clip();
        ctx.drawImage(logoImg, textX, textY, logoBox, logoBox);
        ctx.restore();
      } else {
        roundRect(
          ctx,
          textX,
          textY,
          logoBox,
          logoBox,
          18,
          "rgba(255,255,255,0.12)",
          "rgba(255,255,255,0.22)"
        );
        ctx.fillStyle = "#ffffff";
        ctx.font =
          "900 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText("QR", textX + 20, textY + 46);
      }

      ctx.fillStyle = "#ffffff";
      ctx.font =
        "950 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(storeName, textX + logoBox + 18, textY + 34);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font =
        "850 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(`카운터 주문 · store=${storeId}`, textX + logoBox + 18, textY + 62);

      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font =
        "800 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      const lines = (counterDesc || "")
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);

      let dy = textY + 96;
      for (const line of lines.slice(0, 3)) {
        ctx.fillText(line, textX, dy);
        dy += 26;
      }

      const qrX = A4_W - padding - 260;
      const qrY = topY + imgH + Math.floor((bottomH - 260) / 2);

      roundRect(ctx, qrX - 12, qrY - 12, 260 + 24, 260 + 24, 18, "#ffffff", "rgba(255,255,255,0.18)");
      ctx.drawImage(qrImg, qrX, qrY, 260, 260);

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font =
        "800 14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(trimMiddle(counterUrl, 68), padding, topY + posterH - 22);

      if (i === 0) {
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, posterH);
        ctx.lineTo(A4_W, posterH);
        ctx.stroke();
      }
    }

    downloadCanvasAsPng(canvas, `counter-qr_${storeId}_A4x2_${Date.now()}.png`);
  }

  // ==========================
  // ✅ 테이블 PNG (A4 3x4 = 12개/장)
  // ==========================
  async function downloadTablePng() {
    if (!origin || !storeId) {
      alert("선택된 매장 정보가 없습니다. 관리자 화면에서 매장을 선택해 주세요.");
      router.push("/admin");
      return;
    }
    if (!makeTables) {
      alert("테이블 QR 생성 체크박스를 켜주세요.");
      return;
    }
    if (tableNumbers.length === 0) {
      alert("테이블 번호가 없습니다. 범위/추가 테이블을 입력해 주세요.");
      return;
    }

    const A4_W = 1240;
    const A4_H = 1754;

    const COLS = 3;
    const ROWS = 4;
    const PER_PAGE = COLS * ROWS;

    const padding = 34;
    const gap = 18;

    const cardW = Math.floor((A4_W - padding * 2 - gap * (COLS - 1)) / COLS);
    const cardH = Math.floor((A4_H - padding * 2 - gap * (ROWS - 1)) / ROWS);

    const innerPad = 16;
    const labelH = 76;
    const qrSize = Math.min(240, cardW - innerPad * 2);

    const pages: number[][] = [];
    for (let i = 0; i < tableNumbers.length; i += PER_PAGE) {
      pages.push(tableNumbers.slice(i, i + PER_PAGE));
    }

    const cacheBust = `${Date.now()}`;

    for (let p = 0; p < pages.length; p++) {
      const nums = pages[p];

      const qrPromises = nums.map((n) => {
        const url = tableUrl(n);
        const src = qrImgUrl(url, 720, `${cacheBust}-t${n}`);
        return loadImage(src).then((img) => ({ n, img, url }));
      });

      let loaded: Array<{ n: number; img: HTMLImageElement; url: string }>;
      try {
        loaded = await Promise.all(qrPromises);
      } catch (e) {
        alert("테이블 QR 로드 실패\n" + String(e));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = A4_W;
      canvas.height = A4_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, A4_W, A4_H);

      ctx.fillStyle = "#111827";
      ctx.font =
        "900 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(`${storeName} · 테이블 QR · store=${storeId}`, padding, 26);

      for (let i = 0; i < loaded.length; i++) {
        const row = Math.floor(i / COLS);
        const col = i % COLS;

        const x = padding + col * (cardW + gap);
        const y = padding + row * (cardH + gap) + 10;

        roundRect(ctx, x, y, cardW, cardH, 16, "#ffffff", "#e5e7eb");

        ctx.fillStyle = "#111827";
        ctx.font =
          "950 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(storeName, x + innerPad, y + 28);

        ctx.fillStyle = "#111827";
        ctx.font =
          "950 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(formatTableLabel(loaded[i].n), x + innerPad, y + 56);

        const qrX = x + Math.floor((cardW - qrSize) / 2);
        const qrY = y + labelH;

        roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 14, "#ffffff", "#e5e7eb");
        ctx.drawImage(loaded[i].img, qrX, qrY, qrSize, qrSize);

        ctx.fillStyle = "#9ca3af";
        ctx.font =
          "800 10.5px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
        ctx.fillText(trimMiddle(loaded[i].url, 52), x + innerPad, y + cardH - 14);
      }

      downloadCanvasAsPng(canvas, `table-qr_${storeId}_A4_3x4_${p + 1}of${pages.length}_${Date.now()}.png`);
      if (pages.length > 1) await sleep(350);
    }
  }

  const selectedCount = useMemo(() => {
    let c = 0;
    if (makeCounter) c += 1;
    if (makeTables) c += tableNumbers.length;
    return c;
  }, [makeCounter, makeTables, tableNumbers.length]);

  const onTogglePreview = () => {
    setShowPreview((v) => !v);
    setSeed(String(Date.now()));
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
          max-width: 1100px;
          margin: 0 auto;
          padding: 14px;
        }
        .topbar {
          display: grid;
          gap: 6px;
          margin-bottom: 10px;
        }
        .titleRow {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .h1 {
          margin: 0;
          font-size: 26px;
          font-weight: 950;
          letter-spacing: -0.02em;
        }
        .pill {
          font-size: 12px;
          font-weight: 900;
          padding: 6px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #fff;
          color: #6b7280;
          white-space: nowrap;
        }
        .desc {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.4;
          font-weight: 750;
          word-break: keep-all;
        }
        .panelGrid {
          display: grid;
          grid-template-columns: 1fr 1.1fr;
          gap: 10px;
          align-items: start;
          margin-top: 10px;
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
        .formGrid {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .field {
          display: grid;
          gap: 6px;
        }
        .label {
          font-size: 12px;
          color: var(--muted);
          font-weight: 900;
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
          min-height: 72px;
          resize: vertical;
          white-space: pre-wrap;
        }
        .checkRow {
          display: grid;
          gap: 8px;
        }
        .checkItem {
          display: flex;
          gap: 10px;
          align-items: center;
          font-weight: 900;
          color: var(--text);
        }
        .checkItem small {
          color: var(--muted);
          font-weight: 800;
        }
        .row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .btnRow {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 10px;
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
        .previewHead {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .count {
          color: var(--muted);
          font-size: 12px;
          font-weight: 900;
        }
        .grid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .qrCard {
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 12px;
          background: #fff;
          display: grid;
          gap: 10px;
          min-width: 0;
        }
        .qrLabel {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .qrLabel strong {
          font-weight: 950;
        }
        .qrLabel span {
          font-size: 12px;
          color: var(--muted);
          font-weight: 850;
          white-space: nowrap;
        }
        .qrImgWrap {
          display: grid;
          place-items: center;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fafafa;
        }
        .qrImgWrap img {
          width: 100%;
          height: auto;
          max-width: 260px;
        }
        .qrUrl {
          font-size: 11px;
          color: var(--muted);
          font-weight: 800;
          word-break: break-all;
          line-height: 1.35;
        }
        @media (max-width: 980px) {
          .panelGrid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 520px) {
          .row2 {
            grid-template-columns: 1fr;
          }
          .grid {
            grid-template-columns: 1fr;
          }
          .h1 {
            font-size: 24px;
          }
        }
      `}</style>

      <header className="topbar">
        <div className="titleRow">
          <h1 className="h1">QR 생성</h1>
          <span className="pill">선택 매장: {storeId || "—"}</span>
        </div>
        <p className="desc">체크한 항목만 PNG로 다운로드합니다. (QR URL에 store 파라미터가 포함됩니다)</p>
      </header>

      <section className="panelGrid">
        <div className="card">
          <h2 className="cardTitle">설정</h2>

          <div className="formGrid">
            <div className="field">
              <div className="label">매장명 (매장정보에서 자동 반영)</div>
              <input className="input" value={storeName} disabled />
            </div>

            <div className="field">
              <div className="label">카운터 QR 안내 문구 작성</div>
              <textarea className="textarea" value={counterDesc} onChange={(e) => setCounterDesc(e.target.value)} />
            </div>

            <div className="checkRow">
              <label className="checkItem">
                <input
                  type="checkbox"
                  checked={makeCounter}
                  onChange={(e) => {
                    setMakeCounter(e.target.checked);
                    setShowPreview(false);
                  }}
                />
                카운터 QR 생성 <small>(A4 1장에 2개)</small>
              </label>

              <label className="checkItem">
                <input
                  type="checkbox"
                  checked={makeTables}
                  onChange={(e) => {
                    setMakeTables(e.target.checked);
                    setShowPreview(false);
                  }}
                />
                테이블 QR 생성 <small>(A4 1장에 12개)</small>
              </label>
            </div>

            {makeTables ? (
              <>
                <div className="row2">
                  <div className="field">
                    <div className="label">테이블 범위 시작</div>
                    <input className="input" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} inputMode="numeric" />
                  </div>
                  <div className="field">
                    <div className="label">테이블 범위 종료</div>
                    <input className="input" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} inputMode="numeric" />
                  </div>
                </div>

                <div className="field">
                  <div className="label">추가 테이블(선택)</div>
                  <input
                    className="input"
                    value={customTables}
                    onChange={(e) => setCustomTables(e.target.value)}
                    placeholder='예: "21,22,30" 또는 "1~5"'
                  />
                </div>
              </>
            ) : null}

            <div className="btnRow">
              <button
                className="btn btnPrimary"
                onClick={() => {
                  setSeed(String(Date.now()));
                  downloadCounterPng();
                }}
                disabled={!makeCounter || !origin || !storeId}
              >
                카운터 QR 다운로드(PNG)
              </button>

              <button
                className="btn btnPrimary"
                onClick={() => {
                  setSeed(String(Date.now()));
                  downloadTablePng();
                }}
                disabled={!makeTables || tableNumbers.length === 0 || !origin || !storeId}
              >
                테이블 QR 다운로드(PNG)
              </button>

              <button className="btn" onClick={onTogglePreview} disabled={!origin || !storeId}>
                {showPreview ? "미리보기(샘플) 닫기" : "미리보기(샘플)"}
              </button>

              <a className="btn" href="/admin">
                관리자 홈
              </a>
            </div>

            <div className="hint">
              선택됨: <b>{selectedCount}</b>개
            </div>
          </div>
        </div>

        <div className="card">
          <div className="previewHead">
            <h2 className="cardTitle">미리보기(샘플)</h2>
            <div className="count">{showPreview ? `샘플 ${previewItems.length}개` : ""}</div>
          </div>

          {!origin ? (
            <p className="desc" style={{ marginTop: 10 }}>
              브라우저 정보를 불러오는 중…
            </p>
          ) : !showPreview ? (
            <p className="desc" style={{ marginTop: 10 }}>
              미리보기(샘플)을 눌러 확인하세요.
            </p>
          ) : previewItems.length === 0 ? (
            <p className="desc" style={{ marginTop: 10 }}>
              생성할 항목을 체크해 주세요.
            </p>
          ) : (
            <div className="grid">
              {previewItems.map((it) => (
                <div className="qrCard" key={it.key}>
                  <div className="qrLabel">
                    <strong>{it.label}</strong>
                    <span>{storeName}</span>
                  </div>

                  <div className="qrImgWrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.imgSrc} alt={`${it.label} QR`} style={{ maxWidth: PREVIEW_QR_SIZE }} />
                  </div>

                  <div className="qrUrl">{it.url}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function trimMiddle(s: string, maxLen: number) {
  const str = String(s || "");
  if (str.length <= maxLen) return str;
  const head = Math.ceil((maxLen - 3) / 2);
  const tail = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, head)}...${str.slice(str.length - tail)}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  roundedClipPath(ctx, x, y, w, h, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function roundedClipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}
export default function AdminQrPage() {
  return (
    <Suspense fallback={<div className="card"><p className="muted">로딩 중...</p></div>}>
      <AdminQrPageInner />
    </Suspense>
  );
}