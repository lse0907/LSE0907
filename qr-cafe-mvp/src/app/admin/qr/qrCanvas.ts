import { createQrDataUrl } from "./qrEncoder";
import type { AdminQrDesignSettings, PaperPreset } from "./qrTypes";

export type TableSheetPreset = { label: string; cols: number; rows: number };

export type CounterPosterCanvasOptions = {
  design: AdminQrDesignSettings;
  preset: PaperPreset;
  counterPrintPreset: string;
  targetUrl: string;
  storeName: string;
  mainImage: string;
  logoImage: string;
};

export type TableSheetCanvasOptions = {
  design: AdminQrDesignSettings;
  preset: TableSheetPreset;
  tableNumbers: number[];
  storeName: string;
  logoImage: string;
  getTableUrl: (n: number) => string;
};

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${src}`));
    img.src = src;
  });
}

function trimMiddle(s: string, maxLen: number) {
  const str = String(s || "");
  if (str.length <= maxLen) return str;
  const head = Math.ceil((maxLen - 3) / 2);
  const tail = Math.floor((maxLen - 3) / 2);
  return `${str.slice(0, head)}...${str.slice(str.length - tail)}`;
}

function roundedClipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
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

function formatTableLabel(n: number) {
  return `테이블 ${n}`;
}

function getCounterScale(counterPrintPreset: string) {
  if (counterPrintPreset === "a3_poster") return 1.35;
  if (counterPrintPreset === "a5_card") return 0.86;
  if (counterPrintPreset === "a4_2up") return 0.82;
  return 1;
}

export async function createCounterPosterCanvas({
  design: ds,
  preset,
  counterPrintPreset,
  targetUrl,
  storeName,
  mainImage,
  logoImage,
}: CounterPosterCanvasOptions) {
  const A4_W = preset.width;
  const A4_H = preset.height;
  const copies = preset.copies || 1;
  const posterH = Math.floor(A4_H / copies);
  const scale = getCounterScale(counterPrintPreset);

  const padding = Math.max(36, Math.round(A4_W * 0.04 * scale));
  const imgH = Math.floor(posterH * (counterPrintPreset === "a5_card" ? 0.54 : 0.62));
  const bottomH = posterH - imgH;
  const logoBox = Math.round(70 * scale);
  const qrMax = counterPrintPreset === "a3_poster" ? 560 : counterPrintPreset === "a4_poster" ? 420 : 300;
  const qrSize = Math.min(Math.round(A4_W * 0.25), Math.round(bottomH * 0.72), qrMax);

  const qrSrc = createQrDataUrl(targetUrl, 720);
  const qrImg = await loadImage(qrSrc).catch((e) => {
    throw new Error("QR 이미지 로드 실패\n" + String(e));
  });
  const heroImg = ds.show_main_image && mainImage ? await loadImage(mainImage).catch(() => null) : null;
  const logoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;

  const canvas = document.createElement("canvas");
  canvas.width = A4_W;
  canvas.height = A4_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas를 생성할 수 없습니다.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, A4_W, A4_H);

  for (let i = 0; i < copies; i++) {
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
      g.addColorStop(0, ds.template_key === "soft_round" ? ds.accent_color : "#111827");
      g.addColorStop(1, ds.template_key === "premium_dark" ? "#030712" : "#374151");
      ctx.fillStyle = g;
      ctx.fillRect(0, topY, A4_W, imgH);
    }

    ctx.fillStyle = ds.template_key === "soft_round" ? "#fff7ed" : ds.template_key === "premium_dark" ? "#030712" : ds.accent_color || "#111827";
    ctx.fillRect(0, topY + imgH, A4_W, bottomH);

    const textX = padding;
    const textY = topY + imgH + padding;

    const headlineX = ds.show_logo ? textX + logoBox + Math.round(18 * scale) : textX;
    if (ds.show_logo) {
      if (logoImg) {
        roundRect(ctx, textX, textY, logoBox, logoBox, Math.round(18 * scale), "rgba(255,255,255,0.12)", "rgba(255,255,255,0.22)");
        ctx.save();
        ctx.beginPath();
        roundedClipPath(ctx, textX, textY, logoBox, logoBox, Math.round(18 * scale));
        ctx.clip();
        ctx.drawImage(logoImg, textX, textY, logoBox, logoBox);
        ctx.restore();
      } else {
        roundRect(ctx, textX, textY, logoBox, logoBox, Math.round(18 * scale), "rgba(255,255,255,0.12)", "rgba(255,255,255,0.22)");
        ctx.fillStyle = "#ffffff";
        ctx.font = `900 ${Math.round(26 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
        ctx.fillText(storeName.trim().slice(0, 1) || "QR", textX + Math.round(22 * scale), textY + Math.round(46 * scale));
      }
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `950 ${Math.round(34 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
    ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, headlineX, textY + Math.round(34 * scale));

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `850 ${Math.round(18 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
    ctx.fillText(ds.counter_title, headlineX, textY + Math.round(62 * scale));

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `800 ${Math.round(18 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
    const lines = (ds.counter_description || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    let dy = textY + Math.round(96 * scale);
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, textX, dy);
      dy += Math.round(26 * scale);
    }

    const qrX = A4_W - padding - qrSize;
    const qrY = topY + imgH + Math.floor((bottomH - qrSize) / 2);
    const qrPad = Math.round(12 * scale);
    roundRect(ctx, qrX - qrPad, qrY - qrPad, qrSize + qrPad * 2, qrSize + qrPad * 2, Math.round(18 * scale), "#ffffff", "rgba(255,255,255,0.18)");
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `800 ${Math.round(14 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
    if (ds.show_target_url) ctx.fillText(trimMiddle(targetUrl, 68), padding, topY + posterH - Math.round(22 * scale));

    if (i < copies - 1) {
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, posterH);
      ctx.lineTo(A4_W, posterH);
      ctx.stroke();
    }
  }

  return canvas;
}

export async function createTableSheetCanvases({
  design: ds,
  preset,
  tableNumbers,
  storeName,
  logoImage,
  getTableUrl,
}: TableSheetCanvasOptions) {
  const A4_W = 1240;
  const A4_H = 1754;
  const COLS = preset.cols;
  const ROWS = preset.rows;
  const PER_PAGE = COLS * ROWS;
  const padding = 34;
  const gap = 18;
  const cardW = Math.floor((A4_W - padding * 2 - gap * (COLS - 1)) / COLS);
  const cardH = Math.floor((A4_H - padding * 2 - gap * (ROWS - 1)) / ROWS);
  const innerPad = 16;
  const labelH = 76;
  const qrSize = Math.min(240, cardW - innerPad * 2);
  const pages: number[][] = [];
  const tableLogoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;

  for (let i = 0; i < tableNumbers.length; i += PER_PAGE) pages.push(tableNumbers.slice(i, i + PER_PAGE));
  if (pages.length === 0) pages.push([]);

  const canvases: HTMLCanvasElement[] = [];
  for (const pageNums of pages) {
    const loaded = await Promise.all(
      pageNums.map((n) => {
        const url = getTableUrl(n);
        const src = createQrDataUrl(url, 720);
        return loadImage(src).then((img) => ({ n, img, url }));
      })
    );

    const canvas = document.createElement("canvas");
    canvas.width = A4_W;
    canvas.height = A4_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas를 생성할 수 없습니다.");

    const isPremium = ds.template_key === "premium_dark";
    const isPhoto = ds.template_key === "cafe_poster";
    const isRound = ds.template_key === "soft_round";
    const pageBg = isPremium ? "#0f172a" : isRound ? "#fff7ed" : isPhoto ? "#f8fafc" : "#ffffff";
    ctx.fillStyle = pageBg;
    ctx.fillRect(0, 0, A4_W, A4_H);
    ctx.fillStyle = isPremium ? "rgba(255,255,255,0.86)" : "#111827";
    ctx.font = "900 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
    ctx.fillText(`${ds.show_store_name ? storeName : ds.table_title} · 테이블 QR`, padding, 26);

    for (let i = 0; i < loaded.length; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const x = padding + col * (cardW + gap);
      const y = padding + row * (cardH + gap) + 10;
      const cardRadius = isRound ? 28 : isPremium ? 22 : 16;
      const cardFill = isPremium ? "#111827" : isRound ? "#fffbeb" : "#ffffff";
      const cardStroke = isPremium ? "rgba(255,255,255,0.22)" : isPhoto ? ds.accent_color : isRound ? "#fed7aa" : "#e5e7eb";
      const titleColor = isPremium ? "#ffffff" : "#111827";
      const mutedColor = isPremium ? "rgba(255,255,255,0.72)" : "#6b7280";
      const brandFill = isPremium ? "rgba(255,255,255,0.10)" : isRound ? "#fed7aa" : isPhoto ? ds.accent_color : "#f9fafb";

      roundRect(ctx, x, y, cardW, cardH, cardRadius, cardFill, cardStroke);
      if (isPhoto) {
        const g = ctx.createLinearGradient(x, y, x + cardW, y + Math.max(64, Math.floor(cardH * 0.22)));
        g.addColorStop(0, ds.accent_color || "#111827");
        g.addColorStop(1, "#111827");
        roundRect(ctx, x + 1, y + 1, cardW - 2, Math.max(64, Math.floor(cardH * 0.22)), cardRadius, g);
      } else if (isRound || isPremium) {
        roundRect(ctx, x + innerPad, y + innerPad, cardW - innerPad * 2, 36, 18, brandFill);
      }

      const markSize = ds.show_logo ? 30 : 0;
      const titleX = x + innerPad + (markSize ? markSize + 8 : 0);
      const titleY = y + 30;
      if (ds.show_logo) {
        const markFill = isPremium ? "rgba(255,255,255,0.14)" : isPhoto ? "rgba(255,255,255,0.2)" : ds.accent_color || "#111827";
        roundRect(ctx, x + innerPad, y + 12, markSize, markSize, 10, markFill, isPremium ? "rgba(255,255,255,0.2)" : undefined);
        if (tableLogoImg) {
          ctx.save();
          ctx.beginPath();
          roundedClipPath(ctx, x + innerPad, y + 12, markSize, markSize, 10);
          ctx.clip();
          ctx.drawImage(tableLogoImg, x + innerPad, y + 12, markSize, markSize);
          ctx.restore();
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.font = "900 15px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
          ctx.fillText(storeName.trim().slice(0, 1) || "Q", x + innerPad + 9, y + 33);
        }
      }

      ctx.fillStyle = isPhoto ? "#ffffff" : titleColor;
      ctx.font = "950 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(ds.show_store_name ? storeName : ds.table_title, titleX, titleY);
      ctx.fillStyle = isPhoto ? "rgba(255,255,255,0.9)" : mutedColor;
      ctx.font = "900 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(formatTableLabel(loaded[i].n), x + innerPad, y + 62);

      const qrX = x + Math.floor((cardW - qrSize) / 2);
      const qrY = y + labelH + (isPhoto ? 8 : 0);
      roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, isRound ? 24 : 16, "#ffffff", isPremium ? "rgba(255,255,255,0.25)" : "#e5e7eb");
      ctx.drawImage(loaded[i].img, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = mutedColor;
      ctx.font = "850 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      ctx.fillText(ds.table_description || "QR을 찍고 메뉴를 선택해 주세요.", x + innerPad, y + cardH - (ds.show_target_url ? 32 : 16));
      ctx.fillStyle = isPremium ? "rgba(255,255,255,0.5)" : "#9ca3af";
      ctx.font = "800 10.5px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif";
      if (ds.show_target_url) ctx.fillText(trimMiddle(loaded[i].url, 52), x + innerPad, y + cardH - 14);
    }

    canvases.push(canvas);
  }

  return canvases;
}
