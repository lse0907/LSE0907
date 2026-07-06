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
  mainImage: string;
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

function drawLogoBadge(
  ctx: CanvasRenderingContext2D,
  logoImg: HTMLImageElement | null,
  storeName: string,
  x: number,
  y: number,
  size: number,
  radius: number,
  bg = "#ffffff",
  textColor = "#111827",
  stroke?: string
) {
  roundRect(ctx, x, y, size, size, radius, bg, stroke);
  if (logoImg) {
    ctx.save();
    ctx.beginPath();
    roundedClipPath(ctx, x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(logoImg, x, y, size, size);
    ctx.restore();
    return;
  }
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${Math.round(size * 0.38)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
  ctx.fillText(storeName.trim().slice(0, 1) || "Q", x + size / 2, y + size / 2 + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawQrCard(ctx: CanvasRenderingContext2D, qrImg: HTMLImageElement, x: number, y: number, size: number, radius: number, stroke = "#e5e7eb") {
  const pad = Math.max(14, Math.round(size * 0.05));
  roundRect(ctx, x - pad, y - pad, size + pad * 2, size + pad * 2, radius, "#ffffff", stroke);
  ctx.drawImage(qrImg, x, y, size, size);
}

function fillCoverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const srcRatio = sw / sh;
  const dstRatio = w / h;
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
  ctx.drawImage(img, cropX, cropY, cropW, cropH, x, y, w, h);
}

function drawWrappedLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineH: number, maxLines: number) {
  let dy = y;
  for (const line of lines.slice(0, maxLines)) {
    ctx.fillText(line, x, dy);
    dy += lineH;
  }
}

function counterLogoSize(template: string, scale: number) {
  if (template === "premium_dark") return Math.round(118 * scale);
  if (template === "soft_round") return Math.round(92 * scale);
  if (template === "cafe_poster") return Math.round(84 * scale);
  return Math.round(96 * scale);
}

function counterQrSize(template: string, base: number) {
  if (template === "simple") return Math.round(base * 1.12);
  if (template === "premium_dark") return Math.round(base * 1.08);
  if (template === "soft_round") return Math.round(base * 0.98);
  return Math.round(base * 1.02);
}

function drawImageTint(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
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
  const padding = Math.max(36, Math.round(A4_W * 0.045 * scale));
  const qrMax = counterPrintPreset === "a3_poster" ? 620 : counterPrintPreset === "a4_poster" ? 500 : 330;

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

  const lines = (ds.counter_description || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  for (let i = 0; i < copies; i++) {
    const topY = i * posterH;
    const template = ds.template_key;
    const accent = ds.accent_color || "#111827";
    const logoSize = counterLogoSize(template, scale);
    const qrBaseSize = Math.min(Math.round(A4_W * 0.34), Math.round(posterH * 0.38), qrMax);
    const qrSize = counterQrSize(template, qrBaseSize);

    if (template === "cafe_poster") {
      if (heroImg) fillCoverImage(ctx, heroImg, 0, topY, A4_W, posterH);
      else {
        const g = ctx.createLinearGradient(0, topY, A4_W, topY + posterH);
        g.addColorStop(0, accent);
        g.addColorStop(1, "#111827");
        ctx.fillStyle = g;
        ctx.fillRect(0, topY, A4_W, posterH);
      }
      drawImageTint(ctx, "#000000", 0, topY, A4_W, posterH, 0.32);
      const panelW = Math.round(A4_W - padding * 2);
      const panelH = Math.round(posterH * 0.58);
      const panelX = padding;
      const panelY = topY + posterH - panelH - padding;
      roundRect(ctx, panelX, panelY, panelW, panelH, Math.round(34 * scale), "rgba(255,255,255,0.94)", "rgba(255,255,255,0.62)");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, panelX + Math.round(34 * scale), panelY + Math.round(34 * scale), logoSize, Math.round(22 * scale), "#ffffff", "#111827", "#e5e7eb");
      ctx.fillStyle = "#111827";
      ctx.font = `950 ${Math.round(42 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, panelX + Math.round(34 * scale), panelY + Math.round(150 * scale));
      ctx.fillStyle = accent;
      ctx.font = `900 ${Math.round(24 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, panelX + Math.round(34 * scale), panelY + Math.round(192 * scale));
      ctx.fillStyle = "#374151";
      ctx.font = `800 ${Math.round(20 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, panelX + Math.round(34 * scale), panelY + Math.round(236 * scale), Math.round(31 * scale), 3);
      const qrX = panelX + panelW - qrSize - Math.round(40 * scale);
      const qrY = panelY + Math.round((panelH - qrSize) / 2);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(24 * scale), "#d1d5db");
    } else if (template === "premium_dark") {
      const heroH = Math.round(posterH * 0.62);
      if (heroImg) fillCoverImage(ctx, heroImg, 0, topY, A4_W, heroH);
      else {
        const g = ctx.createLinearGradient(0, topY, A4_W, topY + heroH);
        g.addColorStop(0, "#374151");
        g.addColorStop(1, "#020617");
        ctx.fillStyle = g;
        ctx.fillRect(0, topY, A4_W, heroH);
      }
      drawImageTint(ctx, "#020617", 0, topY, A4_W, heroH, 0.42);
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, topY + heroH, A4_W, posterH - heroH);
      const qrX = A4_W / 2 - qrSize / 2;
      const qrY = topY + heroH - Math.round(qrSize * 0.34);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(28 * scale), "rgba(255,255,255,0.28)");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, padding, topY + heroH + Math.round(56 * scale), logoSize, Math.round(999 * scale), "rgba(255,255,255,0.96)", "#111827", "rgba(255,255,255,0.22)");
      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.font = `900 ${Math.round(16 * scale)}px Georgia, Times New Roman, ui-serif, Noto Sans KR, serif`;
      ctx.fillText("SCAN & ORDER", padding, topY + heroH + Math.round(38 * scale));
      ctx.fillStyle = "#ffffff";
      ctx.font = `950 ${Math.round(44 * scale)}px Georgia, Times New Roman, ui-serif, Noto Sans KR, serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, padding + logoSize + Math.round(26 * scale), topY + heroH + Math.round(104 * scale));
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.font = `850 ${Math.round(24 * scale)}px Georgia, Times New Roman, ui-serif, Noto Sans KR, serif`;
      ctx.fillText(ds.counter_title, padding + logoSize + Math.round(26 * scale), topY + heroH + Math.round(145 * scale));
      ctx.font = `800 ${Math.round(20 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, padding, topY + posterH - Math.round(96 * scale), Math.round(31 * scale), 2);
      ctx.fillStyle = accent;
      ctx.fillRect(padding, topY + posterH - Math.round(34 * scale), A4_W - padding * 2, Math.max(4, Math.round(5 * scale)));
    } else if (template === "soft_round") {
      ctx.fillStyle = "#fff7ed";
      ctx.fillRect(0, topY, A4_W, posterH);
      if (heroImg) {
        fillCoverImage(ctx, heroImg, 0, topY, A4_W, posterH);
        drawImageTint(ctx, "#fff7ed", 0, topY, A4_W, posterH, 0.78);
      }
      ctx.fillStyle = "rgba(251,146,60,0.18)";
      ctx.beginPath();
      ctx.arc(A4_W - padding, topY + padding, Math.round(170 * scale), 0, Math.PI * 2);
      ctx.fill();
      const cardX = padding;
      const cardY = topY + Math.round(padding * 1.15);
      const cardW = A4_W - padding * 2;
      const cardH = posterH - Math.round(padding * 2.3);
      roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(48 * scale), "rgba(255,255,255,0.88)", "#fed7aa");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, cardX + Math.round(38 * scale), cardY + Math.round(38 * scale), logoSize, Math.round(26 * scale), "#ffedd5", "#9a3412", "#fdba74");
      ctx.fillStyle = "#111827";
      ctx.font = `950 ${Math.round(40 * scale)}px ui-rounded, ui-sans-serif, system-ui, -apple-system, Segoe UI, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, cardX + Math.round(42 * scale), cardY + Math.round(162 * scale));
      ctx.fillStyle = "#9a3412";
      ctx.font = `850 ${Math.round(24 * scale)}px ui-rounded, ui-sans-serif, system-ui, -apple-system, Segoe UI, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, cardX + Math.round(42 * scale), cardY + Math.round(204 * scale));
      const qrX = cardX + cardW - qrSize - Math.round(54 * scale);
      const qrY = cardY + Math.round(cardH * 0.38);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(30 * scale), "#fed7aa");
      ctx.fillStyle = "#57534e";
      ctx.font = `800 ${Math.round(21 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      drawWrappedLines(ctx, lines, cardX + Math.round(42 * scale), qrY + Math.round(42 * scale), Math.round(32 * scale), 3);
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, topY, A4_W, posterH);
      ctx.fillStyle = "rgba(15,23,42,0.05)";
      ctx.fillRect(0, topY, A4_W, Math.round(posterH * 0.18));
      const cardX = padding;
      const cardY = topY + padding;
      const cardW = A4_W - padding * 2;
      const cardH = posterH - padding * 2;
      roundRect(ctx, cardX, cardY, cardW, cardH, Math.round(28 * scale), "#ffffff", "#e5e7eb");
      if (ds.show_logo) drawLogoBadge(ctx, logoImg, storeName, cardX + Math.round(42 * scale), cardY + Math.round(42 * scale), logoSize, Math.round(20 * scale), "#f9fafb", "#111827", "#e5e7eb");
      ctx.fillStyle = "#111827";
      ctx.font = `950 ${Math.round(44 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.show_store_name ? storeName : ds.counter_title, cardX + Math.round(42 * scale), cardY + Math.round(178 * scale));
      ctx.fillStyle = accent;
      ctx.font = `900 ${Math.round(26 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.fillText(ds.counter_title, cardX + Math.round(42 * scale), cardY + Math.round(224 * scale));
      const qrX = A4_W / 2 - qrSize / 2;
      const qrY = cardY + Math.round(cardH * 0.43);
      drawQrCard(ctx, qrImg, qrX, qrY, qrSize, Math.round(22 * scale), "#d1d5db");
      ctx.fillStyle = "#4b5563";
      ctx.font = `800 ${Math.round(21 * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      ctx.textAlign = "center";
      drawWrappedLines(ctx, lines, A4_W / 2, qrY + qrSize + Math.round(60 * scale), Math.round(32 * scale), 3);
      ctx.textAlign = "start";
      ctx.fillStyle = accent;
      ctx.fillRect(cardX + Math.round(42 * scale), topY + posterH - Math.round(72 * scale), cardW - Math.round(84 * scale), Math.max(4, Math.round(5 * scale)));
    }

    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    if (i < copies - 1) {
      ctx.strokeStyle = "#e5e7eb";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, topY + posterH);
      ctx.lineTo(A4_W, topY + posterH);
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
  mainImage,
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
  const density = PER_PAGE <= 4 ? "large" : PER_PAGE <= 8 ? "medium" : "compact";
  const innerPad = density === "large" ? 24 : density === "medium" ? 18 : 14;
  const pages: number[][] = [];
  const tableLogoImg = ds.show_logo && logoImage ? await loadImage(logoImage).catch(() => null) : null;
  const tableHeroImg = density === "large" && ds.show_main_image && mainImage ? await loadImage(mainImage).catch(() => null) : null;

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
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, A4_W, A4_H);

    for (let i = 0; i < loaded.length; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const x = padding + col * (cardW + gap);
      const y = padding + row * (cardH + gap);
      const cardRadius = isRound ? (density === "large" ? 34 : 26) : isPremium ? 24 : 16;
      const cardFill = isPremium ? "#111827" : isRound ? "#fffbeb" : "#ffffff";
      const cardStroke = isPremium ? "rgba(255,255,255,0.22)" : isPhoto ? ds.accent_color : isRound ? "#fed7aa" : "#e5e7eb";
      const titleColor = isPremium ? "#ffffff" : "#111827";
      const mutedColor = isPremium ? "rgba(255,255,255,0.72)" : "#6b7280";
      const brandFill = isPremium ? "rgba(255,255,255,0.10)" : isRound ? "#fed7aa" : isPhoto ? ds.accent_color : "#f9fafb";
      const markSize = ds.show_logo ? (density === "large" ? 54 : density === "medium" ? 40 : 30) : 0;
      const tableLabelSize = density === "large" ? 34 : density === "medium" ? 26 : 22;
      const brandFontSize = density === "large" ? 20 : density === "medium" ? 16 : 14;
      const descFontSize = density === "large" ? 16 : density === "medium" ? 13 : 12;
      const qrSize = density === "large" ? Math.min(Math.round(cardW * 0.48), Math.round(cardH * 0.42), 330) : density === "medium" ? Math.min(Math.round(cardW * 0.70), Math.round(cardH * 0.48), 260) : Math.min(232, cardW - innerPad * 2, Math.round(cardH * 0.52));

      roundRect(ctx, x, y, cardW, cardH, cardRadius, cardFill, cardStroke);

      if (density === "large" && tableHeroImg && (isPhoto || isPremium || isRound)) {
        const heroH = isPremium ? Math.round(cardH * 0.44) : isPhoto ? Math.round(cardH * 0.36) : cardH;
        ctx.save();
        ctx.beginPath();
        roundedClipPath(ctx, x + 1, y + 1, cardW - 2, isRound ? cardH - 2 : heroH, cardRadius);
        ctx.clip();
        fillCoverImage(ctx, tableHeroImg, x + 1, y + 1, cardW - 2, isRound ? cardH - 2 : heroH);
        ctx.restore();
        if (isRound) drawImageTint(ctx, "#fff7ed", x + 1, y + 1, cardW - 2, cardH - 2, 0.80);
        else drawImageTint(ctx, isPremium ? "#020617" : "#000000", x + 1, y + 1, cardW - 2, heroH, isPremium ? 0.48 : 0.26);
      } else if (isPhoto) {
        const g = ctx.createLinearGradient(x, y, x + cardW, y + Math.max(64, Math.floor(cardH * 0.22)));
        g.addColorStop(0, ds.accent_color || "#111827");
        g.addColorStop(1, "#111827");
        roundRect(ctx, x + 1, y + 1, cardW - 2, Math.max(64, Math.floor(cardH * 0.22)), cardRadius, g);
      } else if (isRound || isPremium) {
        roundRect(ctx, x + innerPad, y + innerPad, cardW - innerPad * 2, density === "large" ? 52 : 36, 18, brandFill);
      }

      if (isPremium || isRound) {
        const logoX = density === "large" ? x + innerPad : x + Math.floor((cardW - markSize) / 2);
        const logoY = density === "large" ? y + innerPad : y + 14;
        if (ds.show_logo) {
          drawLogoBadge(
            ctx,
            tableLogoImg,
            storeName,
            logoX,
            logoY,
            markSize,
            isRound ? 16 : 999,
            isPremium ? "rgba(255,255,255,0.96)" : "#ffedd5",
            isPremium ? "#111827" : "#9a3412",
            isPremium ? "rgba(255,255,255,0.22)" : "#fdba74"
          );
        }
        ctx.textAlign = density === "large" ? "start" : "center";
        ctx.fillStyle = titleColor;
        ctx.font = isPremium
          ? `950 ${brandFontSize}px Georgia, Times New Roman, ui-serif, Noto Sans KR, serif`
          : `950 ${brandFontSize}px ui-rounded, ui-sans-serif, system-ui, -apple-system, Segoe UI, Noto Sans KR, sans-serif`;
        const brandX = density === "large" ? x + innerPad + (markSize ? markSize + 14 : 0) : x + cardW / 2;
        const brandY = density === "large" ? y + innerPad + 22 : y + (ds.show_logo ? 68 : 34);
        ctx.fillText(ds.show_store_name ? storeName : ds.table_title, brandX, brandY);
        ctx.fillStyle = isPremium ? "#ffffff" : "#9a3412";
        ctx.font = isPremium
          ? `950 ${tableLabelSize}px Georgia, Times New Roman, ui-serif, Noto Sans KR, serif`
          : `950 ${tableLabelSize}px ui-rounded, ui-sans-serif, system-ui, -apple-system, Segoe UI, Noto Sans KR, sans-serif`;
        ctx.fillText(formatTableLabel(loaded[i].n), density === "large" ? brandX : x + cardW / 2, density === "large" ? y + innerPad + 62 : y + (ds.show_logo ? 98 : 66));
        ctx.textAlign = "start";
      } else {
        const titleX = x + innerPad + (markSize ? markSize + 10 : 0);
        if (ds.show_logo) {
          const markFill = isPhoto ? "rgba(255,255,255,0.22)" : ds.accent_color || "#111827";
          roundRect(ctx, x + innerPad, y + innerPad, markSize, markSize, 12, markFill);
          if (tableLogoImg) {
            ctx.save();
            ctx.beginPath();
            roundedClipPath(ctx, x + innerPad, y + innerPad, markSize, markSize, 12);
            ctx.clip();
            ctx.drawImage(tableLogoImg, x + innerPad, y + innerPad, markSize, markSize);
            ctx.restore();
          } else {
            ctx.fillStyle = "#ffffff";
            ctx.font = `900 ${Math.round(markSize * 0.42)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
            ctx.fillText(storeName.trim().slice(0, 1) || "Q", x + innerPad + Math.round(markSize * 0.30), y + innerPad + Math.round(markSize * 0.68));
          }
        }
        ctx.fillStyle = isPhoto ? "#ffffff" : titleColor;
        ctx.font = `950 ${brandFontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
        ctx.fillText(ds.show_store_name ? storeName : ds.table_title, titleX, y + innerPad + Math.round(markSize ? markSize * 0.40 : 18));
        ctx.fillStyle = isPhoto ? "rgba(255,255,255,0.92)" : mutedColor;
        ctx.font = `900 ${tableLabelSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
        ctx.fillText(formatTableLabel(loaded[i].n), x + innerPad, y + (density === "large" ? 96 : 62));
      }

      const qrX = density === "large" && (isPhoto || isPremium || isRound) ? x + cardW - qrSize - innerPad - 6 : x + Math.floor((cardW - qrSize) / 2);
      const qrY = density === "large" ? y + Math.round(cardH * 0.38) : y + (isPremium || isRound ? 118 : 82);
      roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, isRound ? 24 : 16, "#ffffff", isPremium ? "rgba(255,255,255,0.25)" : "#e5e7eb");
      ctx.drawImage(loaded[i].img, qrX, qrY, qrSize, qrSize);

      ctx.fillStyle = mutedColor;
      ctx.font = `850 ${descFontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans KR, sans-serif`;
      const descX = density === "large" && (isPhoto || isPremium || isRound) ? x + innerPad : x + innerPad;
      const descY = y + cardH - (density === "large" ? 28 : 16);
      ctx.fillText(ds.table_description || "QR을 찍고 메뉴를 선택해 주세요.", descX, descY);
    }

    canvases.push(canvas);
  }

  return canvases;
}
